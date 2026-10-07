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
    state: &Mutex<GlobalState>,
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
    state: &Mutex<GlobalState>,
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

static SESSION_RESTORE_LOCK: Mutex<()> = Mutex::const_new(());

pub(crate) async fn restore_and_persist_session(
    project_name: &str,
    username: &str,
    password: Option<&str>,
) -> Result<AuthData> {
    let _guard = SESSION_RESTORE_LOCK.lock().await;
    let data = restore_session(project_name, username, password).await?;
    persist_session_credentials(project_name, username, &data).await?;
    Ok(data)
}

async fn project_server_url(project_name: &str, offline_reason: &str) -> Result<String> {
    let project = load_config_or_default(project_name).await?;
    if !project.online {
        bail!(LauncherError::OfflineProfile(offline_reason.to_string()));
    }
    project
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing.into())
}

pub(crate) async fn wipe_project_credentials(
    project_name: &str,
    usernames: &[String],
) -> Result<()> {
    let mut failures: Vec<String> = Vec::new();
    for username in usernames {
        for kind in ["password", "refresh_token", "uuid"] {
            if let Err(e) = storage::delete_credential(project_name, username, kind).await {
                failures.push(format!("{username}/{kind}: {e}"));
            }
        }
    }
    if failures.is_empty() {
        return Ok(());
    }
    bail!(
        "Не удалось удалить сохранённые учётные данные: {}",
        failures.join("; ")
    );
}

