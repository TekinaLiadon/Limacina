use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tokio::sync::Mutex;

use crate::modrinth::client;
use crate::modrinth::install::{
    check_updates, install_project, sync_installed_from_hashes, uninstall_project, InstallContext,
};
use crate::modrinth::structs::{ModrinthManifest, ModrinthProject, ModrinthVersion, SearchHit};
use crate::state::dto::{GlobalState, ModLoader};
use crate::utils::download_file::file_sha1;
use crate::utils::env_info::launcher_path;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};

#[derive(Serialize)]
pub struct SearchDto {
    pub hits: Vec<SearchHit>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
    pub version_numbers: std::collections::HashMap<String, String>,
}

#[derive(Serialize)]
pub struct ProjectDetails {
    pub project: ModrinthProject,
    pub versions: Vec<ModrinthVersion>,
}

#[derive(Serialize, Clone)]
pub struct InstalledMod {
    pub project_id: String,
    pub slug: Option<String>,
    pub title: String,
    pub icon_url: Option<String>,
    pub filename: String,
    pub version_number: String,
    pub sha1: String,
}

#[derive(Serialize, Clone)]
pub struct ModrinthUpdate {
    pub project_id: String,
    pub current_version: String,
    pub available_version: Option<String>,
}

#[derive(Serialize)]
pub struct InstallResult {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
}

struct ProfileContext {
    project_name: String,
    loaders: Vec<String>,
    game_versions: Vec<String>,
}

fn loader_key(loader: &ModLoader) -> Option<String> {
    match loader {
        ModLoader::Fabric => Some("fabric".to_string()),
        ModLoader::Forge => Some("forge".to_string()),
        ModLoader::NeoForge => Some("neoforge".to_string()),
        ModLoader::Vanilla => None,
    }
}

async fn profile_context(state: &Mutex<GlobalState>) -> Result<ProfileContext> {
    let config = state.lock().await.project_config.clone();
    if config.online {
        return Err(anyhow!(
            "Моды Modrinth доступны только в одиночных профилях"
        ));
    }
    let loaders = loader_key(&config.mod_loader).into_iter().collect();
    Ok(ProfileContext {
        project_name: config.project_name.clone(),
        loaders,
        game_versions: vec![config.mc_version.clone()],
    })
}

async fn install_context(state: &Mutex<GlobalState>) -> Result<InstallContext> {
    let profile = profile_context(state).await?;
    let base = launcher_path(Some(&profile.project_name))?;
    Ok(InstallContext {
        loaders: profile.loaders,
        game_versions: profile.game_versions,
        mods_dir: base.join("mods"),
        manifest_path: base.join("modrinth.json"),
    })
}

#[tauri::command]
pub async fn modrinth_search(
    query: Option<String>,
    index: Option<String>,
    categories: Vec<String>,
    offset: u32,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<SearchDto> {
    let profile = profile_context(&state).await?;

    let mut facets: Vec<Vec<String>> = vec![
        vec!["project_type:mod".to_string()],
        profile
            .game_versions
            .iter()
            .map(|v| format!("versions:{}", v))
            .collect(),
    ];
    if let Some(loader) = profile.loaders.first() {
        facets.push(vec![format!("categories:{}", loader)]);
    }
    if !categories.is_empty() {
        facets.push(
            categories
                .iter()
                .map(|c| format!("categories:{}", c))
                .collect(),
        );
    }

    let result = client::search(
        query.as_deref().unwrap_or(""),
        &facets,
        index.as_deref().unwrap_or("relevance"),
        offset,
        20,
    )
    .await?;

    let version_ids: Vec<String> = result
        .hits
        .iter()
        .filter_map(|h| h.latest_version.clone())
        .collect();
    let version_numbers: std::collections::HashMap<String, String> = if version_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        match client::get_versions(&version_ids).await {
            Ok(versions) => versions
                .into_iter()
                .map(|v| (v.project_id, v.version_number))
                .collect(),
            Err(e) => {
                log_err!("[modrinth] Не удалось определить версии из поиска: {}", e);
                std::collections::HashMap::new()
            }
        }
    };

    Ok(SearchDto {
        hits: result.hits,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
        version_numbers,
    })
}

#[tauri::command]
pub async fn modrinth_project(
    id: String,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<ProjectDetails> {
    profile_context(&state).await?;
    let project = client::get_project(&id)
        .await
        .context("Не удалось получить информацию о моде")?;
    let versions = client::get_project_versions(&id, &[], &[])
        .await
        .unwrap_or_default();
    Ok(ProjectDetails { project, versions })
}

#[tauri::command]
pub async fn modrinth_installed(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<Vec<InstalledMod>> {
    let ctx = install_context(&state).await?;

    let mut local_hashes: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&ctx.mods_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if !entry
                .file_type()
                .await
                .map(|t| t.is_file())
                .unwrap_or(false)
            {
                continue;
            }
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "part") {
                continue;
            }
            let filename = entry.file_name().to_string_lossy().to_string();
            match file_sha1(&path).await {
                Ok(hash) => {
                    local_hashes.insert(filename, hash);
                }
                Err(e) => {
                    log_err!("[modrinth] Не удалось вычислить хеш {:?}: {}", path, e);
                }
            }
        }
    }

    let manifest: ModrinthManifest = sync_installed_from_hashes(&ctx, local_hashes).await?;
    let mut mods: Vec<InstalledMod> = manifest
        .mods
        .into_values()
        .map(|entry| InstalledMod {
            project_id: entry.project_id,
            slug: entry.slug,
            title: entry.title,
            icon_url: entry.icon_url,
            filename: entry.filename,
            version_number: entry.version_number,
            sha1: entry.sha1,
        })
        .collect();
    mods.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(mods)
}

#[tauri::command]
pub async fn modrinth_check_updates(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<Vec<ModrinthUpdate>> {
    let ctx = install_context(&state).await?;
    let checks = check_updates(&ctx).await?;
    Ok(checks
        .into_iter()
        .map(|c| ModrinthUpdate {
            project_id: c.project_id,
            current_version: c.current_version,
            available_version: c.available_version,
        })
        .collect())
}

#[tauri::command]
pub async fn modrinth_install(
    project_id: String,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<InstallResult> {
    let ctx = install_context(&state).await?;
    let report = install_project(&ctx, &project_id).await?;
    log_info!(
        "[modrinth] Установка завершена: установлено {}, пропущено {}",
        report.installed.len(),
        report.skipped.len()
    );
    Ok(InstallResult {
        installed: report.installed,
        skipped: report.skipped,
    })
}

#[tauri::command]
pub async fn modrinth_uninstall(
    project_id: String,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let ctx = install_context(&state).await?;
    uninstall_project(&ctx, &project_id).await?;
    Ok(())
}
