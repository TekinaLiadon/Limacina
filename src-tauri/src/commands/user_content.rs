use crate::utils::errors::LauncherError;
use anyhow::{bail, Context, Result};
use md5::{Digest, Md5};
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::auth;
use crate::commands::auth::{persist_session_credentials, restore_session};
use crate::launcher_server::user_content::{self, UserContentItem};
use crate::offline::{delete_offline_skin_files, offline_skin_paths, parse_offline_skin_model};
use crate::state::config::load_config_or_default;
use crate::state::dto::{GlobalState, SessionTokens};
use crate::utils::download_file::{download_file, write_atomic};
use crate::utils::env_info::launcher_path;
use crate::utils::hex::digest_hex;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};

#[derive(Serialize)]
pub struct SessionInfo {
    pub uuid: String,
    pub username: String,
}

#[tauri::command]
pub async fn select_account(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
) -> CommandResult<SessionInfo> {
    let project = load_config_or_default(&project_name).await?;

    let auth_data = if project.online {
        restore_session(&project_name, &username, None).await?
    } else {
        auth::offline(&username)
    };

    let uuid = auth_data.uuid();
    let username_str = auth_data.username(&username);

    {
        let mut state = state.lock().await;
        state.session = Some(SessionTokens {
            access_token: auth_data.tokens.access_token.clone(),
            uuid: uuid.clone(),
            username: username_str.clone(),
            project_name: project_name.clone(),
        });
    }

    if project.online {
        persist_session_credentials(&project_name, &username, &auth_data).await?;
    }

    log_info!("Аккаунт выбран: {}", username_str);

    Ok(SessionInfo {
        uuid,
        username: username_str,
    })
}

#[tauri::command]
pub async fn get_session_info(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<Option<SessionInfo>> {
    let state = state.lock().await;
    Ok(state.session.as_ref().map(|s| SessionInfo {
        uuid: s.uuid.clone(),
        username: s.username.clone(),
    }))
}

#[tauri::command]
pub async fn clear_session(state: State<'_, Mutex<GlobalState>>) -> CommandResult<()> {
    let mut state = state.lock().await;
    state.session = None;
    Ok(())
}

#[tauri::command]
pub async fn upload_skin(
    state: State<'_, Mutex<GlobalState>>,
    request: tauri::ipc::Request<'_>,
) -> CommandResult<UserContentItem> {
    let model = request
        .headers()
        .get("Skin-Model")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| match value {
            "slim" => Some("slim"),
            "classic" => Some("classic"),
            _ => None,
        });

    let file_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),

        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .context("Некорректное тело запроса загрузки скина")?,
    };

    let item = user_content::upload_skin(&state, file_data, model).await?;
    Ok(item)
}

#[tauri::command]
pub async fn list_skins(
    state: State<'_, Mutex<GlobalState>>,
    uuid: String,
) -> CommandResult<Vec<UserContentItem>> {
    let items = user_content::list_skins(&state, uuid).await?;
    Ok(items)
}

#[tauri::command]
pub async fn delete_skin(state: State<'_, Mutex<GlobalState>>, id: i64) -> CommandResult<()> {
    user_content::delete_skin(&state, id).await?;
    Ok(())
}

#[tauri::command]
pub async fn set_active_skin(state: State<'_, Mutex<GlobalState>>, id: i64) -> CommandResult<()> {
    user_content::set_active_skin(&state, id).await?;
    Ok(())
}

fn skin_cache_name(uuid: &str, url: &str) -> String {
    let hash = Md5::digest(url.as_bytes());
    format!("{}_{}.png", uuid, digest_hex(hash))
}

