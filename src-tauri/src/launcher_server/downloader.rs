use crate::log_info;
use futures_util::StreamExt;
use md5::{Digest, Md5};
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

const MAX_CONCURRENT_DOWNLOADS: usize = 20;

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("Не удалось получить файл от сервера: {0}")]
    FetchError(#[from] reqwest::Error),

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

#[derive(Serialize)]
struct BodyFile {
    url: String,
}

fn get_server_url() -> Result<String, DownloadError> {
    env::var("LAUNCHER_SERVER_URL")
        .map_err(|_| DownloadError::SystemError("LAUNCHER_SERVER_URL not set".to_string()))
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
    let server_url = get_server_url()?;
    let body = BodyFile {
        url: url.to_string(),
    };

    let response = client
        .post(format!("{}/files/files", server_url))
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(DownloadError::SystemError(format!(
            "Сервер вернул {} при скачивании {}: {}",
            status, url, body
        )));
    }

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

    let launcher_name: String =
        env::var("LAUNCHER_NAME").unwrap_or_else(|_| "Limacina".to_string());

    let dir: PathBuf = home_dir.join(&launcher_name);

    Ok(dir.to_string_lossy().to_string())
}

pub async fn download_all_files(app: AppHandle) -> Result<String, DownloadError> {
    let client = Client::new();
    let server_url = get_server_url()?;

    let response = client
        .get(format!("{}/files/list", server_url))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(DownloadError::SystemError(format!(
            "Сервер файлов вернул {}: {}",
            status, body
        )));
    }

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
    let mut tasks = Vec::new();

    for file_key in files_to_download {
        let sem = semaphore.clone();
        let client = client.clone();

        let core_path = core.clone();
        let file_key_clone = file_key.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem
                .acquire()
                .await
                .map_err(|e| DownloadError::SystemError(e.to_string()))?;

            let file_path = core_path.join(&file_key_clone);

            download_file(&client, &file_path, &file_key_clone).await?;

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

pub async fn download_mods(app: AppHandle, project_name: String) -> Result<String, DownloadError> {
    let client = Client::new();
    let server_url = get_server_url()?;

    let response = client
        .get(format!("{}/files/mods", server_url))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_info!("Сервер вернул ошибку {}: {}", status, body);
        return Err(DownloadError::SystemError(format!(
            "Сервер вернул {}: {}",
            status, body
        )));
    }

    let response_text = response.text().await?;
    log_info!("Ответ сервера: {}", response_text);

    let mods: HashMap<String, String> = serde_json::from_str(&response_text)?;

    log_info!("Получено модов: {}", mods.len());
    for (name, hash) in &mods {
        log_info!("  мод: {} (hash: {})", name, hash);
    }

    let mods_dir = crate::utils::env_info::launcher_patch(Some(&project_name))
        .map_err(|e| DownloadError::SystemError(e.to_string()))?
        .join("mods");

    fs::create_dir_all(&mods_dir)?;

    let server_mods: std::collections::HashSet<&String> = mods.keys().collect();

    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy().to_string();
            if !server_mods.contains(&name) {
                log_info!("Удаление лишнего мода: {}", name);
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    let total_mods = mods.len();
    let _ = app.emit("totalMods", total_mods);

    if total_mods == 0 {
        log_info!("Список модов пуст");
        return Ok("Нет модов для скачивания".to_string());
    }

    let mut files_to_download: Vec<String> = Vec::new();

    log_info!("Путь к папке модов: {:?}", mods_dir);

    for (file_name, expected_hash) in &mods {
        let file_path = mods_dir.join(file_name);
        let exists = file_path.exists();
        if !exists {
            log_info!("Мод отсутствует: {}", file_name);
            files_to_download.push(file_name.clone());
        } else {
            match get_file_hash(&file_path) {
                Ok(hash) if hash == *expected_hash => {
                    log_info!("Мод актуален: {}", file_name);
                    continue;
                }
                Ok(hash) => {
                    log_info!("Мод изменился: {} (ожидается {}, есть {})", file_name, expected_hash, hash);
                    files_to_download.push(file_name.clone());
                }
                Err(e) => {
                    log_info!("Ошибка чтения мода {}: {}", file_name, e);
                    files_to_download.push(file_name.clone());
                }
            }
        }
    }

    let total_to_download = files_to_download.len();
    log_info!("Модов к скачиванию: {}", total_to_download);

    if total_to_download == 0 {
        return Ok(format!("Все моды актуальны: {}", total_mods));
    }

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let mut tasks = Vec::new();

    for file_name in files_to_download {
        let sem = semaphore.clone();
        let client = client.clone();
        let mods_dir = mods_dir.clone();
        let app = app.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem
                .acquire()
                .await
                .map_err(|e| DownloadError::SystemError(e.to_string()))?;

            let file_path = mods_dir.join(&file_name);

            let url = format!("/mods/{}", file_name);
            log_info!("Скачивание мода: {} -> {:?}", url, file_path);
            download_file(&client, &file_path, &url).await?;
            log_info!("Мод скачан: {}", file_name);

            let _ = app.emit("modDownloaded", &file_name);

            Ok::<(), DownloadError>(())
        });

        tasks.push(handle);
    }

    let results = futures::future::join_all(tasks).await;

    let mut downloaded = 0;
    for res in results {
        match res {
            Ok(Ok(())) => downloaded += 1,
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(DownloadError::JoinError(e)),
        }
    }

    Ok(format!("Скачано модов: {}/{}", downloaded, total_to_download))
}
