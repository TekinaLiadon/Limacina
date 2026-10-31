pub mod downloader;
pub mod user_content;

use anyhow::{bail, Context, Result};
use std::future::Future;
use tokio::sync::Mutex;

use crate::log_err;
use crate::log_info;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::utils::errors::LauncherError;
use crate::utils::http::{http_client, read_error_body_text, with_launcher_id};

pub(crate) async fn fetch_project_config(base_url: &str) -> Result<ProjectConfig> {
    let response = LauncherError::classify(
        with_launcher_id(http_client().get(format!("{base_url}/v1/launcher/config")))
            .send()
            .await
            .with_context(|| format!("Не удалось подключиться к {}", base_url)),
        LauncherError::LauncherServer,
    )?;

    if !response.status().is_success() {
        let status = response.status();
        let body = read_error_body_text(response, base_url).await;
        log_err!("Сервер вернул {} при запросе конфига: {}", status, body);
        bail!(LauncherError::LauncherServer(format!(
            "Сервер {} вернул {} при запросе конфига проекта",
            base_url, status
        )));
    }

    let config: ProjectConfig = LauncherError::classify(
        response
            .json()
            .await
            .context("Не удалось распарсить конфиг с сервера"),
        LauncherError::LauncherServer,
    )?;

    if config.project_name.trim().is_empty() {
        bail!(LauncherError::LauncherServer(
            "Сервер не вернул название проекта".to_string()
        ));
    }

    Ok(config)
}

pub(crate) async fn api_context(state: &Mutex<GlobalState>) -> Result<(String, String)> {
    let guard = state.lock().await;
    let token = guard
        .session
        .as_ref()
        .ok_or(LauncherError::NoSession)?
        .access_token
        .clone();
    let server_url = guard
        .project_config
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing)?;
    Ok((token, server_url))
}

fn is_unauthorized_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<LauncherError>(),
            Some(LauncherError::HttpStatus { status: 401, .. })
        )
    })
}

async fn session_identity(state: &Mutex<GlobalState>) -> Result<(String, String)> {
    let guard = state.lock().await;
    let session = guard.session.as_ref().ok_or(LauncherError::NoSession)?;
    Ok((session.project_name.clone(), session.username.clone()))
}

pub(crate) async fn with_session_retry<T, F, Fut>(
    state: &Mutex<GlobalState>,
    request: F,
) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T>>,
{
    match request().await {
        Ok(value) => Ok(value),
        Err(error) if is_unauthorized_error(&error) => {
            let (project_name, username) = session_identity(state).await?;
            log_info!(
                "Сервер вернул 401: восстанавливаем сессию \"{username}\" и повторяем запрос"
            );
            let data =
                crate::commands::auth::restore_and_persist_session(&project_name, &username, None)
                    .await?;
            {
                let mut guard = state.lock().await;
                if let Some(session) = guard.session.as_mut() {
                    session.access_token = data.tokens.access_token.clone();
                }
            }
            request().await
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod session_retry_tests {
    use super::with_session_retry;
    use crate::auth::storage;
    use crate::auth::OFFLINE_ACCESS_TOKEN;
    use crate::commands::auth::wipe_project_credentials;
    use crate::state::dto::{GlobalState, ProjectConfig, SessionTokens};
    use crate::state::launcher_config::LauncherConfig;
    use crate::test_support::{
        rotation_payload, seed_offline_project, seed_online_project, LauncherDirGuard,
    };
    use crate::utils::errors::LauncherError;
    use mockito::Server;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Mutex;

    fn state(project_name: &str, online: bool, access_token: &str) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: project_name.to_string(),
                online,
                ..ProjectConfig::default()
            },
            session: Some(SessionTokens {
                access_token: access_token.to_string(),
                uuid: "uuid-1".to_string(),
                username: "Steve".to_string(),
                project_name: project_name.to_string(),
            }),
            launcher_config: Some(LauncherConfig::default()),
            app_version: String::new(),
        })
    }

    fn unauthorized() -> anyhow::Error {
        LauncherError::HttpStatus {
            status: 401,
            message: "token expired".to_string(),
        }
        .into()
    }

    #[tokio::test]
    async fn offline_token_unauthorized_fails_with_offline_profile_without_retry() {
        let _guard = LauncherDirGuard::acquire("session_retry_offline_token").await;
        seed_offline_project("OffProj").await;
        let state = state("OffProj", false, OFFLINE_ACCESS_TOKEN);
        let attempts = AtomicUsize::new(0);

        let error = with_session_retry(&state, || async {
            attempts.fetch_add(1, Ordering::SeqCst);
            Err::<u8, _>(unauthorized())
        })
        .await
        .expect_err("офлайн-токен не должен восстанавливаться через сервер");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::OfflineProfile(_))
            ),
            "ожидается OfflineProfile: {error}"
        );
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            1,
            "повторный запрос для офлайн-токена не должен выполняться"
        );
    }

    #[tokio::test]
    async fn unauthorized_online_session_restores_and_retries_request() {
        let _guard = LauncherDirGuard::acquire("session_retry_online").await;
        let mut server = Server::new_async().await;
        let refresh = server
            .mock("POST", "/v1/common/auth/refresh")
            .with_status(200)
            .with_body(rotation_payload("access-2", "tok-2"))
            .create_async()
            .await;

        seed_online_project("TestProj", &server.url()).await;
        storage::save_fallback("TestProj", "Steve", "refresh_token", "tok-1")
            .expect("сохранение токена");
        let state = state("TestProj", true, "access-1");
        let attempts = AtomicUsize::new(0);

        let result = with_session_retry(&state, || async {
            if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                Err(unauthorized())
            } else {
                Ok("done")
            }
        })
        .await
        .expect("ретрай после восстановления сессии");

        refresh.assert_async().await;
        assert_eq!(result, "done");
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(
            state
                .lock()
                .await
                .session
                .as_ref()
                .expect("сессия")
                .access_token,
            "access-2",
            "токен сессии должен обновиться после restore"
        );

        wipe_project_credentials("TestProj", &["Steve".to_string()])
            .await
            .expect("очистка хранилища после теста");
    }
}

