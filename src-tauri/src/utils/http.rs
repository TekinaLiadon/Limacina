use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

pub fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("Не удалось создать HTTP клиент")
    })
}

pub(crate) async fn require_success(response: reqwest::Response) -> Result<reqwest::Response> {
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or(text);
        anyhow::bail!("{}", message);
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
        .with_context(|| connect_context.to_string())?;
    let response = require_success(response).await?;
    response
        .json()
        .await
        .with_context(|| parse_context.to_string())
}
