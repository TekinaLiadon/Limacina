use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use tokio::sync::Mutex;

use crate::modrinth::client;
use crate::modrinth::install::{
    check_updates, install_project, sync_installed_from_scan, uninstall_project, InstallContext,
};
use crate::modrinth::structs::{ModrinthManifest, ModrinthProject, ModrinthVersion, SearchHit};
use crate::state::config::current_project_config;
use crate::state::dto::{GlobalState, ModLoader};
use crate::utils::env_info::launcher_path;
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};

const SEARCH_PAGE_LIMIT: u32 = 20;
const MODRINTH_ID_MAX_LEN: usize = 128;

fn ensure_modrinth_id(id: &str) -> Result<()> {
    let valid = !id.is_empty()
        && id.len() <= MODRINTH_ID_MAX_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if valid {
        return Ok(());
    }
    bail!(LauncherError::InvalidInput(format!(
        "Некорректный идентификатор мода: {id}"
    )))
}

#[derive(Serialize)]
pub struct SearchDto {
    pub hits: Vec<SearchHit>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
    pub version_numbers: std::collections::HashMap<String, String>,
    pub version_numbers_failed: bool,
}

#[derive(Serialize)]
pub struct ProjectDetails {
    pub project: ModrinthProject,
    pub versions: Vec<ModrinthVersion>,
    pub versions_failed: bool,
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

#[derive(Debug)]
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
    let config = current_project_config(state).await?;
    if config.online {
        return Err(anyhow!(LauncherError::OfflineProfile(
            "моды Modrinth доступны только в одиночных профилях".to_string()
        )));
    }
    if config.mod_loader == ModLoader::Vanilla {
        return Err(anyhow!(LauncherError::InvalidInput(
            "моды Modrinth требуют загрузчик модов: выберите Fabric, Forge или NeoForge для профиля"
                .to_string()
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

    let result = LauncherError::classify(
        client::search(
            query.as_deref().unwrap_or(""),
            &facets,
            index.as_deref().unwrap_or("relevance"),
            offset,
            SEARCH_PAGE_LIMIT,
        )
        .await,
        LauncherError::Modrinth,
    )?;

    let version_ids: Vec<String> = result
        .hits
        .iter()
        .filter_map(|h| h.latest_version.clone())
        .collect();
    let mut version_numbers_failed = false;
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
                version_numbers_failed = true;
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
        version_numbers_failed,
    })
}

#[tauri::command]
pub async fn modrinth_project(
    id: String,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<ProjectDetails> {
    ensure_modrinth_id(&id)?;
    profile_context(&state).await?;
    let project = LauncherError::classify(
        client::get_project(&id)
            .await
            .context("Не удалось получить информацию о моде"),
        LauncherError::Modrinth,
    )?;
    let mut versions_failed = false;
    let versions = match client::get_project_versions(&id, &[], &[]).await {
        Ok(versions) => versions,
        Err(e) => {
            log_err!("[modrinth] Не удалось получить версии мода {}: {}", id, e);
            versions_failed = true;
            Vec::new()
        }
    };
    Ok(ProjectDetails {
        project,
        versions,
        versions_failed,
    })
}

#[tauri::command]
pub async fn modrinth_installed(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<Vec<InstalledMod>> {
    let ctx = install_context(&state).await?;

    let manifest: ModrinthManifest = LauncherError::classify(
        sync_installed_from_scan(&ctx).await,
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
    mods.sort_by_key(|a| a.title.to_lowercase());
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
    ensure_modrinth_id(&project_id)?;
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
    ensure_modrinth_id(&project_id)?;
    let ctx = install_context(&state).await?;
    LauncherError::classify(
        uninstall_project(&ctx, &project_id).await,
        LauncherError::Modrinth,
    )?;
    Ok(())
}

#[cfg(test)]
mod modrinth_id_tests {
    use super::ensure_modrinth_id;
    use crate::utils::errors::LauncherError;

    #[test]
    fn plain_ids_and_slugs_pass() {
        for id in [
            "AANobbMI",
            "sodium",
            "fabric-api_2",
            "create-1-20-1",
            "0123456789",
        ] {
            ensure_modrinth_id(id)
                .unwrap_or_else(|e| panic!("корректный идентификатор {id} отклонён: {e:#}"));
        }
    }

    #[test]
    fn url_shaped_and_traversal_ids_are_rejected() {
        for id in [
            "",
            "../evil",
            "mods/../../escape",
            "sodium?facet=x",
            "sodium#fragment",
            "sodium&other=1",
            "two words",
            "id:colon",
            "id%20encoded",
        ] {
            let error = ensure_modrinth_id(id)
                .err()
                .unwrap_or_else(|| panic!("некорректный идентификатор {id:?} прошёл проверку"));
            assert!(
                matches!(
                    error.downcast_ref::<LauncherError>(),
                    Some(LauncherError::InvalidInput(_))
                ),
                "ожидается InvalidInput для {id:?}: {error:#}"
            );
            assert!(
                error.to_string().contains("идентификатор мода"),
                "ошибка должна называть проблему: {error:#}"
            );
        }
    }

    #[test]
    fn oversized_id_is_rejected() {
        let long = "a".repeat(129);
        assert!(ensure_modrinth_id(&long).is_err());
        let boundary = "a".repeat(128);
        ensure_modrinth_id(&boundary).expect("граничная длина допустима");
    }
}

#[cfg(test)]
mod profile_context_tests {
    use super::profile_context;
    use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
    use tokio::sync::Mutex;

    fn state_with_loader(loader: ModLoader) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "VanillaCheck".to_string(),
                mc_version: "1.21.1".to_string(),
                mod_loader: loader,
                online: false,
                ..ProjectConfig::default()
            },
            ..GlobalState::default()
        })
    }

    #[tokio::test]
    async fn vanilla_profile_is_blocked_with_explicit_message() {
        let state = state_with_loader(ModLoader::Vanilla);

        let error = profile_context(&state)
            .await
            .expect_err("профиль без лоадера не должен искать и ставить моды");
        assert!(
            error.to_string().contains("загрузчик модов"),
            "ошибка должна объяснять причину: {error:#}"
        );
    }

    #[tokio::test]
    async fn loader_profile_passes_with_loader_filter() {
        for loader in [ModLoader::Fabric, ModLoader::Forge, ModLoader::NeoForge] {
            let state = state_with_loader(loader.clone());
            let profile = profile_context(&state)
                .await
                .unwrap_or_else(|e| panic!("профиль с лоадером должен проходить: {e:#}"));
            assert!(
                profile.loaders.len() == 1,
                "для {:?} должен передаваться ровно один лоадер-фильтр",
                loader
            );
        }
    }
}
