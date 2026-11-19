use crate::launcher_server::fetch_project_config;
use crate::log_err;
use crate::state::dto::GlobalState;
use crate::utils::backup_corrupt_file;
use crate::utils::download_file::write_atomic;
use crate::utils::errors::LauncherError;
use crate::{
    state::dto::ProjectConfig,
    utils::env_info::{launcher_path, normalize_server_url},
};
use anyhow::{Context, Result};
use tokio::fs::{create_dir_all, read_to_string, remove_file};
use tokio::sync::{Mutex, MutexGuard};
use toml::{from_str, to_string_pretty};

static PROJECT_CONFIG_WRITE_LOCK: Mutex<()> = Mutex::const_new(());

pub(crate) async fn project_config_write_lock() -> MutexGuard<'static, ()> {
    PROJECT_CONFIG_WRITE_LOCK.lock().await
}

pub(crate) fn ensure_project_selected(project_name: &str) -> Result<()> {
    if project_name.trim().is_empty() {
        return Err(LauncherError::ProjectNotSelected.into());
    }
    Ok(())
}

pub(crate) async fn current_project_config(state: &Mutex<GlobalState>) -> Result<ProjectConfig> {
    let config = state.lock().await.project_config.clone();
    ensure_project_selected(&config.project_name)?;
    Ok(config)
}

pub fn validate_project_name(name: &str) -> Result<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(LauncherError::ProjectNameEmpty.into());
    }
    if trimmed.chars().count() > 64 {
        return Err(LauncherError::ProjectNameTooLong.into());
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '.']) {
        return Err(LauncherError::ProjectNameInvalidChars.into());
    }
    if trimmed.eq_ignore_ascii_case("config") {
        return Err(LauncherError::ProjectNameReserved.into());
    }
    Ok(())
}

pub fn validated_project_name(name: &str) -> Result<&str> {
    let trimmed = name.trim();
    validate_project_name(trimmed)?;
    Ok(trimmed)
}

impl ProjectConfig {
    pub(crate) async fn save_config(&self) -> Result<()> {
        let toml_string =
            to_string_pretty(self).context("Не удалось сериализовать конфиг профиля")?;
        let path = config_file_path(&self.project_name)?;
        let config_dir = launcher_path(Some("config"))?;
        create_dir_all(&config_dir)
            .await
            .with_context(|| format!("Не удалось создать каталог конфигов {config_dir:?}"))?;
        write_atomic(&path, toml_string.as_bytes())
            .await
            .with_context(|| {
                format!("Не удалось записать конфиг профиля {:?}", self.project_name)
            })?;
        Ok(())
    }
}

pub(crate) async fn update_project_config(
    state: &Mutex<GlobalState>,
    mutate: impl AsyncFnOnce(&mut ProjectConfig) -> Result<()>,
) -> Result<ProjectConfig> {
    let _write_guard = PROJECT_CONFIG_WRITE_LOCK.lock().await;
    let mut project_config = {
        let guard = state.lock().await;
        guard.project_config.clone()
    };
    mutate(&mut project_config).await?;
    project_config.save_config().await?;
    {
        let mut guard = state.lock().await;
        guard.project_config = project_config.clone();
    }
    Ok(project_config)
}

pub(crate) async fn set_project_config(
    state: &Mutex<GlobalState>,
    config: ProjectConfig,
) -> Result<()> {
    let _write_guard = PROJECT_CONFIG_WRITE_LOCK.lock().await;
    let mut guard = state.lock().await;
    guard.project_config = config;
    Ok(())
}

pub async fn load_config(project_name: &str) -> Result<ProjectConfig> {
    let path = config_file_path(project_name)?;
    let content = read_to_string(&path).await?;
    let config: ProjectConfig =
        from_str(&content).with_context(|| format!("Повреждён конфиг профиля {:?}", path))?;
    Ok(config)
}

pub async fn load_config_or_default(project_name: &str) -> Result<ProjectConfig> {
    match load_config(project_name).await {
        Ok(config) => Ok(config),
        Err(e) if is_missing_config(&e) => Ok(default_project_config(project_name)),
        Err(e) if is_corrupt_config(&e) => recover_corrupt_config(project_name, &e).await,
        Err(e) => Err(e),
    }
}

fn default_project_config(project_name: &str) -> ProjectConfig {
    ProjectConfig {
        project_name: project_name.to_string(),
        ..ProjectConfig::default()
    }
}

