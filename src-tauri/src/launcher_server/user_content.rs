use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::log_info;
use crate::state::dto::GlobalState;
use crate::utils::errors::LauncherError;
use crate::utils::http::{request_json, require_success, with_launcher_id};
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

async fn api_get_json<T: serde::de::DeserializeOwned>(url: &str, token: &str) -> Result<T> {
    LauncherError::classify(
        request_json(
            with_launcher_id(
                crate::utils::http::http_client()
                    .get(url)
                    .bearer_auth(token),
            ),
            "Не удалось подключиться к серверу",
            "Не удалось распарсить ответ сервера",
        )
        .await,
        LauncherError::LauncherServer,
    )
}

async fn api_delete(url: &str, token: &str) -> Result<()> {
    let result = async {
        let client = crate::utils::http::http_client();
        let response = require_success(
            with_launcher_id(client.delete(url).bearer_auth(token))
                .send()
                .await
                .map_err(|e| {
                    LauncherError::LauncherServer(format!(
                        "Не удалось подключиться к серверу: {e:#}"
                    ))
                })?,
        )
        .await?;

        let _ = response;
        Ok(())
    }
    .await;

    LauncherError::classify(result, LauncherError::LauncherServer)
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
    let result = async {
        let part = reqwest::multipart::Part::bytes(file_data)
            .file_name(file_name.to_string())
            .mime_str(mime)
            .map_err(|e| {
                LauncherError::LauncherServer(format!("Не удалось создать multipart part: {e:#}"))
            })?;

        let form = reqwest::multipart::Form::new().part("file", part);

        let client = crate::utils::http::http_client();
        let response = require_success(
            with_launcher_id(client.post(url).bearer_auth(token).multipart(form))
                .send()
                .await
                .map_err(|e| LauncherError::LauncherServer(format!("{send_context}: {e:#}")))?,
        )
        .await?;

        let item: UserContentItem = response
            .json()
            .await
            .map_err(|e| LauncherError::LauncherServer(format!("{parse_context}: {e:#}")))?;
        Ok(item)
    }
    .await;

    LauncherError::classify(result, LauncherError::LauncherServer)
}

pub async fn upload_skin(
    state: &Mutex<GlobalState>,
    file_data: Vec<u8>,
    model: Option<&str>,
) -> Result<UserContentItem> {
    let (token, server_url) = crate::launcher_server::api_context(state).await?;
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
    let (token, server_url) = crate::launcher_server::api_context(state).await?;
    let url = format!("{}/v1/common/content/skins/{}", server_url, uuid);

    let items: Vec<UserContentItem> = api_get_json(&url, &token).await?;
    Ok(items)
}

pub async fn delete_skin(state: &Mutex<GlobalState>, id: i64) -> Result<()> {
    let (token, server_url) = crate::launcher_server::api_context(state).await?;
    let url = format!("{}/v1/common/content/skins/{}", server_url, id);

    api_delete(&url, &token).await?;
    log_info!("Скин удалён: id={}", id);

    Ok(())
}

pub async fn set_active_skin(state: &Mutex<GlobalState>, id: i64) -> Result<()> {
    let (token, server_url) = crate::launcher_server::api_context(state).await?;
    let url = format!("{}/v1/common/content/skins/active", server_url);

    let result = async {
        let client = crate::utils::http::http_client();
        let response = require_success(
            with_launcher_id(
                client
                    .patch(&url)
                    .bearer_auth(&token)
                    .json(&serde_json::json!({ "id": id })),
            )
            .send()
            .await
            .map_err(|e| {
                LauncherError::LauncherServer(format!("Не удалось подключиться к серверу: {e:#}"))
            })?,
        )
        .await?;

        let _ = response;
        log_info!("Активный скин изменён: id={}", id);

        Ok(())
    }
    .await;

    LauncherError::classify(result, LauncherError::LauncherServer)
}

pub async fn upload_model(
    state: &Mutex<GlobalState>,
    file_content: String,
) -> Result<UserContentItem> {
    let (token, server_url) = crate::launcher_server::api_context(state).await?;
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
    let (token, server_url) = crate::launcher_server::api_context(state).await?;
    let url = format!("{}/v1/common/content/models/{}", server_url, uuid);

    let items: Vec<UserContentItem> = api_get_json(&url, &token).await?;
    Ok(items)
}

pub async fn delete_model(state: &Mutex<GlobalState>, id: i64) -> Result<()> {
    let (token, server_url) = crate::launcher_server::api_context(state).await?;
    let url = format!("{}/v1/common/content/models/{}", server_url, id);

    api_delete(&url, &token).await?;
    log_info!("Модель удалёна: id={}", id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::dto::{ProjectConfig, SessionTokens};
    use mockito::Server;

    fn state_with(server_url: &str) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                server_url: Some(server_url.to_string()),
                ..ProjectConfig::default()
            },
            session: Some(SessionTokens {
                access_token: "token-1".to_string(),
                uuid: "uuid-1".to_string(),
                username: "Cordelia".to_string(),
                project_name: "Proj".to_string(),
            }),
            ..GlobalState::default()
        })
    }

    #[tokio::test]
    async fn delete_skin_sends_delete_request() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("DELETE", "/v1/common/content/skins/42")
            .match_header("authorization", "Bearer token-1")
            .with_status(200)
            .create_async()
            .await;

        let state = state_with(&server.url());
        delete_skin(&state, 42)
            .await
            .expect("удаление скина должно пройти");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn delete_model_sends_delete_request() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("DELETE", "/v1/common/content/models/7")
            .match_header("authorization", "Bearer token-1")
            .with_status(200)
            .create_async()
            .await;

        let state = state_with(&server.url());
        delete_model(&state, 7)
            .await
            .expect("удаление модели должно пройти");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn delete_skin_errors_on_non_success_status() {
        let mut server = Server::new_async().await;
        server
            .mock("DELETE", "/v1/common/content/skins/42")
            .with_status(500)
            .create_async()
            .await;

        let state = state_with(&server.url());
        let result = delete_skin(&state, 42).await;

        assert!(result.is_err(), "не-2xx ответ должен вернуть ошибку");
    }
}
