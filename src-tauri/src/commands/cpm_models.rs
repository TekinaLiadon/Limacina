use std::sync::{Mutex as StdMutex, OnceLock};

use anyhow::{anyhow, Context, Result};
use tokio::sync::Mutex;

use crate::cpm::{
    build_link_definition, build_player_model_file, local_model_file_name, merge_selected_model,
    model_file_name, parse_cpm_config, rebind_selection, remove_selected_model, CpmModelEntry,
    CpmModelManifest, RebindDecision, SKIN_TYPE_DEFAULT, SKIN_TYPE_SLIM,
};
use crate::launcher_server::user_content;
use crate::state::config::{current_project_config, validated_project_name};
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

const PROJECT_NAME_HEADER: &str = "Project-Name";
const MODEL_NAME_HEADER: &str = "Model-Name";
const MODEL_URL_HEADER: &str = "Model-Url";
const MODEL_ID_HEADER: &str = "Model-Id";
const MODEL_SLIM_HEADER: &str = "Model-Slim";

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

#[derive(Debug)]
struct PlayerModelRequest {
    project_name: String,
    name: String,
    url: Option<String>,
    model_id: Option<i64>,
    slim: Option<bool>,
    data: Option<Vec<u8>>,
}

fn header_raw<'a>(headers: &'a tauri::http::HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn decode_percent_header(raw: &str, header: &str) -> Result<String> {
    let bytes = raw.as_bytes();
    let mut decoded: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let hex = bytes
            .get(index + 1..index + 3)
            .ok_or_else(|| anyhow!("Некорректное значение заголовка {header}"))?;
        let hex = std::str::from_utf8(hex)
            .map_err(|_| anyhow!("Некорректное значение заголовка {header}"))?;
        if !hex.as_bytes().iter().all(u8::is_ascii_hexdigit) {
            return Err(anyhow!("Некорректное значение заголовка {header}"));
        }
        let byte = u8::from_str_radix(hex, 16)
            .map_err(|_| anyhow!("Некорректное значение заголовка {header}"))?;
        decoded.push(byte);
        index += 3;
    }
    String::from_utf8(decoded).with_context(|| format!("Некорректное значение заголовка {header}"))
}

fn required_text_header(headers: &tauri::http::HeaderMap, name: &str) -> Result<String> {
    let raw = header_raw(headers, name).ok_or_else(|| {
        anyhow!(LauncherError::InvalidInput(format!(
            "Не указан заголовок {name}"
        )))
    })?;
    decode_percent_header(raw, name)
}

fn optional_text_header(headers: &tauri::http::HeaderMap, name: &str) -> Result<Option<String>> {
    match header_raw(headers, name) {
        Some(raw) => Ok(Some(decode_percent_header(raw, name)?)),
        None => Ok(None),
    }
}

fn parse_player_model_request(
    headers: &tauri::http::HeaderMap,
    body: &tauri::ipc::InvokeBody,
) -> Result<PlayerModelRequest> {
    let data = match body {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.is_empty() => None,
        tauri::ipc::InvokeBody::Raw(bytes) => Some(bytes.clone()),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(anyhow!(LauncherError::InvalidInput(
                "Данные модели должны передаваться бинарным телом запроса".to_string()
            )));
        }
    };
    let slim = match header_raw(headers, MODEL_SLIM_HEADER) {
        Some("true") => Some(true),
        Some("false") => Some(false),
        Some(_) => {
            return Err(anyhow!(LauncherError::InvalidInput(format!(
                "Некорректное значение заголовка {MODEL_SLIM_HEADER}"
            ))));
        }
        None => None,
    };
    let model_id = match header_raw(headers, MODEL_ID_HEADER) {
        Some(raw) => Some(raw.parse::<i64>().map_err(|_| {
            anyhow!(LauncherError::InvalidInput(format!(
                "Некорректное значение заголовка {MODEL_ID_HEADER}"
            )))
        })?),
        None => None,
    };
    Ok(PlayerModelRequest {
        project_name: required_text_header(headers, PROJECT_NAME_HEADER)?,
        name: required_text_header(headers, MODEL_NAME_HEADER)?,
        url: optional_text_header(headers, MODEL_URL_HEADER)?,
        model_id,
        slim,
        data,
    })
}

