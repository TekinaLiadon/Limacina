use tauri::State;
use tokio::sync::Mutex;

use crate::auth::{self, storage};
use crate::state::dto::{GlobalState, SessionTokens};
use crate::utils::tauri_err::CommandResult;

#[derive(serde::Serialize)]
pub struct SavedCredentials {
    pub username: String,
    pub password: String,
}

#[tauri::command]
pub async fn auth_login(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
    password: String,
    remember_me: bool,
) -> CommandResult<()> {
    let auth_data = auth::login(&username, &password).await?;

    {
        let mut state = state.lock().await;
        state.session = Some(SessionTokens {
            access_token: auth_data.tokens.access_token,
            refresh_token: auth_data.tokens.refresh_token,
            uuid: auth_data.profile.uuid,
            username: auth_data.profile.username,
        });

        if let Some(ref mut config) = state.launcher_config {
            if remember_me {
                config.add_login(&project_name, &username);
            } else {
                config.remove_login(&project_name, &username);
            }
            config.save()?;
        }
    }

    if remember_me {
        storage::save_password(&project_name, &username, &password)?;
    } else {
        let _ = storage::delete_password(&project_name, &username);
    }

    Ok(())
}

#[tauri::command]
pub async fn auth_saved(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<Option<SavedCredentials>> {
    let state = state.lock().await;
    let username = state
        .launcher_config
        .as_ref()
        .and_then(|lc| lc.get_first_login(&project_name));

    let Some(username) = username else {
        return Ok(None);
    };

    let password = storage::get_password(&project_name, &username)?;
    Ok(Some(SavedCredentials { username, password }))
}

#[tauri::command]
pub async fn auth_logins(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<Vec<String>> {
    let state = state.lock().await;
    let logins = state
        .launcher_config
        .as_ref()
        .map(|lc| lc.get_logins(&project_name))
        .unwrap_or_default();
    Ok(logins)
}
