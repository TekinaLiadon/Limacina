use anyhow::{bail, Context, Result};
use tauri::State;
use tokio::sync::Mutex;

use crate::auth::{self, storage, AuthData};
use crate::commands::launcher_config::update_launcher_config;
use crate::log_err;
use crate::log_info;
use crate::state::config::load_config_or_default;
use crate::state::dto::{GlobalState, SessionTokens};
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;

async fn store_session(
    state: &State<'_, Mutex<GlobalState>>,
    data: &AuthData,
    fallback_username: &str,
    project_name: &str,
) -> (String, String) {
    let uuid = data.uuid();
    let username = data.username(fallback_username);

    let mut state = state.lock().await;
    state.session = Some(SessionTokens {
        access_token: data.tokens.access_token.clone(),
        uuid: uuid.clone(),
        username: username.clone(),
        project_name: project_name.to_string(),
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

pub(crate) async fn persist_session_credentials(
    project_name: &str,
    username: &str,
    data: &AuthData,
) -> Result<()> {
    let uuid = data.uuid();
    if !uuid.is_empty() {
        let _ = storage::save_credential(project_name, username, "uuid", &uuid).await;
    }
    storage::save_credential(
        project_name,
        username,
        "refresh_token",
        &data.tokens.refresh_token,
    )
    .await?;
    Ok(())
}

fn is_refresh_rejected(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<LauncherError>(),
            Some(LauncherError::HttpStatus {
                status: 401 | 403,
                ..
            })
        )
    })
}

pub(crate) async fn restore_session(
    project_name: &str,
    username: &str,
    password: Option<&str>,
) -> Result<AuthData> {
    let project = load_config_or_default(project_name).await?;
    if !project.online {
        bail!(LauncherError::OfflineProfile(
            "серверная авторизация недоступна".to_string()
        ));
    }
    let server_url = project
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing)?;

    if let Ok(refresh_token) =
        storage::get_credential(project_name, username, "refresh_token").await
    {
        match auth::refresh(&server_url, &refresh_token).await {
            Ok(data) => return Ok(data),
            Err(e) if is_refresh_rejected(&e) => {
                log_err!(
                    "restore_session: сервер отклонил refresh-токен ({}), пробуем вход по паролю",
                    e
                );
                let _ = storage::delete_credential(project_name, username, "refresh_token").await;
            }
            Err(e) => {
                log_err!(
                    "restore_session: временный сбой refresh ({}), refresh-токен сохранён",
                    e
                );
                let classified =
                    LauncherError::classify(Err::<AuthData, _>(e), LauncherError::AuthServer);
                return classified.context(
                    "Не удалось обновить сессию. Проверьте подключение к серверу и повторите попытку",
                );
            }
        }
    }

    let stored_password = password.map(|password| password.to_string());
    match stored_password {
        Some(password) => auth::login(&server_url, username, &password).await,
        None => bail!(LauncherError::NoSavedCredentials(username.to_string())),
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
    let project = load_config_or_default(project_name).await?;
    if !project.online {
        bail!(LauncherError::OfflineProfile(
            "регистрация недоступна".to_string()
        ));
    }
    let server_url = project
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing)?;

    auth::register(&server_url, username, password).await?;

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
    let project = load_config_or_default(project_name).await?;

    if !project.online {
        if username.trim().is_empty() {
            bail!(LauncherError::UsernameEmpty);
        }
        let data = auth::offline(username);
        store_session(state, &data, username, project_name).await;
        remember_login(state, project_name, username, true).await?;
        return Ok(());
    }

    let data = restore_session(project_name, username, Some(password)).await?;

    store_session(state, &data, username, project_name).await;
    remember_login(state, project_name, username, remember_me).await?;

    if remember_me {
        persist_session_credentials(project_name, username, &data).await?;
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
    let project = load_config_or_default(&project_name).await?;

    if !project.online {
        let data = auth::offline(&username);
        store_session(&state, &data, &username, &project_name).await;
        return Ok(());
    }

    let auth_data = restore_session(&project_name, &username, None).await?;
    store_session(&state, &auth_data, &username, &project_name).await;

    persist_session_credentials(&project_name, &username, &auth_data).await?;

    Ok(())
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

async fn change_password_flow(
    state: &State<'_, Mutex<GlobalState>>,
    project_name: &str,
    old_password: &str,
    new_password: &str,
) -> Result<()> {
    if new_password.trim().len() < 6 {
        bail!(LauncherError::PasswordTooShort);
    }
    if old_password == new_password {
        bail!(LauncherError::PasswordUnchanged);
    }

    let (username, access_token) = {
        let state = state.lock().await;
        let session = state.session.as_ref().ok_or(LauncherError::NoSession)?;
        if session.access_token == crate::auth::OFFLINE_ACCESS_TOKEN {
            bail!(LauncherError::OfflineProfile(
                "смена пароля недоступна".to_string()
            ));
        }
        if project_name != state.project_config.project_name {
            bail!(LauncherError::ProjectNotSelected);
        }
        (session.username.clone(), session.access_token.clone())
    };

    let project = load_config_or_default(project_name).await?;
    if !project.online {
        bail!(LauncherError::OfflineProfile(
            "смена пароля недоступна".to_string()
        ));
    }
    let server_url = project
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing)?;

    let data = auth::change_password(&server_url, &access_token, old_password, new_password)
        .await
        .context("Не удалось сменить пароль")?;

    {
        let mut state = state.lock().await;
        state.session = Some(SessionTokens {
            access_token: data.tokens.access_token.clone(),
            uuid: data.uuid(),
            username: data.username(&username),
            project_name: project_name.to_string(),
        });
    }

    storage::save_credential(
        project_name,
        &username,
        "refresh_token",
        &data.tokens.refresh_token,
    )
    .await?;

    log_info!("Пароль изменён: {}", username);

    Ok(())
}