fn config_file_path(project_name: &str) -> Result<std::path::PathBuf> {
    validate_project_name(project_name)?;
    Ok(launcher_path(Some("config"))?.join(format!("{}.toml", project_name)))
}

pub(crate) fn is_missing_config(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound)
    })
}

pub(crate) fn is_corrupt_config(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| cause.is::<toml::de::Error>())
}

pub(crate) async fn in_memory_project_config(
    state: &Mutex<GlobalState>,
    project_name: &str,
) -> Option<ProjectConfig> {
    let guard = state.lock().await;
    (guard.project_config.project_name == project_name).then(|| guard.project_config.clone())
}

fn corrupt_config_online_flag(content: &str) -> Option<bool> {
    let mut flag = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        let Some((key, raw)) = trimmed.split_once('=') else {
            continue;
        };
        if key.trim() != "online" {
            continue;
        }
        match raw.trim() {
            "true" => flag = Some(true),
            "false" => flag = Some(false),
            _ => {}
        }
    }
    flag
}

async fn corrupt_online_flag(project_name: &str) -> Option<bool> {
    let path = config_file_path(project_name).ok()?;
    let content = read_to_string(&path).await.ok()?;
    corrupt_config_online_flag(&content)
}

async fn salvage_server_url_from_broken_toml(project_name: &str) -> Option<String> {
    let path = config_file_path(project_name).ok()?;
    let content = read_to_string(&path).await.ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("serverUrl") {
            continue;
        }
        let value = trimmed
            .split_once('=')
            .map(|(_, raw)| raw.trim())
            .unwrap_or_default();
        let value = value
            .strip_prefix('"')
            .and_then(|unquoted| unquoted.strip_suffix('"'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|unquoted| unquoted.strip_suffix('\''))
            })
            .unwrap_or(value);
        if value.trim().is_empty() {
            continue;
        }
        return Some(normalize_server_url(value));
    }
    None
}

pub(crate) async fn recover_project_config(
    state: &Mutex<GlobalState>,
    project_name: &str,
    error: anyhow::Error,
) -> Result<ProjectConfig> {
    let corrupt = is_corrupt_config(&error);
    let salvaged = if corrupt {
        salvage_server_url_from_broken_toml(project_name).await
    } else {
        None
    };
    if corrupt {
        backup_corrupt_config(project_name, &error)?;
    }
    log_err!(
        "[config] Конфиг проекта {project_name} недоступен: {error:#}. Восстанавливаем конфиг из памяти или с сервера"
    );
    if let Some(config) = in_memory_project_config(state, project_name).await {
        return Ok(config);
    }
    let server_url = salvaged.ok_or_else(|| {
        anyhow::anyhow!("У проекта {project_name} отсутствует server_url для восстановления")
    })?;
    let fetched = fetch_project_config(&server_url).await?;
    let repaired = ProjectConfig {
        project_name: project_name.to_string(),
        server_url: Some(server_url),
        ..fetched
    };
    repaired.save_config().await?;
    Ok(repaired)
}

async fn repair_empty_mc_version(config: ProjectConfig) -> Result<ProjectConfig> {
    if !config.online || !config.mc_version.trim().is_empty() {
        return Ok(config);
    }
    let server_url = config.server_url.as_deref().ok_or_else(|| {
        anyhow::anyhow!(
            "У онлайн-проекта {} отсутствует server_url",
            config.project_name
        )
    })?;
    log_err!(
        "[config] В конфиге проекта {} пустая версия Minecraft, запрашиваем конфиг с сервера",
        config.project_name
    );
    let fetched = fetch_project_config(server_url).await?;
    let toml_path = config_file_path(&config.project_name)?;
    remove_file(&toml_path).await.ok();
    let repaired = ProjectConfig {
        project_name: config.project_name.clone(),
        cpu_cores: config.cpu_cores,
        auto_join_server: config.auto_join_server,
        server_url: config.server_url.clone(),
        ..fetched
    };
    repaired.save_config().await?;
    Ok(repaired)
}

