use crate::{log_info, log_err};
use anyhow::{Context, Result};
use futures::StreamExt;
use md5::{Digest, Md5};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::state::dto::GlobalState;
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};
use tokio::sync::Mutex;

fn build_auth_client(token: &str) -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token))
            .context("Некорректный токен авторизации")?,
    );
    Client::builder()
        .default_headers(headers)
        .connect_timeout(Duration::from_secs(10))
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
    let mut file = File::open(file_path)
        .with_context(|| format!("Не удалось открыть файл для проверки хеша: {:?}", file_path))?;
    let mut hasher = Md5::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer)
            .with_context(|| format!("Ошибка чтения файла {:?}", file_path))?;
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
    log_info!("[download] Запрос файла: {} → {:?}", url, file_path);
    let server_url = get_server_url()?;
    let body = BodyFile {
        url: url.to_string(),
    };

    let response = client
        .post(format!("{}/files/files", server_url))
        .json(&body)
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на сервер для файла: {}", url))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("[download] Ошибка сервера {} при скачивании {}: {}", status, url, body);
        anyhow::bail!("Сервер вернул {} при скачивании {}: {} (путь: {:?})", status, url, body, file_path);
    }

    if let Some(parent) = Path::new(file_path).parent() {
        tokio::fs::create_dir_all(parent).await
            .with_context(|| format!("Не удалось создать директорию {:?}", parent))?;
    }

    let mut file = tokio::fs::File::create(file_path).await
        .with_context(|| format!("Не удалось создать файл {:?}", file_path))?;
    let mut stream = response.bytes_stream();
    let mut total_bytes: u64 = 0;

    while let Some(item) = stream.next().await {
        let chunk = item
            .with_context(|| format!("Ошибка чтения потока при скачивании {}", url))?;
        total_bytes += chunk.len() as u64;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await
            .with_context(|| format!("Ошибка записи в файл {:?}", file_path))?;
    }

    log_info!("[download] Готово: {} ({} байт)", url, total_bytes);
    Ok(())
}