#[tauri::command]
pub async fn save_player_model(request: tauri::ipc::Request<'_>) -> CommandResult<()> {
    let payload = parse_player_model_request(request.headers(), request.body())?;
    let project_name = validated_project_name(&payload.project_name)?;
    save_player_model_inner(
        project_name,
        payload.name,
        payload.url,
        payload.model_id,
        payload.slim,
        payload.data,
    )
    .await?;
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

    remove_model_files(&dir, &displaced_files).await;

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
    if changed {
        save_manifest(&project_name, &manifest).await?;
    }

    let selected_exists = match &selected {
        Some(file) => {
            !removed_files.contains(file)
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

    remove_model_files(&dir, &removed_files).await;

    log_info!("Синхронизация моделей CPM завершена");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::dto::{ProjectConfig, SessionTokens};
    use crate::test_support::LauncherDirGuard;
    use tauri::http::{HeaderMap, HeaderValue};

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
        save_manifest(SYNC_PROJECT, &CpmModelManifest { models: entries })
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

    async fn mock_models_endpoint(server: &mut mockito::ServerGuard, body: String) {
        server
            .mock("GET", "/v1/common/content/models/uuid-1")
            .with_status(200)
            .with_body(body)
            .create_async()
            .await;
    }

    async fn manifest_files(project: &str) -> Vec<String> {
        read_manifest(project)
            .await
            .unwrap()
            .models
            .iter()
            .map(|m| m.file.clone())
            .collect()
    }

    async fn save_displaced_model() -> Result<()> {
        save_player_model_inner(
            SYNC_PROJECT,
            "new".to_string(),
            Some("https://cdn.example.com/m/7v2".to_string()),
            Some(7),
            None,
            None,
        )
        .await
    }

    #[cfg(unix)]
    struct ReadOnlyDir(std::path::PathBuf);

    #[cfg(unix)]
    impl ReadOnlyDir {
        fn lock(path: std::path::PathBuf) -> Self {
            std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o500))
                .expect("каталог переводится в read-only");
            Self(path)
        }
    }

    #[cfg(unix)]
    impl Drop for ReadOnlyDir {
        fn drop(&mut self) {
            let _ = std::fs::set_permissions(
                &self.0,
                std::os::unix::fs::PermissionsExt::from_mode(0o700),
            );
        }
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
        mock_models_endpoint(
            &mut server,
            models_mock_body(&[serde_json::json!({
                "id": 5,
                "url": "https://cdn.example.com/m/5"
            })]),
        )
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
        mock_models_endpoint(
            &mut server,
            models_mock_body(&[serde_json::json!({
                "id": 2,
                "url": "https://cdn.example.com/m/2"
            })]),
        )
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
        mock_models_endpoint(
            &mut server,
            models_mock_body(&[serde_json::json!({
                "id": 1,
                "url": "https://cdn.example.com/m/new"
            })]),
        )
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
        mock_models_endpoint(&mut server, models_mock_body(&[])).await;
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

        assert_eq!(
            manifest_files(SYNC_PROJECT).await,
            vec!["keep.cpmmodel", "limacina_7_new.cpmmodel"]
        );
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

        let _read_only = ReadOnlyDir::lock(
            cpm_config_path(SYNC_PROJECT)
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf(),
        );

        let result = save_displaced_model().await;

        result.expect_err("сбой записи cpm.json");
        assert_eq!(
            manifest_files(SYNC_PROJECT).await,
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

        let _read_only = ReadOnlyDir::lock(
            manifest_path(SYNC_PROJECT)
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf(),
        );

        let result = save_displaced_model().await;

        result.expect_err("сохранение манифеста должно провалиться");
        assert!(
            model_file_exists("old.cpmmodel").await,
            "вытесненный файл не удаляется при сбое манифеста"
        );
        assert!(
            model_file_exists("limacina_7_new.cpmmodel").await,
            "файл модели записывается до манифеста"
        );
        assert_eq!(
            manifest_files(SYNC_PROJECT).await,
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
        mock_models_endpoint(&mut server, models_mock_body(&items)).await;
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
        mock_models_endpoint(&mut server, models_mock_body(&items)).await;
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

    fn percent_encode(value: &str) -> String {
        let mut out = String::new();
        for byte in value.as_bytes() {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                out.push(char::from(*byte));
            } else {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
        out
    }

    fn model_request_headers(
        project: &str,
        name: &str,
        url: Option<&str>,
        id: Option<i64>,
        slim: Option<bool>,
    ) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("Project-Name", HeaderValue::from_str(project).unwrap());
        headers.insert("Model-Name", HeaderValue::from_str(name).unwrap());
        if let Some(url) = url {
            headers.insert("Model-Url", HeaderValue::from_str(url).unwrap());
        }
        if let Some(id) = id {
            headers.insert("Model-Id", HeaderValue::from_str(&id.to_string()).unwrap());
        }
        if let Some(slim) = slim {
            headers.insert(
                "Model-Slim",
                HeaderValue::from_static(if slim { "true" } else { "false" }),
            );
        }
        headers
    }

    fn raw_body(bytes: Vec<u8>) -> tauri::ipc::InvokeBody {
        tauri::ipc::InvokeBody::Raw(bytes)
    }

    #[test]
    fn parse_player_model_request_reads_headers_and_raw_body() {
        let headers = model_request_headers(
            "proj",
            &percent_encode("Герой"),
            Some("https://cdn/9.cpm"),
            Some(9),
            Some(true),
        );
        let body = raw_body(vec![0x53, 1, 2, 255]);

        let payload = parse_player_model_request(&headers, &body).unwrap();

        assert_eq!(payload.project_name, "proj");
        assert_eq!(payload.name, "Герой");
        assert_eq!(payload.url.as_deref(), Some("https://cdn/9.cpm"));
        assert_eq!(payload.model_id, Some(9));
        assert_eq!(payload.slim, Some(true));
        assert_eq!(payload.data, Some(vec![0x53, 1, 2, 255]));
    }

    #[test]
    fn parse_player_model_request_treats_missing_headers_and_empty_body_as_absent_fields() {
        let headers = model_request_headers("proj", "hero", None, None, Some(false));
        let body = raw_body(Vec::new());

        let payload = parse_player_model_request(&headers, &body).unwrap();

        assert_eq!(payload.url, None);
        assert_eq!(payload.model_id, None);
        assert_eq!(payload.slim, Some(false));
        assert_eq!(payload.data, None);
    }

    #[test]
    fn parse_player_model_request_rejects_json_body() {
        let headers = model_request_headers("proj", "hero", None, None, None);
        let body = tauri::ipc::InvokeBody::Json(serde_json::json!({ "data": [1, 2, 3] }));

        let error = parse_player_model_request(&headers, &body).unwrap_err();

        assert!(
            error.to_string().contains("бинарным телом"),
            "русская ошибка формата тела: {error}"
        );
    }

    #[test]
    fn parse_player_model_request_requires_project_and_name_headers() {
        let body = raw_body(Vec::new());
        let headers = model_request_headers("proj", "hero", None, None, None);

        let mut without_project = headers.clone();
        without_project.remove("Project-Name");
        let error = parse_player_model_request(&without_project, &body).unwrap_err();
        assert!(
            error.to_string().contains("Project-Name"),
            "ошибка: {error}"
        );

        let mut without_name = headers;
        without_name.remove("Model-Name");
        let error = parse_player_model_request(&without_name, &body).unwrap_err();
        assert!(error.to_string().contains("Model-Name"), "ошибка: {error}");
    }

    #[test]
    fn parse_player_model_request_rejects_broken_optional_headers() {
        let body = raw_body(Vec::new());

        let mut broken_slim = model_request_headers("proj", "hero", None, None, None);
        broken_slim.insert("Model-Slim", HeaderValue::from_static("maybe"));
        let error = parse_player_model_request(&broken_slim, &body).unwrap_err();
        assert!(error.to_string().contains("Model-Slim"), "ошибка: {error}");

        let mut broken_id = model_request_headers("proj", "hero", None, None, None);
        broken_id.insert("Model-Id", HeaderValue::from_static("9x"));
        let error = parse_player_model_request(&broken_id, &body).unwrap_err();
        assert!(error.to_string().contains("Model-Id"), "ошибка: {error}");
    }

    #[test]
    fn decode_percent_header_restores_unicode_and_escapes() {
        assert_eq!(
            decode_percent_header(&percent_encode("Модель 100%"), "Model-Name").unwrap(),
            "Модель 100%"
        );
        assert_eq!(
            decode_percent_header("plain-value", "Model-Name").unwrap(),
            "plain-value"
        );
        assert_eq!(
            decode_percent_header("a%20b+c", "Model-Name").unwrap(),
            "a b+c"
        );
    }

    #[test]
    fn decode_percent_header_reports_broken_escapes() {
        let error = decode_percent_header("a%G1", "Model-Name").unwrap_err();
        assert!(error.to_string().contains("Model-Name"), "ошибка: {error}");

        let error = decode_percent_header("trailing%", "Model-Name").unwrap_err();
        assert!(error.to_string().contains("Model-Name"), "ошибка: {error}");

        let error = decode_percent_header("a%+5", "Model-Name").unwrap_err();
        assert!(error.to_string().contains("Model-Name"), "ошибка: {error}");
    }
}
