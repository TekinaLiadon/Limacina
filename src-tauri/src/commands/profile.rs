use anyhow::{bail, Context, Result};
use std::collections::BTreeMap;
use tauri::State;
use tokio::fs;
use tokio::sync::Mutex;

use crate::commands::launcher_config::update_launcher_config;
use crate::launcher_server::fetch_project_config;
use crate::log_err;
use crate::log_info;
use crate::minecraft::manifest::VERSION_MANIFEST_URL;
use crate::minecraft::mod_loader::fabric::Fabric;
use crate::minecraft::mod_loader::manifest::loader_index;
use crate::minecraft::mod_loader::{forge::manifest::FORGE, neoforge::manifest::NEOFORGE};
use crate::minecraft::structs::{
    ModLoader as ModLoaderTrait, INDEX_CACHE_FILES, INDEX_CACHE_PREFIXES,
};
use crate::minecraft::vanilla::structs::VanillaVersionsManifest;
use crate::state::config::{
    backup_corrupt_config, current_project_config, is_corrupt_config, load_config,
    load_config_or_default, project_config_write_lock, set_project_config, validate_project_name,
    validated_project_name,
};
use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
use crate::state::launcher_config::LauncherConfig;
use crate::utils::compare_versions;
use crate::utils::download_file::download_json;
use crate::utils::env_info::{launcher_path, normalize_server_url};
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;

async fn register_project(state: &Mutex<GlobalState>, project_name: &str) -> Result<()> {
    let mut registered = false;
    update_launcher_config(state, |config| {
        if config.has_project(project_name) {
            return;
        }
        config.add_project(project_name);
        registered = true;
    })
    .await?;
    if !registered {
        bail!(LauncherError::ProjectExists(project_name.to_string()));
    }
    Ok(())
}

async fn validate_new_project_name(state: &Mutex<GlobalState>, name: &str) -> Result<()> {
    validate_project_name(name)?;

    let trimmed = name.trim();
    let already_registered = {
        let guard = state.lock().await;
        guard
            .launcher_config
            .as_ref()
            .is_some_and(|c| c.has_project(trimmed))
    };
    if already_registered {
        bail!(LauncherError::ProjectExists(trimmed.to_string()));
    }
    match load_config(trimmed).await {
        Ok(_) => bail!(LauncherError::ProjectExists(trimmed.to_string())),
        Err(e) if is_corrupt_config(&e) => backup_corrupt_config(trimmed, &e)?,
        Err(_) => {}
    }
    Ok(())
}

async fn persist_new_project(config: &ProjectConfig) -> Result<()> {
    let result = async {
        let project_dir = launcher_path(Some(&config.project_name))?;
        fs::create_dir_all(&project_dir)
            .await
            .with_context(|| format!("Не удалось создать папку профиля {:?}", project_dir))?;
        config.save_config().await?;
        Ok(())
    }
    .await;
    LauncherError::classify(result, LauncherError::DiskIo)
}

async fn activate_project(state: &Mutex<GlobalState>, config: &ProjectConfig) -> Result<()> {
    set_project_config(state, config.clone()).await
}

async fn add_server_profile(state: &Mutex<GlobalState>, server_url: &str) -> Result<ProjectConfig> {
    if server_url.trim().is_empty() {
        bail!(LauncherError::ServerUrlMissing);
    }
    let base_url = normalize_server_url(server_url);

    log_info!(
        "[profile] Запрос конфига сервера: {}/v1/launcher/config",
        base_url
    );
    let mut config = fetch_project_config(&base_url).await?;

    {
        let _write_guard = project_config_write_lock().await;
        validate_new_project_name(state, &config.project_name).await?;

        config.online = true;
        config.initialized = false;
        config.server_url = Some(base_url);

        persist_new_project(&config).await?;
        register_project(state, &config.project_name).await?;
    }
    activate_project(state, &config).await?;

    log_info!("[profile] Профиль сервера создан: {}", config.project_name);
    Ok(config)
}

