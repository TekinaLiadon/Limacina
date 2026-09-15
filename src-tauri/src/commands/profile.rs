use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use tauri::State;
use tokio::fs;
use tokio::sync::Mutex;

use crate::commands::launcher_config::update_launcher_config;
use crate::log_info;
use crate::minecraft::manifest::VERSION_MANIFEST_URL;
use crate::minecraft::mod_loader::fabric::Fabric;
use crate::minecraft::mod_loader::forge::manifest::get_manifest_index as forge_manifest_index;
use crate::minecraft::mod_loader::neoforge::manifest::get_manifest_index as neoforge_manifest_index;
use crate::minecraft::structs::{
    ModLoader as ModLoaderTrait, INDEX_CACHE_FILES, INDEX_CACHE_PREFIXES,
};
use crate::minecraft::vanilla::structs::VanillaVersionsManifest;
use crate::state::config::{load_config, load_config_or_default, validate_project_name};
use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
use crate::state::launcher_config::LauncherConfig;
use crate::utils::compare_versions;
use crate::utils::download_file::download_json;
use crate::utils::env_info::{launcher_path, normalize_server_url};
use crate::utils::errors::LauncherError;
use crate::utils::http::http_client;
use crate::utils::tauri_err::CommandResult;

async fn register_project(state: &State<'_, Mutex<GlobalState>>, project_name: &str) -> Result<()> {
    update_launcher_config(state, |config| config.add_project(project_name)).await?;
    Ok(())
}

async fn validate_new_project_name(
    state: &State<'_, Mutex<GlobalState>>,
    name: &str,
) -> Result<()> {
    validate_project_name(name)?;

    let trimmed = name.trim();
    let already_registered = {
        let guard = state.lock().await;
        guard
            .launcher_config
            .as_ref()
            .is_some_and(|c| c.has_project(trimmed))
    };
    if already_registered || load_config(trimmed).await.is_ok() {
        bail!(LauncherError::ProjectExists(trimmed.to_string()));
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

async fn activate_project(state: &State<'_, Mutex<GlobalState>>, config: &ProjectConfig) {
    let mut guard = state.lock().await;
    guard.project_config = config.clone();
}

async fn add_server_profile(
    state: &State<'_, Mutex<GlobalState>>,
    server_url: &str,
) -> Result<ProjectConfig> {
    if server_url.trim().is_empty() {
        bail!(LauncherError::ServerUrlMissing);
    }
    let base_url = normalize_server_url(server_url);

    log_info!(
        "[profile] Запрос конфига сервера: {}/v1/launcher/config",
        base_url
    );
    let response = LauncherError::classify(
        http_client()
            .get(format!("{}/v1/launcher/config", base_url))
            .send()
            .await
            .with_context(|| format!("Не удалось подключиться к {}", base_url)),
        LauncherError::LauncherServer,
    )?;

    if !response.status().is_success() {
        bail!(LauncherError::LauncherServer(format!(
            "Сервер {} вернул {}",
            base_url,
            response.status()
        )));
    }

    let mut config: ProjectConfig = LauncherError::classify(
        response
            .json()
            .await
            .context("Не удалось распарсить конфиг сервера"),
        LauncherError::LauncherServer,
    )?;

    if config.project_name.trim().is_empty() {
        bail!(LauncherError::LauncherServer(
            "Сервер не вернул название проекта".to_string()
        ));
    }

    validate_new_project_name(state, &config.project_name).await?;

    config.online = true;
    config.initialized = false;
    config.server_url = Some(base_url);

    persist_new_project(&config).await?;
    register_project(state, &config.project_name).await?;
    activate_project(state, &config).await;

    log_info!("[profile] Профиль сервера создан: {}", config.project_name);
    Ok(config)
}

async fn add_offline_profile(
    state: &State<'_, Mutex<GlobalState>>,
    name: &str,
    mc_version: &str,
    mod_loader: ModLoader,
    loader_version: Option<String>,
) -> Result<ProjectConfig> {
    validate_new_project_name(state, name).await?;

    if mc_version.trim().is_empty() {
        bail!(LauncherError::InvalidInput(
            "Выберите версию Minecraft".to_string()
        ));
    }

    let loader_version = loader_version.filter(|v| !v.trim().is_empty());
    if mod_loader != ModLoader::Vanilla && loader_version.is_none() {
        bail!(LauncherError::LoaderNotSelected);
    }

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
    activate_project(state, &config).await;

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
            LauncherError::classify(forge_manifest_index().await, LauncherError::ManifestParse)?,
            mc_version,
        ),
        ModLoader::NeoForge => pick_maven_versions(
            LauncherError::classify(
                neoforge_manifest_index().await,
                LauncherError::ManifestParse,
            )?,
            mc_version,
        ),
    };

    Ok(versions)
}

fn pick_maven_versions(index: HashMap<String, Vec<String>>, mc_version: &str) -> Vec<String> {
    let mut versions = index.get(mc_version).cloned().unwrap_or_default();
    versions.sort_by(|a, b| compare_versions(b, a));
    versions
}