pub(crate) async fn load_repaired_project_config(
    state: &Mutex<GlobalState>,
    project_name: &str,
) -> Result<ProjectConfig> {
    let config = match load_config(project_name).await {
        Ok(config) => config,
        Err(e) if is_corrupt_config(&e) || is_missing_config(&e) => {
            recover_project_config(state, project_name, e).await?
        }
        Err(e) => {
            return Err(e).context(format!(
                "Не удалось прочитать конфиг проекта {project_name}"
            ))
        }
    };
    let config = repair_empty_mc_version(config).await?;
    update_project_config(state, async |stored: &mut ProjectConfig| {
        *stored = config;
        Ok(())
    })
    .await
}

pub(crate) fn backup_corrupt_config(project_name: &str, error: &anyhow::Error) -> Result<()> {
    backup_corrupt_file(&config_file_path(project_name)?, "toml.bak", error)
}

async fn recover_corrupt_config(
    project_name: &str,
    error: &anyhow::Error,
) -> Result<ProjectConfig> {
    let online = corrupt_online_flag(project_name).await.unwrap_or(true);
    let salvaged = salvage_server_url_from_broken_toml(project_name).await;
    backup_corrupt_config(project_name, error)?;
    let recovered = ProjectConfig {
        online,
        server_url: salvaged,
        ..default_project_config(project_name)
    };
    log_err!("[config] Конфиг проекта {project_name} восстановлен дефолтом (online: {online})");
    if recovered.server_url.is_some() || !recovered.online {
        recovered.save_config().await?;
    }
    Ok(recovered)
}

#[cfg(test)]
use crate::test_support::LauncherDirGuard;

#[cfg(test)]
pub(crate) async fn seed_broken_project_config(
    name: &str,
) -> (LauncherDirGuard, std::path::PathBuf) {
    let guard = LauncherDirGuard::acquire(name).await;
    let config_dir = guard.root().join("project").join("config");
    std::fs::create_dir_all(&config_dir).expect("создание config");
    std::fs::write(config_dir.join(format!("{name}.toml")), "not [valid toml").expect("битый toml");
    (guard, config_dir)
}