pub async fn download_all_files(app: AppHandle, project_name: String, check_hashes: bool, state: &Mutex<GlobalState>) -> Result<String> {
    let token = {
        let guard = state.lock().await;
        guard
            .session
            .as_ref()
            .context("Необходима авторизация для скачивания файлов")?
            .access_token
            .clone()
    };

    let client = build_auth_client(&token)?;
    let server_url = get_server_url()?;

    log_info!("[files] Запрос списка файлов: {}/files/list", server_url);
    let response = client
        .get(format!("{}/files/list", server_url))
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}/files/list", server_url))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("[files] Сервер вернул {}: {}", status, body);
        anyhow::bail!("Сервер файлов вернул {} (проект: {}): {}", status, project_name, body);
    }

    let file_list: HashMap<String, String> = response.json().await
        .with_context(|| format!("Не удалось распарсить JSON списка файлов (проект: {})", project_name))?;
    let core = crate::utils::env_info::launcher_patch(Some(&project_name))?;

    log_info!("[files] Получено файлов от сервера: {}", file_list.len());
    log_info!("[files] Папка проекта: {:?}", core);
    log_info!("[files] Проверка файлов...");

    let mut files_to_download: Vec<String> = Vec::new();

    for (key, expected_hash) in &file_list {
        let file_path = core.join(key);
        if !file_path.exists() {
            files_to_download.push(key.clone());
        } else if check_hashes {
            match get_file_hash(&file_path) {
                Ok(hash) if hash == *expected_hash => continue,
                _ => files_to_download.push(key.clone()),
            }
        }
    }

    log_info!("[files] Проверка завершена. К скачиванию: {} из {}", files_to_download.len(), file_list.len());

    let total_files = files_to_download.len();
    let _ = app.emit("totalFile", total_files);

    if total_files == 0 {
        log_info!("[files] Все файлы уже на месте");
        return Ok(serde_json::to_string(&file_list)?);
    }

    for key in &files_to_download {
        log_info!("[files] Будет скачан: {}", key);
    }

    let semaphore_list: Vec<SemaphoreInfo> = files_to_download
        .iter()
        .map(|key| SemaphoreInfo {
            url: key.clone(),
            dest: PathBuf::from(key),
        })
        .collect();

    log_info!("[files] Начало скачивания {} файлов (макс. 15 параллельно)", total_files);
    let download_futures = semaphore_core(core.clone(), semaphore_list, move |url, dest| {
        let client = client.clone();
        async move {
            download_file(&client, &dest, &url).await
        }
    }, None::<fn(&str)>);

    log_info!("[files] Файлы созданы, запуск загрузки...");
    let results = futures::future::join_all(download_futures).await;

    let mut downloaded = 0;
    let mut errors = 0;
    for res in &results {
        match res {
            Ok(()) => downloaded += 1,
            Err(e) => {
                errors += 1;
                log_err!("[files] Ошибка: {:?}", e);
            }
        }
    }

    log_info!("[files] Итого: скачано {}, ошибок: {}, всего: {}", downloaded, errors, total_files);

    for res in results {
        res?;
    }

    Ok(format!("Скачано файлов: {}", total_files))
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

    log_info!("[mods] Запрос списка модов: {}/files/mods", server_url);
    let response = client
        .get(format!("{}/files/mods", server_url))
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}/files/mods", server_url))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("[mods] Сервер вернул ошибку {}: {}", status, body);
        anyhow::bail!("Сервер модов вернул {} (проект: {}): {}", status, project_name, body);
    }

    let response_text = response.text().await
        .with_context(|| format!("Не удалось прочитать ответ от {}/files/mods", server_url))?;
    log_info!("[mods] Ответ сервера: {}", response_text);

    let mods: HashMap<String, String> = serde_json::from_str(&response_text)
        .with_context(|| format!("Не удалось распарсить JSON списка модов (проект: {})", project_name))?;

    log_info!("[mods] Получено модов: {}", mods.len());
    for (name, hash) in &mods {
        log_info!("  мод: {} (hash: {})", name, hash);
    }

    let mods_dir = crate::utils::env_info::launcher_patch(Some(&project_name))?
        .join("mods");

    tokio::fs::create_dir_all(&mods_dir).await?;

    let server_mods: std::collections::HashSet<&str> = mods.keys()
        .map(|k| k.strip_prefix("mods/").unwrap_or(k))
        .collect();

    if let Ok(mut entries) = tokio::fs::read_dir(&mods_dir).await {
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_file() {
                continue;
            }
            let name_os = entry.file_name();
            let name = name_os.to_string_lossy();
            if !server_mods.contains(name.as_ref()) {
                log_info!("[mods] Удаление лишнего мода: {}", name);
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    let total_mods = mods.len();
    let _ = app.emit("totalMods", total_mods);

    if total_mods == 0 {
        log_info!("[mods] Список модов пуст");
        return Ok("Нет модов для скачивания".to_string());
    }

    let mut files_to_download: Vec<String> = Vec::new();

    log_info!("[mods] Путь к папке модов: {:?}", mods_dir);

    for (server_key, expected_hash) in &mods {
        let file_name = server_key.strip_prefix("mods/").unwrap_or(server_key);
        let file_path = mods_dir.join(file_name);
        let exists = file_path.exists();
        if !exists {
            log_info!("[mods] Мод отсутствует: {}", file_name);
            files_to_download.push(server_key.clone());
        } else {
            match get_file_hash(&file_path) {
                Ok(hash) if hash == *expected_hash => {
                    log_info!("[mods] Мод актуален: {}", file_name);
                    continue;
                }
                Ok(hash) => {
                    log_info!("[mods] Мод изменился: {} (ожидается {}, есть {})", file_name, expected_hash, hash);
                    files_to_download.push(server_key.clone());
                }
                Err(e) => {
                    log_info!("[mods] Ошибка чтения мода {}: {}", file_name, e);
                    files_to_download.push(server_key.clone());
                }
            }
        }
    }

    let total_to_download = files_to_download.len();
    log_info!("[mods] Модов к скачиванию: {} из {}", total_to_download, total_mods);

    if total_to_download == 0 {
        log_info!("[mods] Все моды актуальны");
        return Ok(format!("Все моды актуальны: {}", total_mods));
    }

    for key in &files_to_download {
        log_info!("[mods] Будет скачан: {}", key);
    }

    let semaphore_list: Vec<SemaphoreInfo> = files_to_download
        .iter()
        .map(|key| SemaphoreInfo {
            url: key.clone(),
            dest: PathBuf::from(key.strip_prefix("mods/").unwrap_or(key)),
        })
        .collect();

    let app_clone = app.clone();
    log_info!("[mods] Начало скачивания {} модов (макс. 15 параллельно)", total_to_download);
    let download_futures = semaphore_core(mods_dir, semaphore_list, move |url, dest| {
        let client = client.clone();
        async move {
            download_file(&client, &dest, &url).await
        }
    }, Some(move |url: &str| {
        let file_name = url.strip_prefix("mods/").unwrap_or(url);
        let _ = app_clone.emit("modDownloaded", file_name);
    }));

    let results = futures::future::join_all(download_futures).await;

    let mut downloaded = 0;
    let mut errors = 0;
    for res in &results {
        match res {
            Ok(()) => downloaded += 1,
            Err(e) => {
                errors += 1;
                log_err!("[mods] Ошибка: {:?}", e);
            }
        }
    }

    log_info!("[mods] Итого: скачано {}, ошибок: {}, всего: {}", downloaded, errors, total_to_download);

    for res in results {
        res?;
    }

    Ok(format!("Скачано модов: {}/{}", downloaded, total_to_download))
}
