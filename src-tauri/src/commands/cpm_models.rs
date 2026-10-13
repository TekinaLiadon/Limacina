use std::sync::{Mutex as StdMutex, OnceLock};

use anyhow::{anyhow, Context, Result};
use tauri::State;
use tokio::sync::Mutex;

use crate::cpm::{
    build_link_definition, build_player_model_file, local_model_file_name, merge_selected_model,
    model_file_name, parse_cpm_config, pick_eviction_index, rebind_selection,
    remove_selected_model, CpmModelEntry, CpmModelManifest, RebindDecision, SKIN_TYPE_DEFAULT,
    SKIN_TYPE_SLIM,
};
use crate::launcher_server::user_content;
use crate::state::config::current_project_config;
use crate::state::dto::GlobalState;
use crate::utils::allowlisted_read::{has_extension, AllowlistedRead};
use crate::utils::download_file::{read_to_string_opt, write_atomic};
use crate::utils::env_info::launcher_path;
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};

const CPM_PROJECT_EXT: &str = "cpmproject";
const CPM_PROJECT_MAX_BYTES: u64 = 20 * 1024 * 1024;
const CPM_PROJECT_READ: AllowlistedRead = AllowlistedRead::new(
    CPM_PROJECT_EXT,
    CPM_PROJECT_MAX_BYTES,
    1024 * 1024,
    "МБ",
    "модели",
);

static MODELS_MANIFEST_LOCK: Mutex<()> = Mutex::const_new(());

fn pending_cpm_project() -> &'static StdMutex<Option<String>> {
    static PENDING: OnceLock<StdMutex<Option<String>>> = OnceLock::new();
    PENDING.get_or_init(|| StdMutex::new(None))
}

fn is_cpm_project_path(path: &str) -> bool {
    has_extension(path, CPM_PROJECT_EXT)
}

pub fn extract_cpm_project_path(mut args: impl Iterator<Item = String>) -> Option<String> {
    args.find(|arg| is_cpm_project_path(arg))
}

pub fn store_cpm_project_path(path: Option<String>) {
    let mut pending = pending_cpm_project()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *pending = path;
}

#[tauri::command]
pub async fn take_cpm_project_path() -> CommandResult<Option<String>> {
    let mut pending = pending_cpm_project()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    Ok(pending.take())
}

#[tauri::command]
pub async fn read_cpm_project_file(path: String) -> CommandResult<tauri::ipc::Response> {
    let bytes = CPM_PROJECT_READ.read(&path).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn manifest_path(project_name: &str) -> Result<std::path::PathBuf> {
    Ok(launcher_path(Some("config"))?.join(format!("{project_name}.models.json")))
}

async fn read_manifest(project_name: &str) -> Result<CpmModelManifest> {
    let path = manifest_path(project_name)?;
    let Some(content) = read_to_string_opt(&path).await? else {
        return Ok(CpmModelManifest::default());
    };
    serde_json::from_str(&content).with_context(|| format!("Повреждён манифест моделей {:?}", path))
}

async fn save_manifest(project_name: &str, manifest: &CpmModelManifest) -> Result<()> {
    let path = manifest_path(project_name)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать каталог {parent:?}"))?;
    }
    let content = serde_json::to_string_pretty(manifest)
        .context("Не удалось сериализовать манифест моделей")?;
    write_atomic(&path, content.as_bytes())
        .await
        .with_context(|| format!("Не удалось записать манифест моделей {:?}", path))?;
    Ok(())
}

fn player_models_dir(project_name: &str) -> Result<std::path::PathBuf> {
    Ok(launcher_path(Some(project_name))?.join("player_models"))
}

fn cpm_config_path(project_name: &str) -> Result<std::path::PathBuf> {
    Ok(launcher_path(Some(project_name))?
        .join("config")
        .join("cpm.json"))
}

async fn read_selected_model(project_name: &str) -> Result<Option<String>> {
    let path = cpm_config_path(project_name)?;
    let Some(content) = read_to_string_opt(&path).await? else {
        return Ok(None);
    };
    Ok(parse_cpm_config(Some(&content))
        .get("selectedModel")
        .and_then(|v| v.as_str())
        .map(String::from))
}

async fn set_selected_model(project_name: &str, file_name: &str) -> Result<()> {
    let path = cpm_config_path(project_name)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать папку {:?}", parent))?;
    }
    let existing = read_to_string_opt(&path).await?;
    if let Some(content) = merge_selected_model(existing.as_deref(), file_name)? {
        write_atomic(&path, content.as_bytes()).await?;
    }
    Ok(())
}

async fn clear_selected_model(project_name: &str) -> Result<()> {
    let path = cpm_config_path(project_name)?;
    let existing = read_to_string_opt(&path).await?;
    if let Some(content) = remove_selected_model(existing.as_deref())? {
        write_atomic(&path, content.as_bytes()).await?;
    }
    Ok(())
}