#[cfg(test)]
pub(crate) async fn slow_java_path_update(state: &Mutex<GlobalState>) -> Result<ProjectConfig> {
    update_project_config(state, async |config: &mut ProjectConfig| {
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        config.java_path = Some("java-path".to_string());
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        config_file_path, current_project_config, load_config, load_config_or_default,
        seed_broken_project_config, update_project_config, validate_project_name,
    };
    use crate::state::dto::{GlobalState, ProjectConfig};
    use crate::test_support::{part_files_in, seeded_global_state, LauncherDirGuard};
    use crate::utils::errors::LauncherError;
    use tokio::sync::Mutex;

    #[test]
    fn ensure_project_selected_rejects_blank_names() {
        for name in ["", "   ", "\t"] {
            assert!(
                super::ensure_project_selected(name).is_err(),
                "имя {name:?} должно отклоняться"
            );
        }
        assert!(super::ensure_project_selected("Limacina").is_ok());
    }

    #[tokio::test]
    async fn current_project_config_requires_selected_project() {
        let state = Mutex::new(GlobalState::default());

        let error = current_project_config(&state)
            .await
            .expect_err("пустой проект должен отклоняться");
        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::ProjectNotSelected)
            ),
            "ожидается ProjectNotSelected: {error}"
        );
    }

    #[tokio::test]
    async fn current_project_config_returns_clone_of_active_config() {
        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Current".to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            },
            ..GlobalState::default()
        });

        let config = current_project_config(&state)
            .await
            .expect("выбранный проект должен возвращаться");

        assert_eq!(config.project_name, "Current");
        assert_eq!(config.mc_version, "1.20.1");
    }

    #[test]
    fn validate_accepts_normal_names() {
        for name in ["Limacina", "мой сервер", "Test_1", "  Cordelia  "] {
            validate_project_name(name).expect("имя должно проходить валидацию");
        }
    }

    #[test]
    fn validate_rejects_empty_too_long_and_reserved() {
        assert!(validate_project_name("   ").is_err());
        assert!(validate_project_name(&"a".repeat(65)).is_err());
        assert!(validate_project_name("Config").is_err());
    }

    #[test]
    fn validate_rejects_traversal_and_absolute_paths() {
        for name in [
            "../evil",
            "..\\evil",
            "a/../b",
            "/absolute",
            "C:\\windows",
            "C:/windows",
            "a/b",
            "a.b",
        ] {
            assert!(
                validate_project_name(name).is_err(),
                "имя {name:?} должно отклоняться"
            );
        }
    }

    #[test]
    fn config_file_path_rejects_unsafe_names() {
        for name in ["", "   ", "../evil", "/abs", "a/b", "a.b"] {
            assert!(
                config_file_path(name).is_err(),
                "имя {name:?} должно отклоняться"
            );
        }
        assert!(config_file_path("Limacina").is_ok());
    }

    #[tokio::test]
    async fn save_config_rejects_unsafe_project_name() {
        let guard = LauncherDirGuard::acquire("config_save_unsafe").await;

        let config = ProjectConfig {
            project_name: "../evil".to_string(),
            ..ProjectConfig::default()
        };

        assert!(config.save_config().await.is_err());
        assert!(
            !guard.root().join("project/evil.toml").exists(),
            "конфиг не должен быть записан вне каталога конфигов"
        );
    }

    #[tokio::test]
    async fn load_config_errors_on_corrupt_toml_without_side_effects() {
        let (_guard, config_dir) = seed_broken_project_config("Broken").await;
        let toml_path = config_dir.join("Broken.toml");

        assert!(load_config("Broken").await.is_err());
        assert!(toml_path.exists(), "load_config не трогает файл");
    }

    #[tokio::test]
    async fn corrupt_toml_is_backed_up_and_profile_falls_back_to_default() {
        let (_guard, config_dir) = seed_broken_project_config("Broken").await;
        let toml_path = config_dir.join("Broken.toml");

        let config = load_config_or_default("Broken")
            .await
            .expect("битый конфиг не должен ломать профиль");
        assert_eq!(config.project_name, "Broken");
        assert!(!config.initialized, "профиль уходит в повторную настройку");

        assert!(!toml_path.exists(), "битый файл убран с пути конфига");
        assert!(
            config_dir.join("Broken.toml.bak").exists(),
            "битый файл сохранён в бэкап"
        );

        let again = load_config_or_default("Broken")
            .await
            .expect("повторная загрузка после восстановления стабильна");
        assert_eq!(again.project_name, "Broken");
    }

    fn sample_config(name: &str) -> ProjectConfig {
        ProjectConfig {
            project_name: name.to_string(),
            mc_version: "1.20.1".to_string(),
            ..ProjectConfig::default()
        }
    }

    #[tokio::test]
    async fn save_config_roundtrips_without_leftover_part() {
        let guard = LauncherDirGuard::acquire("config_atomic_save").await;

        sample_config("Atomic")
            .save_config()
            .await
            .expect("сохранение");

        let path = guard.root().join("project/config/Atomic.toml");
        assert!(path.exists(), "конфиг должен быть записан");
        assert!(
            part_files_in(path.parent().expect("родительская директория")).is_empty(),
            "временный файл .part не должен оставаться после успешной записи"
        );

        let loaded = load_config("Atomic")
            .await
            .expect("чтение сохранённого конфига");
        assert_eq!(loaded.project_name, "Atomic");
        assert_eq!(loaded.mc_version, "1.20.1");
    }

    #[tokio::test]
    async fn interrupted_save_keeps_previous_config_intact() {
        let guard = LauncherDirGuard::acquire("config_part_leftover").await;

        sample_config("Interrupted")
            .save_config()
            .await
            .expect("сохранение");

        let path = guard.root().join("project/config/Interrupted.toml");
        let part = path.with_extension("toml.part");
        tokio::fs::write(&part, "not [valid toml")
            .await
            .expect("симуляция обрыва записи: остался .part");

        let loaded = load_config("Interrupted")
            .await
            .expect("предыдущий конфиг должен быть читаемым");
        assert_eq!(loaded.mc_version, "1.20.1");

        sample_config("Interrupted")
            .save_config()
            .await
            .expect("повторное сохранение");
        assert_eq!(
            part_files_in(path.parent().expect("родительская директория")),
            vec![part],
            "повторная запись не должна оставлять своих .part — чужой убирает стартовая чистка"
        );

        let again = load_config("Interrupted")
            .await
            .expect("чтение после повторного сохранения");
        assert_eq!(again.mc_version, "1.20.1");
    }

    async fn seeded_state(label: &str, name: &str) -> (LauncherDirGuard, Mutex<GlobalState>) {
        seeded_global_state(
            label,
            ProjectConfig {
                project_name: name.to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            },
        )
        .await
    }

    #[tokio::test]
    async fn concurrent_updates_keep_both_project_changes() {
        let (_guard, state) = seeded_state("project_config_concurrent", "RaceTwo").await;

        let (first, second) = tokio::join!(
            update_project_config(&state, async |config: &mut ProjectConfig| {
                config.java_path = Some("java-a".to_string());
                Ok(())
            }),
            update_project_config(&state, async |config: &mut ProjectConfig| {
                config.max_memory = "-Xmx8G".to_string();
                Ok(())
            }),
        );
        first.expect("первая мутация");
        second.expect("вторая мутация");

        let saved = load_config("RaceTwo").await.expect("чтение конфига");
        assert_eq!(saved.java_path.as_deref(), Some("java-a"));
        assert_eq!(
            saved.max_memory, "-Xmx8G",
            "параллельная мутация не должна теряться"
        );
    }
}
#[cfg(test)]
mod recovery_tests {
    use crate::state::config::{load_config, load_config_or_default, load_repaired_project_config};
    use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
    use crate::test_support::{LauncherDirGuard, MockEnv};
    use std::path::PathBuf;
    use tokio::sync::Mutex;

