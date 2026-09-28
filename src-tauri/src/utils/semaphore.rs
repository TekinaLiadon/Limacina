use std::{future::Future, path::PathBuf, sync::Arc, time::Duration};

use anyhow::Error;
use tokio::{
    sync::Semaphore,
    time::{sleep, Instant},
};

use crate::utils::errors::LauncherError;
use crate::{log_err, log_info};
pub(crate) const MAX_CONCURRENT_DOWNLOADS: usize = 15;
const MAX_RETRIES: usize = 4;

pub struct SemaphoreInfo {
    pub url: String,
    pub dest: PathBuf,
}

fn is_retryable_failure(error: &Error) -> bool {
    error.chain().any(|cause| {
        if let Some(typed) = cause.downcast_ref::<LauncherError>() {
            match typed {
                LauncherError::HttpStatus { status, .. } => *status >= 500,
                LauncherError::Download(_) | LauncherError::LauncherServer(_) => true,
                _ => false,
            }
        } else if let Some(request_error) = cause.downcast_ref::<reqwest::Error>() {
            request_error.is_timeout()
                || request_error.is_connect()
                || request_error.is_body()
                || request_error.is_decode()
                || request_error
                    .status()
                    .is_some_and(|status| status.as_u16() >= 500)
        } else {
            false
        }
    })
}

pub fn semaphore_core<F, Fut, C>(
    base_path: PathBuf,
    list: Vec<SemaphoreInfo>,
    download_fn: F,
    on_done: Option<C>,
) -> Vec<impl Future<Output = Result<(), Error>>>
where
    F: Fn(String, PathBuf) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
    C: Fn(&str) + Send + Sync + 'static,
{
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let base_path = Arc::new(base_path);
    let download_fn = Arc::new(download_fn);
    let on_done = on_done.map(|f| Arc::new(f));
    let mut download_futures = Vec::new();

    for el in list {
        let sem = semaphore.clone();
        let path = base_path.join(&el.dest);
        let download_fn = download_fn.clone();
        let on_done = on_done.clone();

        download_futures.push(async move {
            let _permit = match sem.acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => {
                    return Err(
                        LauncherError::Download("Семафор скачивания закрыт".to_string()).into(),
                    );
                }
            };
            let start_time = Instant::now();
            let mut final_result = Err(LauncherError::Download(format!(
                "Не удалось скачать файл после {MAX_RETRIES} попыток"
            ))
            .into());

            for attempt in 1..=MAX_RETRIES {
                match download_fn(el.url.clone(), path.clone()).await {
                    Ok(_) => {
                        log_info!("[semaphore] Успешно скачан: {}", el.url);
                        if let Some(ref cb) = on_done {
                            cb(&el.url);
                        }
                        final_result = Ok(());
                        break;
                    }
                    Err(e) if attempt < MAX_RETRIES && is_retryable_failure(&e) => {
                        log_err!(
                            "[semaphore] Ошибка скачивания {} (попытка {}/{}): {:?}",
                            el.url,
                            attempt,
                            MAX_RETRIES,
                            e
                        );

                        let delay = 2_u64.pow(attempt as u32);
                        log_info!("[semaphore] Повтор через {} сек: {}", delay, el.url);
                        sleep(Duration::from_secs(delay)).await;
                    }

                    Err(e) => {
                        log_err!(
                            "[semaphore] Финальная ошибка скачивания {} (попытка {}/{}): {:?}",
                            el.url,
                            attempt,
                            MAX_RETRIES,
                            e
                        );
                        final_result = Err(e);
                        break;
                    }
                }
            }

            let elapsed = start_time.elapsed();
            let min_duration = Duration::from_millis(100);
            if elapsed < min_duration {
                sleep(min_duration - elapsed).await;
            }
            final_result
        });
    }
    download_futures
}

#[cfg(test)]
mod retry_classification_tests {
    use super::is_retryable_failure;
    use crate::utils::errors::LauncherError;
    use anyhow::anyhow;

    fn http_status(status: u16) -> anyhow::Error {
        LauncherError::HttpStatus {
            status,
            message: format!("статус {status}"),
        }
        .into()
    }

    #[test]
    fn retries_network_failures_and_server_errors() {
        for error in [
            LauncherError::Download("обрыв соединения".to_string()).into(),
            LauncherError::LauncherServer("Не удалось отправить запрос".to_string()).into(),
            http_status(500),
            http_status(502),
            http_status(503),
        ] {
            assert!(
                is_retryable_failure(&error),
                "сетевые ошибки и 5xx должны ретраиться: {error:?}"
            );
        }
    }

    #[test]
    fn does_not_retry_deterministic_failures() {
        for error in [
            http_status(404),
            http_status(403),
            http_status(429),
            LauncherError::HashMismatch("хеш не совпал".to_string()).into(),
            LauncherError::DiskIo("диск переполнен".to_string()).into(),
            LauncherError::ManifestParse("битый манифест".to_string()).into(),
            LauncherError::GameDownload("JAR файл не существует".to_string()).into(),
            anyhow!("неизвестная ошибка без типа"),
        ] {
            assert!(
                !is_retryable_failure(&error),
                "детерминированные ошибки не должны ретраиться: {error:?}"
            );
        }
    }

    #[test]
    fn classification_sees_through_contexts() {
        let wrapped = anyhow!(LauncherError::HttpStatus {
            status: 404,
            message: "нет файла".to_string()
        })
        .context("Не удалось скачать файл");
        assert!(!is_retryable_failure(&wrapped));

        let wrapped_network = anyhow!(LauncherError::Download("таймаут".to_string()))
            .context("Не удалось скачать файл");
        assert!(is_retryable_failure(&wrapped_network));
    }
}
