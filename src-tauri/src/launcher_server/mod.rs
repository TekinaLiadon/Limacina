pub mod downloader;
pub mod user_content;

use anyhow::{Context, Result};
use tokio::sync::Mutex;

use crate::state::dto::GlobalState;
use crate::utils::errors::LauncherError;

pub(crate) async fn api_context(
    state: &Mutex<GlobalState>,
    _auth_error: &str,
) -> Result<(String, String)> {
    let guard = state.lock().await;
    let token = guard
        .session
        .as_ref()
        .ok_or(LauncherError::NoSession)
        .context("Не удалось подготовить контекст запроса к лаунчер-серверу")?
        .access_token
        .clone();
    let server_url = guard
        .project_config
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing)?;
    Ok((token, server_url))
}
