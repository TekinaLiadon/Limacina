use std::{future::Future, path::PathBuf, sync::Arc, time::Duration};

use anyhow::Error;
use tokio::{
    sync::Semaphore,
    time::{sleep, Instant},
};

use crate::{log_err, log_info};
const MAX_CONCURRENT_DOWNLOADS: usize = 15;
const MAX_RETRIES: usize = 4;

pub struct SemaphoreInfo {
    pub url: String,
    pub dest: PathBuf,
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
            let _permit = sem.acquire_owned().await.expect("Семафор закрыт");
            let start_time = Instant::now();
            let mut final_result = Err(anyhow::anyhow!(
                "Не удалось скачать файл после {} попыток",
                MAX_RETRIES
            ));

            for attempt in 1..=MAX_RETRIES {
                match download_fn(el.url.clone(), path.clone()).await {
                    Ok(_) => {
                        if let Some(ref cb) = on_done {
                            cb(&el.url);
                        }
                        final_result = Ok(());
                        break;
                    }
                    Err(e) if attempt < MAX_RETRIES => {
                        log_info!("Ошибка скачивания {}. Повторный запрос", el.url);
                        log_err!("Ошибка скачивания {}: {:?}. Повтор...", el.url, e);

                        let delay = 2_u64.pow(attempt as u32);
                        sleep(Duration::from_secs(delay)).await;
                    }

                    Err(e) => {
                        log_err!("Финальная ошибка скачивания {}: {:?}", el.url, e);
                        final_result = Err(e);
                        break;
                    }
                }
            }

            let elapsed = start_time.elapsed();
            let min_duration = Duration::from_secs(1);
            if elapsed < min_duration {
                sleep(min_duration - elapsed).await;
            }
            final_result
        });
    }
    download_futures
}
