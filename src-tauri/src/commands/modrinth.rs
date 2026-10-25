use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tokio::sync::Mutex;

use crate::modrinth::client;
use crate::modrinth::install::{
    check_updates, install_project, sync_installed_from_scan, uninstall_project, InstallContext,
};
use crate::modrinth::modset::{
    self, ensure_modrinth_id, ModsetEntry, ModsetRecord, ModsetUnresolved,
};
use crate::modrinth::structs::{ModrinthManifest, ModrinthProject, ModrinthVersion, SearchHit};
use crate::state::config::current_project_config;
use crate::state::dto::{GlobalState, ModLoader};
use crate::utils::env_info::launcher_path;
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};

const SEARCH_PAGE_LIMIT: u32 = 20;

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
    ensure_modrinth_id(&id, "мода")?;
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
    version_id: Option<String>,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<InstallResult> {
    ensure_modrinth_id(&project_id, "мода")?;
    if let Some(version_id) = &version_id {
        ensure_modrinth_id(version_id, "версии")?;
    }
    let ctx = install_context(&state).await?;
    let report = LauncherError::classify(
        install_project(&ctx, &project_id, version_id.as_deref()).await,
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
    ensure_modrinth_id(&project_id, "мода")?;
    let ctx = install_context(&state).await?;
    LauncherError::classify(
        uninstall_project(&ctx, &project_id).await,
        LauncherError::Modrinth,
    )?;
    Ok(())
}

#[derive(Serialize)]
pub struct ModrinthExportReport {
    pub mods: Vec<ModsetRecord>,
    pub unresolved: Vec<ModsetUnresolved>,
}

#[derive(Serialize)]
pub struct ModrinthImportPreview {
    #[serde(rename = "formatVersion")]
    pub format_version: u32,
    pub entries: Vec<ModsetEntry>,
}

#[derive(Serialize)]
pub struct ModrinthImportReport {
    pub entries: Vec<ModsetEntry>,
}

#[tauri::command]
pub async fn modrinth_export_prepare(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<ModrinthExportReport> {
    let ctx = install_context(&state).await?;
    let (mods, unresolved) =
        LauncherError::classify(modset::export_prepare(&ctx).await, LauncherError::Modrinth)?;
    Ok(ModrinthExportReport { mods, unresolved })
}

#[tauri::command]
pub async fn modrinth_export_save(path: String, mods: Vec<ModsetRecord>) -> CommandResult<()> {
    LauncherError::classify(
        modset::export_save(&path, &mods).await,
        LauncherError::Modrinth,
    )?;
    Ok(())
}

#[tauri::command]
pub async fn modrinth_import_preview(content: String) -> CommandResult<ModrinthImportPreview> {
    let parsed = LauncherError::classify(modset::parse_modset(&content), LauncherError::Modrinth)?;
    Ok(ModrinthImportPreview {
        format_version: parsed.format_version,
        entries: parsed.entries,
    })
}

#[tauri::command]
pub async fn modrinth_import_apply(
    content: String,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<ModrinthImportReport> {
    let ctx = install_context(&state).await?;
    let entries = LauncherError::classify(
        modset::import_apply(&ctx, &content).await,
        LauncherError::Modrinth,
    )?;
    log_info!(
        "[modrinth] Импорт набора завершён: {} записей в отчёте",
        entries.len()
    );
    Ok(ModrinthImportReport { entries })
}

#[cfg(test)]
mod modrinth_id_tests {
    use crate::modrinth::modset::ensure_modrinth_id;
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
            ensure_modrinth_id(id, "мода")
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
            let error = ensure_modrinth_id(id, "мода")
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
        assert!(ensure_modrinth_id(&long, "мода").is_err());
        let boundary = "a".repeat(128);
        ensure_modrinth_id(&boundary, "мода").expect("граничная длина допустима");
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

#[cfg(test)]
mod modset_command_tests {
    use super::{install_context, modrinth_export_save, modrinth_import_preview};
    use crate::modrinth::modset::{parse_modset, ModsetRecord, MODSET_SOURCE};
    use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
    use crate::test_support::{part_files_in, LauncherDirGuard, TempDir};
    use tokio::sync::Mutex;

    fn record(project_id: Option<&str>) -> ModsetRecord {
        ModsetRecord {
            source: MODSET_SOURCE.to_string(),
            project_id: project_id.map(str::to_string),
            slug: None,
            version_id: Some("ver1".to_string()),
            version_number: Some("1.0.0".to_string()),
            title: Some("Test Mod".to_string()),
            filename: Some("test-mod.jar".to_string()),
        }
    }

    #[tokio::test]
    async fn export_save_appends_extension_and_writes_atomically() {
        let dir = TempDir::new("modset_cmd_append");
        let path = dir.0.join("my-mods");

        modrinth_export_save(
            path.to_string_lossy().as_ref().to_string(),
            vec![record(Some("AAA"))],
        )
        .await
        .expect("сохранение набора");

        let target = dir.0.join("my-mods.limmods.json");
        assert!(target.exists(), "расширение должно добавляться");
        let content = std::fs::read_to_string(&target).expect("чтение файла набора");
        let parsed = parse_modset(&content).expect("записанный файл читается парсером");
        assert_eq!(parsed.format_version, 1);
        assert_eq!(parsed.entries[0].project_id.as_deref(), Some("AAA"));
        assert!(
            part_files_in(&dir.0).is_empty(),
            "атомарная запись не оставляет .part"
        );
    }

    #[tokio::test]
    async fn export_save_keeps_existing_extension() {
        let dir = TempDir::new("modset_cmd_keep");
        let path = dir.0.join("pack.limmods.json");

        modrinth_export_save(
            path.to_string_lossy().as_ref().to_string(),
            vec![record(Some("AAA"))],
        )
        .await
        .expect("сохранение набора");

        assert!(path.exists());
        assert!(!dir.0.join("pack.limmods.json.limmods.json").exists());
    }

    #[tokio::test]
    async fn export_save_rejects_relative_path() {
        let error =
            modrinth_export_save("relative/dir/mods".to_string(), vec![record(Some("AAA"))])
                .await
                .expect_err("относительный путь отклоняется");
        assert!(error.message.contains("абсолютным"), "{}", error.message);
    }

    #[tokio::test]
    async fn export_save_rejects_reserved_manifest_name() {
        let dir = TempDir::new("modset_cmd_reserved");
        let path = dir.0.join("modrinth.json");

        let error = modrinth_export_save(
            path.to_string_lossy().as_ref().to_string(),
            vec![record(Some("AAA"))],
        )
        .await
        .expect_err("имя внутреннего манифеста запрещено");

        assert!(
            error.message.contains("зарезервировано"),
            "{}",
            error.message
        );
        assert!(!path.exists(), "манифест bookkeeping не перезаписывается");
    }

    #[tokio::test]
    async fn export_save_rejects_bad_records_before_write() {
        let dir = TempDir::new("modset_cmd_bad_records");
        let mut url_shaped = record(Some("AAA"));
        url_shaped.project_id = Some("sodium?facet=x".to_string());
        let foreign = ModsetRecord {
            source: "curseforge".to_string(),
            ..record(Some("AAA"))
        };
        for bad in [url_shaped, foreign] {
            let path = dir.0.join("out.limmods.json");
            let error =
                modrinth_export_save(path.to_string_lossy().as_ref().to_string(), vec![bad])
                    .await
                    .expect_err("некорректная запись отклоняется до записи файла");
            assert_eq!(error.code, "invalid_input", "{}", error.message);
            assert!(
                !path.exists(),
                "файл не должен создаваться: {}",
                error.message
            );
        }
    }

    #[tokio::test]
    async fn import_preview_parses_without_profile_or_state() {
        let error = modrinth_import_preview("{ не json".to_string())
            .await
            .err()
            .expect("битый файл даёт понятную ошибку");
        assert!(error.message.contains("JSON"), "{}", error.message);

        let preview = modrinth_import_preview(
            r#"{"format_version": 1, "mods": [{"source": "modrinth", "project_id": "AAA", "title": "Mod A"}]}"#
                .to_string(),
        )
        .await
        .expect("превью без профиля и сети");
        assert_eq!(preview.format_version, 1);
        assert_eq!(preview.entries.len(), 1);
        assert_eq!(preview.entries[0].title.as_deref(), Some("Mod A"));
    }

    #[tokio::test]
    async fn import_apply_is_gated_for_vanilla_profile() {
        let _dir = LauncherDirGuard::acquire("modset_cmd_gate").await;
        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "VanillaCheck".to_string(),
                mc_version: "1.21.1".to_string(),
                mod_loader: ModLoader::Vanilla,
                online: false,
                ..ProjectConfig::default()
            },
            ..GlobalState::default()
        });

        let error = install_context(&state)
            .await
            .err()
            .expect("Vanilla-профиль не должен импортировать наборы модов");
        assert!(
            error.to_string().contains("загрузчик модов"),
            "ошибка должна объяснять причину: {error:#}"
        );
    }
}