#[tauri::command]
pub async fn create_server_profile(
    state: State<'_, Mutex<GlobalState>>,
    server_url: String,
) -> CommandResult<ProjectConfig> {
    Ok(add_server_profile(&state, &server_url).await?)
}

#[tauri::command]
pub async fn get_server_connect_url(state: State<'_, Mutex<GlobalState>>) -> CommandResult<String> {
    let (project_name, online, server_url) = {
        let guard = state.lock().await;
        (
            guard.project_config.project_name.clone(),
            guard.project_config.online,
            guard.project_config.resolved_server_url(),
        )
    };
    if project_name.trim().is_empty() {
        return Err(LauncherError::ProjectNotSelected.into());
    }
    if !online {
        return Err(LauncherError::OfflineProfile(
            "ссылка для подключения доступна только у серверных профилей".to_string(),
        )
        .into());
    }
    let url = server_url.ok_or(LauncherError::ServerUrlMissing)?;
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
    Ok(add_offline_profile(&state, &name, &mc_version, mod_loader, loader_version).await?)
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
    let project_dir = launcher_path(Some(project_name))?;
    if project_dir.exists() {
        LauncherError::classify(
            fs::remove_dir_all(&project_dir)
                .await
                .with_context(|| format!("Не удалось удалить папку проекта {:?}", project_dir)),
            LauncherError::DiskIo,
        )?;
    }

    let config_path = launcher_path(Some("config"))?.join(format!("{}.toml", project_name));
    let _ = fs::remove_file(&config_path).await;

    let models_manifest_path =
        launcher_path(Some("config"))?.join(format!("{}.models.json", project_name));
    let _ = fs::remove_file(&models_manifest_path).await;

    let manifest_path = launcher_path(None)?
        .join("manifest")
        .join(format!("installed_{}.json", project_name));
    let _ = fs::remove_file(&manifest_path).await;

    Ok(())
}

async fn delete_project_credentials(project_name: &str, logins: Vec<String>) {
    for username in logins {
        for key_suffix in ["password", "refresh_token", "uuid"] {
            let _ =
                crate::auth::storage::delete_credential(project_name, &username, key_suffix).await;
        }
    }
}

async fn delete_current_project(state: &State<'_, Mutex<GlobalState>>) -> Result<LauncherConfig> {
    let project_name = {
        let guard = state.lock().await;
        guard.project_config.project_name.clone()
    };
    if project_name.trim().is_empty() {
        bail!(LauncherError::ProjectNotSelected);
    }
    if project_name.eq_ignore_ascii_case("config") {
        bail!(LauncherError::ProjectNameReserved);
    }
    let env_project = crate::utils::env_info::get_default_project_name();
    if !crate::utils::env_info::is_offline_build()
        && !env_project.is_empty()
        && project_name == env_project
    {
        bail!(LauncherError::ProjectProtected(project_name.clone()));
    }

    let saved_logins = {
        let guard = state.lock().await;
        guard
            .launcher_config
            .as_ref()
            .map(|c| c.get_logins(&project_name))
            .unwrap_or_default()
    };
    delete_project_credentials(&project_name, saved_logins).await;

    delete_project_files(&project_name).await?;

    let config = update_launcher_config(state, |config| {
        config.remove_project(&project_name);
    })
    .await?;

    let next_project = config.current_project.clone();
    let next_config = match next_project.as_deref() {
        Some(name) if !name.is_empty() => load_config_or_default(name).await?,
        _ => ProjectConfig::default(),
    };
    {
        let mut guard = state.lock().await;
        guard.session = None;
        guard.project_config = next_config;
    }

    log_info!("[profile] Проект {} удалён", project_name);
    Ok(config)
}

#[tauri::command]
pub async fn delete_project(state: State<'_, Mutex<GlobalState>>) -> CommandResult<LauncherConfig> {
    Ok(delete_current_project(&state).await?)
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

#[tauri::command]
pub async fn refresh_manifests() -> CommandResult<String> {
    let manifest_dir = launcher_path(None)?.join("manifest");
    let mut removed = 0usize;

    if manifest_dir.exists() {
        let mut entries = LauncherError::classify(
            fs::read_dir(&manifest_dir)
                .await
                .with_context(|| format!("Не удалось прочитать {:?}", manifest_dir)),
            LauncherError::DiskIo,
        )?;
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
            if is_index {
                log_info!("[manifests] Удалён кеш: {}", name);
                let _ = fs::remove_file(entry.path()).await;
                removed += 1;
            }
        }
    }

    log_info!(
        "[manifests] Удалено файлов: {}, перекачивание индексов",
        removed
    );

    LauncherError::classify(
        minecraft_versions(false).await,
        LauncherError::ManifestParse,
    )?;
    LauncherError::classify(forge_manifest_index().await, LauncherError::ManifestParse)?;
    LauncherError::classify(
        neoforge_manifest_index().await,
        LauncherError::ManifestParse,
    )?;

    Ok(format!("Манифесты обновлены (удалено кешей: {})", removed))
}

#[cfg(test)]
mod tests {
    use crate::test_support::LauncherDirGuard;

    use super::delete_project_files;

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
}