#[cfg(test)]
mod fetch_project_config_tests {
    use super::fetch_project_config;
    use crate::utils::errors::LauncherError;
    use crate::utils::install_id::LAUNCHER_ID_HEADER;
    use mockito::Server;

    fn config_body(project_name: &str) -> String {
        format!(
            r#"{{"projectName":"{project_name}","mcVersion":"1.20.1","modLoader":"vanilla",
                "loaderVersion":null,"javaPath":null,"jvmArgs":[],
                "minMemory":"-Xms512M","maxMemory":"-Xmx4G"}}"#
        )
    }

    fn launcher_server_error(error: &anyhow::Error) -> Option<&LauncherError> {
        error
            .chain()
            .find_map(|cause| cause.downcast_ref::<LauncherError>())
            .and_then(|e| match e {
                LauncherError::LauncherServer(_) => Some(e),
                _ => None,
            })
    }

    #[tokio::test]
    async fn parses_server_config_with_launcher_id_header() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/config")
            .match_header(LAUNCHER_ID_HEADER, mockito::Matcher::Any)
            .with_status(200)
            .with_body(config_body("TestProj"))
            .create_async()
            .await;

        let config = fetch_project_config(&server.url())
            .await
            .expect("валидный конфиг должен разбираться");

        assert_eq!(config.project_name, "TestProj");
        assert_eq!(config.mc_version, "1.20.1");
        assert_eq!(config.min_memory, "-Xms512M");
    }

    #[tokio::test]
    async fn http_error_is_classified_with_status_in_message() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/config")
            .with_status(503)
            .with_body("maintenance")
            .create_async()
            .await;

        let error = fetch_project_config(&server.url())
            .await
            .expect_err("ошибка сервера должна пробрасываться");

        assert!(
            launcher_server_error(&error).is_some(),
            "ожидается LauncherServer: {error:#}"
        );
        assert!(
            error.to_string().contains("503"),
            "сообщение должно называть статус: {error:#}"
        );
    }

    #[tokio::test]
    async fn unparseable_body_is_classified_as_launcher_server() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body("<html>not json</html>")
            .create_async()
            .await;

        let error = fetch_project_config(&server.url())
            .await
            .expect_err("мусор вместо JSON должен отклоняться");

        assert!(
            launcher_server_error(&error).is_some(),
            "ожидается LauncherServer: {error:#}"
        );
    }

    #[tokio::test]
    async fn missing_project_name_is_rejected() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body(config_body(""))
            .create_async()
            .await;

        let error = fetch_project_config(&server.url())
            .await
            .expect_err("конфиг без названия проекта должен отклоняться");

        assert!(
            error.to_string().contains("не вернул название проекта"),
            "сообщение должно объяснять причину: {error:#}"
        );
        assert!(
            launcher_server_error(&error).is_some(),
            "ожидается LauncherServer: {error:#}"
        );
    }
}
