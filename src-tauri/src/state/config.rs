use crate::log_err;
use crate::state::dto::GlobalState;
use crate::utils::download_file::write_atomic;
use crate::utils::errors::LauncherError;
use crate::{state::dto::ProjectConfig, utils::env_info::launcher_path};
use anyhow::{Context, Result};
use tokio::fs::{create_dir_all, read_to_string, rename};
use tokio::sync::Mutex;
use toml::{from_str, to_string_pretty};

static PROJECT_CONFIG_WRITE_LOCK: Mutex<()> = Mutex::const_new(());

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

impl ProjectConfig {
    pub async fn save_config(&self) -> Result<()> {
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

fn is_missing_config(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound)
    })
}

fn is_corrupt_config(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| cause.is::<toml::de::Error>())
}

async fn recover_corrupt_config(
    project_name: &str,
    error: &anyhow::Error,
) -> Result<ProjectConfig> {
    let path = config_file_path(project_name)?;
    let backup_path = path.with_extension("toml.bak");
    log_err!(
        "{}: {:?} — {:?} ({})",
        LauncherError::ConfigCorrupt,
        path,
        backup_path,
        error
    );
    rename(&path, &backup_path).await.with_context(|| {
        format!(
            "Не удалось сохранить бэкап повреждённого конфига {:?}",
            backup_path
        )
    })?;
    Ok(default_project_config(project_name))
}

#[cfg(test)]
mod tests {
    use super::{
        config_file_path, load_config, load_config_or_default, update_project_config,
        validate_project_name,
    };
    use crate::state::dto::{GlobalState, ProjectConfig};
    use crate::test_support::LauncherDirGuard;
    use tokio::sync::Mutex;

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
        let guard = LauncherDirGuard::acquire("config_corrupt_strict").await;
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        let toml_path = config_dir.join("Broken.toml");
        std::fs::write(&toml_path, "not [valid toml").expect("запись битого toml");

        assert!(load_config("Broken").await.is_err());
        assert!(toml_path.exists(), "load_config не трогает файл");
    }

    #[tokio::test]
    async fn corrupt_toml_is_backed_up_and_profile_falls_back_to_default() {
        let guard = LauncherDirGuard::acquire("config_corrupt_recovery").await;
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        let toml_path = config_dir.join("Broken.toml");
        std::fs::write(&toml_path, "not [valid toml").expect("запись битого toml");

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
            !path.with_extension("toml.part").exists(),
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
        assert!(!part.exists(), ".part должен быть убран успешной записью");

        let again = load_config("Interrupted")
            .await
            .expect("чтение после повторного сохранения");
        assert_eq!(again.mc_version, "1.20.1");
    }

    async fn seeded_state(label: &str, name: &str) -> (LauncherDirGuard, Mutex<GlobalState>) {
        let guard = LauncherDirGuard::acquire(label).await;
        let base = ProjectConfig {
            project_name: name.to_string(),
            mc_version: "1.20.1".to_string(),
            ..ProjectConfig::default()
        };
        base.save_config()
            .await
            .expect("сохранение базового конфига");
        let state = Mutex::new(GlobalState {
            project_config: base,
            ..Default::default()
        });
        (guard, state)
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
