pub mod storage;

use anyhow::{Context, Result};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use uuid::{Builder, Variant, Version};

use crate::{
    log_info,
    utils::errors::LauncherError,
    utils::http::{http_client, request_json, with_launcher_id},
};

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
struct AuthInvalidateRequest {
    refresh_token: String,
}

#[derive(serde::Serialize)]
struct AuthChangePasswordRequest {
    old_password: String,
    new_password: String,
}

pub const OFFLINE_ACCESS_TOKEN: &str = "0";

pub fn generate_offline_uuid(nickname: &str) -> String {
    log_info!("Генерация офлайн uuid");
    let data = format!("OfflinePlayer:{}", nickname);

    let hash = Md5::digest(data.as_bytes());

    let mut builder = Builder::from_bytes(hash.into());

    builder
        .set_variant(Variant::RFC4122)
        .set_version(Version::Md5);

    builder.into_uuid().to_string().replace("-", "")
}

pub fn offline(username: &str) -> AuthData {
    AuthData {
        tokens: AuthTokens {
            access_token: OFFLINE_ACCESS_TOKEN.to_string(),
            refresh_token: String::new(),
        },
        profile: None,
        uuid: Some(generate_offline_uuid(username)),
        username: Some(username.to_string()),
        role: None,
    }
}

pub async fn register(server_url: &str, username: &str, password: &str) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/registration", server_url);
    let body = AuthLoginRequest {
        username: username.to_string(),
        password: password.to_string(),
    };

    LauncherError::classify(
        request_json(
            with_launcher_id(http_client().post(&url).json(&body)),
            "Не удалось подключиться к серверу авторизации",
            "Не удалось распарсить ответ авторизации",
        )
        .await,
        LauncherError::AuthServer,
    )
}

pub async fn change_password(
    server_url: &str,
    access_token: &str,
    old_password: &str,
    new_password: &str,
) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/password", server_url);
    let body = AuthChangePasswordRequest {
        old_password: old_password.to_string(),
        new_password: new_password.to_string(),
    };

    LauncherError::classify(
        request_json(
            with_launcher_id(
                http_client()
                    .patch(&url)
                    .bearer_auth(access_token)
                    .json(&body),
            ),
            "Не удалось подключиться к серверу авторизации",
            "Не удалось распарсить ответ смены пароля",
        )
        .await,
        LauncherError::AuthServer,
    )
}

pub async fn login(server_url: &str, username: &str, password: &str) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/login", server_url);
    let body = AuthLoginRequest {
        username: username.to_string(),
        password: password.to_string(),
    };

    LauncherError::classify(
        request_json(
            with_launcher_id(http_client().post(&url).json(&body)),
            "Не удалось подключиться к серверу авторизации",
            "Не удалось распарсить ответ авторизации",
        )
        .await,
        LauncherError::AuthServer,
    )
}

pub async fn refresh(server_url: &str, refresh_token: &str) -> Result<AuthData> {
    let url = format!("{}/v1/common/auth/refresh", server_url);
    let body = AuthRefreshRequest {
        refresh_token: refresh_token.to_string(),
    };

    request_json(
        with_launcher_id(http_client().post(&url).json(&body)),
        "Не удалось подключиться к серверу авторизации",
        "Не удалось распарсить ответ авторизации",
    )
    .await
}

pub async fn invalidate(server_url: &str, refresh_token: &str) -> Result<()> {
    let url = format!("{}/v1/common/auth/invalidate", server_url);

    let client = crate::utils::http::http_client();
    let body = AuthInvalidateRequest {
        refresh_token: refresh_token.to_string(),
    };

    let result = async {
        let response = with_launcher_id(client.post(&url).json(&body))
            .send()
            .await
            .context("Не удалось подключиться к серверу авторизации")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Вернул {} при инвалидации токена: {}", status, body);
        }

        Ok(())
    }
    .await;

    LauncherError::classify(result, LauncherError::AuthServer)
}