#[tauri::command]
pub async fn change_password(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    old_password: String,
    new_password: String,
) -> CommandResult<()> {
    change_password_flow(&state, &project_name, &old_password, &new_password).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_account(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
) -> CommandResult<()> {
    if let Ok(refresh_token) =
        storage::get_credential(&project_name, &username, "refresh_token").await
    {
        if !refresh_token.is_empty() {
            if let Ok(project) = load_config_or_default(&project_name).await {
                if project.online {
                    if let Some(server_url) = project.resolved_server_url() {
                        if let Err(e) = auth::invalidate(&server_url, &refresh_token).await {
                            log_err!("Не удалось инвалидировать токен на сервере: {}", e);
                        }
                    }
                }
            }
        }
    }

    let _ = storage::delete_credential(&project_name, &username, "password").await;
    let _ = storage::delete_credential(&project_name, &username, "refresh_token").await;
    let _ = storage::delete_credential(&project_name, &username, "uuid").await;

    remember_login(&state, &project_name, &username, false).await?;

    Ok(())
}

#[cfg(test)]
mod restore_session_tests {
    use super::restore_session;
    use crate::auth::storage;
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;
    use mockito::Server;

    async fn seed_online_project(server_url: &str) {
        let config = ProjectConfig {
            project_name: "TestProj".to_string(),
            mc_version: "1.20.1".to_string(),
            server_url: Some(server_url.to_string()),
            online: true,
            ..ProjectConfig::default()
        };
        config
            .save_config()
            .await
            .expect("сохранение конфига проекта");
    }

    #[tokio::test]
    async fn network_failure_keeps_refresh_token() {
        let _guard = LauncherDirGuard::acquire("restore_session_network").await;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("порт");
        let port = listener.local_addr().expect("адрес").port();
        drop(listener);

        seed_online_project(&format!("http://127.0.0.1:{port}")).await;
        storage::save_fallback("TestProj", "Steve", "refresh_token", "tok-keep")
            .expect("сохранение токена");

        let error = restore_session("TestProj", "Steve", None)
            .await
            .expect_err("сетевой сбой должен вернуть ошибку");

        assert!(
            !error.to_string().contains("Нет сохранённых учётных данных"),
            "сетевой сбой не должен подменяться на NoSavedCredentials: {error}"
        );
        assert_eq!(
            storage::get_credential("TestProj", "Steve", "refresh_token")
                .await
                .expect("токен должен остаться"),
            "tok-keep"
        );
    }

    #[tokio::test]
    async fn server_error_keeps_refresh_token() {
        let _guard = LauncherDirGuard::acquire("restore_session_5xx").await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/common/auth/refresh")
            .with_status(503)
            .with_body("temporarily unavailable")
            .create_async()
            .await;

        seed_online_project(&server.url()).await;
        storage::save_fallback("TestProj", "Steve", "refresh_token", "tok-keep")
            .expect("сохранение токена");

        let error = restore_session("TestProj", "Steve", None)
            .await
            .expect_err("5xx должен вернуть ошибку");

        mock.assert_async().await;
        assert!(
            !error.to_string().contains("Нет сохранённых учётных данных"),
            "5xx не должен подменяться на NoSavedCredentials: {error}"
        );
        assert_eq!(
            storage::get_credential("TestProj", "Steve", "refresh_token")
                .await
                .expect("токен должен остаться"),
            "tok-keep"
        );
    }

    #[tokio::test]
    async fn unauthorized_deletes_refresh_token_and_reports_no_saved_credentials() {
        let _guard = LauncherDirGuard::acquire("restore_session_401").await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/common/auth/refresh")
            .with_status(401)
            .with_body("{\"message\": \"invalid token\"}")
            .create_async()
            .await;

        seed_online_project(&server.url()).await;
        storage::save_fallback("TestProj", "Steve", "refresh_token", "tok-dead")
            .expect("сохранение токена");

        let error = restore_session("TestProj", "Steve", None)
            .await
            .expect_err("после отклонения токена и без пароля должна быть ошибка");

        mock.assert_async().await;
        assert!(
            error.to_string().contains("Нет сохранённых учётных данных"),
            "ожидается NoSavedCredentials: {error}"
        );
        assert!(
            storage::get_credential("TestProj", "Steve", "refresh_token")
                .await
                .is_err(),
            "отклонённый токен должен быть удалён"
        );
    }

    #[tokio::test]
    async fn unauthorized_falls_back_to_password_login() {
        let _guard = LauncherDirGuard::acquire("restore_session_401_password").await;
        let mut server = Server::new_async().await;
        server
            .mock("POST", "/v1/common/auth/refresh")
            .with_status(403)
            .with_body("{\"message\": \"token revoked\"}")
            .create_async()
            .await;
        let login_mock = server
            .mock("POST", "/v1/common/auth/login")
            .with_status(200)
            .with_body(
                "{\"tokens\": {\"access_token\": \"access-1\", \"refresh_token\": \"refresh-1\"}, \
                 \"profile\": {\"uuid\": \"uuid-1\", \"username\": \"Steve\"}}",
            )
            .create_async()
            .await;

        seed_online_project(&server.url()).await;
        storage::save_fallback("TestProj", "Steve", "refresh_token", "tok-dead")
            .expect("сохранение токена");

        let data = restore_session("TestProj", "Steve", Some("secret"))
            .await
            .expect("вход по паролю должен пройти после отклонения токена");

        login_mock.assert_async().await;
        assert_eq!(data.tokens.access_token, "access-1");
        assert!(
            storage::get_credential("TestProj", "Steve", "refresh_token")
                .await
                .is_err(),
            "отклонённый токен должен быть удалён"
        );
    }
}
