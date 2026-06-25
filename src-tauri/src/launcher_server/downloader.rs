use crate::log_info;
use anyhow::{Context, Result};
use futures::StreamExt;
use md5::{Digest, Md5};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use crate::state::dto::GlobalState;
use tokio::sync::Mutex;

const MAX_CONCURRENT_DOWNLOADS: usize = 20;

fn build_auth_client(token: &str) -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token))
            .context("Некорректный токен авторизации")?,
    );
    Client::builder()
        .default_headers(headers)
        .build()
        .context("Не удалось создать HTTP клиент")
}

#[derive(Serialize)]
struct BodyFile {
    url: String,
}

fn get_server_url() -> Result<String> {
    Ok(env!("LAUNCHER_SERVER_URL").to_string())
}

fn get_file_hash(file_path: &PathBuf) -> Result<String> {
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
) -> Result<()> {
    let server_url = get_server_url()?;
    let body = BodyFile {
        url: url.to_string(),
    };

    let response = client
        .post(format!("{}/files/files", server_url))
        .json(&body)
        .send()
        .await
        .context("Не удалось получить файл от сервера")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Сервер вернул {} при скачивании {}: {}", status, url, body);
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

pub async fn download_all_files(app: AppHandle, state: &Mutex<GlobalState>) -> Result<String> {
    let state = state.lock().await;
    let token = state
        .session
        .as_ref()
        .context("Необходима авторизация для скачивания файлов")?
        .access_token
        .clone();
    drop(state);

    let client = build_auth_client(&token)?;
    let server_url = get_server_url()?;

    let response = client
        .get(format!("{}/files/list", server_url))
        .send()
        .await
        .context("Не удалось получить список файлов от сервера")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Сервер файлов вернул {}: {}", status, body);
    }

    let file_list: HashMap<String, String> = response.json().await?;

    let core = crate::utils::env_info::launcher_patch(None)?;

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
                .context("Ошибка получения семафора")?;

            let file_path = core_path.join(&file_key_clone);

            download_file(&client, &file_path, &file_key_clone).await?;

            Ok::<(), anyhow::Error>(())
        });

        tasks.push(handle);
    }

    let results = futures::future::join_all(tasks).await;

    for res in results {
        res.context("Ошибка выполнения задачи скачивания")??;
    }

    Ok("Все скачено успешно".to_string())
}

pub async fn download_mods(app: AppHandle, project_name: String, state: &Mutex<GlobalState>) -> Result<String> {
    let state = state.lock().await;
    let token = state
        .session
        .as_ref()
        .context("Необходима авторизация для скачивания модов")?
        .access_token
        .clone();
    drop(state);

    let client = build_auth_client(&token)?;
    let server_url = get_server_url()?;

    let response = client
        .get(format!("{}/files/mods", server_url))
        .send()
        .await
        .context("Не удалось получить список модов от сервера")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_info!("Сервер вернул ошибку {}: {}", status, body);
        anyhow::bail!("Сервер вернул {}: {}", status, body);
    }

    let response_text = response.text().await?;
    log_info!("Ответ сервера: {}", response_text);

    let mods: HashMap<String, String> = serde_json::from_str(&response_text)?;

    log_info!("Получено модов: {}", mods.len());
    for (name, hash) in &mods {
        log_info!("  мод: {} (hash: {})", name, hash);
    }

    let mods_dir = crate::utils::env_info::launcher_patch(Some(&project_name))?
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
                .context("Ошибка получения семафора")?;

            let file_path = mods_dir.join(&file_name);

            let url = format!("/mods/{}", file_name);
            log_info!("Скачивание мода: {} -> {:?}", url, file_path);
            download_file(&client, &file_path, &url).await?;
            log_info!("Мод скачан: {}", file_name);

            let _ = app.emit("modDownloaded", &file_name);

            Ok::<(), anyhow::Error>(())
        });

        tasks.push(handle);
    }

    let results = futures::future::join_all(tasks).await;

    let mut downloaded = 0;
    for res in results {
        res.context("Ошибка выполнения задачи скачивания мода")??;
        downloaded += 1;
    }

    Ok(format!("Скачано модов: {}/{}", downloaded, total_to_download))
}
