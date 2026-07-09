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

#[derive(serde::Serialize)]
struct AuthLoginRequest {
    username: String,
    password: String,
}

#[derive(serde::Serialize)]
struct AuthRefreshRequest {
    refresh_token: String,
}

pub async fn register(username: &str, password: &str) -> Result<AuthData> {
    let server_url = env!("LAUNCHER_SERVER_URL");
    let url = format!("{}/auth/registration", server_url);

    let client = reqwest::Client::new();
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
        .context("Не удалось распарсить ответ регистрации")?;

    Ok(auth_data)
}

pub async fn login(username: &str, password: &str) -> Result<AuthData> {
    let server_url = env!("LAUNCHER_SERVER_URL");
    let url = format!("{}/auth/login", server_url);

    let client = reqwest::Client::new();
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

pub async fn refresh(refresh_token: &str) -> Result<AuthData> {
    let server_url = env!("LAUNCHER_SERVER_URL");
    let url = format!("{}/auth/refresh", server_url);

    let client = reqwest::Client::new();
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
