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
                LauncherError::HttpStatus { status, .. } => *status >= 500 || *status == 429,
                LauncherError::Download(_) | LauncherError::LauncherServer(_) => true,
                _ => false,
            }
        } else if let Some(request_error) = cause.downcast_ref::<reqwest::Error>() {
            request_error.is_timeout()
                || request_error.is_connect()
                || request_error.is_body()
                || request_error.is_decode()
                || request_error.status().is_some_and(|status| {
                    let status = status.as_u16();
                    status >= 500 || status == 429
                })
        } else {
            false
        }
    })
}

fn jitter_fraction(url: &str, attempt: usize) -> f64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in url.as_bytes().iter().chain(attempt.to_le_bytes().iter()) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    f64::from((hash % 1000) as u16) / 1000.0
}

fn retry_delay(attempt: usize, url: &str) -> Duration {
    let base_ms = 1000_u64 * 2_u64.pow(attempt as u32);
    let scaled = 0.5 + 0.5 * jitter_fraction(url, attempt);
    Duration::from_millis((base_ms as f64 * scaled) as u64)
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

                        let delay = retry_delay(attempt, &el.url);
                        log_info!(
                            "[semaphore] Повтор через {} мс: {}",
                            delay.as_millis(),
                            el.url
                        );
                        sleep(delay).await;
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
    use super::{is_retryable_failure, retry_delay};
    use crate::utils::errors::LauncherError;
    use anyhow::anyhow;

    pub(super) fn http_status(status: u16) -> anyhow::Error {
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
            http_status(429),
            http_status(500),
            http_status(502),
            http_status(503),
        ] {
            assert!(
                is_retryable_failure(&error),
                "сетевые ошибки, 429 и 5xx должны ретраиться: {error:?}"
            );
        }
    }

    #[test]
    fn does_not_retry_deterministic_failures() {
        for error in [
            http_status(404),
            http_status(403),
            http_status(401),
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

        let wrapped_rate_limit = anyhow!(LauncherError::HttpStatus {
            status: 429,
            message: "слишком много запросов".to_string()
        })
        .context("Не удалось скачать файл");
        assert!(is_retryable_failure(&wrapped_rate_limit));
    }

    #[test]
    fn retry_delay_stays_within_half_base_bounds() {
        for url in [
            "mods/a.jar",
            "configs/settings.json",
            "assets/indexes/1.json",
        ] {
            for attempt in 1..=3 {
                let base_ms = 1000_u64 * 2_u64.pow(attempt as u32);
                let delay = retry_delay(attempt, url);
                assert!(
                    delay.as_millis() >= u128::from(base_ms / 2)
                        && delay.as_millis() < u128::from(base_ms),
                    "задержка {attempt} для {url} должна быть в [base/2, base): {delay:?}"
                );
            }
        }
    }

    #[test]
    fn retry_delay_jitter_spreads_across_urls() {
        let urls: Vec<String> = (0..24)
            .map(|index| format!("mods/file-{index}.jar"))
            .collect();
        let delays: Vec<u64> = urls
            .iter()
            .map(|url| retry_delay(1, url).as_millis() as u64)
            .collect();
        let distinct: std::collections::HashSet<u64> = delays.iter().copied().collect();
        assert!(
            distinct.len() > 1,
            "джиттер должен разводить одновременные повторы, а не давать одну задержку: {delays:?}"
        );
    }
}

#[cfg(test)]
mod semaphore_core_tests {
    use super::retry_classification_tests::http_status;
    use super::{semaphore_core, SemaphoreInfo};
    use crate::test_support::LauncherDirGuard;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn info(url: &str, dest: &str) -> SemaphoreInfo {
        SemaphoreInfo {
            url: url.to_string(),
            dest: PathBuf::from(dest),
        }
    }

    #[tokio::test]
    async fn downloads_all_files_and_reports_done_per_file() {
        let guard = LauncherDirGuard::acquire("semaphore_ok").await;
        let base = guard.root().to_path_buf();
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&calls);
        let done = Arc::new(AtomicUsize::new(0));
        let done_counter = Arc::clone(&done);

        let futures = semaphore_core(
            base.clone(),
            vec![info("u1", "a.txt"), info("u2", "sub/b.txt")],
            move |url, dest| {
                counter.fetch_add(1, Ordering::Relaxed);
                async move {
                    if let Some(parent) = dest.parent() {
                        tokio::fs::create_dir_all(parent).await.unwrap();
                    }
                    tokio::fs::write(&dest, url.as_bytes()).await.unwrap();
                    Ok(())
                }
            },
            Some(move |_url: &str| {
                done_counter.fetch_add(1, Ordering::Relaxed);
            }),
        );
        let results = futures::future::join_all(futures).await;

        assert!(results.iter().all(|result| result.is_ok()));
        assert_eq!(calls.load(Ordering::Relaxed), 2, "по одной попытке на файл");
        assert_eq!(
            done.load(Ordering::Relaxed),
            2,
            "on_done вызывается на каждый успех"
        );
        assert_eq!(
            tokio::fs::read_to_string(base.join("a.txt")).await.unwrap(),
            "u1"
        );
        assert_eq!(
            tokio::fs::read_to_string(base.join("sub/b.txt"))
                .await
                .unwrap(),
            "u2"
        );
    }

    #[tokio::test]
    async fn non_retryable_failure_stops_after_single_attempt() {
        let guard = LauncherDirGuard::acquire("semaphore_fatal").await;
        let base = guard.root().to_path_buf();
        let attempts = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&attempts);

        let futures = semaphore_core(
            base,
            vec![info("u1", "a.txt"), info("u2", "b.txt")],
            move |url, _dest| {
                counter.fetch_add(1, Ordering::Relaxed);
                let url = url.clone();
                async move { Err(http_status_failing(&url)) }
            },
            None::<fn(&str)>,
        );
        let results = futures::future::join_all(futures).await;

        assert_eq!(results.len(), 2);
        assert!(
            results.iter().all(|result| result.is_err()),
            "фатальные ошибки не должны ретраиться"
        );
        assert_eq!(
            attempts.load(Ordering::Relaxed),
            2,
            "одна попытка на файл без повторов"
        );
    }

    fn http_status_failing(url: &str) -> anyhow::Error {
        let _ = url;
        http_status(404)
    }
}
