use crate::log_err;
use crate::utils::env_info::default_server_url;
use crate::utils::errors::{LauncherError, INTERNAL_ERROR_CODE};

const SERVER_URL_PLACEHOLDER: &str = "<адрес сервера>";

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

#[derive(Debug, serde::Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    fn typed(error: &LauncherError) -> Self {
        Self {
            code: error.code().to_string(),
            message: redact_server_url(error.to_string(), default_server_url().as_deref()),
        }
    }

    fn internal(message: String) -> Self {
        Self {
            code: INTERNAL_ERROR_CODE.to_string(),
            message: redact_server_url(message, default_server_url().as_deref()),
        }
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(error: anyhow::Error) -> Self {
        log_err!("{:#}", error);
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
    use super::{redact_server_url, CommandError};
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
}