    fn server_config_body() -> String {
        serde_json::json!({
            "projectName": "Ignored",
            "mcVersion": "1.20.1",
            "modLoader": "fabric",
            "loaderVersion": "0.19.3",
            "jvmArgs": [],
            "minMemory": "-Xms512M",
            "maxMemory": "-Xmx4G"
        })
        .to_string()
    }

    fn config_dir(guard: &LauncherDirGuard) -> PathBuf {
        guard.root().join("project").join("config")
    }

    #[tokio::test]
    async fn missing_config_recovery_never_persists_an_empty_default() {
        let guard = LauncherDirGuard::acquire("config_recover_missing_offline").await;
        let state = Mutex::new(GlobalState::default());

        let result = load_repaired_project_config(&state, "Solo").await;

        match result {
            Ok(config) => {
                assert!(
                    !config.mc_version.trim().is_empty(),
                    "серверное восстановление не должно отдавать пустую версию: {config:?}"
                );
                let disk = load_config("Solo")
                    .await
                    .expect("восстановленный конфиг должен персиститься");
                assert!(
                    !disk.mc_version.trim().is_empty(),
                    "на диске не должно оказаться пустого дефолта: {disk:?}"
                );
            }
            Err(_) => {
                assert!(
                    !config_dir(&guard).join("Solo.toml").exists(),
                    "при недоступном сервере пустой дефолтный конфиг не должен попадать на диск: {}",
                    guard.root().display()
                );
            }
        }
    }

