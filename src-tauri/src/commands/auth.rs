use tauri::State;
use tokio::sync::Mutex;

use crate::auth::{self, storage};
use crate::log_err;
use crate::state::dto::{GlobalState, SessionTokens};
use crate::utils::tauri_err::CommandResult;

#[derive(serde::Serialize)]
pub struct SavedCredentials {
    pub username: String,
    pub password: String,
}

#[tauri::command]
pub async fn auth_register(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
    password: String,
) -> CommandResult<()> {
    auth::register(&username, &password).await?;

    storage::save_credential(&project_name, &username, "password", &password)?;
    {
        let mut state = state.lock().await;
        if let Some(ref mut config) = state.launcher_config {
            config.add_login(&project_name, &username);
            config.save()?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn auth_login(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
    password: String,
    remember_me: bool,
) -> CommandResult<()> {
    let data = if let Ok(saved_refresh_token) = storage::get_credential(&project_name, &username, "refresh_token") {
        auth::refresh(&saved_refresh_token).await
            .unwrap_or(auth::login(&username, &password).await?)
    } else {
        auth::login(&username, &password).await?
    };

    let uuid = data.uuid();
    let username_str = data.username(&username);

    {
        let mut state = state.lock().await;
        state.session = Some(SessionTokens {
            access_token: data.tokens.access_token.clone(),
            refresh_token: data.tokens.refresh_token.clone(),
            uuid: uuid.clone(),
            username: username_str,
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
        storage::save_credential(&project_name, &username, "password", &password)?;
        storage::save_credential(&project_name, &username, "refresh_token", &data.tokens.refresh_token)?;
        if !uuid.is_empty() {
            storage::save_credential(&project_name, &username, "uuid", &uuid)?;
        }
    } else {
        let _ = storage::delete_credential(&project_name, &username, "password");
        let _ = storage::delete_credential(&project_name, &username, "refresh_token");
        let _ = storage::delete_credential(&project_name, &username, "uuid");
    }

    Ok(())
}

#[tauri::command]
pub async fn auth_refresh(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
) -> CommandResult<String> {

    let auth_data = if let Ok(refresh_token) = storage::get_credential(&project_name, &username, "refresh_token") {
        match auth::refresh(&refresh_token).await {
            Ok(data) => data,
            Err(e) => {
                log_err!("auth_refresh: refresh failed: {}, trying login", e);
                let _ = storage::delete_credential(&project_name, &username, "refresh_token");
                match storage::get_credential(&project_name, &username, "password") {
                    Ok(password) => match auth::login(&username, &password).await {
                        Ok(data) => data,
                        Err(e) => {
                            log_err!("auth_refresh: login fallback failed: {}", e);
                            return Ok(format!("{:#}", e));
                        }
                    },
                    Err(_) => return Ok(String::new()),
                }
            }
        }
    } else {
        match storage::get_credential(&project_name, &username, "password") {
            Ok(password) => match auth::login(&username, &password).await {
                Ok(data) => data,
                Err(e) => {
                    log_err!("auth_refresh: login failed: {}", e);
                    return Ok(format!("{:#}", e));
                }
            },
            Err(_) => return Ok(String::new()),
        }
    };

    let uuid = auth_data.uuid();
    let username_str = auth_data.username(&username);

    {
        let mut state = state.lock().await;
        state.session = Some(SessionTokens {
            access_token: auth_data.tokens.access_token.clone(),
            refresh_token: auth_data.tokens.refresh_token.clone(),
            uuid: uuid.clone(),
            username: username_str,
        });
    }

    if !uuid.is_empty() {
        let _ = storage::save_credential(&project_name, &username, "uuid", &uuid);
    }
    storage::save_credential(&project_name, &username, "refresh_token", &auth_data.tokens.refresh_token)?;

    Ok(String::new())
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

    let password = storage::get_credential(&project_name, &username, "password")?;
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

#[tauri::command]
pub async fn delete_account(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
) -> CommandResult<()> {
    let _ = storage::delete_credential(&project_name, &username, "password");
    let _ = storage::delete_credential(&project_name, &username, "refresh_token");
    let _ = storage::delete_credential(&project_name, &username, "uuid");

    {
        let mut state = state.lock().await;
        if let Some(ref mut config) = state.launcher_config {
            config.remove_login(&project_name, &username);
            config.save()?;
        }
    }

    Ok(())
}