#[cfg(test)]
mod auth_http_tests {
    use super::*;
    use mockito::{Matcher, Server};
    use serde_json::json;

    fn auth_payload() -> serde_json::Value {
        json!({
            "tokens": { "access_token": "access-1", "refresh_token": "refresh-1" },
            "profile": { "uuid": "uuid-1", "username": "Cordelia" }
        })
    }

    #[tokio::test]
    async fn login_sends_credentials_and_parses_auth_data() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/common/auth/login")
            .match_body(Matcher::PartialJsonString(
                json!({"username": "Cordelia", "password": "secret"}).to_string(),
            ))
            .with_status(200)
            .with_body(auth_payload().to_string())
            .create_async()
            .await;

        let data = login(&server.url(), "Cordelia", "secret")
            .await
            .expect("логин");

        assert_eq!(data.tokens.access_token, "access-1");
        assert_eq!(data.tokens.refresh_token, "refresh-1");
        assert_eq!(data.uuid(), "uuid-1");
        assert_eq!(data.username("fallback"), "Cordelia");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn login_sends_launcher_id_header() {
        crate::utils::install_id::override_install_id_for_tests("test-install-id");

        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/common/auth/login")
            .match_header("x-launcher-id", "test-install-id")
            .with_status(200)
            .with_body(auth_payload().to_string())
            .create_async()
            .await;

        login(&server.url(), "Cordelia", "secret")
            .await
            .expect("логин");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn login_error_returns_server_message() {
        let mut server = Server::new_async().await;
        server
            .mock("POST", "/v1/common/auth/login")
            .with_status(401)
            .with_body(json!({"message": "Неверный пароль"}).to_string())
            .create_async()
            .await;

        let error = login(&server.url(), "Cordelia", "wrong")
            .await
            .expect_err("должна быть ошибка");
        assert!(error.to_string().contains("Неверный пароль"), "{}", error);
    }

    #[tokio::test]
    async fn refresh_sends_refresh_token_and_parses_auth_data() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/common/auth/refresh")
            .match_body(Matcher::JsonString(
                json!({"refresh_token": "refresh-1"}).to_string(),
            ))
            .with_status(200)
            .with_body(auth_payload().to_string())
            .create_async()
            .await;

        let data = refresh(&server.url(), "refresh-1")
            .await
            .expect("обновление сессии");

        assert_eq!(data.tokens.access_token, "access-1");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn register_parses_auth_data() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/common/auth/registration")
            .match_body(Matcher::PartialJsonString(
                json!({"username": "NewUser", "password": "pass"}).to_string(),
            ))
            .with_status(200)
            .with_body(auth_payload().to_string())
            .create_async()
            .await;

        let data = register(&server.url(), "NewUser", "pass")
            .await
            .expect("регистрация");

        assert_eq!(data.username("fallback"), "Cordelia");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn change_password_sends_bearer_and_passwords() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("PATCH", "/v1/common/auth/password")
            .match_header("authorization", "Bearer access-1")
            .match_body(Matcher::PartialJsonString(
                json!({"old_password": "old-pass", "new_password": "new-pass"}).to_string(),
            ))
            .with_status(200)
            .with_body(auth_payload().to_string())
            .create_async()
            .await;

        let data = change_password(&server.url(), "access-1", "old-pass", "new-pass")
            .await
            .expect("смена пароля");

        assert_eq!(data.tokens.access_token, "access-1");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn invalidate_error_propagates_status() {
        let mut server = Server::new_async().await;
        server
            .mock("POST", "/v1/common/auth/invalidate")
            .with_status(500)
            .with_body("boom")
            .create_async()
            .await;

        let error = invalidate(&server.url(), "refresh-1")
            .await
            .expect_err("должна быть ошибка");
        assert!(error.to_string().contains("500"), "{}", error);
    }
}
