use futures_util::StreamExt;
use md5::{Digest, Md5};
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

const MAX_CONCURRENT_DOWNLOADS: usize = 20;

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("Не удалось получить файл от сервера: {0}")]
    FetchError(#[from] reqwest::Error),

    #[error("Не удалось получить размер файла из заголовков")]
    ContentLengthError,

    #[error("Ошибка файловой системы: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Ошибка JSON: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Системная ошибка: {0}")]
    SystemError(String),

    #[error("Ошибка выполнения задачи: {0}")]
    JoinError(#[from] tokio::task::JoinError),
}

impl Serialize for DownloadError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Clone, Serialize)]
struct TotalProgressPayload {
    completed: usize,
    total: usize,
    percent: f64,
    current_file: String,
}

#[derive(Serialize)]
struct BodyFile {
    url: String,
}

fn get_file_hash(file_path: &PathBuf) -> Result<String, DownloadError> {
    let mut file = File::open(file_path)?;
    let mut hasher = Md5::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

async fn download_file(
    client: &Client,
    file_path: &PathBuf,
    url: &str,
) -> Result<(), DownloadError> {
    let body = BodyFile {
        url: url.to_string(),
    };

    let response = client
        .post("http://strapi.tekina.ru/api/test")
        .json(&body)
        .send()
        .await?;

    if let Some(parent) = Path::new(file_path).parent() {
        fs::create_dir_all(parent)?;
    }

    let mut file = File::create(file_path)?;
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item?;
        file.write_all(&chunk)?;
    }

    Ok(())
}

fn get_base_dir() -> Result<String, DownloadError> {
    #[allow(deprecated)]
    let home_dir: PathBuf = env::home_dir()
        .ok_or_else(|| DownloadError::SystemError("Home directory not found".to_string()))?;

    let launcher_name: String = env::var("LAUNCHER_NAME")
        .unwrap_or_else(|_| "default_launcher".to_string());

    let dir: PathBuf = home_dir.join(&launcher_name);

    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn download_all_files(app: AppHandle) -> Result<String, DownloadError> {
    let client = Client::new();

    let response = client
        .get("http://strapi.tekina.ru/api/list")
        .send()
        .await?;

    let file_list: HashMap<String, String> = response.json().await?;

    let base_dir_str = get_base_dir()?;
    let core = PathBuf::from(&base_dir_str);

    let mut files_to_download: Vec<String> = Vec::new();

    for (key, expected_hash) in &file_list {
        let file_path = core.join(key);
        if !file_path.exists() {
            files_to_download.push(key.clone());
        } else {
            match get_file_hash(&file_path) {
                Ok(hash) if hash == *expected_hash => continue,
                _ => files_to_download.push(key.clone()),
            }
        }
    }

    let total_files = files_to_download.len();
    let _ = app.emit("totalFile", total_files);

    if total_files == 0 {
        return Ok(serde_json::to_string(&file_list)?);
    }

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let completed_counter = Arc::new(AtomicUsize::new(0));
    let mut tasks = Vec::new();

    for file_key in files_to_download {
        let sem = semaphore.clone();
        let client = client.clone();
        let app = app.clone();
        let counter = completed_counter.clone();

        let core_path = core.clone();
        let file_key_clone = file_key.clone();

        let total_files_count = total_files;

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| DownloadError::SystemError(e.to_string()))?;

            let file_name = Path::new(&file_key_clone)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| file_key_clone.clone());

            let file_path = core_path.join(&file_key_clone);

            download_file(&client, &file_path, &file_key_clone).await?;

            let completed = counter.fetch_add(1, Ordering::SeqCst) + 1;

            /*let _ = app.emit(
                "numberFile",
                TotalProgressPayload {
                    completed,
                    total: total_files_count,
                    percent: (completed as f64 / total_files_count as f64 * 100.0).round(),
                    current_file: file_name,
                },
            );*/

            Ok::<(), DownloadError>(())
        });

        tasks.push(handle);
    }

    let results = futures::future::join_all(tasks).await;

    for res in results {
        match res {
            Ok(inner_result) => inner_result?,
            Err(e) => return Err(DownloadError::JoinError(e)),
        }
    }

    Ok("Все скачено успешно".to_string())
}