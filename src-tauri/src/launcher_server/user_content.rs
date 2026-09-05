use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::log_info;
use crate::state::dto::GlobalState;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserContentItem {
    pub id: Option<i64>,
    pub url: String,
}


async fn require_api_context(state: &Mutex<GlobalState>) -> Result<(String, String)> {
    let state = state.lock().await;
    let token = state
        .session
        .as_ref()
        .map(|s| s.access_token.clone())
        .context("Нет активной сессии. Войдите в аккаунт.")?;
    Ok((token, state.project_config.resolved_server_url()))
}

async fn require_success(response: reqwest::Response) -> Result<reqwest::Response> {
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

async fn api_get_json<T: serde::de::DeserializeOwned>(url: &str, token: &str) -> Result<T> {
    let client = crate::utils::http::http_client();
    let response = require_success(
        client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .context("Не удалось подключиться к серверу")?,
    )
    .await?;

    response
        .json()
        .await
        .context("Не удалось распарсить ответ сервера")
}

async fn api_delete(url: &str, token: &str) -> Result<()> {
    let client = crate::utils::http::http_client();
    let response = require_success(
        client
            .delete(url)
            .bearer_auth(token)
            .send()
            .await
            .context("Не удалось подключиться к серверу")?,
    )
    .await?;

    let _ = response;
    Ok(())
}

pub async fn upload_skin(state: &Mutex<GlobalState>, file_data: Vec<u8>) -> Result<UserContentItem> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/skins", server_url);

    let part = reqwest::multipart::Part::bytes(file_data)
        .file_name("skin.png")
        .mime_str("image/png")
        .context("Не удалось создать multipart part")?;

    let form = reqwest::multipart::Form::new().part("file", part);

    let client = crate::utils::http::http_client();
    let response = require_success(
        client
            .post(&url)
            .bearer_auth(&token)
            .multipart(form)
            .send()
            .await
            .context("Не удалось загрузить скин")?,
    )
    .await?;

    let item: UserContentItem = response
        .json()
        .await
        .context("Не удалось распарсить ответ загрузки скина")?;

    log_info!("Скин загружен: {:?}", item.url);

    Ok(item)
}

pub async fn list_skins(state: &Mutex<GlobalState>, uuid: String) -> Result<Vec<UserContentItem>> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/skins/{}", server_url, uuid);

    let items: Vec<UserContentItem> = api_get_json(&url, &token).await?;
    Ok(items)
}

pub async fn delete_skin(state: &Mutex<GlobalState>, id: i64) -> Result<()> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/skins/{}", server_url, id);

    api_delete(&url, &token).await?;
    log_info!("Скин удалён: id={}", id);

    Ok(())
}

pub async fn upload_model(
    state: &Mutex<GlobalState>,
    file_content: String,
) -> Result<UserContentItem> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/models", server_url);

    let part = reqwest::multipart::Part::bytes(file_content.into_bytes())
        .file_name("model.txt")
        .mime_str("text/plain")
        .context("Не удалось создать multipart part")?;

    let form = reqwest::multipart::Form::new().part("file", part);

    let client = crate::utils::http::http_client();
    let response = require_success(
        client
            .post(&url)
            .bearer_auth(&token)
            .multipart(form)
            .send()
            .await
            .context("Не удалось загрузить модель")?,
    )
    .await?;

    let item: UserContentItem = response
        .json()
        .await
        .context("Не удалось распарсить ответ загрузки модели")?;

    log_info!("Модель загружена: {:?}", item.url);

    Ok(item)
}

pub async fn list_models(
    state: &Mutex<GlobalState>,
    uuid: String,
) -> Result<Vec<UserContentItem>> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/models/{}", server_url, uuid);

    let items: Vec<UserContentItem> = api_get_json(&url, &token).await?;
    Ok(items)
}

pub async fn delete_model(state: &Mutex<GlobalState>, id: i64) -> Result<()> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/models/{}", server_url, id);

    api_delete(&url, &token).await?;
    log_info!("Модель удалёна: id={}", id);

    Ok(())
}
