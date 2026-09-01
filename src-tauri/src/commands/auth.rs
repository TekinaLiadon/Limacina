use anyhow::{bail, Result};
use tauri::State;
use tokio::sync::Mutex;

use crate::auth::{self, storage, AuthData};
use crate::commands::launcher_config::update_launcher_config;
use crate::log_err;
use crate::state::config::load_config_or_default;
use crate::state::dto::{GlobalState, SessionTokens};
use crate::utils::tauri_err::CommandResult;

#[derive(serde::Serialize)]
pub struct SavedCredentials {
    pub username: String,
    pub password: String,
}


async fn store_session(
    state: &State<'_, Mutex<GlobalState>>,
    data: &AuthData,
    fallback_username: &str,
) -> (String, String) {
    let uuid = data.uuid();
    let username = data.username(fallback_username);

    let mut state = state.lock().await;
    state.session = Some(SessionTokens {
        access_token: data.tokens.access_token.clone(),
        uuid: uuid.clone(),
        username: username.clone(),
    });

    (uuid, username)
}


async fn remember_login(
    state: &State<'_, Mutex<GlobalState>>,
    project_name: &str,
    username: &str,
    remember: bool,
) -> Result<()> {
    update_launcher_config(state, |config| {
        if remember {
            config.add_login(project_name, username);
        } else {
            config.remove_login(project_name, username);
        }
    })
    .await?;
    Ok(())
}



pub(crate) async fn restore_session(
    project_name: &str,
    username: &str,
    password: Option<&str>,
) -> Result<AuthData> {
    let project = load_config_or_default(project_name).await;
    if !project.online {
        bail!(
            "Профиль «{}» — одиночный, серверная авторизация недоступна",
            project_name
        );
    }
    let server_url = project.resolved_server_url();

    if let Ok(refresh_token) = storage::get_credential(project_name, username, "refresh_token").await
    {
        match auth::refresh(&server_url, &refresh_token).await {
            Ok(data) => return Ok(data),
            Err(e) => {
                log_err!("restore_session: refresh не удался ({}), пробуем вход по паролю", e);
                let _ = storage::delete_credential(project_name, username, "refresh_token").await;
            }
        }
    }

    let stored_password = match password {
        Some(password) => Some(password.to_string()),
        None => storage::get_credential(project_name, username, "password")
            .await
            .ok(),
    };
    match stored_password {
        Some(password) => auth::login(&server_url, username, &password).await,
        None => bail!(
            "Нет сохранённых учётных данных для «{}» — войдите с паролем",
            username
        ),
    }
}

#[tauri::command]
pub async fn auth_register(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
    password: String,
) -> CommandResult<()> {
    register_account(&state, &project_name, &username, &password).await?;
    Ok(())
}

async fn register_account(
    state: &State<'_, Mutex<GlobalState>>,
    project_name: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    let project = load_config_or_default(project_name).await;
    if !project.online {
        bail!("Регистрация недоступна для одиночного профиля");
    }

    auth::register(&project.resolved_server_url(), username, password).await?;

    storage::save_credential(project_name, username, "password", password).await?;
    remember_login(state, project_name, username, true).await?;

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
    login_account(&state, &project_name, &username, &password, remember_me).await?;
    Ok(())
}

async fn login_account(
    state: &State<'_, Mutex<GlobalState>>,
    project_name: &str,
    username: &str,
    password: &str,
    remember_me: bool,
) -> Result<()> {
    let project = load_config_or_default(project_name).await;


    if !project.online {
        if username.trim().is_empty() {
            bail!("Введите ник");
        }
        let data = auth::offline(username);
        store_session(state, &data, username).await;
        remember_login(state, project_name, username, true).await?;
        return Ok(());
    }

    let data = restore_session(project_name, username, Some(password)).await?;

    let (uuid, _) = store_session(state, &data, username).await;
    remember_login(state, project_name, username, remember_me).await?;

    if remember_me {
        storage::save_credential(project_name, username, "password", password).await?;
        storage::save_credential(
            project_name,
            username,
            "refresh_token",
            &data.tokens.refresh_token,
        )
        .await?;
        if !uuid.is_empty() {
            storage::save_credential(project_name, username, "uuid", &uuid).await?;
        }
    } else {
        let _ = storage::delete_credential(project_name, username, "password").await;
        let _ = storage::delete_credential(project_name, username, "refresh_token").await;
        let _ = storage::delete_credential(project_name, username, "uuid").await;
    }

    Ok(())
}

#[tauri::command]
pub async fn auth_refresh(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
) -> CommandResult<()> {
    let project = load_config_or_default(&project_name).await;

    if !project.online {
        let data = auth::offline(&username);
        store_session(&state, &data, &username).await;
        return Ok(());
    }

    let auth_data = restore_session(&project_name, &username, None).await?;
    let (uuid, _) = store_session(&state, &auth_data, &username).await;

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

    Ok(())
}

#[tauri::command]
pub async fn auth_saved(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<Option<SavedCredentials>> {
    let username = {
        let state = state.lock().await;
        state
            .launcher_config
            .as_ref()
            .and_then(|lc| lc.get_first_login(&project_name))
    };

    let Some(username) = username else {
        return Ok(None);
    };


    let project = load_config_or_default(&project_name).await;
    if !project.online {
        return Ok(Some(SavedCredentials {
            username,
            password: String::new(),
        }));
    }



    let password = storage::get_credential(&project_name, &username, "password")
        .await
        .unwrap_or_default();
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
    let _ = storage::delete_credential(&project_name, &username, "password").await;
    let _ = storage::delete_credential(&project_name, &username, "refresh_token").await;
    let _ = storage::delete_credential(&project_name, &username, "uuid").await;

    remember_login(&state, &project_name, &username, false).await?;

    Ok(())
}
