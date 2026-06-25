use tauri::State;
use tokio::sync::Mutex;

use crate::auth::{self, config, storage};
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
    }

    if remember_me {
        config::add_login(&project_name, &username)?;
        storage::save_password(&project_name, &username, &password)?;
    } else {
        config::remove_login(&project_name, &username)?;
        let _ = storage::delete_password(&project_name, &username);
    }

    Ok(())
}

#[tauri::command]
pub async fn auth_saved(
    project_name: String,
) -> CommandResult<Option<SavedCredentials>> {
    let username = config::get_first_login(&project_name)?;
    let Some(username) = username else {
        return Ok(None);
    };

    let password = storage::get_password(&project_name, &username)?;
    Ok(Some(SavedCredentials { username, password }))
}

#[tauri::command]
pub async fn auth_logins(
    project_name: String,
) -> CommandResult<Vec<String>> {
    let cfg = config::load_config()?;
    let logins = cfg
        .projects
        .get(&project_name)
        .map(|p| p.logins.iter().map(|l| l.username.clone()).collect())
        .unwrap_or_default();

    Ok(logins)
}