async fn add_offline_profile(
    state: &Mutex<GlobalState>,
    name: &str,
    mc_version: &str,
    mod_loader: ModLoader,
    loader_version: Option<String>,
) -> Result<ProjectConfig> {
    if mc_version.trim().is_empty() {
        bail!(LauncherError::InvalidInput(
            "Выберите версию Minecraft".to_string()
        ));
    }

    let loader_version = loader_version.filter(|v| !v.trim().is_empty());
    if mod_loader != ModLoader::Vanilla && loader_version.is_none() {
        bail!(LauncherError::LoaderNotSelected);
    }

    let config = {
        let _write_guard = project_config_write_lock().await;
        validate_new_project_name(state, name).await?;

        let config = ProjectConfig {
            project_name: name.trim().to_string(),
            mc_version: mc_version.trim().to_string(),
            mod_loader,
            loader_version,
            online: false,
            server_url: None,
            ..ProjectConfig::default()
        };

        persist_new_project(&config).await?;
        let mods_dir = launcher_path(Some(&config.project_name))?.join("mods");
        fs::create_dir_all(&mods_dir)
            .await
            .with_context(|| format!("Не удалось создать папку модов {:?}", mods_dir))?;

        register_project(state, &config.project_name).await?;
        config
    };
    activate_project(state, &config).await?;

    log_info!(
        "[profile] Одиночный профиль создан: {}",
        config.project_name
    );
    Ok(config)
}

async fn minecraft_versions(include_snapshots: bool) -> Result<Vec<String>> {
    let manifest_path = launcher_path(None)?
        .join("manifest")
        .join("vanilla_index.json");
    let manifest: VanillaVersionsManifest = LauncherError::classify(
        download_json(Some(VERSION_MANIFEST_URL), &manifest_path)
            .await
            .context("Не удалось получить список версий Minecraft"),
        LauncherError::ManifestParse,
    )?;

    Ok(manifest
        .versions
        .into_iter()
        .filter(|v| include_snapshots || v.version_type == "release")
        .map(|v| v.id)
        .collect())
}

async fn loader_versions(mod_loader: ModLoader, mc_version: &str) -> Result<Vec<String>> {
    if mc_version.trim().is_empty() {
        bail!(LauncherError::InvalidInput(
            "Сначала выберите версию Minecraft".to_string()
        ));
    }

    let versions = match mod_loader {
        ModLoader::Vanilla => Vec::new(),
        ModLoader::Fabric => {
            let probe = ProjectConfig {
                mc_version: mc_version.to_string(),
                ..ProjectConfig::default()
            };
            LauncherError::classify(
                Fabric
                    .versions(&probe)
                    .await
                    .with_context(|| format!("Нет версий Fabric для Minecraft {}", mc_version)),
                LauncherError::ManifestParse,
            )?
            .into_iter()
            .map(|v| v.id)
            .collect()
        }
        ModLoader::Forge => pick_maven_versions(
            LauncherError::classify(loader_index(&FORGE).await, LauncherError::ManifestParse)?,
            mc_version,
        ),
        ModLoader::NeoForge => pick_maven_versions(
            LauncherError::classify(loader_index(&NEOFORGE).await, LauncherError::ManifestParse)?,
            mc_version,
        ),
    };

    Ok(versions)
}

fn pick_maven_versions(index: BTreeMap<String, Vec<String>>, mc_version: &str) -> Vec<String> {
    let mut versions = index.get(mc_version).cloned().unwrap_or_default();
    versions.sort_by(|a, b| compare_versions(b, a));
    versions
}

#[tauri::command]
pub async fn create_server_profile(
    state: State<'_, Mutex<GlobalState>>,
    server_url: String,
) -> CommandResult<ProjectConfig> {
    Ok(add_server_profile(state.inner(), &server_url).await?)
}

#[tauri::command]
pub async fn get_server_connect_url(state: State<'_, Mutex<GlobalState>>) -> CommandResult<String> {
    let config = current_project_config(state.inner()).await?;
    if !config.online {
        return Err(LauncherError::OfflineProfile(
            "ссылка для подключения доступна только у серверных профилей".to_string(),
        )
        .into());
    }
    let url = config
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing)?;
    Ok(url)
}

#[tauri::command]
pub async fn create_offline_profile(
    state: State<'_, Mutex<GlobalState>>,
    name: String,
    mc_version: String,
    mod_loader: ModLoader,
    loader_version: Option<String>,
) -> CommandResult<ProjectConfig> {
    Ok(add_offline_profile(
        state.inner(),
        &name,
        &mc_version,
        mod_loader,
        loader_version,
    )
    .await?)
}

