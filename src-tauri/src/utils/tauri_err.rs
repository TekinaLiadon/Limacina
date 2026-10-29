use crate::log_err;
use crate::utils::env_info::default_server_url;
use crate::utils::errors::{LauncherError, INTERNAL_ERROR_CODE};
use std::sync::{Mutex, OnceLock};

const SERVER_URL_PLACEHOLDER: &str = "<адрес сервера>";

const COMMAND_MESSAGE_LIMIT: usize = 400;

static KNOWN_SERVER_URLS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn known_server_urls() -> &'static Mutex<Vec<String>> {
    KNOWN_SERVER_URLS.get_or_init(|| Mutex::new(Vec::new()))
}

pub(crate) fn remember_server_url(url: &str) {
    let base = url.trim().trim_end_matches('/');
    if base.is_empty() {
        return;
    }
    let mut urls = known_server_urls()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if !urls.iter().any(|known| known == base) {
        urls.push(base.to_string());
    }
}

fn bounded_message(message: &str) -> String {
    if message.chars().count() <= COMMAND_MESSAGE_LIMIT {
        return message.to_string();
    }
    let cut: String = message.chars().take(COMMAND_MESSAGE_LIMIT).collect();
    format!("{cut}…")
}

fn redact_server_url(message: String, server_url: Option<&str>) -> String {
    let Some(base) = server_url.map(|url| url.trim().trim_end_matches('/')) else {
        return message;
    };
    if base.is_empty() {
        return message;
    }
    let mut redacted = message.replace(base, SERVER_URL_PLACEHOLDER);
    if let Some(host) = base
        .strip_prefix("http://")
        .and_then(|h| h.strip_suffix(":80"))
    {
        redacted = redacted.replace(&format!("http://{host}"), SERVER_URL_PLACEHOLDER);
    }
    if let Some(host) = base
        .strip_prefix("https://")
        .and_then(|h| h.strip_suffix(":443"))
    {
        redacted = redacted.replace(&format!("https://{host}"), SERVER_URL_PLACEHOLDER);
    }
    redacted
}

pub(crate) fn redact_known_server_urls(message: String) -> String {
    let mut redacted = redact_server_url(message, default_server_url().as_deref());
    let known = known_server_urls()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    for url in known.iter() {
        redacted = redact_server_url(redacted, Some(url));
    }
    redacted
}

#[derive(Debug, serde::Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    fn typed(error: &LauncherError) -> Self {
        Self {
            code: error.code().to_string(),
            message: bounded_message(&redact_known_server_urls(error.to_string())),
        }
    }

    fn internal(message: String) -> Self {
        Self {
            code: INTERNAL_ERROR_CODE.to_string(),
            message: bounded_message(&redact_known_server_urls(message)),
        }
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(error: anyhow::Error) -> Self {
        log_err!("{}", bounded_message(&format!("{:#}", error)));
        let typed = error
            .chain()
            .find_map(|cause| cause.downcast_ref::<LauncherError>());
        match typed {
            Some(typed) => Self::typed(typed),
            None => Self::internal(format!("{:#}", error)),
        }
    }
}

