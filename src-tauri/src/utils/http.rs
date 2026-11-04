use anyhow::Result;
use serde::de::DeserializeOwned;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{Client, ClientBuilder};

use crate::utils::errors::LauncherError;
use crate::utils::install_id::{install_id, LAUNCHER_ID_HEADER};

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

pub const USER_AGENT: &str = concat!(
    "TekinaLiadon/Limacina/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/TekinaLiadon/Limacina)"
);

const READ_TIMEOUT: Duration = Duration::from_secs(30);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub(crate) fn base_client_builder() -> ClientBuilder {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(READ_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .user_agent(USER_AGENT)
}

pub fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        base_client_builder()
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

pub(crate) fn with_launcher_id(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match install_id() {
        Some(id) => request.header(LAUNCHER_ID_HEADER, id),
        None => request,
    }
}

const ERROR_BODY_LIMIT: usize = 256;
const ERROR_BODY_READ_LIMIT: u64 = 64 * 1024;

pub(crate) fn bounded_error_body(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= ERROR_BODY_LIMIT {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(ERROR_BODY_LIMIT).collect();
    format!("{cut}…")
}

pub(crate) async fn read_body_capped(
    mut response: reqwest::Response,
    url: &str,
    max_bytes: u64,
) -> Result<Vec<u8>> {
    if let Some(length) = response.content_length() {
        if length > max_bytes {
            return Err(LauncherError::SizeLimit(format!(
                "{url}: размер тела ответа {length} байт, ожидалось не более {max_bytes}"
            ))
            .into());
        }
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| LauncherError::Http(format!("Не удалось прочитать ответ от {url}: {e:#}")))?
    {
        let total = body.len() as u64 + chunk.len() as u64;
        if total > max_bytes {
            return Err(LauncherError::SizeLimit(format!(
                "{url}: получено {total} байт, ожидалось не более {max_bytes}"
            ))
            .into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub(crate) async fn read_error_body_text(response: reqwest::Response, url: &str) -> String {
    match read_body_capped(response, url, ERROR_BODY_READ_LIMIT).await {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) => format!("(тело ответа не прочитано: {e})"),
    }
}

pub(crate) async fn require_success(response: reqwest::Response) -> Result<reqwest::Response> {
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = read_error_body_text(response, "ответ сервера").await;
        let message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .map(|m| bounded_error_body(&m))
            .unwrap_or_else(|| bounded_error_body(&text));
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

#[cfg(test)]
mod tests {
    use super::{bounded_error_body, http_client, read_body_capped, request_json, require_success};
    use crate::utils::errors::LauncherError;
    use mockito::Server;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Payload {
        value: u32,
    }

    #[tokio::test]
    async fn request_json_parses_success_body() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/data")
            .with_status(200)
            .with_body(r#"{"value": 7}"#)
            .create_async()
            .await;

        let payload: Payload = request_json(
            http_client().get(format!("{}/data", server.url())),
            "Не удалось подключиться",
            "Не удалось разобрать ответ",
        )
        .await
        .expect("успешный JSON разбирается");

        assert_eq!(payload, Payload { value: 7 });
    }

    #[tokio::test]
    async fn request_json_reports_connect_failure_with_context() {
        let error = request_json::<Payload>(
            http_client().get("http://127.0.0.1:1/data"),
            "Не удалось подключиться",
            "Не удалось разобрать ответ",
        )
        .await
        .expect_err("недоступный сервер должен давать ошибку");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::Http(_))
            ),
            "ожидается Http: {error:#}"
        );
        assert!(
            error.to_string().contains("Не удалось подключиться"),
            "ошибка должна нести connect-контекст: {error}"
        );
    }

    #[tokio::test]
    async fn request_json_propagates_http_status() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/data")
            .with_status(503)
            .with_body(r#"{"message": "техработы"}"#)
            .create_async()
            .await;

        let error = request_json::<Payload>(
            http_client().get(format!("{}/data", server.url())),
            "Не удалось подключиться",
            "Не удалось разобрать ответ",
        )
        .await
        .expect_err("некорректный статус должен давать ошибку");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::HttpStatus { status: 503, .. })
            ),
            "ожидается HttpStatus 503: {error:#}"
        );
        assert!(
            error.to_string().contains("техработы"),
            "ошибка должна нести сообщение сервера: {error}"
        );
    }

    #[tokio::test]
    async fn request_json_reports_parse_failure_with_context() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/data")
            .with_status(200)
            .with_body("не json")
            .create_async()
            .await;

        let error = request_json::<Payload>(
            http_client().get(format!("{}/data", server.url())),
            "Не удалось подключиться",
            "Не удалось разобрать ответ",
        )
        .await
        .expect_err("некорректный JSON должен давать ошибку");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::Http(_))
            ),
            "ожидается Http: {error:#}"
        );
        assert!(
            error.to_string().contains("Не удалось разобрать ответ"),
            "ошибка должна нести parse-контекст: {error}"
        );
    }

    #[test]
    fn bounded_error_body_keeps_short_text() {
        assert_eq!(bounded_error_body("boom"), "boom");
        assert_eq!(bounded_error_body("  boom  \n"), "boom");
    }

    #[test]
    fn bounded_error_body_truncates_long_text() {
        let text = "ж".repeat(1000);
        let bounded = bounded_error_body(&text);
        assert_eq!(bounded.chars().count(), 257, "256 символов плюс многоточие");
        assert!(bounded.starts_with("ж"));
        assert!(bounded.ends_with('…'));
        assert!(!bounded.contains(&text), "тело не должно попадать целиком");
    }

    async fn get_error(status: usize, body: String) -> anyhow::Error {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/")
            .with_status(status)
            .with_body(body)
            .create_async()
            .await;

        let response = http_client().get(server.url()).send().await.expect("ответ");
        require_success(response)
            .await
            .expect_err("неуспешный статус должен давать ошибку")
    }

    #[tokio::test]
    async fn require_success_bounds_reflected_body() {
        let padding = "x".repeat(4096);
        let error = get_error(502, format!("refresh_token=leaked-{padding}")).await;
        let message = error.to_string();

        assert!(
            !message.contains(&padding),
            "тело ответа не должно попадать в ошибку целиком: {message}"
        );
        assert!(
            message.contains("refresh_token=leaked-"),
            "начало тела должно сохраняться для понятности: {message}"
        );
    }

    #[tokio::test]
    async fn require_success_bounds_long_server_message() {
        let message = "м".repeat(4096);
        let error = get_error(500, serde_json::json!({ "message": message }).to_string()).await;
        let rendered = error.to_string();

        assert!(
            !rendered.contains(&message),
            "серверное сообщение не должно попадать в ошибку целиком: {rendered}"
        );
        assert!(
            rendered.chars().count() < 300,
            "сообщение должно быть ограничено: {rendered}"
        );
    }

    #[tokio::test]
    async fn require_success_keeps_short_server_message() {
        let error = get_error(
            404,
            serde_json::json!({ "message": "Ничего не найдено" }).to_string(),
        )
        .await;

        assert_eq!(error.to_string(), "Ничего не найдено");
    }

    #[tokio::test]
    async fn read_body_capped_accepts_body_at_limit() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/at-limit")
            .with_status(200)
            .with_body("x".repeat(1024))
            .create_async()
            .await;

        let response = http_client()
            .get(format!("{}/at-limit", server.url()))
            .send()
            .await
            .expect("ответ");
        let body = read_body_capped(response, &server.url(), 1024)
            .await
            .expect("тело ровно на лимите читается");

        assert_eq!(body.len(), 1024);
    }

    #[tokio::test]
    async fn read_body_capped_rejects_oversized_body() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/over-limit")
            .with_status(200)
            .with_body("x".repeat(4096))
            .create_async()
            .await;

        let response = http_client()
            .get(format!("{}/over-limit", server.url()))
            .send()
            .await
            .expect("ответ");
        let error = read_body_capped(response, &server.url(), 1024)
            .await
            .expect_err("тело сверх лимита должно отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::SizeLimit(_))
            ),
            "ожидался SizeLimit: {error}"
        );
        assert!(
            error.to_string().contains("ожидалось не более 1024"),
            "ошибка должна называть лимит: {error}"
        );
    }

    #[tokio::test]
    async fn require_success_preserves_status_for_oversized_error_body() {
        let padding = "x".repeat(128 * 1024);
        let error = get_error(401, format!("token expired {padding}")).await;

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::HttpStatus { status: 401, .. })
            ),
            "классификация статуса должна сохраниться, чтобы работал retry 401: {error}"
        );
        let rendered = error.to_string();
        assert!(
            !rendered.contains(&padding),
            "тело сверх лимита не должно попадать в сообщение целиком"
        );
        assert!(
            rendered.contains("не прочитано"),
            "ошибка должна называть причину непрочитанного тела: {rendered}"
        );
    }
}

