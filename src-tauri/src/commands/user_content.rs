use anyhow::Context;
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::auth::{self, storage};
use crate::commands::auth::restore_session;
use crate::launcher_server::user_content::{self, UserContentItem};
use crate::log_info;
use crate::state::config::load_config_or_default;
use crate::state::dto::{GlobalState, SessionTokens};
use crate::utils::tauri_err::CommandResult;

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
    let project = load_config_or_default(&project_name).await;



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
        });
    }

    if project.online {
        if !uuid.is_empty() {
            let _ = storage::save_credential(&project_name, &username, "uuid", &uuid).await;
        }
        storage::save_credential(
            &project_name,
            &username,
            "refresh_token",
            &auth_data.tokens.refresh_token,
        )
        .await?;
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
pub async fn logout_account(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let mut state = state.lock().await;
    state.session = None;
    Ok(())
}

#[tauri::command]
pub async fn upload_skin(
    state: State<'_, Mutex<GlobalState>>,
    request: tauri::ipc::Request<'_>,
) -> CommandResult<UserContentItem> {

    let file_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),

        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .context("Некорректное тело запроса загрузки скина")?,
    };

    let item = user_content::upload_skin(&state, file_data).await?;
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
pub async fn delete_skin(
    state: State<'_, Mutex<GlobalState>>,
    id: i64,
) -> CommandResult<()> {
    user_content::delete_skin(&state, id).await?;
    Ok(())
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
pub async fn delete_model(
    state: State<'_, Mutex<GlobalState>>,
    id: i64,
) -> CommandResult<()> {
    user_content::delete_model(&state, id).await?;
    Ok(())
}
