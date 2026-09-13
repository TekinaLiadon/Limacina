use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::log_info;
use crate::state::dto::GlobalState;
use crate::utils::http::{request_json, require_success};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserContentItem {
    pub id: Option<i64>,
    pub url: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub active: bool,
}

async fn require_api_context(state: &Mutex<GlobalState>) -> Result<(String, String)> {
    crate::launcher_server::api_context(state, "Нет активной сессии. Войдите в аккаунт.").await
}

async fn api_get_json<T: serde::de::DeserializeOwned>(url: &str, token: &str) -> Result<T> {
    request_json(
        crate::utils::http::http_client()
            .get(url)
            .bearer_auth(token),
        "Не удалось подключиться к серверу",
        "Не удалось распарсить ответ сервера",
    )
    .await
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

async fn upload_multipart(
    url: &str,
    token: &str,
    file_data: Vec<u8>,
    file_name: &str,
    mime: &str,
    send_context: &'static str,
    parse_context: &'static str,
) -> Result<UserContentItem> {
    let part = reqwest::multipart::Part::bytes(file_data)
        .file_name(file_name.to_string())
        .mime_str(mime)
        .context("Не удалось создать multipart part")?;

    let form = reqwest::multipart::Form::new().part("file", part);

    let client = crate::utils::http::http_client();
    let response = require_success(
        client
            .post(url)
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await
            .context(send_context)?,
    )
    .await?;

    let item: UserContentItem = response.json().await.context(parse_context)?;
    Ok(item)
}

pub async fn upload_skin(
    state: &Mutex<GlobalState>,
    file_data: Vec<u8>,
    model: Option<&str>,
) -> Result<UserContentItem> {
    let (token, server_url) = require_api_context(state).await?;
    let mut url = format!("{}/v1/common/content/skins", server_url);
    if let Some(model) = model {
        url.push_str("?model=");
        url.push_str(model);
    }

    let item = upload_multipart(
        &url,
        &token,
        file_data,
        "skin.png",
        "image/png",
        "Не удалось загрузить скин",
        "Не удалось распарсить ответ загрузки скина",
    )
    .await?;

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

pub async fn set_active_skin(state: &Mutex<GlobalState>, id: i64) -> Result<()> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/skins/active", server_url);

    let client = crate::utils::http::http_client();
    let response = require_success(
        client
            .patch(&url)
            .bearer_auth(&token)
            .json(&serde_json::json!({ "id": id }))
            .send()
            .await
            .context("Не удалось подключиться к серверу")?,
    )
    .await?;

    let _ = response;
    log_info!("Активный скин изменён: id={}", id);

    Ok(())
}

pub async fn upload_model(
    state: &Mutex<GlobalState>,
    file_content: String,
) -> Result<UserContentItem> {
    let (token, server_url) = require_api_context(state).await?;
    let url = format!("{}/v1/common/content/models", server_url);

    let item = upload_multipart(
        &url,
        &token,
        file_content.into_bytes(),
        "model.txt",
        "text/plain",
        "Не удалось загрузить модель",
        "Не удалось распарсить ответ загрузки модели",
    )
    .await?;

    log_info!("Модель загружена: {:?}", item.url);

    Ok(item)
}

pub async fn list_models(state: &Mutex<GlobalState>, uuid: String) -> Result<Vec<UserContentItem>> {
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