fn enforce_models_limit(manifest: &mut CpmModelManifest, selected: Option<&str>) -> Vec<String> {
    let Some(limit) = manifest.limit else {
        return Vec::new();
    };
    let limit = (limit.max(1)) as usize;
    let mut evicted_files = Vec::new();

    while manifest.models.len() > limit {
        let Some(index) = pick_eviction_index(manifest, selected) else {
            break;
        };
        let entry = manifest.models.remove(index);
        log_info!("Модель {} удалена: достигнут лимит хранения", entry.file);
        evicted_files.push(entry.file);
    }

    evicted_files
}

async fn remove_model_files(dir: &std::path::Path, files: &[String]) {
    for file in files {
        if let Err(e) = tokio::fs::remove_file(dir.join(file)).await {
            log_err!("Не удалось удалить файл модели {file:?}: {e:#}");
        }
    }
}

async fn write_link_stub(dir: &std::path::Path, entry: &CpmModelEntry, url: &str) -> Result<()> {
    let data_block = build_link_definition(url, entry.skin_type.unwrap_or(SKIN_TYPE_DEFAULT))?;
    let container = build_player_model_file(&entry.name, &data_block);
    let path = dir.join(&entry.file);
    write_atomic(&path, &container)
        .await
        .with_context(|| format!("Не удалось записать модель {path:?}"))
}

