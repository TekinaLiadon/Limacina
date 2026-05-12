use std::{future::Future, path::PathBuf, sync::Arc};

use anyhow::Error;
use tokio::sync::Semaphore;

use crate::{log_info, utils::download_file::download_file};
const MAX_CONCURRENT_DOWNLOADS: usize = 20;


pub struct SemaphoreInfo {
    pub url: String, 
    pub dest: PathBuf
}

pub fn semaphore_core(base_path:PathBuf, list: Vec<SemaphoreInfo>) ->  Vec<impl Future<Output = Result<(), Error>>>{
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let base_path = Arc::new(base_path);
    let mut download_futures = Vec::new();

    for el in list {
        let sem = semaphore.clone();
        let url = el.url.clone();
        let path = base_path.join(el.dest.clone());

        download_futures.push(async move {
            let _permit = sem.acquire_owned().await.expect("Семафор закрыт");

            log_info!("Скачивание {}", url);
            match download_file(&url, &path).await {
                Ok(_) => Ok(()),
                Err(e) => {
                    eprintln!("Ошибка скачивания {}: {:?}", url, e);
                    Err(e)
                }
            }
        });
    }
    return download_futures;
}