async fn get_profile_skin_inner(
    state: &State<'_, Mutex<GlobalState>>,
    url: &str,
) -> Result<Vec<u8>> {
    let (project_name, uuid) = {
        let guard = state.lock().await;
        let uuid = guard
            .session
            .as_ref()
            .map(|s| s.uuid.clone())
            .ok_or(LauncherError::NoSession)?;
        (guard.project_config.project_name.clone(), uuid)
    };

    if project_name.trim().is_empty() {
        bail!(LauncherError::ProjectNotSelected);
    }

    let cache_dir = launcher_path(Some(&project_name))?.join("profile_skins");
    let file_name = skin_cache_name(&uuid, url);
    let cache_path = cache_dir.join(&file_name);
    let prefix = format!("{}_", uuid);

    crate::utils::blocking(
        "Не удалось выполнить очистку кэша скинов",
        {
            let cache_dir = cache_dir.clone();
            let file_name = file_name.clone();
            let prefix = prefix.clone();
            move || {
                if let Ok(entries) = std::fs::read_dir(&cache_dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            if name.starts_with(&prefix) && name != file_name {
                                let _ = std::fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }
        },
    )
    .await?;

    download_file(url, &cache_path).await?;

    let cache_path_clone = cache_path.clone();
    let bytes = crate::utils::blocking(
        "Не удалось выполнить чтение кэша скина",
        move || {
            std::fs::read(&cache_path_clone)
                .with_context(|| format!("Не удалось прочитать {:?}", cache_path_clone))
        },
    )
    .await??;
    Ok(bytes)
}

#[tauri::command]
pub async fn get_profile_skin(
    state: State<'_, Mutex<GlobalState>>,
    url: String,
) -> CommandResult<tauri::ipc::Response> {
    let bytes = get_profile_skin_inner(&state, &url).await?;
    log_info!("Скин профиля получен из кэша: {}", url);
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn upload_model(
    state: State<'_, Mutex<GlobalState>>,
    file_content: String,
) -> CommandResult<UserContentItem> {
    let item = user_content::upload_model(&state, file_content).await?;
    Ok(item)
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, Mutex<GlobalState>>,
    uuid: String,
) -> CommandResult<Vec<UserContentItem>> {
    let items = user_content::list_models(&state, uuid).await?;
    Ok(items)
}

#[tauri::command]
pub async fn delete_model(state: State<'_, Mutex<GlobalState>>, id: i64) -> CommandResult<()> {
    user_content::delete_model(&state, id).await?;
    Ok(())
}

async fn current_project_name(state: &State<'_, Mutex<GlobalState>>) -> Result<String> {
    let project_name = {
        let guard = state.lock().await;
        guard.project_config.project_name.clone()
    };
    if project_name.trim().is_empty() {
        bail!(LauncherError::ProjectNotSelected);
    }
    Ok(project_name)
}

#[tauri::command]
pub async fn save_offline_skin(
    state: State<'_, Mutex<GlobalState>>,
    request: tauri::ipc::Request<'_>,
) -> CommandResult<()> {
    let model = request
        .headers()
        .get("Skin-Model")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| match value {
            "slim" => Some("slim".to_string()),
            "classic" => Some("classic".to_string()),
            _ => None,
        })
        .context("Некорректная модель скина")?;

    let file_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .context("Некорректное тело запроса сохранения скина")?,
    };

    let project_name = current_project_name(&state).await?;
    let (png_path, meta_path) = offline_skin_paths(&project_name)?;
    let png_parent = png_path.parent().map(|p| p.to_path_buf());

    crate::utils::blocking(
        "Не удалось подготовить каталог скинов",
        move || -> Result<()> {
            if let Some(parent) = png_parent {
                std::fs::create_dir_all(&parent)
                    .with_context(|| format!("Не удалось создать каталог {:?}", parent))?;
            }
            Ok(())
        },
    )
    .await??;

    write_atomic(&png_path, &file_data)
        .await
        .context("Не удалось записать локальный скин")?;

    let meta = serde_json::json!({ "model": model });
    write_atomic(&meta_path, meta.to_string().as_bytes())
        .await
        .context("Не удалось записать метаданные локального скина")?;

    log_info!("Локальный скин сохранён: {}", png_path.display());
    Ok(())
}

#[tauri::command]
pub async fn get_offline_skin(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<tauri::ipc::Response> {
    let project_name = current_project_name(&state).await?;
    let (png_path, _) = offline_skin_paths(&project_name)?;
    let bytes = crate::utils::blocking(
        "Не удалось прочитать локальный скин",
        move || match std::fs::read(&png_path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => {
                log_err!("Не удалось прочитать локальный скин {:?}: {}", png_path, e);
                Vec::new()
            }
        },
    )
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_offline_skin_model(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<Option<String>> {
    let project_name = current_project_name(&state).await?;
    let (_, meta_path) = offline_skin_paths(&project_name)?;
    let model = crate::utils::blocking(
        "Не удалось прочитать модель локального скина",
        move || {
            std::fs::read(&meta_path)
                .ok()
                .and_then(|bytes| parse_offline_skin_model(&bytes))
        },
    )
    .await?;
    Ok(model)
}

#[tauri::command]
pub async fn delete_offline_skin(state: State<'_, Mutex<GlobalState>>) -> CommandResult<()> {
    let project_name = current_project_name(&state).await?;
    delete_offline_skin_files(&project_name).await?;
    Ok(())
}