#[tauri::command]
pub async fn save_current_project(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<()> {
    update_launcher_config(&state, |config| {
        config.current_project = Some(project_name.clone());
    })
    .await?;
    Ok(())
}

async fn delete_project_files(project_name: &str) -> Result<()> {
    let config_path = launcher_path(Some("config"))?.join(format!("{}.toml", project_name));
    match fs::remove_file(&config_path).await {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err(e)
                .with_context(|| format!("Не удалось удалить конфиг проекта {:?}", config_path));
        }
        _ => {}
    }

    let aux_paths = [
        (
            launcher_path(Some("config"))?.join(format!("{}.models.json", project_name)),
            "манифест моделей",
        ),
        (
            launcher_path(None)?
                .join("manifest")
                .join(format!("installed_{}.json", project_name)),
            "install-манифест",
        ),
    ];
    for (path, label) in aux_paths {
        if let Err(e) = fs::remove_file(&path).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                log_err!("Не удалось удалить {label} проекта {project_name} ({path:?}): {e}");
            }
        }
    }

    let project_dir = launcher_path(Some(project_name))?;
    let removal = match fs::remove_dir_all(&project_dir).await {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        outcome => {
            outcome.with_context(|| format!("Не удалось удалить папку проекта {:?}", project_dir))
        }
    };
    LauncherError::classify(removal, LauncherError::DiskIo)?;

    Ok(())
}

async fn delete_project_credentials(project_name: &str, logins: Vec<String>) -> Result<()> {
    crate::commands::auth::wipe_project_credentials(project_name, &logins).await
}