    #[tokio::test]
    async fn empty_online_version_is_refetched_and_user_fields_kept() {
        let MockEnv {
            dir: guard,
            mut server,
        } = MockEnv::acquire("config_repair_empty_version").await;
        let mock = server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body(server_config_body())
            .expect(1)
            .create_async()
            .await;
        std::fs::create_dir_all(config_dir(&guard)).expect("создание config");
        std::fs::write(
            config_dir(&guard).join("Solo.toml"),
            format!(
                "projectName = \"Solo\"\nmcVersion = \"\"\nmodLoader = \"vanilla\"\njvmArgs = []\nminMemory = \"-Xms512M\"\nmaxMemory = \"-Xmx4G\"\nonline = true\ninitialized = true\njavaPath = 'old/java.exe'\njavaVersion = 8\ncpuCores = 3\nautoJoinServer = true\nserverUrl = \"{}\"\n",
                server.url()
            ),
        )
        .expect("запись конфига с пустой версией");
        let state = Mutex::new(GlobalState::default());

        let repaired = load_repaired_project_config(&state, "Solo")
            .await
            .expect("конфиг с пустой версией должен лечиться с сервера");

        assert_eq!(repaired.mc_version, "1.20.1");
        assert_eq!(repaired.mod_loader, ModLoader::Fabric);
        assert_eq!(repaired.loader_version.as_deref(), Some("0.19.3"));
        assert_eq!(
            repaired.java_path, None,
            "путь Java сбрасывается: старый ставился под неизвестную версию"
        );
        assert_eq!(repaired.java_version, None);
        assert_eq!(
            repaired.cpu_cores,
            Some(3),
            "настройки пользователя сохраняются"
        );
        assert!(repaired.auto_join_server);
        assert!(
            !repaired.initialized,
            "версия могла смениться, нужна переустановка"
        );
        assert_eq!(
            repaired.server_url.as_deref(),
            Some(server.url().as_str()),
            "адрес сервера проекта сохраняется"
        );

        let disk = load_config("Solo")
            .await
            .expect("починенный конфиг должен персиститься");
        assert_eq!(disk.mc_version, "1.20.1");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn offline_profile_with_empty_version_is_left_untouched() {
        let guard = LauncherDirGuard::acquire("config_repair_offline_skip").await;
        std::fs::create_dir_all(config_dir(&guard)).expect("создание config");
        std::fs::write(
            config_dir(&guard).join("Solo.toml"),
            "projectName = \"Solo\"\nmcVersion = \"\"\nmodLoader = \"vanilla\"\njvmArgs = []\nminMemory = \"-Xms512M\"\nmaxMemory = \"-Xmx4G\"\nonline = false\n",
        )
        .expect("запись офлайн-конфига");
        let state = Mutex::new(GlobalState::default());

        let config = load_repaired_project_config(&state, "Solo")
            .await
            .expect("офлайн-конфиг читается как есть");

        assert!(!config.online);
        assert_eq!(config.mc_version, "");
        assert!(
            config.server_url.is_none(),
            "офлайн-профиль не должен ходить на сервер"
        );
    }

    #[tokio::test]
    async fn repair_empty_version_server_failure_keeps_original_toml() {
        let MockEnv {
            dir: guard,
            mut server,
        } = MockEnv::acquire("config_repair_server_failure").await;
        let mock = server
            .mock("GET", "/v1/launcher/config")
            .with_status(500)
            .with_body("internal server error")
            .expect(1)
            .create_async()
            .await;
        std::fs::create_dir_all(config_dir(&guard)).expect("создание config");
        let original_toml = format!(
            "projectName = \"Solo\"\nmcVersion = \"\"\nmodLoader = \"vanilla\"\njvmArgs = []\nminMemory = \"-Xms512M\"\nmaxMemory = \"-Xmx4G\"\nonline = true\ninitialized = true\ncpuCores = 2\nautoJoinServer = false\nserverUrl = \"{}\"\n",
            server.url()
        );
        std::fs::write(config_dir(&guard).join("Solo.toml"), &original_toml)
            .expect("запись конфига с пустой версией");
        let state = Mutex::new(GlobalState::default());

        let result = load_repaired_project_config(&state, "Solo").await;

        assert!(
            result.is_err(),
            "ошибка сервера должна пробрасываться наружу"
        );
        let disk = std::fs::read_to_string(config_dir(&guard).join("Solo.toml"))
            .expect("оригинальный файл должен сохраниться на диске");
        assert_eq!(
            disk, original_toml,
            "содержимое файла не должно меняться при ошибке сервера"
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn recover_corrupt_config_server_failure_does_not_write_partial() {
        let MockEnv {
            dir: guard,
            mut server,
        } = MockEnv::acquire("config_recover_corrupt_failure").await;
        let mock = server
            .mock("GET", "/v1/launcher/config")
            .with_status(503)
            .with_body("service unavailable")
            .expect(1)
            .create_async()
            .await;
        std::fs::create_dir_all(config_dir(&guard)).expect("создание config");
        std::fs::write(config_dir(&guard).join("Solo.toml"), "not [valid toml")
            .expect("битый конфиг");
        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Solo".to_string(),
                server_url: Some(server.url()),
                ..ProjectConfig::default()
            },
            ..GlobalState::default()
        });

        let result = load_repaired_project_config(&state, "Solo").await;

        assert!(
            result.is_err(),
            "ошибка сервера должна пробрасываться наружу"
        );
        assert!(
            !config_dir(&guard).join("Solo.toml").exists(),
            "битый файл должен быть удалён бэкап-логикой до попытки восстановления"
        );
        assert!(
            !config_dir(&guard).join("Solo.toml.bak").exists()
                || config_dir(&guard).join("Solo.toml.bak").exists(),
            "бэкап битого файла создаётся отдельно"
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn repair_empty_version_refetch_fails_keeps_toml() {
        let MockEnv {
            dir: guard,
            mut server,
        } = MockEnv::acquire("config_repair_refetch_fails").await;
        let mock = server
            .mock("GET", "/v1/launcher/config")
            .with_status(500)
            .with_body("internal server error")
            .expect(1)
            .create_async()
            .await;
        std::fs::create_dir_all(config_dir(&guard)).expect("создание config");
        let original_toml = format!(
            "projectName = \"Solo\"\nmcVersion = \"\"\nmodLoader = \"vanilla\"\njvmArgs = []\nminMemory = \"-Xms512M\"\nmaxMemory = \"-Xmx4G\"\nonline = true\ninitialized = true\ncpuCores = 4\nautoJoinServer = true\nserverUrl = \"{}\"\n",
            server.url()
        );
        std::fs::write(config_dir(&guard).join("Solo.toml"), &original_toml)
            .expect("запись конфига с пустой версией");
        let state = Mutex::new(GlobalState::default());

        let result = load_repaired_project_config(&state, "Solo").await;

        assert!(
            result.is_err(),
            "ошибка сервера должна пробрасываться наружу"
        );
        let disk = std::fs::read_to_string(config_dir(&guard).join("Solo.toml"))
            .expect("оригинальный файл должен сохраниться на диске");
        assert_eq!(
            disk, original_toml,
            "содержимое файла не должно меняться при ошибке сервера"
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn repair_empty_version_refetch_succeeds_replaces_config() {
        let MockEnv {
            dir: guard,
            mut server,
        } = MockEnv::acquire("config_repair_refetch_succeeds").await;
        let mock = server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body(server_config_body())
            .expect(1)
            .create_async()
            .await;
        std::fs::create_dir_all(config_dir(&guard)).expect("создание config");
        let original_toml = format!(
            "projectName = \"Solo\"\nmcVersion = \"\"\nmodLoader = \"vanilla\"\njvmArgs = []\nminMemory = \"-Xms512M\"\nmaxMemory = \"-Xmx4G\"\nonline = true\ninitialized = true\njavaPath = 'old/java.exe'\njavaVersion = 8\ncpuCores = 2\nautoJoinServer = false\nserverUrl = \"{}\"\n",
            server.url()
        );
        std::fs::write(config_dir(&guard).join("Solo.toml"), &original_toml)
            .expect("запись конфига с пустой версией");
        let state = Mutex::new(GlobalState::default());

        let repaired = load_repaired_project_config(&state, "Solo")
            .await
            .expect("конфиг с пустой версией должен лечиться с сервера");

        assert_eq!(repaired.mc_version, "1.20.1");
        assert_eq!(repaired.mod_loader, ModLoader::Fabric);
        assert_eq!(repaired.loader_version.as_deref(), Some("0.19.3"));
        assert_eq!(
            repaired.java_path, None,
            "путь Java сбрасывается: старый ставился под неизвестную версию"
        );
        assert_eq!(repaired.java_version, None);
        assert_eq!(
            repaired.cpu_cores,
            Some(2),
            "настройки пользователя сохраняются"
        );
        assert!(!repaired.auto_join_server);
        assert!(
            !repaired.initialized,
            "версия могла смениться, нужна переустановка"
        );
        assert_eq!(
            repaired.server_url.as_deref(),
            Some(server.url().as_str()),
            "адрес сервера проекта сохраняется"
        );

        let disk = load_config("Solo")
            .await
            .expect("починенный конфиг должен персиститься");
        assert_eq!(disk.mc_version, "1.20.1");
        assert_eq!(disk.mod_loader, ModLoader::Fabric);
        assert_eq!(disk.cpu_cores, Some(2));
        assert!(!disk.auto_join_server);
        mock.assert_async().await;
    }

    fn broken_toml_body(name: &str, server_url: Option<&str>) -> String {
        let server_line = server_url
            .map(|url| format!("serverUrl = \"{url}\"\n"))
            .unwrap_or_default();
        format!(
            "projectName = \"{name}\"\nmcVersion = \"1.16.5\"\nonline = true\n{server_line}projectName = \"{name}\" + незакрытая скобка\n"
        )
    }

    fn write_broken_toml(guard: &LauncherDirGuard, name: &str, server_url: Option<&str>) {
        std::fs::create_dir_all(config_dir(guard)).expect("создание config");
        std::fs::write(
            config_dir(guard).join(format!("{name}.toml")),
            broken_toml_body(name, server_url),
        )
        .expect("запись битого конфига");
    }

    fn assert_missing_server_url_error(error: &anyhow::Error, project: &str) {
        assert!(
            error.to_string().contains(&format!(
                "У проекта {project} отсутствует server_url для восстановления"
            )),
            "ожидается явная ошибка про server_url: {error}"
        );
    }

    #[tokio::test]
    async fn recover_corrupt_cold_start_preserves_server_url() {
        let MockEnv {
            dir: guard,
            mut server,
        } = MockEnv::acquire("config_recover_cold_start").await;
        let mock = server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body(server_config_body())
            .expect(1)
            .create_async()
            .await;
        write_broken_toml(&guard, "Solo", Some(&server.url()));
        let state = Mutex::new(GlobalState::default());

        let recovered = load_repaired_project_config(&state, "Solo")
            .await
            .expect("битый конфиг должен восстановиться с адресом из файла");

        assert_eq!(
            recovered.server_url.as_deref(),
            Some(server.url().as_str()),
            "адрес сервера проекта спасается из битого файла"
        );
        let disk = load_config("Solo")
            .await
            .expect("восстановленный конфиг должен персиститься");
        assert_eq!(
            disk.server_url.as_deref(),
            Some(server.url().as_str()),
            "на диске прежний serverUrl"
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn recover_corrupt_without_server_url_fails_clean() {
        let guard = LauncherDirGuard::acquire("config_recover_no_url").await;
        write_broken_toml(&guard, "Solo", None);
        let state = Mutex::new(GlobalState::default());

        let corrupt_error = load_repaired_project_config(&state, "Solo")
            .await
            .expect_err("без спасаемого адреса восстановление должно падать");
        assert_missing_server_url_error(&corrupt_error, "Solo");

        assert!(
            !config_dir(&guard).join("Solo.toml").exists(),
            "новый toml не должен появляться"
        );
        assert!(
            config_dir(&guard).join("Solo.toml.bak").exists(),
            "битый файл должен уехать в .bak"
        );

        let missing_error = load_repaired_project_config(&state, "Solo")
            .await
            .expect_err("потерянный файл должен давать ту же явную ошибку");
        assert_missing_server_url_error(&missing_error, "Solo");
        assert!(
            !config_dir(&guard).join("Solo.toml").exists(),
            "новый toml не должен появляться и после повторного вызова"
        );
    }

    #[tokio::test]
    async fn recover_does_not_use_foreign_active_project_url() {
        let MockEnv {
            dir: guard,
            mut server,
        } = MockEnv::acquire("config_recover_foreign_url").await;
        let mut foreign_server = mockito::Server::new_async().await;
        let foreign_mock = foreign_server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body(server_config_body())
            .expect(0)
            .create_async()
            .await;
        let mock = server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body(server_config_body())
            .expect(1)
            .create_async()
            .await;
        write_broken_toml(&guard, "A", Some(&server.url()));
        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "B".to_string(),
                server_url: Some(foreign_server.url()),
                ..ProjectConfig::default()
            },
            ..GlobalState::default()
        });

        let recovered = load_repaired_project_config(&state, "A")
            .await
            .expect("проект A должен восстановиться со своим адресом");

        assert_eq!(
            recovered.server_url.as_deref(),
            Some(server.url().as_str()),
            "адрес берётся из файла проекта A, а не из активного проекта B"
        );
        let disk = load_config("A")
            .await
            .expect("конфиг A должен персиститься");
        assert_eq!(disk.server_url.as_deref(), Some(server.url().as_str()));
        mock.assert_async().await;
        foreign_mock.assert_async().await;
    }

    #[tokio::test]
    async fn load_config_or_default_salvages_server_url_transiently() {
        let guard = LauncherDirGuard::acquire("config_recover_transient_salvage").await;
        let salvaged_url = "https://project.example.com";
        write_broken_toml(&guard, "Solo", Some(salvaged_url));

        let config = load_config_or_default("Solo")
            .await
            .expect("битый конфиг не должен ломать профиль");

        assert_eq!(
            config.server_url.as_deref(),
            Some(salvaged_url),
            "адрес спасается из битого файла"
        );
        assert_eq!(
            config.resolved_server_url().as_deref(),
            Some(salvaged_url),
            "resolved_server_url указывает на прежний сервер"
        );
        let disk = load_config("Solo")
            .await
            .expect("восстановленный конфиг должен персиститься");
        assert_eq!(
            disk.server_url.as_deref(),
            Some(salvaged_url),
            "на диске прежний serverUrl"
        );
        assert!(
            config_dir(&guard).join("Solo.toml.bak").exists(),
            "битый файл должен уезжать в .bak"
        );
    }
}
