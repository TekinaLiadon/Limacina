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
use crate::minecraft::structs::{ModLoader as ModLoaderTrait, INDEX_CACHE_FILES, INDEX_CACHE_PREFIXES};
use crate::minecraft::vanilla::structs::VanillaVersionsManifest;
use crate::state::config::load_config;
use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
use crate::utils::compare_versions;
use crate::utils::download_file::download_json;
use crate::utils::env_info::{launcher_path, normalize_server_url};
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
    let trimmed = name.trim();
    if trimmed.is_empty() {
        bail!("Введите название профиля");
    }
    if trimmed.chars().count() > 64 {
        bail!("Название профиля не должно быть длиннее 64 символов");
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '.']) {
        bail!("Название профиля не должно содержать символы / \\ : * ? \" < > | и точку");
    }

    let already_registered = {
        let guard = state.lock().await;
        guard
            .launcher_config
            .as_ref()
            .is_some_and(|c| c.has_project(trimmed))
    };
    if already_registered || load_config(trimmed).await.is_ok() {
        bail!("Профиль «{}» уже существует", trimmed);
    }
    Ok(())
}


async fn persist_new_project(config: &ProjectConfig) -> Result<()> {
    let project_dir = launcher_path(Some(&config.project_name))?;
    fs::create_dir_all(&project_dir)
        .await
        .with_context(|| format!("Не удалось создать папку профиля {:?}", project_dir))?;
    config.save_config().await?;
    Ok(())
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
        bail!("Введите адрес сервера");
    }
    let base_url = normalize_server_url(server_url);

    log_info!("[profile] Запрос конфига сервера: {}/v1/launcher/config", base_url);
    let response = http_client()
        .get(format!("{}/v1/launcher/config", base_url))
        .send()
        .await
        .with_context(|| format!("Не удалось подключиться к {}", base_url))?;

    if !response.status().is_success() {
        bail!("Сервер {} вернул {}", base_url, response.status());
    }

    let mut config: ProjectConfig = response
        .json()
        .await
        .context("Не удалось распарсить конфиг сервера")?;

    if config.project_name.trim().is_empty() {
        bail!("Сервер не вернул название проекта");
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
        bail!("Выберите версию Minecraft");
    }

    let loader_version = loader_version.filter(|v| !v.trim().is_empty());
    if mod_loader != ModLoader::Vanilla && loader_version.is_none() {
        bail!("Выберите версию загрузчика модов");
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

    log_info!("[profile] Одиночный профиль создан: {}", config.project_name);
    Ok(config)
}

async fn minecraft_versions(include_snapshots: bool) -> Result<Vec<String>> {
    let manifest_path = launcher_path(None)?
        .join("manifest")
        .join("vanilla_index.json");
    let manifest: VanillaVersionsManifest =
        download_json(Some(VERSION_MANIFEST_URL), &manifest_path)
            .await
            .context("Не удалось получить список версий Minecraft")?;

    Ok(manifest
        .versions
        .into_iter()
        .filter(|v| include_snapshots || v.version_type == "release")
        .map(|v| v.id)
        .collect())
}

async fn loader_versions(mod_loader: ModLoader, mc_version: &str) -> Result<Vec<String>> {
    if mc_version.trim().is_empty() {
        bail!("Сначала выберите версию Minecraft");
    }

    let versions = match mod_loader {
        ModLoader::Vanilla => Vec::new(),
        ModLoader::Fabric => {
            let probe = ProjectConfig {
                mc_version: mc_version.to_string(),
                ..ProjectConfig::default()
            };
            Fabric
                .versions(&probe)
                .await
                .with_context(|| format!("Нет версий Fabric для Minecraft {}", mc_version))?
                .into_iter()
                .map(|v| v.id)
                .collect()
        }
        ModLoader::Forge => pick_maven_versions(forge_manifest_index().await?, mc_version),
        ModLoader::NeoForge => pick_maven_versions(neoforge_manifest_index().await?, mc_version),
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
        let mut entries = fs::read_dir(&manifest_dir)
            .await
            .with_context(|| format!("Не удалось прочитать {:?}", manifest_dir))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .context("Не удалось прочитать запись в папке manifest")?
        {
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

    log_info!("[manifests] Удалено файлов: {}, перекачивание индексов", removed);

    minecraft_versions(false).await?;
    forge_manifest_index().await?;
    neoforge_manifest_index().await?;

    Ok(format!("Манифесты обновлены (удалено кешей: {})", removed))
}