#[cfg(test)]
mod client_defaults_tests {
    use std::time::{Duration, Instant};

    use super::{base_client_builder, http_client};
    use mockito::{Matcher, Server};

    #[test]
    fn base_client_builder_configures_total_deadline() {
        let client = base_client_builder().build().expect("общий клиент");
        let debug = format!("{client:?}");
        assert!(
            debug.contains("TotalTimeout"),
            "у общего клиента должен быть общий таймаут: {debug}"
        );
    }

    #[tokio::test]
    async fn http_client_sends_user_agent() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/user-agent")
            .match_header(
                "user-agent",
                Matcher::Regex("^TekinaLiadon/Limacina/.*".to_string()),
            )
            .with_status(200)
            .create_async()
            .await;

        http_client()
            .get(format!("{}/user-agent", server.url()))
            .send()
            .await
            .expect("запрос к серверу");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn slow_body_times_out_by_total_deadline() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/slow-body")
            .with_status(200)
            .with_chunked_body(|writer| {
                writer.write_all(b"partial")?;
                std::thread::sleep(Duration::from_secs(2));
                Ok(())
            })
            .create_async()
            .await;

        let client = base_client_builder()
            .read_timeout(Duration::from_secs(10))
            .timeout(Duration::from_millis(300))
            .build()
            .expect("клиент с коротким общим таймаутом");

        let started = Instant::now();
        let response = client
            .get(format!("{}/slow-body", server.url()))
            .send()
            .await
            .expect("заголовки приходят без паузы");
        let result = response.text().await;
        let elapsed = started.elapsed();

        let error = result.expect_err("недописанное тело должно обрываться по общему таймауту");
        assert!(error.is_timeout(), "ошибка должна быть таймаутом: {error}");
        assert!(
            elapsed < Duration::from_secs(1),
            "общий таймаут должен сработать раньше read_timeout и паузы сервера: {elapsed:?}"
        );
    }
}
