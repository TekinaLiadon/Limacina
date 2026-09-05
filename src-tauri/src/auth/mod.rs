pub mod storage;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AuthProfile {
    pub uuid: String,
    pub username: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AuthData {
    pub tokens: AuthTokens,
    #[serde(default)]
    pub profile: Option<AuthProfile>,
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

impl AuthData {
    pub fn uuid(&self) -> String {
        self.profile
            .as_ref()
            .map(|p| p.uuid.clone())
            .or_else(|| self.uuid.clone())
            .unwrap_or_default()
    }

    pub fn username(&self, fallback: &str) -> String {
        self.profile
            .as_ref()
            .map(|p| p.username.clone())
            .or_else(|| self.username.clone())
            .unwrap_or_else(|| fallback.to_string())
    }
}

#[derive(serde::Serialize)]
struct AuthLoginRequest {
    username: String,
    password: String,
}

#[derive(serde::Serialize)]
struct AuthRefreshRequest {
    refresh_token: String,
}

#[derive(serde::Serialize)]
struct AuthChangePasswordRequest {
    old_password: String,
    new_password: String,
}


pub const OFFLINE_ACCESS_TOKEN: &str = "0";


pub fn offline(username: &str) -> AuthData {
    AuthData {
        tokens: AuthTokens {
            access_token: OFFLINE_ACCESS_TOKEN.to_string(),
            refresh_token: String::new(),
        },
        profile: None,
        uuid: Some(crate::minecraft::mod_loader::utils::generate_offline_uuid(username)),
        username: Some(username.to_string()),
        role: None,
    }
}

pub async fn register(server_url: &str, username: &str, password: &str) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/registration", server_url);

    let client = crate::utils::http::http_client();
    let body = AuthLoginRequest {
        username: username.to_string(),
        password: password.to_string(),
    };

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .context("Не удалось подключиться к серверу авторизации")?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or(body);
        anyhow::bail!("{}", message);
    }

    let auth_data: AuthData = response
        .json()
        .await
        .context("Не удалось распарсить ответ авторизации")?;

    Ok(auth_data)
}

pub async fn change_password(
    server_url: &str,
    access_token: &str,
    old_password: &str,
    new_password: &str,
) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/password", server_url);

    let client = crate::utils::http::http_client();
    let body = AuthChangePasswordRequest {
        old_password: old_password.to_string(),
        new_password: new_password.to_string(),
    };

    let response = client
        .patch(&url)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .context("Не удалось подключиться к серверу авторизации")?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or(body);
        anyhow::bail!("{}", message);
    }

    let auth_data: AuthData = response
        .json()
        .await
        .context("Не удалось распарсить ответ смены пароля")?;

    Ok(auth_data)
}

pub async fn login(server_url: &str, username: &str, password: &str) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/login", server_url);

    let client = crate::utils::http::http_client();
    let body = AuthLoginRequest {
        username: username.to_string(),
        password: password.to_string(),
    };

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .context("Не удалось подключиться к серверу авторизации")?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or(body);
        anyhow::bail!("{}", message);
    }

    let auth_data: AuthData = response
        .json()
        .await
        .context("Не удалось распарсить ответ авторизации")?;

    Ok(auth_data)
}

pub async fn refresh(server_url: &str, refresh_token: &str) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/refresh", server_url);

    let client = crate::utils::http::http_client();
    let body = AuthRefreshRequest {
        refresh_token: refresh_token.to_string(),
    };

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .context("Не удалось подключиться к серверу авторизации")?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or(body);
        anyhow::bail!("{}", message);
    }

    let auth_data: AuthData = response
        .json()
        .await
        .context("Не удалось распарсить ответ авторизации")?;

    Ok(auth_data)
}
