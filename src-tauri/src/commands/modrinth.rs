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
use crate::utils::errors::LauncherError;
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
        return Err(anyhow!(LauncherError::OfflineProfile(
            "моды Modrinth доступны только в одиночных профилях".to_string()
        )));
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

async fn collect_installed_hashes(
    mods_dir: &std::path::Path,
) -> std::collections::HashMap<String, String> {
    let mut local_hashes: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    let mut entries = match tokio::fs::read_dir(mods_dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return local_hashes,
        Err(e) => {
            log_err!(
                "[modrinth] Не удалось прочитать папку модов {:?}: {}",
                mods_dir,
                e
            );
            return local_hashes;
        }
    };

    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(e) => {
                log_err!(
                    "[modrinth] Не удалось прочитать запись в папке модов: {}",
                    e
                );
                continue;
            }
        };

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

    local_hashes
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
    let project = LauncherError::classify(
        client::get_project(&id)
            .await
            .context("Не удалось получить информацию о моде"),
        LauncherError::Modrinth,
    )?;
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
    let local_hashes = collect_installed_hashes(&ctx.mods_dir).await;

    let manifest: ModrinthManifest = LauncherError::classify(
        sync_installed_from_hashes(&ctx, local_hashes).await,
        LauncherError::Modrinth,
    )?;
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
    let checks = LauncherError::classify(check_updates(&ctx).await, LauncherError::Modrinth)?;
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
    let report = LauncherError::classify(
        install_project(&ctx, &project_id).await,
        LauncherError::Modrinth,
    )?;
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
    LauncherError::classify(
        uninstall_project(&ctx, &project_id).await,
        LauncherError::Modrinth,
    )?;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::collect_installed_hashes;
    use crate::test_support::LauncherDirGuard;

    #[tokio::test]
    async fn collect_installed_hashes_skips_entries_with_read_error() {
        let guard = LauncherDirGuard::acquire("modrinth_installed_scan").await;
        let mods_dir = guard.project_dir("Proj").join("mods");
        tokio::fs::create_dir_all(&mods_dir)
            .await
            .expect("создание папки модов");
        tokio::fs::write(mods_dir.join("good.jar"), b"jar-content")
            .await
            .expect("запись мода");

        let unreadable = mods_dir.join("broken.jar");
        tokio::fs::write(&unreadable, b"broken")
            .await
            .expect("запись проблемного мода");
        deny_read_permission(&unreadable);

        let hashes = collect_installed_hashes(&mods_dir).await;
        assert_eq!(
            hashes.len(),
            1,
            "скан должен продолжиться после ошибки чтения"
        );
        assert!(hashes.contains_key("good.jar"));
    }

    fn deny_read_permission(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = std::fs::metadata(path)
            .expect("метаданные проблемного мода")
            .permissions();
        permissions.set_mode(0o000);
        std::fs::set_permissions(path, permissions).expect("права на проблемный мод");
    }
}