#[tauri::command]
pub async fn get_player_models_limit(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<Option<u32>> {
    let project_name = current_project_config(state.inner()).await?.project_name;
    let manifest = read_manifest(&project_name).await?;
    Ok(manifest.limit)
}

#[tauri::command]
pub async fn set_player_models_limit(
    state: State<'_, Mutex<GlobalState>>,
    limit: Option<u32>,
) -> CommandResult<()> {
    let project_name = current_project_config(state.inner()).await?.project_name;
    if limit == Some(0) {
        return Err(LauncherError::InvalidInput(
            "Лимит моделей должен быть не меньше 1".to_string(),
        )
        .into());
    }

    let _guard = MODELS_MANIFEST_LOCK.lock().await;
    let mut manifest = read_manifest(&project_name).await?;
    manifest.limit = limit;
    let selected = read_selected_model(&project_name).await?;
    let evicted_files = enforce_models_limit(&mut manifest, selected.as_deref());
    save_manifest(&project_name, &manifest).await?;
    let dir = player_models_dir(&project_name)?;
    remove_model_files(&dir, &evicted_files).await;

    log_info!(
        "Лимит моделей обновлён: {}",
        limit
            .map(|v| v.to_string())
            .unwrap_or_else(|| "не ограничен".to_string())
    );
    Ok(())
}

#[tauri::command]
pub async fn save_player_model(
    state: State<'_, Mutex<GlobalState>>,
    name: String,
    url: Option<String>,
    model_id: Option<i64>,
    slim: Option<bool>,
    data: Option<Vec<u8>>,
) -> CommandResult<()> {
    let project_name = current_project_config(state.inner()).await?.project_name;
    save_player_model_inner(&project_name, name, url, model_id, slim, data).await?;
    Ok(())
}

async fn save_player_model_inner(
    project_name: &str,
    name: String,
    url: Option<String>,
    model_id: Option<i64>,
    slim: Option<bool>,
    data: Option<Vec<u8>>,
) -> Result<()> {
    let (model_data, entry) = match url {
        Some(url) => {
            let id = model_id.ok_or_else(|| {
                anyhow!(LauncherError::InvalidInput(
                    "Не указан идентификатор модели".to_string()
                ))
            })?;
            let skin_type = if slim.unwrap_or(false) {
                SKIN_TYPE_SLIM
            } else {
                SKIN_TYPE_DEFAULT
            };
            let entry = CpmModelEntry {
                id: Some(id),
                file: model_file_name(id, &name),
                name,
                url: Some(url),
                skin_type: Some(skin_type),
                offline: false,
            };
            (None, entry)
        }
        None => {
            let model_data = data.ok_or_else(|| {
                anyhow!(LauncherError::InvalidInput(
                    "Не переданы данные модели".to_string()
                ))
            })?;
            if model_data.len() as u64 > CPM_PROJECT_MAX_BYTES {
                return Err(anyhow!(LauncherError::InvalidInput(format!(
                    "Данные модели слишком большие: {} МБ, максимум {} МБ",
                    model_data.len() / (1024 * 1024),
                    CPM_PROJECT_MAX_BYTES / (1024 * 1024)
                ))));
            }
            let entry = CpmModelEntry {
                id: None,
                file: local_model_file_name(&name),
                name,
                url: None,
                skin_type: None,
                offline: true,
            };
            (Some(model_data), entry)
        }
    };

    let dir = player_models_dir(project_name)?;
    LauncherError::classify(
        tokio::fs::create_dir_all(&dir)
            .await
            .context("Не удалось создать папку моделей"),
        LauncherError::DiskIo,
    )?;

    let _guard = MODELS_MANIFEST_LOCK.lock().await;
    let mut manifest = read_manifest(project_name).await?;
    let mut displaced_files: Vec<String> = Vec::new();
    manifest.models.retain(|model| {
        let same = model.file == entry.file || (entry.id.is_some() && model.id == entry.id);
        if same && model.file != entry.file {
            displaced_files.push(model.file.clone());
        }
        !same
    });
    manifest.models.push(entry.clone());
    let evicted_files = enforce_models_limit(&mut manifest, Some(&entry.file));

    if let Some(model_data) = &model_data {
        let container = build_player_model_file(&entry.name, model_data);
        let path = dir.join(&entry.file);
        write_atomic(&path, &container)
            .await
            .with_context(|| format!("Не удалось записать модель {path:?}"))?;
    } else if let Some(link_url) = entry.url.as_deref() {
        write_link_stub(&dir, &entry, link_url).await?;
    } else {
        return Err(anyhow!(LauncherError::PlayerModel(
            "В манифесте моделей нет ссылки на модель".to_string()
        )));
    }
    save_manifest(project_name, &manifest).await?;
    set_selected_model(project_name, &entry.file).await?;

    let mut stale_files = displaced_files;
    stale_files.extend(evicted_files);
    remove_model_files(&dir, &stale_files).await;

    log_info!("Модель сохранена в игру: {}", entry.file);
    Ok(())
}

pub async fn sync_player_models(state: &Mutex<GlobalState>) -> Result<()> {
    let config = current_project_config(state).await?;
    if !config.online {
        return Ok(());
    }
    let project_name = config.project_name;
    let uuid = state
        .lock()
        .await
        .session
        .as_ref()
        .map(|s| s.uuid.clone())
        .ok_or(LauncherError::NoSession)?;

    let items = user_content::list_models(state, uuid).await?;
    let server_ids: Vec<i64> = items.iter().filter_map(|i| i.id).collect();

    let _guard = MODELS_MANIFEST_LOCK.lock().await;
    let mut manifest = read_manifest(&project_name).await?;
    let dir = player_models_dir(&project_name)?;
    tokio::fs::create_dir_all(&dir).await?;
    let mut changed = false;

    let mut removed_files: Vec<String> = Vec::new();
    manifest.models.retain(|entry| {
        if entry.offline {
            return true;
        }
        let known = entry.id.map(|id| server_ids.contains(&id)).unwrap_or(false);
        if !known {
            removed_files.push(entry.file.clone());
        }
        known
    });
    if !removed_files.is_empty() {
        changed = true;
    }

    for entry in manifest.models.iter_mut() {
        if entry.offline {
            continue;
        }
        let mut url_changed = false;
        if let Some(item) = items.iter().find(|i| i.id == entry.id) {
            if entry.url.as_deref() != Some(item.url.as_str()) {
                entry.url = Some(item.url.clone());
                url_changed = true;
                changed = true;
            }
        }
        let url = entry.url.clone().ok_or_else(|| {
            anyhow!(LauncherError::PlayerModel(
                "В манифесте моделей нет ссылки на модель".to_string()
            ))
        })?;
        let exists = tokio::fs::try_exists(dir.join(&entry.file))
            .await
            .unwrap_or(false);
        if !exists || url_changed {
            write_link_stub(&dir, entry, &url).await?;
            changed = true;
        }
    }

    let mut added_new = false;
    for item in items.iter() {
        let Some(id) = item.id else { continue };
        if manifest.models.iter().any(|m| m.id == Some(id)) {
            continue;
        }
        let name = format!("Модель {}", id);
        let entry = CpmModelEntry {
            id: Some(id),
            file: model_file_name(id, &name),
            name,
            url: Some(item.url.clone()),
            skin_type: Some(SKIN_TYPE_DEFAULT),
            offline: false,
        };
        write_link_stub(&dir, &entry, &item.url).await?;
        manifest.models.push(entry);
        added_new = true;
        changed = true;
    }

    let selected = read_selected_model(&project_name).await?;
    let evicted_files = enforce_models_limit(&mut manifest, selected.as_deref());
    if changed || !evicted_files.is_empty() {
        save_manifest(&project_name, &manifest).await?;
    }

    let selected_exists = match &selected {
        Some(file) => {
            !removed_files.contains(file)
                && !evicted_files.contains(file)
                && tokio::fs::try_exists(dir.join(file)).await.unwrap_or(false)
        }
        None => false,
    };
    match rebind_selection(&manifest, selected.as_deref(), selected_exists, added_new) {
        RebindDecision::Keep => {}
        RebindDecision::Select(file) => {
            set_selected_model(&project_name, &file).await?;
            log_info!("Выбрана модель CPM: {file}");
        }
        RebindDecision::Clear => {
            clear_selected_model(&project_name).await?;
            log_info!("Выбор модели CPM сброшен: модель удалена с сервера");
        }
    }

    let mut stale_files = removed_files;
    stale_files.extend(evicted_files);
    remove_model_files(&dir, &stale_files).await;

    log_info!("Синхронизация моделей CPM завершена");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::dto::{ProjectConfig, SessionTokens};
    use crate::test_support::{cpm_model_entry, LauncherDirGuard};

    #[test]
    fn extract_cpm_project_path_finds_associated_file() {
        let args = vec![
            "--flag".to_string(),
            "C:/models/skin.CPMPROJECT".to_string(),
            "other.txt".to_string(),
        ];
        assert_eq!(
            extract_cpm_project_path(args.into_iter()),
            Some("C:/models/skin.CPMPROJECT".to_string())
        );
        assert_eq!(extract_cpm_project_path(std::iter::empty::<String>()), None);
    }

    #[tokio::test]
    async fn enforce_models_limit_evicts_oldest_and_defers_file_deletion() {
        let _guard = LauncherDirGuard::acquire("cpm_limit").await;
        let project = "Cordelia";
        let dir = player_models_dir(project).unwrap();
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let mut manifest = CpmModelManifest {
            models: vec![
                cpm_model_entry(Some(1), "a.cpmmodel", false),
                cpm_model_entry(Some(2), "b.cpmmodel", false),
                cpm_model_entry(Some(3), "c.cpmmodel", false),
            ],
            limit: Some(2),
        };
        for model in &manifest.models {
            tokio::fs::write(dir.join(&model.file), b"x").await.unwrap();
        }
        tokio::fs::write(dir.join("orphan.cpmmodel"), b"x")
            .await
            .unwrap();

        let evicted_files = enforce_models_limit(&mut manifest, None);

        assert_eq!(evicted_files, vec!["a.cpmmodel"]);
        assert_eq!(manifest.models.len(), 2);
        assert_eq!(manifest.models[0].file, "b.cpmmodel");
        assert!(
            tokio::fs::try_exists(dir.join("a.cpmmodel")).await.unwrap(),
            "удаление отложено до сохранения манифеста"
        );

        remove_model_files(&dir, &evicted_files).await;

        assert!(!tokio::fs::try_exists(dir.join("a.cpmmodel")).await.unwrap());
        assert!(tokio::fs::try_exists(dir.join("b.cpmmodel")).await.unwrap());
        assert!(tokio::fs::try_exists(dir.join("orphan.cpmmodel"))
            .await
            .unwrap());

        manifest.limit = Some(1);
        let evicted_files = enforce_models_limit(&mut manifest, None);
        assert_eq!(evicted_files, vec!["b.cpmmodel"]);
        assert_eq!(manifest.models.len(), 1);
        assert_eq!(manifest.models[0].file, "c.cpmmodel");
        remove_model_files(&dir, &evicted_files).await;
        assert!(tokio::fs::try_exists(dir.join("orphan.cpmmodel"))
            .await
            .unwrap());
    }

    const SYNC_PROJECT: &str = "Cordelia";

    fn sync_state(server_url: &str, online: bool, with_session: bool) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: SYNC_PROJECT.to_string(),
                online,
                server_url: Some(server_url.to_string()),
                ..ProjectConfig::default()
            },
            session: with_session.then(|| SessionTokens {
                access_token: "token-1".to_string(),
                uuid: "uuid-1".to_string(),
                username: "Cordelia".to_string(),
                project_name: SYNC_PROJECT.to_string(),
            }),
            ..GlobalState::default()
        })
    }

    fn online_entry(id: i64, file: &str, url: &str) -> CpmModelEntry {
        CpmModelEntry {
            id: Some(id),
            file: file.to_string(),
            name: file.to_string(),
            url: Some(url.to_string()),
            skin_type: Some(SKIN_TYPE_DEFAULT),
            offline: false,
        }
    }

    async fn seed_manifest(entries: Vec<CpmModelEntry>) {
        save_manifest(
            SYNC_PROJECT,
            &CpmModelManifest {
                models: entries,
                limit: None,
            },
        )
        .await
        .expect("запись стартового манифеста");
    }

    async fn write_model_file(file: &str, content: &[u8]) {
        let dir = player_models_dir(SYNC_PROJECT).unwrap();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        tokio::fs::write(dir.join(file), content).await.unwrap();
    }

    async fn model_file_exists(file: &str) -> bool {
        tokio::fs::try_exists(player_models_dir(SYNC_PROJECT).unwrap().join(file))
            .await
            .unwrap()
    }

    fn models_mock_body(items: &[serde_json::Value]) -> String {
        serde_json::Value::Array(items.to_vec()).to_string()
    }

    #[tokio::test]
    async fn sync_player_models_skips_offline_project_without_server_call() {
        let _guard = LauncherDirGuard::acquire("cpm_sync_offline").await;
        let state = sync_state("http://127.0.0.1:1", false, true);

        sync_player_models(&state)
            .await
            .expect("офлайн-профиль пропускается без ошибок");
    }

    #[tokio::test]
    async fn sync_player_models_requires_session_for_online_project() {
        let _guard = LauncherDirGuard::acquire("cpm_sync_no_session").await;
        let state = sync_state("http://127.0.0.1:1", true, false);

        let error = sync_player_models(&state)
            .await
            .expect_err("без сессии синхронизация невозможна");
        assert!(matches!(
            error.downcast_ref::<LauncherError>(),
            Some(LauncherError::NoSession)
        ));
    }

    #[tokio::test]
    async fn sync_player_models_adds_server_models_and_selects_newest() {
        let _guard = LauncherDirGuard::acquire("cpm_sync_add").await;
        let mut server = mockito::Server::new_async().await;
        let body = models_mock_body(&[serde_json::json!({
            "id": 5,
            "url": "https://cdn.example.com/m/5"
        })]);
        server
            .mock("GET", "/v1/common/content/models/uuid-1")
            .with_status(200)
            .with_body(body)
            .create_async()
            .await;
        let state = sync_state(&server.url(), true, true);

        sync_player_models(&state)
            .await
            .expect("первая синхронизация");

        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert_eq!(manifest.models.len(), 1, "модель с сервера добавлена");
        let added = &manifest.models[0];
        assert_eq!(added.id, Some(5));
        assert_eq!(added.url.as_deref(), Some("https://cdn.example.com/m/5"));
        assert!(
            model_file_exists(&added.file).await,
            "файл-заглушка должен быть записан"
        );

        let selected = read_selected_model(SYNC_PROJECT).await.unwrap();
        assert_eq!(
            selected.as_deref(),
            Some(added.file.as_str()),
            "при первой синхронизации модель выбирается автоматически"
        );
    }

    #[tokio::test]
    async fn sync_player_models_removes_gone_models_and_rebinds_selection() {
        let _guard = LauncherDirGuard::acquire("cpm_sync_remove").await;
        let mut server = mockito::Server::new_async().await;
        let body = models_mock_body(&[serde_json::json!({
            "id": 2,
            "url": "https://cdn.example.com/m/2"
        })]);
        server
            .mock("GET", "/v1/common/content/models/uuid-1")
            .with_status(200)
            .with_body(body)
            .create_async()
            .await;
        let state = sync_state(&server.url(), true, true);

        seed_manifest(vec![
            online_entry(1, "gone.cpmmodel", "https://cdn.example.com/m/1"),
            online_entry(2, "stay.cpmmodel", "https://cdn.example.com/m/2"),
        ])
        .await;
        write_model_file("gone.cpmmodel", b"old stub").await;
        write_model_file("stay.cpmmodel", b"stay stub").await;
        set_selected_model(SYNC_PROJECT, "gone.cpmmodel")
            .await
            .unwrap();

        sync_player_models(&state).await.expect("синхронизация");

        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert_eq!(
            manifest
                .models
                .iter()
                .map(|m| m.file.as_str())
                .collect::<Vec<_>>(),
            vec!["stay.cpmmodel"],
            "исчезнувшая с сервера модель удаляется из манифеста"
        );
        assert!(
            !model_file_exists("gone.cpmmodel").await,
            "файл исчезнувшей модели должен быть удалён"
        );
        assert!(model_file_exists("stay.cpmmodel").await);
        assert_eq!(
            read_selected_model(SYNC_PROJECT).await.unwrap().as_deref(),
            Some("stay.cpmmodel"),
            "выбор должен переехать на оставшуюся модель"
        );
    }

    #[tokio::test]
    async fn sync_player_models_rewrites_stub_when_url_changes() {
        let _guard = LauncherDirGuard::acquire("cpm_sync_url").await;
        let mut server = mockito::Server::new_async().await;
        let body = models_mock_body(&[serde_json::json!({
            "id": 1,
            "url": "https://cdn.example.com/m/new"
        })]);
        server
            .mock("GET", "/v1/common/content/models/uuid-1")
            .with_status(200)
            .with_body(body)
            .create_async()
            .await;
        let state = sync_state(&server.url(), true, true);

        seed_manifest(vec![online_entry(
            1,
            "a.cpmmodel",
            "https://cdn.example.com/m/old",
        )])
        .await;
        write_model_file("a.cpmmodel", b"stub with old url").await;

        sync_player_models(&state).await.expect("синхронизация");

        let stub = tokio::fs::read(player_models_dir(SYNC_PROJECT).unwrap().join("a.cpmmodel"))
            .await
            .unwrap();
        let stub = String::from_utf8_lossy(&stub).into_owned();
        assert!(
            stub.contains("raw:https://cdn.example.com/m/new"),
            "заглушка должна быть перезаписана с новой ссылкой: {stub}"
        );
        assert!(!stub.contains("m/old"), "старая ссылка не должна остаться");
    }

    #[tokio::test]
    async fn sync_player_models_keeps_offline_entries_without_server_id() {
        let _guard = LauncherDirGuard::acquire("cpm_sync_offline_entry").await;
        let mut server = mockito::Server::new_async().await;
        server
            .mock("GET", "/v1/common/content/models/uuid-1")
            .with_status(200)
            .with_body(models_mock_body(&[]))
            .create_async()
            .await;
        let state = sync_state(&server.url(), true, true);

        let local = CpmModelEntry {
            id: None,
            file: "local.cpmmodel".to_string(),
            name: "local".to_string(),
            url: None,
            skin_type: None,
            offline: true,
        };
        seed_manifest(vec![local]).await;
        write_model_file("local.cpmmodel", b"local model").await;

        sync_player_models(&state).await.expect("синхронизация");

        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert_eq!(
            manifest.models.len(),
            1,
            "локальная модель не подчиняется серверному списку"
        );
        assert!(model_file_exists("local.cpmmodel").await);
        assert!(
            read_selected_model(SYNC_PROJECT).await.unwrap().is_none(),
            "без добавленных моделей выбор не навязывается"
        );
    }

    #[tokio::test]
    async fn sync_player_models_propagates_server_errors() {
        let _guard = LauncherDirGuard::acquire("cpm_sync_error").await;
        let state = sync_state("http://127.0.0.1:1", true, true);

        assert!(
            sync_player_models(&state).await.is_err(),
            "недоступный сервер должен дать ошибку синхронизации"
        );
    }

    #[tokio::test]
    async fn save_player_model_swaps_file_and_removes_previous_jar() {
        let _guard = LauncherDirGuard::acquire("cpm_replace_swap").await;
        seed_manifest(vec![
            online_entry(7, "old.cpmmodel", "https://cdn.example.com/m/7"),
            online_entry(8, "keep.cpmmodel", "https://cdn.example.com/m/8"),
        ])
        .await;
        write_model_file("old.cpmmodel", b"old").await;
        write_model_file("keep.cpmmodel", b"keep").await;

        save_player_model_inner(
            SYNC_PROJECT,
            "new".to_string(),
            Some("https://cdn.example.com/m/7v2".to_string()),
            Some(7),
            None,
            None,
        )
        .await
        .expect("замена записи");

        let files: Vec<String> = read_manifest(SYNC_PROJECT)
            .await
            .unwrap()
            .models
            .iter()
            .map(|m| m.file.clone())
            .collect();
        assert_eq!(files, vec!["keep.cpmmodel", "limacina_7_new.cpmmodel"]);
        assert!(
            !model_file_exists("old.cpmmodel").await,
            "файл предыдущей версии должен быть удалён"
        );
        assert!(model_file_exists("keep.cpmmodel").await);
        assert!(model_file_exists("limacina_7_new.cpmmodel").await);
        assert_eq!(
            read_selected_model(SYNC_PROJECT).await.unwrap().as_deref(),
            Some("limacina_7_new.cpmmodel"),
            "сохранённая модель выбирается в игре"
        );
    }

    #[tokio::test]
    async fn save_player_model_keeps_file_when_reuploading_same_model() {
        let _guard = LauncherDirGuard::acquire("cpm_replace_same").await;

        save_player_model_inner(
            SYNC_PROJECT,
            "Hero".to_string(),
            Some("https://cdn.example.com/m/9".to_string()),
            Some(9),
            None,
            None,
        )
        .await
        .expect("первая загрузка");

        save_player_model_inner(
            SYNC_PROJECT,
            "Hero".to_string(),
            Some("https://cdn.example.com/m/9v2".to_string()),
            Some(9),
            None,
            None,
        )
        .await
        .expect("повторная загрузка");

        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert_eq!(manifest.models.len(), 1);
        assert_eq!(
            manifest.models[0].url.as_deref(),
            Some("https://cdn.example.com/m/9v2")
        );
        assert!(
            model_file_exists("limacina_9_Hero.cpmmodel").await,
            "переименования не было — файл не должен удаляться"
        );
    }

    #[tokio::test]
    async fn save_player_model_rejects_oversized_offline_data() {
        let _guard = LauncherDirGuard::acquire("cpm_save_limit").await;
        let data = vec![0u8; (CPM_PROJECT_MAX_BYTES + 1024) as usize];

        let error = save_player_model_inner(
            SYNC_PROJECT,
            "Big".to_string(),
            None,
            None,
            None,
            Some(data),
        )
        .await
        .expect_err("офлайн-данные больше лимита должны быть отклонены");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ошибка лимита должна быть InvalidInput: {error}"
        );
        assert!(
            error.to_string().contains("слишком большие"),
            "русская ошибка лимита: {error}"
        );
    }

    #[tokio::test]
    async fn save_player_model_write_failure_leaves_no_dangling_state() {
        let _guard = LauncherDirGuard::acquire("cpm_save_write_fail").await;
        let file = local_model_file_name("Hero");
        let dir = player_models_dir(SYNC_PROJECT).unwrap();
        tokio::fs::create_dir_all(dir.join(&file)).await.unwrap();

        let error = save_player_model_inner(
            SYNC_PROJECT,
            "Hero".to_string(),
            None,
            None,
            None,
            Some(b"model".to_vec()),
        )
        .await
        .expect_err("сбой записи файла модели");

        assert!(
            !error.to_string().is_empty(),
            "ошибка записи должна вернуться вызывающему"
        );
        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert!(
            manifest.models.is_empty(),
            "манифест не должен ссылаться на незаписанный файл"
        );
        assert_eq!(
            read_selected_model(SYNC_PROJECT).await.unwrap(),
            None,
            "выбор не должен указывать на несуществующий файл"
        );
    }

    #[tokio::test]
    async fn save_player_model_retry_after_failure_restores_offline_state() {
        let _guard = LauncherDirGuard::acquire("cpm_save_retry").await;
        let file = local_model_file_name("Hero");
        let dir = player_models_dir(SYNC_PROJECT).unwrap();
        tokio::fs::create_dir_all(dir.join(&file)).await.unwrap();

        save_player_model_inner(
            SYNC_PROJECT,
            "Hero".to_string(),
            None,
            None,
            None,
            Some(b"model".to_vec()),
        )
        .await
        .expect_err("первое сохранение падает на записи файла");

        tokio::fs::remove_dir_all(dir.join(&file)).await.unwrap();

        save_player_model_inner(
            SYNC_PROJECT,
            "Hero".to_string(),
            None,
            None,
            None,
            Some(b"model v2".to_vec()),
        )
        .await
        .expect("повторное сохранение чинит состояние");

        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert_eq!(manifest.models.len(), 1);
        assert_eq!(manifest.models[0].file, file);
        assert!(model_file_exists(&file).await);
        assert_eq!(
            read_selected_model(SYNC_PROJECT).await.unwrap().as_deref(),
            Some(file.as_str()),
            "после повтора выбор указывает на существующий файл"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn save_player_model_failure_at_selection_keeps_previous_selection_valid() {
        let _guard = LauncherDirGuard::acquire("cpm_save_select_fail").await;
        seed_manifest(vec![online_entry(
            7,
            "old.cpmmodel",
            "https://cdn.example.com/m/7",
        )])
        .await;
        write_model_file("old.cpmmodel", b"old").await;
        set_selected_model(SYNC_PROJECT, "old.cpmmodel")
            .await
            .unwrap();

        let game_config_dir = cpm_config_path(SYNC_PROJECT)
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::set_permissions(
            &game_config_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o500),
        )
        .unwrap();

        let result = save_player_model_inner(
            SYNC_PROJECT,
            "new".to_string(),
            Some("https://cdn.example.com/m/7v2".to_string()),
            Some(7),
            None,
            None,
        )
        .await;

        std::fs::set_permissions(
            &game_config_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o700),
        )
        .unwrap();

        result.expect_err("сбой записи cpm.json");
        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert_eq!(
            manifest
                .models
                .iter()
                .map(|m| m.file.clone())
                .collect::<Vec<_>>(),
            vec!["limacina_7_new.cpmmodel"],
            "манифест и файл модели коммитятся до выбора"
        );
        assert!(model_file_exists("limacina_7_new.cpmmodel").await);
        assert!(
            model_file_exists("old.cpmmodel").await,
            "вытесненный файл не удаляется до перевеса выбора"
        );
        assert_eq!(
            read_selected_model(SYNC_PROJECT).await.unwrap().as_deref(),
            Some("old.cpmmodel"),
            "старый выбор остаётся валидным"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn save_player_model_keeps_displaced_file_when_manifest_save_fails() {
        let _guard = LauncherDirGuard::acquire("cpm_save_manifest_fail").await;
        seed_manifest(vec![online_entry(
            7,
            "old.cpmmodel",
            "https://cdn.example.com/m/7",
        )])
        .await;
        write_model_file("old.cpmmodel", b"old").await;
        set_selected_model(SYNC_PROJECT, "old.cpmmodel")
            .await
            .unwrap();

        let config_dir = manifest_path(SYNC_PROJECT)
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::set_permissions(
            &config_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o500),
        )
        .unwrap();

        let result = save_player_model_inner(
            SYNC_PROJECT,
            "new".to_string(),
            Some("https://cdn.example.com/m/7v2".to_string()),
            Some(7),
            None,
            None,
        )
        .await;

        std::fs::set_permissions(
            &config_dir,
            std::os::unix::fs::PermissionsExt::from_mode(0o700),
        )
        .unwrap();

        result.expect_err("сохранение манифеста должно провалиться");
        assert!(
            model_file_exists("old.cpmmodel").await,
            "вытесненный файл не удаляется при сбое манифеста"
        );
        assert!(
            model_file_exists("limacina_7_new.cpmmodel").await,
            "файл модели записывается до манифеста"
        );
        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        assert_eq!(
            manifest
                .models
                .iter()
                .map(|m| m.file.clone())
                .collect::<Vec<_>>(),
            vec!["old.cpmmodel"],
            "манифест на диске не меняется при сбое записи"
        );
        assert_eq!(
            read_selected_model(SYNC_PROJECT).await.unwrap().as_deref(),
            Some("old.cpmmodel")
        );
    }

    #[tokio::test]
    async fn manifest_survives_concurrent_save_and_sync() {
        let _guard = LauncherDirGuard::acquire("cpm_manifest_race").await;
        let mut server = mockito::Server::new_async().await;
        let mut items = vec![serde_json::json!({
            "id": 1,
            "url": "https://cdn.example.com/m/1"
        })];
        for id in 100..125 {
            items.push(serde_json::json!({
                "id": id,
                "url": "https://cdn.example.com/m/saved"
            }));
        }
        server
            .mock("GET", "/v1/common/content/models/uuid-1")
            .with_status(200)
            .with_body(models_mock_body(&items))
            .create_async()
            .await;
        let state = sync_state(&server.url(), true, true);

        seed_manifest(vec![online_entry(
            1,
            "seed.cpmmodel",
            "https://cdn.example.com/m/1",
        )])
        .await;
        write_model_file("seed.cpmmodel", b"seed").await;

        let save_path = async {
            for i in 0..25u32 {
                save_player_model_inner(
                    SYNC_PROJECT,
                    format!("saved-{i}"),
                    Some("https://cdn.example.com/m/saved".to_string()),
                    Some(100 + i64::from(i)),
                    None,
                    None,
                )
                .await
                .expect("сохранение модели");
            }
        };
        let sync_path = async {
            for _ in 0..25 {
                sync_player_models(&state).await.expect("синхронизация");
            }
        };
        tokio::join!(save_path, sync_path);

        let manifest = read_manifest(SYNC_PROJECT).await.unwrap();
        for i in 0..25u32 {
            let file = model_file_name(100 + i64::from(i), &format!("saved-{i}"));
            assert!(
                manifest.models.iter().any(|m| m.file == file),
                "запись {file} потеряна при параллельной записи манифеста"
            );
        }
        assert!(
            manifest.models.iter().any(|m| m.id == Some(1)),
            "серверная запись потеряна при параллельной записи манифеста"
        );
    }

    #[tokio::test]
    async fn concurrent_save_and_sync_keeps_the_saved_selection() {
        let _guard = LauncherDirGuard::acquire("cpm_save_sync_race").await;
        let mut server = mockito::Server::new_async().await;
        let mut items = vec![serde_json::json!({
            "id": 1,
            "url": "https://cdn.example.com/m/1"
        })];
        for id in 900..908 {
            items.push(serde_json::json!({
                "id": id,
                "url": "https://cdn.example.com/saved"
            }));
        }
        server
            .mock("GET", "/v1/common/content/models/uuid-1")
            .with_status(200)
            .with_body(models_mock_body(&items))
            .create_async()
            .await;
        let state = sync_state(&server.url(), true, true);

        for round in 0..8u32 {
            let id = 900 + i64::from(round);
            let name = format!("Round{round}");
            let (saved, synced) = tokio::join!(
                save_player_model_inner(
                    SYNC_PROJECT,
                    name.clone(),
                    Some("https://cdn.example.com/saved".to_string()),
                    Some(id),
                    None,
                    None,
                ),
                sync_player_models(&state),
            );
            saved.expect("сохранение модели");
            synced.expect("синхронизация");

            let selected = read_selected_model(SYNC_PROJECT).await.unwrap();
            let expected = model_file_name(id, &name);
            assert_eq!(
                selected.as_deref(),
                Some(expected.as_str()),
                "выбор только что сохранённой модели не должен теряться (раунд {round})"
            );
        }
    }
}