impl From<LauncherError> for CommandError {
    fn from(error: LauncherError) -> Self {
        Self::typed(&error)
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::{redact_known_server_urls, redact_server_url, remember_server_url, CommandError};
    use crate::utils::env_info::default_server_url;
    use crate::utils::errors::LauncherError;

    #[test]
    fn redact_replaces_every_occurrence_of_server_url() {
        let message = "Не удалось отправить запрос на http://10.0.0.5:3005/v1/launcher/update/releases, повтор http://10.0.0.5:3005 не удался".to_string();
        assert_eq!(
            redact_server_url(message, Some("http://10.0.0.5:3005")),
            "Не удалось отправить запрос на <адрес сервера>/v1/launcher/update/releases, повтор <адрес сервера> не удался"
        );
    }

    #[test]
    fn redact_ignores_trailing_slash_in_configured_url() {
        assert_eq!(
            redact_server_url(
                "ошибка для http://10.0.0.5:3005/v1/x".to_string(),
                Some("http://10.0.0.5:3005/")
            ),
            "ошибка для <адрес сервера>/v1/x"
        );
    }

    #[test]
    fn redact_handles_default_ports() {
        assert_eq!(
            redact_server_url(
                "url (http://10.0.0.5/v1/x)".to_string(),
                Some("http://10.0.0.5:80")
            ),
            "url (<адрес сервера>/v1/x)"
        );
        assert_eq!(
            redact_server_url(
                "url (https://10.0.0.5/v1/x)".to_string(),
                Some("https://10.0.0.5:443")
            ),
            "url (<адрес сервера>/v1/x)"
        );
    }

    #[test]
    fn redact_keeps_message_without_server_url() {
        let message = "Не удалось подключиться к серверу обновлений".to_string();
        assert_eq!(redact_server_url(message.clone(), None), message);
        assert_eq!(
            redact_server_url(message.clone(), Some("http://10.0.0.5:3005")),
            message
        );
    }

    #[test]
    fn redact_skips_empty_configured_url() {
        let message = "Что-то/что-то".to_string();
        assert_eq!(redact_server_url(message.clone(), Some("/")), message);
    }

    #[test]
    fn redact_covers_registered_per_project_url() {
        remember_server_url("http://10.1.2.3:8080");
        let redacted = redact_known_server_urls(
            "Не удалось отправить запрос на http://10.1.2.3:8080/v1/launcher/files/list: timeout"
                .to_string(),
        );
        assert_eq!(
            redacted,
            "Не удалось отправить запрос на <адрес сервера>/v1/launcher/files/list: timeout"
        );
    }

    #[test]
    fn remember_server_url_trims_and_ignores_empty() {
        remember_server_url("http://10.1.2.4:8080/");
        remember_server_url("   ");
        let redacted =
            redact_known_server_urls("Сервер http://10.1.2.4:8080 вернул ошибку".to_string());
        assert_eq!(redacted, "Сервер <адрес сервера> вернул ошибку");
    }

    #[test]
    fn command_error_redacts_registered_project_url() {
        remember_server_url("http://10.9.8.7:3000");
        let error = anyhow::Error::new(LauncherError::LauncherServer(
            "Не удалось отправить запрос на http://10.9.8.7:3000/v1/launcher/files/mods: tcp connect error"
                .to_string(),
        ));
        let command = CommandError::from(error);
        assert!(
            !command.message.contains("10.9.8.7"),
            "адрес проекта не должен попадать в ошибку команды: {}",
            command.message
        );
        assert!(
            command
                .message
                .contains("<адрес сервера>/v1/launcher/files/mods"),
            "адрес должен заменяться заглушкой: {}",
            command.message
        );
    }

    #[tokio::test]
    async fn command_error_redacts_default_server_url_when_configured() {
        let _dir = crate::test_support::LauncherDirGuard::acquire("tauri_err_redact").await;
        let url = default_server_url().unwrap_or_default();
        let error = anyhow::Error::new(LauncherError::Update(format!(
            "Не удалось подключиться: {url}/v1/launcher/update/releases"
        )));
        let command = CommandError::from(error);

        if url.is_empty() {
            assert_eq!(
                command.message,
                "Ошибка обновления: Не удалось подключиться: /v1/launcher/update/releases"
            );
        } else {
            assert!(
                !command.message.contains(&url),
                "URL не должен попадать в сообщение: {}",
                command.message
            );
            assert_eq!(
                command.message,
                "Ошибка обновления: Не удалось подключиться: <адрес сервера>/v1/launcher/update/releases"
            );
        }
    }

    #[test]
    fn command_error_caps_typed_message_length() {
        let body = "с".repeat(2000);
        let error = anyhow::Error::new(LauncherError::HttpStatus {
            status: 500,
            message: body.clone(),
        });

        let command = CommandError::from(error);

        assert_eq!(
            command.message.chars().count(),
            401,
            "400 символов плюс многоточие: {}",
            command.message
        );
        assert!(
            !command.message.contains(&body),
            "тело не должно попадать целиком"
        );
        assert!(command.message.ends_with('…'));
    }

    #[test]
    fn command_error_caps_internal_message_length() {
        let body = "т".repeat(2000);
        let error = anyhow::anyhow!("Не удалось выполнить запрос: {body}");

        let command = CommandError::from(error);

        assert_eq!(
            command.message.chars().count(),
            401,
            "400 символов плюс многоточие: {}",
            command.message
        );
        assert!(
            !command.message.contains(&body),
            "тело не должно попадать целиком"
        );
        assert!(command.message.starts_with("Не удалось выполнить запрос: "));
        assert_eq!(command.code, "internal");
    }

    #[test]
    fn command_error_keeps_short_message_intact() {
        let error = anyhow::anyhow!("Не удалось подключиться к серверу");

        let command = CommandError::from(error);

        assert_eq!(command.message, "Не удалось подключиться к серверу");
        assert!(!command.message.ends_with('…'));
    }
}