pub(crate) async fn restore_session(
    project_name: &str,
    username: &str,
    password: Option<&str>,
) -> Result<AuthData> {
    let server_url = project_server_url(project_name, "серверная авторизация недоступна").await?;

    if let Ok(refresh_token) =
        storage::get_credential(project_name, username, "refresh_token").await
    {
        match auth::refresh(&server_url, &refresh_token).await {
            Ok(data) => return Ok(data),
            Err(e) if is_refresh_rejected(&e) => {
                log_err!(
                    "restore_session: сервер отклонил refresh-токен ({}), сверяем хранилище",
                    e
                );
                if let Some(data) =
                    refresh_after_rejection(project_name, username, &server_url, &refresh_token)
                        .await?
                {
                    return Ok(data);
                }
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

async fn refresh_after_rejection(
    project_name: &str,
    username: &str,
    server_url: &str,
    rejected_token: &str,
) -> Result<Option<AuthData>> {
    let current = storage::get_credential(project_name, username, "refresh_token").await;
    match current {
        Ok(current) if current != rejected_token => {
            log_err!(
                "restore_session: refresh-токен уже сменён параллельным вызовом, повторяем с новым"
            );
            match auth::refresh(server_url, &current).await {
                Ok(data) => Ok(Some(data)),
                Err(e) if is_refresh_rejected(&e) => {
                    log_err!(
                        "restore_session: сервер отклонил и обновлённый токен ({}), удаляем",
                        e
                    );
                    let _ =
                        storage::delete_credential(project_name, username, "refresh_token").await;
                    Ok(None)
                }
                Err(e) => {
                    log_err!(
                        "restore_session: временный сбой повторного refresh ({}), токен сохранён",
                        e
                    );
                    LauncherError::classify(Err::<AuthData, _>(e), LauncherError::AuthServer)
                        .map(Some)
                        .context(
                            "Не удалось обновить сессию. Проверьте подключение к серверу и повторите попытку",
                        )
                }
            }
        }
        _ => {
            let _ = storage::delete_credential(project_name, username, "refresh_token").await;
            Ok(None)
        }
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
    let server_url = project_server_url(project_name, "регистрация недоступна").await?;

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
    login_account(
        state.inner(),
        &project_name,
        &username,
        &password,
        remember_me,
    )
    .await?;
    Ok(())
}

async fn login_account(
    state: &Mutex<GlobalState>,
    project_name: &str,
    username: &str,
    password: &str,
    remember_me: bool,
) -> Result<()> {
    let username = username.trim();
    let project = load_config_or_default(project_name).await?;

    if !project.online {
        if username.is_empty() {
            bail!(LauncherError::UsernameEmpty);
        }
        let data = auth::offline(username);
        store_session(state, &data, username, project_name).await;
        remember_login(state, project_name, username, remember_me).await?;
        return Ok(());
    }

    let data = login_online_session(project_name, username, password, remember_me).await?;

    store_session(state, &data, username, project_name).await;
    remember_login(state, project_name, username, remember_me).await?;

    Ok(())
}

async fn login_online_session(
    project_name: &str,
    username: &str,
    password: &str,
    remember_me: bool,
) -> Result<AuthData> {
    let _guard = SESSION_RESTORE_LOCK.lock().await;
    let data = restore_session(project_name, username, Some(password)).await?;
    if remember_me {
        persist_session_credentials(project_name, username, &data).await?;
    } else {
        wipe_project_credentials(project_name, &[username.to_string()]).await?;
    }
    Ok(data)
}

#[tauri::command]
pub async fn auth_refresh(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
    username: String,
) -> CommandResult<()> {
    auth_refresh_flow(state.inner(), &project_name, &username).await?;
    Ok(())
}

async fn auth_refresh_flow(
    state: &Mutex<GlobalState>,
    project_name: &str,
    username: &str,
) -> Result<()> {
    let username = username.trim();
    if username.is_empty() {
        bail!(LauncherError::UsernameEmpty);
    }
    let project = load_config_or_default(project_name).await?;

    if !project.online {
        let data = auth::offline(username);
        store_session(state, &data, username, project_name).await;
        return Ok(());
    }

    let auth_data = restore_and_persist_session(project_name, username, None).await?;
    store_session(state, &auth_data, username, project_name).await;

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

    let data = change_password_session(
        project_name,
        &username,
        &access_token,
        old_password,
        new_password,
    )
    .await?;

    {
        let mut state = state.lock().await;
        state.session = Some(SessionTokens {
            access_token: data.tokens.access_token.clone(),
            uuid: data.uuid(),
            username: data.username(&username),
            project_name: project_name.to_string(),
        });
    }

    log_info!("Пароль изменён: {}", username);

    Ok(())
}

async fn change_password_session(
    project_name: &str,
    username: &str,
    access_token: &str,
    old_password: &str,
    new_password: &str,
) -> Result<AuthData> {
    let server_url = project_server_url(project_name, "смена пароля недоступна").await?;

    let _guard = SESSION_RESTORE_LOCK.lock().await;
    let data = auth::change_password(&server_url, access_token, old_password, new_password)
        .await
        .context("Не удалось сменить пароль")?;

    storage::save_credential(
        project_name,
        username,
        "refresh_token",
        &data.tokens.refresh_token,
    )
    .await?;

    Ok(data)
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
    delete_account_flow(state.inner(), &project_name, &username).await?;
    Ok(())
}

async fn delete_account_flow(
    state: &Mutex<GlobalState>,
    project_name: &str,
    username: &str,
) -> Result<()> {
    let _guard = SESSION_RESTORE_LOCK.lock().await;

    if let Ok(refresh_token) =
        storage::get_credential(project_name, username, "refresh_token").await
    {
        if !refresh_token.is_empty() {
            if let Ok(server_url) =
                project_server_url(project_name, "удаление аккаунта недоступно").await
            {
                if let Err(e) = auth::invalidate(&server_url, &refresh_token).await {
                    log_err!("Не удалось инвалидировать токен на сервере: {}", e);
                }
            }
        }
    }

    wipe_project_credentials(project_name, &[username.to_string()]).await?;

    {
        let mut guard = state.lock().await;
        if guard.session.as_ref().is_some_and(|session| {
            session.project_name == project_name && session.username == username
        }) {
            guard.session = None;
        }
    }

    remember_login(state, project_name, username, false).await
}

#[cfg(test)]
mod account_flow_tests {
    use super::{
        auth_refresh_flow, change_password_session, delete_account_flow, login_account,
        restore_and_persist_session, wipe_project_credentials,
    };
    use crate::auth::generate_offline_uuid;
    use crate::auth::storage;
    use crate::state::dto::{GlobalState, ProjectConfig, SessionTokens};
    use crate::state::launcher_config::{set_config_file_path_for_tests, LauncherConfig};
    use crate::test_support::LauncherDirGuard;
    use mockito::{Matcher, Server};
    use serde_json::json;
    use std::path::Path;
    use tokio::sync::Mutex;

    struct ConfigFileGuard;

    impl ConfigFileGuard {
        fn acquire(root: &Path, name: &str) -> Self {
            set_config_file_path_for_tests(Some(root.join(name)));
            Self
        }
    }

    impl Drop for ConfigFileGuard {
        fn drop(&mut self) {
            set_config_file_path_for_tests(None);
        }
    }

    fn rotation_payload(access: &str, refresh: &str) -> String {
        json!({
            "tokens": { "access_token": access, "refresh_token": refresh },
            "profile": { "uuid": "uuid-1", "username": "Steve" }
        })
        .to_string()
    }

    async fn seed_online_project(project_name: &str, server_url: &str) {
        let config = ProjectConfig {
            project_name: project_name.to_string(),
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

    fn state_with_session(username: &str, project_name: &str) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: project_name.to_string(),
                online: true,
                ..ProjectConfig::default()
            },
            session: Some(SessionTokens {
                access_token: "access-1".to_string(),
                uuid: "uuid-1".to_string(),
                username: username.to_string(),
                project_name: project_name.to_string(),
            }),
            launcher_config: Some(LauncherConfig::default()),
            app_version: String::new(),
        })
    }

    async fn seed_offline_project(project_name: &str) {
        let config = ProjectConfig {
            project_name: project_name.to_string(),
            mc_version: "1.20.1".to_string(),
            online: false,
            ..ProjectConfig::default()
        };
        config
            .save_config()
            .await
            .expect("сохранение конфига проекта");
    }

    fn offline_state(project_name: &str) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: project_name.to_string(),
                online: false,
                ..ProjectConfig::default()
            },
            session: None,
            launcher_config: Some(LauncherConfig::default()),
            app_version: String::new(),
        })
    }

    #[tokio::test]
    async fn offline_login_trims_username_and_respects_remember_me() {
        let dir = LauncherDirGuard::acquire("auth_offline_trim").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        login_account(&state, "OffProj", "  Steve  ", "ignored", true)
            .await
            .expect("офлайн-вход");

        let guard = state.lock().await;
        let session = guard.session.as_ref().expect("сессия");
        assert_eq!(session.username, "Steve", "ник должен тримиться");
        assert_eq!(
            session.uuid,
            generate_offline_uuid("Steve"),
            "uuid должен считаться от тримнутого ника"
        );
        assert_eq!(
            guard
                .launcher_config
                .as_ref()
                .expect("конфиг лаунчера")
                .get_logins("OffProj"),
            vec!["Steve".to_string()],
            "логин должен сохраняться при remember_me"
        );
    }

    #[tokio::test]
    async fn offline_login_without_remember_me_drops_saved_login() {
        let dir = LauncherDirGuard::acquire("auth_offline_no_remember").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        login_account(&state, "OffProj", "Steve", "ignored", false)
            .await
            .expect("офлайн-вход");

        let guard = state.lock().await;
        assert_eq!(
            guard.session.as_ref().expect("сессия").username,
            "Steve",
            "вход без remember_me всё равно выполняется"
        );
        assert!(
            guard
                .launcher_config
                .as_ref()
                .expect("конфиг лаунчера")
                .get_logins("OffProj")
                .is_empty(),
            "логин не должен сохраняться без remember_me"
        );
    }

    #[tokio::test]
    async fn offline_login_rejects_blank_username() {
        let dir = LauncherDirGuard::acquire("auth_offline_blank").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        let error = login_account(&state, "OffProj", "   ", "ignored", true)
            .await
            .expect_err("пустой ник должен отклоняться");

        assert!(
            error.to_string().contains("Введите ник"),
            "ожидается UsernameEmpty: {error}"
        );
        assert!(
            state.lock().await.session.is_none(),
            "сессия не должна создаваться"
        );
    }

    #[tokio::test]
    async fn auth_refresh_rejects_blank_username_offline() {
        let dir = LauncherDirGuard::acquire("auth_refresh_blank").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        let error = auth_refresh_flow(&state, "OffProj", "   ")
            .await
            .expect_err("пустой ник должен отклоняться");

        assert!(
            error.to_string().contains("Введите ник"),
            "ожидается UsernameEmpty: {error}"
        );
        assert!(
            state.lock().await.session.is_none(),
            "сессия с uuid от пустого ника не должна создаваться"
        );
    }

    #[tokio::test]
    async fn auth_refresh_trims_username_offline() {
        let dir = LauncherDirGuard::acquire("auth_refresh_trim").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        seed_offline_project("OffProj").await;
        let state = offline_state("OffProj");

        auth_refresh_flow(&state, "OffProj", "  Steve  ")
            .await
            .expect("офлайн-refresh");

        let guard = state.lock().await;
        let session = guard.session.as_ref().expect("сессия");
        assert_eq!(session.username, "Steve", "ник должен тримиться");
        assert_eq!(
            session.uuid,
            generate_offline_uuid("Steve"),
            "uuid должен считаться от тримнутого ника"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_change_password_and_refresh_keep_valid_token() {
        let _guard = LauncherDirGuard::acquire("auth_flow_concurrent_password").await;
        let mut server = Server::new_async().await;
        let project = "FlowProj";
        let username = "Steve";

        wipe_project_credentials(project, &[username.to_string()])
            .await
            .expect("очистка хранилища перед тестом");

        let payload = rotation_payload("access-mid", "tok-mid");
        let (first_part, second_part) = payload.split_at(payload.len() / 2);
        let (first_part, second_part) = (first_part.to_string(), second_part.to_string());
        let slow_refresh = server
            .mock("POST", "/v1/common/auth/refresh")
            .match_body(Matcher::PartialJsonString(
                json!({"refresh_token": "tok-old"}).to_string(),
            ))
            .with_status(200)
            .with_chunked_body(move |writer| {
                writer.write_all(first_part.as_bytes())?;
                std::thread::sleep(std::time::Duration::from_millis(300));
                writer.write_all(second_part.as_bytes())?;
                Ok(())
            })
            .create_async()
            .await;
        let password_change = server
            .mock("PATCH", "/v1/common/auth/password")
            .with_status(200)
            .with_body(rotation_payload("access-new", "tok-new"))
            .create_async()
            .await;

        seed_online_project(project, &server.url()).await;
        storage::save_fallback(project, username, "refresh_token", "tok-old")
            .expect("сохранение токена");

        let mut refresh_task = {
            let project = project.to_string();
            let username = username.to_string();
            tokio::spawn(
                async move { restore_and_persist_session(&project, &username, None).await },
            )
        };
        let wait_deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !slow_refresh.matched() {
            if std::time::Instant::now() >= wait_deadline {
                let refresh_result = (&mut refresh_task).await;
                panic!(
                    "задача refresh не дошла до сервера: {:?}",
                    refresh_result.map(|inner| inner.map(|_| ()).map_err(|e| format!("{e:#}")))
                );
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        let password_task = {
            let project = project.to_string();
            let username = username.to_string();
            tokio::spawn(async move {
                change_password_session(&project, &username, "access-1", "old-pass", "new-pass")
                    .await
            })
        };

        refresh_task
            .await
            .expect("задача refresh")
            .expect("refresh должен пройти");
        password_task
            .await
            .expect("задача change_password")
            .expect("смена пароля должна пройти");

        password_change.assert_async().await;
        let token = storage::get_credential(project, username, "refresh_token")
            .await
            .expect("токен должен остаться на диске");
        assert_eq!(
            token, "tok-new",
            "на диске должен остаться токен ротации смены пароля"
        );

        wipe_project_credentials(project, &[username.to_string()])
            .await
            .expect("очистка хранилища после теста");
    }

    #[tokio::test]
    async fn change_password_persists_rotated_token() {
        let _guard = LauncherDirGuard::acquire("auth_flow_password_persist").await;
        let mut server = Server::new_async().await;
        let project = "PwdProj";
        let username = "Steve";

        wipe_project_credentials(project, &[username.to_string()])
            .await
            .expect("очистка хранилища перед тестом");
        let password_change = server
            .mock("PATCH", "/v1/common/auth/password")
            .with_status(200)
            .with_body(rotation_payload("access-new", "tok-new"))
            .create_async()
            .await;

        seed_online_project(project, &server.url()).await;

        let data = change_password_session(project, username, "access-1", "old-pass", "new-pass")
            .await
            .expect("смена пароля");

        password_change.assert_async().await;
        assert_eq!(data.tokens.access_token, "access-new");
        assert_eq!(
            storage::get_credential(project, username, "refresh_token")
                .await
                .expect("ротированный токен должен сохраниться"),
            "tok-new"
        );

        wipe_project_credentials(project, &[username.to_string()])
            .await
            .expect("очистка хранилища после теста");
    }

    #[tokio::test]
    async fn delete_account_resets_session_and_saved_login_for_current_user() {
        let dir = LauncherDirGuard::acquire("auth_flow_delete_current").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        let mut server = Server::new_async().await;
        let invalidate = server
            .mock("POST", "/v1/common/auth/invalidate")
            .with_status(200)
            .create_async()
            .await;

        seed_online_project("TestProj", &server.url()).await;
        storage::save_fallback("TestProj", "Steve", "refresh_token", "tok-del")
            .expect("сохранение токена");

        let state = state_with_session("Steve", "TestProj");
        {
            let mut guard = state.lock().await;
            guard
                .launcher_config
                .as_mut()
                .expect("конфиг лаунчера")
                .add_login("TestProj", "Steve");
        }

        delete_account_flow(&state, "TestProj", "Steve")
            .await
            .expect("удаление аккаунта");

        invalidate.assert_async().await;
        let guard = state.lock().await;
        assert!(
            guard.session.is_none(),
            "сессия удалённого текущего пользователя должна сбрасываться"
        );
        assert!(
            guard
                .launcher_config
                .as_ref()
                .expect("конфиг лаунчера")
                .get_logins("TestProj")
                .is_empty(),
            "сохранённый логин удалённого аккаунта должен убираться"
        );
        drop(guard);
        assert!(
            storage::get_credential("TestProj", "Steve", "refresh_token")
                .await
                .is_err(),
            "креденшелы удалённого аккаунта должны быть стёрты"
        );
    }

    #[tokio::test]
    async fn delete_account_keeps_session_for_other_user() {
        let dir = LauncherDirGuard::acquire("auth_flow_delete_other").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        let mut server = Server::new_async().await;
        let invalidate = server
            .mock("POST", "/v1/common/auth/invalidate")
            .with_status(200)
            .create_async()
            .await;

        seed_online_project("TestProj", &server.url()).await;
        storage::save_fallback("TestProj", "Alex", "refresh_token", "tok-alex")
            .expect("сохранение токена");

        let state = state_with_session("Steve", "TestProj");

        delete_account_flow(&state, "TestProj", "Alex")
            .await
            .expect("удаление аккаунта");

        invalidate.assert_async().await;
        assert!(
            state.lock().await.session.is_some(),
            "сессия другого пользователя не должна сбрасываться"
        );
        assert!(
            storage::get_credential("TestProj", "Alex", "refresh_token")
                .await
                .is_err(),
            "креденшелы удалённого пользователя должны быть стёрты"
        );
    }

    #[tokio::test]
    async fn delete_account_reports_wipe_failure() {
        let dir = LauncherDirGuard::acquire("auth_flow_delete_wipe_fail").await;
        let _config_guard = ConfigFileGuard::acquire(dir.root(), "config.json");
        std::fs::create_dir(dir.root().join("credentials.json"))
            .expect("заглушка недоступного хранилища");

        let state = state_with_session("Steve", "TestProj");

        let error = delete_account_flow(&state, "TestProj", "Steve")
            .await
            .expect_err("ошибка удаления креденшелов не должна проглатываться");

        assert!(
            error.to_string().contains("Не удалось удалить"),
            "неожиданная ошибка: {error}"
        );
        assert!(
            state.lock().await.session.is_some(),
            "при неудавшемся удалении сессия не сбрасывается"
        );
    }
}

#[cfg(test)]
mod restore_session_tests {
    use super::{restore_and_persist_session, restore_session, wipe_project_credentials};
    use crate::auth::storage;
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;
    use mockito::{Matcher, Server};
    use serde_json::json;

    fn rotation_payload(access: &str, refresh: &str) -> String {
        json!({
            "tokens": { "access_token": access, "refresh_token": refresh },
            "profile": { "uuid": "uuid-1", "username": "Steve" }
        })
        .to_string()
    }

    async fn seed_online_project(project_name: &str, server_url: &str) {
        let config = ProjectConfig {
            project_name: project_name.to_string(),
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

        seed_online_project("TestProj", &format!("http://127.0.0.1:{port}")).await;
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

        seed_online_project("TestProj", &server.url()).await;
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

        seed_online_project("TestProj", &server.url()).await;
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

        seed_online_project("TestProj", &server.url()).await;
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

    #[tokio::test]
    async fn concurrent_rotations_keep_valid_refresh_token() {
        let _guard = LauncherDirGuard::acquire("restore_session_concurrent").await;
        let mut server = Server::new_async().await;
        let project = "RaceProj";
        let username = "Racer";

        let first_rotation = server
            .mock("POST", "/v1/common/auth/refresh")
            .match_body(Matcher::PartialJsonString(
                json!({"refresh_token": "tok-old"}).to_string(),
            ))
            .with_status(200)
            .with_body(rotation_payload("access-2", "tok-2"))
            .expect(1)
            .create_async()
            .await;
        let _rejected_old = server
            .mock("POST", "/v1/common/auth/refresh")
            .match_body(Matcher::PartialJsonString(
                json!({"refresh_token": "tok-old"}).to_string(),
            ))
            .with_status(401)
            .with_body("{\"message\": \"invalid token\"}")
            .create_async()
            .await;
        let second_rotation = server
            .mock("POST", "/v1/common/auth/refresh")
            .match_body(Matcher::PartialJsonString(
                json!({"refresh_token": "tok-2"}).to_string(),
            ))
            .with_status(200)
            .with_body(rotation_payload("access-3", "tok-3"))
            .expect(1)
            .create_async()
            .await;

        seed_online_project(project, &server.url()).await;
        storage::save_fallback(project, username, "refresh_token", "tok-old")
            .expect("сохранение токена");

        let (first, second) = tokio::join!(
            restore_and_persist_session(project, username, None),
            restore_and_persist_session(project, username, None),
        );
        first.expect("первая ротация");
        second.expect("вторая ротация");

        let token = storage::get_credential(project, username, "refresh_token")
            .await
            .expect("валидный токен не должен удаляться параллельной ротацией");
        assert!(
            token == "tok-2" || token == "tok-3",
            "неожиданный токен: {token}"
        );
        first_rotation.assert_async().await;
        second_rotation.assert_async().await;

        wipe_project_credentials(project, &[username.to_string()])
            .await
            .expect("очистка хранилища после теста");
        assert!(
            storage::get_credential(project, username, "refresh_token")
                .await
                .is_err(),
            "тест должен убирать за собой записи хранилища"
        );
    }
}
