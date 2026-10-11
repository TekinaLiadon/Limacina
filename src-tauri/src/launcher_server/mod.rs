pub mod downloader;
pub mod user_content;

use anyhow::Result;
use std::future::Future;
use tokio::sync::Mutex;

use crate::log_info;
use crate::state::dto::GlobalState;
use crate::utils::errors::LauncherError;

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
            log_info!("Сервер вернул 401: восстанавливаем сессию «{username}» и повторяем запрос");
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
