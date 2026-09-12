pub mod downloader;
pub mod user_content;

use anyhow::{Context, Result};
use tokio::sync::Mutex;

use crate::state::dto::GlobalState;

pub(crate) async fn api_context(
    state: &Mutex<GlobalState>,
    auth_error: &str,
) -> Result<(String, String)> {
    let guard = state.lock().await;
    let token = guard
        .session
        .as_ref()
        .with_context(|| auth_error.to_string())?
        .access_token
        .clone();
    Ok((token, guard.project_config.resolved_server_url()))
}
