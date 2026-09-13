use std::sync::{Mutex as StdMutex, OnceLock};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;

use crate::launcher_server::user_content;
use crate::log_info;
use crate::state::dto::GlobalState;
use crate::utils::download_file::write_atomic;
use crate::utils::env_info::launcher_path;
use crate::utils::tauri_err::CommandResult;

const MODEL_HEADER: u8 = 0x53;
const PART_END: u8 = 0;
const PART_SKIN_TYPE: u8 = 11;
const PART_PACKAGE_LINK: u8 = 20;
const SKIN_TYPE_SLIM: u8 = 0;
const SKIN_TYPE_DEFAULT: u8 = 1;
const LINK_MAX_LEN: usize = 255;
const CPM_PROJECT_EXT: &str = "cpmproject";
const CPM_PROJECT_MAX_BYTES: u64 = 20 * 1024 * 1024;

fn pending_cpm_project() -> &'static StdMutex<Option<String>> {
    static PENDING: OnceLock<StdMutex<Option<String>>> = OnceLock::new();
    PENDING.get_or_init(|| StdMutex::new(None))
}

fn is_cpm_project_path(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(CPM_PROJECT_EXT))
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
    if !is_cpm_project_path(&path) {
        return Err(anyhow!(
            "Открывать можно только файлы с расширением .{}",
            CPM_PROJECT_EXT
        )
        .into());
    }
    let metadata = tokio::fs::metadata(&path)
        .await
        .with_context(|| format!("Не удалось прочитать файл модели {:?}", path))?;
    if metadata.len() > CPM_PROJECT_MAX_BYTES {
        return Err(anyhow!(
            "Файл модели слишком большой: {} МБ, максимум {} МБ",
            metadata.len() / (1024 * 1024),
            CPM_PROJECT_MAX_BYTES / (1024 * 1024)
        )
        .into());
    }
    let bytes = tokio::fs::read(&path)
        .await
        .with_context(|| format!("Не удалось прочитать файл модели {:?}", path))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CpmModelEntry {
    pub id: Option<i64>,
    pub file: String,
    pub name: String,
    pub url: Option<String>,
    pub skin_type: Option<u8>,
    pub offline: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CpmModelManifest {
    #[serde(default)]
    models: Vec<CpmModelEntry>,
}

fn write_varint(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push(((value & 0x7F) as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn write_utf(out: &mut Vec<u8>, s: &str) {
    write_varint(out, s.len() as u32);
    out.extend_from_slice(s.as_bytes());
}

fn with_checksum(body: &[u8]) -> Vec<u8> {
    let mut sum: u32 = 0;
    for &b in body {
        sum = (sum + b as u32) & 0xFFFF;
    }
    let mut out = Vec::with_capacity(body.len() + 3);
    out.push(MODEL_HEADER);
    out.extend_from_slice(body);
    out.push((sum >> 8) as u8);
    out.push((sum & 0xFF) as u8);
    out
}

fn build_link_definition(url: &str, skin_type: u8) -> Result<Vec<u8>> {
    let link = format!("raw:{url}");
    let link_bytes = link.as_bytes();
    if link_bytes.len() > LINK_MAX_LEN {
        bail!(
            "Слишком длинная ссылка на модель: {} байт, максимум {}",
            link_bytes.len(),
            LINK_MAX_LEN
        );
    }

    let mut body = Vec::new();
    body.push(PART_SKIN_TYPE);
    write_varint(&mut body, 1);
    body.push(skin_type);
    body.push(PART_PACKAGE_LINK);
    write_varint(&mut body, link_bytes.len() as u32 + 1);
    body.push(link_bytes.len() as u8);
    body.extend_from_slice(link_bytes);
    body.push(PART_END);
    write_varint(&mut body, 0);
    Ok(with_checksum(&body))
}

fn build_player_model_file(name: &str, data_block: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    write_utf(&mut body, name);
    write_utf(&mut body, "");
    write_varint(&mut body, data_block.len() as u32);
    body.extend_from_slice(data_block);
    write_varint(&mut body, 0);
    write_varint(&mut body, 0);
    with_checksum(&body)
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed: String = cleaned.trim().chars().take(48).collect();
    let trimmed = trimmed.trim_end().to_string();
    if trimmed.is_empty() {
        "model".to_string()
    } else {
        trimmed
    }
}

fn manifest_path(project_name: &str) -> Result<std::path::PathBuf> {
    Ok(launcher_path(Some("config"))?.join(format!("{project_name}.models.json")))
}

async fn read_manifest(project_name: &str) -> Result<CpmModelManifest> {
    let path = manifest_path(project_name)?;
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(serde_json::from_str(&content)
            .with_context(|| format!("Повреждён манифест моделей {:?}", path))?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(CpmModelManifest::default()),
        Err(e) => Err(e).with_context(|| format!("Не удалось прочитать {:?}", path)),
    }
}

async fn save_manifest(project_name: &str, manifest: &CpmModelManifest) -> Result<()> {
    let path = manifest_path(project_name)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let content = serde_json::to_string_pretty(manifest)?;
    write_atomic(&path, content.as_bytes()).await?;
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

fn parse_cpm_config(content: Option<&str>) -> serde_json::Map<String, serde_json::Value> {
    match content {
        Some(content) => serde_json::from_str(content).unwrap_or_default(),
        None => Default::default(),
    }
}

fn merge_selected_model(content: Option<&str>, file_name: &str) -> Result<Option<String>> {
    let mut root = parse_cpm_config(content);
    if root.get("selectedModel").and_then(|v| v.as_str()) == Some(file_name) {
        return Ok(None);
    }
    root.insert(
        "selectedModel".to_string(),
        serde_json::Value::String(file_name.to_string()),
    );
    Ok(Some(serde_json::to_string_pretty(&root)?))
}

async fn read_selected_model(project_name: &str) -> Result<Option<String>> {
    let path = cpm_config_path(project_name)?;
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(parse_cpm_config(Some(&content))
            .get("selectedModel")
            .and_then(|v| v.as_str())
            .map(String::from)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("Не удалось прочитать {:?}", path)),
    }
}

async fn set_selected_model(project_name: &str, file_name: &str) -> Result<()> {
    let path = cpm_config_path(project_name)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать папку {:?}", parent))?;
    }
    let existing = match tokio::fs::read_to_string(&path).await {
        Ok(content) => Some(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e).with_context(|| format!("Не удалось прочитать {:?}", path)),
    };
    if let Some(content) = merge_selected_model(existing.as_deref(), file_name)? {
        write_atomic(&path, content.as_bytes()).await?;
    }
    Ok(())
}

async fn replace_manifest_entry(project_name: &str, entry: &CpmModelEntry) -> Result<()> {
    let mut manifest = read_manifest(project_name).await?;
    let dir = player_models_dir(project_name)?;
    let mut removed_files: Vec<String> = Vec::new();
    manifest.models.retain(|m| {
        let same = m.file == entry.file || (entry.id.is_some() && m.id == entry.id);
        if same {
            removed_files.push(m.file.clone());
        }
        !same
    });
    for file in removed_files {
        if file != entry.file {
            let _ = tokio::fs::remove_file(dir.join(&file)).await;
        }
    }
    manifest.models.push(entry.clone());
    save_manifest(project_name, &manifest).await?;
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
    let project_name = {
        let guard = state.lock().await;
        guard.project_config.project_name.clone()
    };
    if project_name.trim().is_empty() {
        return Err(anyhow!("Проект не выбран").into());
    }

    let (data_block, entry) = match url {
        Some(url) => {
            let id = model_id.ok_or_else(|| anyhow!("Не указан идентификатор модели"))?;
            let skin_type = if slim.unwrap_or(false) {
                SKIN_TYPE_SLIM
            } else {
                SKIN_TYPE_DEFAULT
            };
            let data_block = build_link_definition(&url, skin_type)?;
            let entry = CpmModelEntry {
                id: Some(id),
                file: format!("limacina_{}_{}.cpmmodel", id, sanitize_file_name(&name)),
                name,
                url: Some(url),
                skin_type: Some(skin_type),
                offline: false,
            };
            (data_block, entry)
        }
        None => {
            let data_block = data.ok_or_else(|| anyhow!("Не переданы данные модели"))?;
            let entry = CpmModelEntry {
                id: None,
                file: format!("limacina_local_{}.cpmmodel", sanitize_file_name(&name)),
                name,
                url: None,
                skin_type: None,
                offline: true,
            };
            (data_block, entry)
        }
    };

    let dir = player_models_dir(&project_name)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .context("Не удалось создать папку моделей")?;
    let container = build_player_model_file(&entry.name, &data_block);
    write_atomic(&dir.join(&entry.file), &container).await?;
    replace_manifest_entry(&project_name, &entry).await?;
    set_selected_model(&project_name, &entry.file).await?;

    log_info!("Модель сохранена в игру: {}", entry.file);
    Ok(())
}

pub async fn sync_player_models(state: &Mutex<GlobalState>) -> Result<()> {
    let (project_name, uuid) = {
        let guard = state.lock().await;
        if !guard.project_config.online {
            return Ok(());
        }
        let project = guard.project_config.project_name.clone();
        let uuid = guard
            .session
            .as_ref()
            .map(|s| s.uuid.clone())
            .context("Нет активной сессии. Войдите в аккаунт.")?;
        (project, uuid)
    };
    if project_name.trim().is_empty() {
        bail!("Проект не выбран");
    }

    let items = user_content::list_models(state, uuid).await?;
    let server_ids: Vec<i64> = items.iter().filter_map(|i| i.id).collect();

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
    for file in removed_files {
        let _ = tokio::fs::remove_file(dir.join(&file)).await;
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
        let url = entry
            .url
            .clone()
            .context("В манифесте моделей нет ссылки на модель")?;
        let path = dir.join(&entry.file);
        let exists = tokio::fs::try_exists(&path).await.unwrap_or(false);
        if !exists || url_changed {
            let data_block =
                build_link_definition(&url, entry.skin_type.unwrap_or(SKIN_TYPE_DEFAULT))?;
            let container = build_player_model_file(&entry.name, &data_block);
            write_atomic(&path, &container).await?;
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
            file: format!("limacina_{}_{}.cpmmodel", id, sanitize_file_name(&name)),
            name,
            url: Some(item.url.clone()),
            skin_type: Some(SKIN_TYPE_DEFAULT),
            offline: false,
        };
        let data_block = build_link_definition(&item.url, SKIN_TYPE_DEFAULT)?;
        let container = build_player_model_file(&entry.name, &data_block);
        write_atomic(&dir.join(&entry.file), &container).await?;
        manifest.models.push(entry);
        added_new = true;
        changed = true;
    }

    if changed {
        save_manifest(&project_name, &manifest).await?;
    }

    let selected = read_selected_model(&project_name).await?;
    let stale = match &selected {
        Some(file) => !tokio::fs::try_exists(dir.join(file)).await.unwrap_or(false),
        None => false,
    };
    if stale || (selected.is_none() && added_new) {
        if let Some(entry) = manifest.models.iter().filter(|m| !m.offline).next_back() {
            set_selected_model(&project_name, &entry.file).await?;
            log_info!("Выбрана модель CPM: {}", entry.file);
        }
    }

    log_info!("Синхронизация моделей CPM завершена");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn merge_creates_config_with_selection_when_missing() {
        let merged = merge_selected_model(None, "limacina_local_test.cpmmodel")
            .unwrap()
            .unwrap();
        let root: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&merged).unwrap();
        assert_eq!(root["selectedModel"], "limacina_local_test.cpmmodel");
    }

    #[test]
    fn merge_preserves_existing_keys() {
        let existing = r#"{"keybinds": {"glide": "KEY_G"}, "selectedModel": "old.cpmmodel"}"#;
        let merged = merge_selected_model(Some(existing), "new.cpmmodel")
            .unwrap()
            .unwrap();
        let root: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&merged).unwrap();
        assert_eq!(root["selectedModel"], "new.cpmmodel");
        assert_eq!(root["keybinds"]["glide"], "KEY_G");
    }

    #[test]
    fn merge_skips_write_when_selection_unchanged() {
        let existing = r#"{"selectedModel": "same.cpmmodel"}"#;
        assert!(merge_selected_model(Some(existing), "same.cpmmodel")
            .unwrap()
            .is_none());
    }

    #[test]
    fn merge_recovers_from_corrupt_config() {
        let merged = merge_selected_model(Some("{ not json"), "new.cpmmodel")
            .unwrap()
            .unwrap();
        let root: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&merged).unwrap();
        assert_eq!(root["selectedModel"], "new.cpmmodel");
    }

    #[test]
    fn link_definition_encodes_stub_block() {
        let data = build_link_definition("https://example.com/m/1", SKIN_TYPE_SLIM).unwrap();
        assert_eq!(data[0], MODEL_HEADER);
        assert_eq!(&data[1..4], &[PART_SKIN_TYPE, 1, SKIN_TYPE_SLIM]);
        let link = b"raw:https://example.com/m/1";
        assert_eq!(data[4], PART_PACKAGE_LINK);
        assert_eq!(data[5] as usize, link.len() + 1);
        assert_eq!(data[6] as usize, link.len());
        assert_eq!(&data[7..7 + link.len()], link);
        assert_eq!(&data[7 + link.len()..7 + link.len() + 2], &[PART_END, 0]);
    }

    #[test]
    fn link_definition_rejects_oversized_url() {
        let url = format!("https://example.com/{}", "a".repeat(300));
        assert!(build_link_definition(&url, SKIN_TYPE_DEFAULT).is_err());
    }

    #[test]
    fn player_model_file_checksum_covers_body_without_header() {
        let container = build_player_model_file("Test", &[1, 2, 3]);
        assert_eq!(container[0], MODEL_HEADER);
        let body = &container[1..container.len() - 2];
        let mut sum: u32 = 0;
        for &b in body {
            sum = (sum + b as u32) & 0xFFFF;
        }
        assert_eq!(container[container.len() - 2], (sum >> 8) as u8);
        assert_eq!(container[container.len() - 1], (sum & 0xFF) as u8);
    }
}