async fn delete_named_project(
    state: &Mutex<GlobalState>,
    project_name: &str,
) -> Result<LauncherConfig> {
    let project_name = validated_project_name(project_name)?;
    let registered = {
        let guard = state.lock().await;
        guard
            .launcher_config
            .as_ref()
            .is_some_and(|c| c.has_project(project_name))
    };
    if !registered {
        bail!(LauncherError::InvalidInput(format!(
            "Проект «{}» не найден",
            project_name
        )));
    }
    let env_project = crate::utils::env_info::get_default_project_name();
    if !crate::utils::env_info::is_offline_build()
        && !env_project.is_empty()
        && project_name == env_project
    {
        bail!(LauncherError::ProjectProtected(project_name.to_string()));
    }

    let saved_logins = {
        let guard = state.lock().await;
        guard
            .launcher_config
            .as_ref()
            .map(|c| c.get_logins(project_name))
            .unwrap_or_default()
    };
    delete_project_credentials(project_name, saved_logins).await?;

    let config = update_launcher_config(state, |config| {
        config.remove_project(project_name);
    })
    .await?;

    delete_project_files(project_name).await?;

    let deleting_current = {
        let guard = state.lock().await;
        guard.project_config.project_name == project_name
    };
    if deleting_current {
        let next_project = config.current_project.clone();
        let next_config = match next_project.as_deref() {
            Some(name) if !name.is_empty() => load_config_or_default(name).await?,
            _ => ProjectConfig::default(),
        };
        {
            let mut guard = state.lock().await;
            guard.session = None;
        }
        set_project_config(state, next_config).await?;
    }

    log_info!("[profile] Проект {} удалён", project_name);
    Ok(config)
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<LauncherConfig> {
    Ok(delete_named_project(state.inner(), &project_name).await?)
}

#[tauri::command]
pub async fn get_minecraft_versions(include_snapshots: bool) -> CommandResult<Vec<String>> {
    Ok(minecraft_versions(include_snapshots).await?)
}

#[tauri::command]
pub async fn get_loader_versions(
    mod_loader: ModLoader,
    mc_version: String,
) -> CommandResult<Vec<String>> {
    Ok(loader_versions(mod_loader, &mc_version).await?)
}

async fn purge_manifest_index_cache(manifest_dir: &std::path::Path) -> Result<usize> {
    if !tokio::fs::try_exists(manifest_dir).await.unwrap_or(false) {
        return Ok(0);
    }
    let mut entries = LauncherError::classify(
        fs::read_dir(manifest_dir)
            .await
            .with_context(|| format!("Не удалось прочитать {:?}", manifest_dir)),
        LauncherError::DiskIo,
    )?;
    let mut removed = 0usize;
    while let Some(entry) = LauncherError::classify(
        entries
            .next_entry()
            .await
            .context("Не удалось прочитать запись в папке manifest"),
        LauncherError::DiskIo,
    )? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_index = INDEX_CACHE_FILES.contains(&name.as_str())
            || INDEX_CACHE_PREFIXES
                .iter()
                .any(|prefix| name.starts_with(prefix));
        if !is_index {
            continue;
        }
        match fs::remove_file(entry.path()).await {
            Ok(()) => {
                log_info!("[manifests] Удалён кеш: {}", name);
                removed += 1;
            }
            Err(e) => {
                log_err!("[manifests] Не удалось удалить кеш {}: {}", name, e);
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
pub async fn refresh_manifests() -> CommandResult<String> {
    let manifest_dir = launcher_path(None)?.join("manifest");
    let removed = purge_manifest_index_cache(&manifest_dir).await?;

    log_info!(
        "[manifests] Удалено файлов: {}, перекачивание индексов",
        removed
    );

    LauncherError::classify(
        minecraft_versions(false).await,
        LauncherError::ManifestParse,
    )?;
    LauncherError::classify(loader_index(&FORGE).await, LauncherError::ManifestParse)?;
    LauncherError::classify(loader_index(&NEOFORGE).await, LauncherError::ManifestParse)?;

    Ok(format!("Манифесты обновлены (удалено кешей: {})", removed))
}

#[cfg(test)]
mod refresh_manifests_tests {
    use super::purge_manifest_index_cache;
    use crate::test_support::{LauncherDirGuard, TempDir};
    use std::fs;

    fn seed_cache(dir: &std::path::Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("vanilla_index.json"), b"{}").unwrap();
        fs::write(dir.join("forge.json"), b"{}").unwrap();
        fs::write(dir.join("fabric_0.16.9.json"), b"{}").unwrap();
        fs::write(dir.join("forge_47.2.0.json"), b"{}").unwrap();
        fs::write(dir.join("not-a-cache.txt"), b"keep me").unwrap();
    }

    #[tokio::test]
    async fn purge_counts_only_removed_index_files() {
        let guard = LauncherDirGuard::acquire("manifest_purge").await;
        let manifest_dir = guard.root().join("manifest");
        seed_cache(&manifest_dir);

        let removed = purge_manifest_index_cache(&manifest_dir)
            .await
            .expect("очистка кешей");

        assert_eq!(
            removed, 3,
            "инсталлерный forge_*.json и чужой файл не считаются: {removed}"
        );
        assert!(!manifest_dir.join("vanilla_index.json").exists());
        assert!(!manifest_dir.join("forge.json").exists());
        assert!(!manifest_dir.join("fabric_0.16.9.json").exists());
        assert!(
            manifest_dir.join("forge_47.2.0.json").exists(),
            "манифесты, созданные инсталлером, не трогаются"
        );
        assert!(manifest_dir.join("not-a-cache.txt").exists());
    }

    #[tokio::test]
    async fn purge_returns_zero_for_missing_dir() {
        let guard = LauncherDirGuard::acquire("manifest_purge_missing").await;
        let manifest_dir = guard.root().join("manifest");

        let removed = purge_manifest_index_cache(&manifest_dir)
            .await
            .expect("отсутствующий каталог — не ошибка");

        assert_eq!(removed, 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn purge_skips_files_that_cannot_be_deleted() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new("manifest_purge_readonly");
        let manifest_dir = dir.0.join("manifest");
        seed_cache(&manifest_dir);
        fs::set_permissions(&manifest_dir, fs::Permissions::from_mode(0o500))
            .expect("каталог без права на запись");

        let removed = purge_manifest_index_cache(&manifest_dir)
            .await
            .expect("неудачи удаления не должны прерывать очистку");

        fs::set_permissions(&manifest_dir, fs::Permissions::from_mode(0o755))
            .expect("восстановление прав");
        assert_eq!(
            removed, 0,
            "счётчик не должен врать при неудачных удалениях: {removed}"
        );
        assert!(manifest_dir.join("vanilla_index.json").exists());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use crate::state::config::{load_config, project_config_write_lock, update_project_config};
    use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
    use crate::state::launcher_config::LauncherConfig;
    use crate::test_support::{ConfigFileGuard, LauncherDirGuard};
    use crate::utils::errors::LauncherError;
    use tokio::sync::Mutex;

    use super::{
        activate_project, add_offline_profile, delete_named_project, delete_project_files,
    };

    fn empty_state() -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            launcher_config: Some(LauncherConfig::default()),
            ..GlobalState::default()
        })
    }

    #[tokio::test]
    async fn parallel_creates_with_same_name_leave_single_profile() {
        let guard = LauncherDirGuard::acquire("profile_create_race").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        let state = empty_state();

        let (first, second) = tokio::join!(
            add_offline_profile(&state, "Dup", "1.20.1", ModLoader::Vanilla, None),
            add_offline_profile(&state, "Dup", "1.20.1", ModLoader::Vanilla, None),
        );

        let winners = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(winners, 1, "ровно один create должен победить");
        let loser = if first.is_ok() { second } else { first };
        let error = loser.expect_err("проигравший должен получить ошибку");
        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::ProjectExists(_))
            ),
            "ожидается ProjectExists: {error:#}"
        );

        let config_dir = guard.root().join("project").join("config");
        assert!(
            config_dir.join("Dup.toml").exists(),
            "конфиг победителя на месте"
        );
        let saved = load_config("Dup")
            .await
            .expect("конфиг победителя должен читаться");
        assert_eq!(saved.mc_version, "1.20.1");
        assert!(
            guard
                .root()
                .join("project")
                .join("Dup")
                .join("mods")
                .exists(),
            "папка победителя на месте"
        );
        assert!(
            state
                .lock()
                .await
                .launcher_config
                .as_ref()
                .expect("конфиг лаунчера")
                .has_project("Dup"),
            "проект зарегистрирован"
        );
    }

    #[tokio::test]
    async fn create_waits_until_inflight_config_write_releases() {
        let guard = LauncherDirGuard::acquire("profile_create_waits_lock").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        let state = Arc::new(empty_state());
        let task_state = Arc::clone(&state);
        let _write_lock = project_config_write_lock().await;

        let task = tokio::spawn(async move {
            add_offline_profile(&task_state, "Waited", "1.20.1", ModLoader::Vanilla, None).await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            !task.is_finished(),
            "создание профиля должно ждать освобождения блокировки конфига"
        );

        drop(_write_lock);
        let created = task
            .await
            .expect("задача создания не должна паниковать")
            .expect("создание после снятия блокировки");
        assert_eq!(created.project_name, "Waited");
        assert!(
            state.lock().await.project_config.project_name == "Waited",
            "профиль должен активироваться после создания"
        );
    }

    #[tokio::test]
    async fn create_over_corrupt_toml_backs_up_broken_file() {
        let guard = LauncherDirGuard::acquire("profile_create_corrupt_bak").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        std::fs::write(config_dir.join("Dup.toml"), "not [valid toml").expect("битый toml");

        let state = empty_state();
        let config = add_offline_profile(&state, "Dup", "1.20.1", ModLoader::Vanilla, None)
            .await
            .expect("битый конфиг не должен блокировать создание");

        assert_eq!(config.project_name, "Dup");
        assert!(
            config_dir.join("Dup.toml.bak").exists(),
            "битый toml должен сохраниться в .bak"
        );
        let saved = load_config("Dup")
            .await
            .expect("новый конфиг должен читаться");
        assert_eq!(saved.mc_version, "1.20.1");
    }

    #[tokio::test]
    async fn create_rejects_name_registered_in_launcher_config() {
        let guard = LauncherDirGuard::acquire("profile_create_registered").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        let mut base = empty_state().into_inner();
        base.launcher_config
            .as_mut()
            .expect("конфиг лаунчера")
            .add_project("Reg");
        let state = Mutex::new(base);

        let error = add_offline_profile(&state, "Reg", "1.20.1", ModLoader::Vanilla, None)
            .await
            .expect_err("зарегистрированное имя должно отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::ProjectExists(_))
            ),
            "ожидается ProjectExists: {error:#}"
        );
        assert!(
            !guard.root().join("project").join("Reg").exists(),
            "файлов быть не должно"
        );
    }

    fn state_with_current(project_name: &str) -> GlobalState {
        GlobalState {
            project_config: ProjectConfig {
                project_name: project_name.to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            },
            session: None,
            launcher_config: Some(LauncherConfig::default()),
            app_version: String::new(),
        }
    }

    #[tokio::test]
    async fn activate_project_survives_parallel_settings_save() {
        let _guard = LauncherDirGuard::acquire("activate_race").await;
        let activated = ProjectConfig {
            project_name: "NewActive".to_string(),
            mc_version: "1.21.1".to_string(),
            ..ProjectConfig::default()
        };
        activated
            .save_config()
            .await
            .expect("сохранение конфига нового профиля");
        let state = Mutex::new(state_with_current("Starter"));

        let (save_result, activate_result) = tokio::join!(
            update_project_config(&state, async |config: &mut ProjectConfig| {
                tokio::time::sleep(Duration::from_millis(80)).await;
                config.java_path = Some("java-path".to_string());
                Ok(())
            }),
            activate_project(&state, &activated),
        );
        save_result.expect("параллельное сохранение настроек");
        activate_result.expect("активация профиля");

        let current = state.lock().await.project_config.clone();
        assert_eq!(
            current.project_name, "NewActive",
            "параллельное сохранение настроек не должно откатывать активацию профиля"
        );
        assert_eq!(current.mc_version, "1.21.1");
    }

    #[tokio::test]
    async fn delete_switch_survives_parallel_settings_save() {
        let guard = LauncherDirGuard::acquire("delete_switch_race").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        for name in ["Old", "Next"] {
            ProjectConfig {
                project_name: name.to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            }
            .save_config()
            .await
            .expect("сохранение конфига проекта");
        }
        let project_dir = guard.root().join("project").join("Old");
        std::fs::create_dir_all(&project_dir).expect("создание папки проекта");

        let mut state = state_with_current("Old");
        if let Some(config) = state.launcher_config.as_mut() {
            config.add_project("Old");
            config.add_project("Next");
            config.current_project = Some("Next".to_string());
        }
        let state = Mutex::new(state);

        let (save_result, delete_result) = tokio::join!(
            update_project_config(&state, async |config: &mut ProjectConfig| {
                tokio::time::sleep(Duration::from_millis(80)).await;
                config.java_path = Some("java-path".to_string());
                Ok(())
            }),
            delete_named_project(&state, "Old"),
        );
        save_result.expect("параллельное сохранение настроек");
        delete_result.expect("удаление проекта");

        let current = state.lock().await;
        assert_eq!(
            current.project_config.project_name, "Next",
            "параллельное сохранение настроек не должно откатывать переключение после удаления"
        );
        assert!(current.session.is_none());
    }

    #[tokio::test]
    async fn delete_named_project_targets_the_named_project_not_the_current_one() {
        let guard = LauncherDirGuard::acquire("delete_named_not_current").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        for name in ["Alpha", "Beta"] {
            ProjectConfig {
                project_name: name.to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            }
            .save_config()
            .await
            .expect("сохранение конфига проекта");
            let dir = guard.root().join("project").join(name);
            std::fs::create_dir_all(dir.join("mods")).expect("создание папки проекта");
            std::fs::write(dir.join("mods").join("mod.jar"), b"x").expect("создание мода");
        }

        let mut state = state_with_current("Beta");
        if let Some(config) = state.launcher_config.as_mut() {
            config.add_project("Alpha");
            config.add_project("Beta");
        }
        let state = Mutex::new(state);

        let config = delete_named_project(&state, "Alpha")
            .await
            .expect("удаление именованного проекта");

        assert!(
            !guard.root().join("project").join("Alpha").exists(),
            "папка Alpha должна удалиться"
        );
        assert!(
            !guard
                .root()
                .join("project")
                .join("config")
                .join("Alpha.toml")
                .exists(),
            "конфиг Alpha должен удалиться"
        );
        assert!(
            guard
                .root()
                .join("project")
                .join("config")
                .join("Beta.toml")
                .exists(),
            "конфиг текущего Beta должен остаться"
        );
        assert!(
            guard
                .root()
                .join("project")
                .join("Beta")
                .join("mods")
                .join("mod.jar")
                .exists(),
            "файлы текущего Beta должны остаться"
        );

        let current = state.lock().await;
        assert_eq!(
            current.project_config.project_name, "Beta",
            "удаление чужого проекта не должно менять текущий"
        );
        assert_eq!(
            config.current_project.as_deref(),
            Some("Beta"),
            "current_project в конфиге не должен сбрасываться на первый из списка"
        );
        assert!(!config.has_project("Alpha"));
    }

    #[tokio::test]
    async fn delete_named_project_rejects_unknown_name() {
        let guard = LauncherDirGuard::acquire("delete_named_unknown").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        let state = Mutex::new(state_with_current("Beta"));

        let error = delete_named_project(&state, "Ghost")
            .await
            .expect_err("неизвестное имя должно отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error:#}"
        );
        assert!(
            !guard.root().join("project").join("Ghost").exists(),
            "файлов быть не должно"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn delete_named_project_aborts_when_toml_removal_fails() {
        use std::os::unix::fs::PermissionsExt;

        let guard = LauncherDirGuard::acquire("delete_toml_locked").await;
        let _config_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        let project_dir = guard.root().join("project").join("Cordelia");
        std::fs::create_dir_all(project_dir.join("mods")).expect("создание папки проекта");
        std::fs::write(project_dir.join("mods").join("mod.jar"), b"x").expect("создание мода");
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание папки конфигов");
        std::fs::write(config_dir.join("Cordelia.toml"), b"toml").expect("создание TOML");

        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Cordelia".to_string(),
                ..ProjectConfig::default()
            },
            session: None,
            launcher_config: Some(LauncherConfig::default()),
            app_version: String::new(),
        });
        state
            .lock()
            .await
            .launcher_config
            .as_mut()
            .expect("конфиг лаунчера")
            .add_project("Cordelia");

        std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o555))
            .expect("запрет записи в папку конфигов");
        let result = delete_named_project(&state, "Cordelia").await;
        std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o755))
            .expect("возврат прав");

        result.expect_err("сбой удаления TOML должен останавливать удаление проекта");

        assert!(
            !state
                .lock()
                .await
                .launcher_config
                .as_ref()
                .expect("конфиг лаунчера")
                .has_project("Cordelia"),
            "реестр должен обновляться до удаления файлов"
        );
        assert!(
            project_dir.exists(),
            "файлы проекта не должны удаляться при сбое удаления TOML"
        );
        assert!(
            config_dir.join("Cordelia.toml").exists(),
            "TOML должен остаться на месте при сбое"
        );
    }

    #[tokio::test]
    async fn delete_project_files_removes_dir_toml_and_manifest() {
        let guard = LauncherDirGuard::acquire("delete_project_files").await;
        let project_dir = guard.root().join("project").join("Test");
        std::fs::create_dir_all(project_dir.join("mods")).expect("создание папки проекта");
        std::fs::write(project_dir.join("mods").join("mod.jar"), b"x").expect("создание мода");

        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание папки конфигов");
        std::fs::write(config_dir.join("Test.toml"), b"toml").expect("создание TOML");
        std::fs::write(config_dir.join("Test.models.json"), b"[]")
            .expect("создание манифеста моделей");
        std::fs::write(config_dir.join("Other.toml"), b"toml").expect("создание чужого TOML");

        let manifest_dir = guard.root().join("manifest");
        std::fs::create_dir_all(&manifest_dir).expect("создание папки манифестов");
        std::fs::write(manifest_dir.join("installed_Test.json"), b"{}")
            .expect("создание манифеста");

        delete_project_files("Test")
            .await
            .expect("удаление файлов проекта");

        assert!(!project_dir.exists());
        assert!(!config_dir.join("Test.toml").exists());
        assert!(!config_dir.join("Test.models.json").exists());
        assert!(!manifest_dir.join("installed_Test.json").exists());
        assert!(config_dir.exists());
        assert!(config_dir.join("Other.toml").exists());
    }

    #[tokio::test]
    async fn delete_project_files_treats_missing_artifacts_as_success() {
        let _guard = LauncherDirGuard::acquire("delete_project_files_missing").await;

        delete_project_files("Ghost")
            .await
            .expect("удаление несуществующих артефактов должно быть успехом");
    }
}
