use anyhow::Result;
use serde::de::DeserializeOwned;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{Client, ClientBuilder};

use crate::utils::errors::LauncherError;
use crate::utils::install_id::{install_id, LAUNCHER_ID_HEADER};

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

const READ_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn base_client_builder() -> ClientBuilder {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(READ_TIMEOUT)
}

pub fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        base_client_builder()
            .build()
            .expect("Не удалось создать HTTP клиент")
    })
}

pub(crate) fn with_launcher_id(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match install_id() {
        Some(id) => request.header(LAUNCHER_ID_HEADER, id),
        None => request,
    }
}

pub(crate) async fn require_success(response: reqwest::Response) -> Result<reqwest::Response> {
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or(text);
        return Err(LauncherError::HttpStatus { status, message }.into());
    }
    Ok(response)
}

pub(crate) async fn request_json<T: DeserializeOwned>(
    request: reqwest::RequestBuilder,
    connect_context: &str,
    parse_context: &str,
) -> Result<T> {
    let response = request
        .send()
        .await
        .map_err(|e| LauncherError::Http(format!("{connect_context}: {e:#}")))?;
    let response = require_success(response).await?;
    let parsed: T = response
        .json()
        .await
        .map_err(|e| LauncherError::Http(format!("{parse_context}: {e:#}")))?;
    Ok(parsed)
}
