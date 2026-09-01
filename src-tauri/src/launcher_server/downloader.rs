use crate::{log_info, log_err, step_try};
use anyhow::{Context, Result};
use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::state::dto::GlobalState;
use crate::utils::download_file::{file_md5};
use crate::utils::env_info::is_safe_relative_path;
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};
use crate::utils::step_events::StepHandle;
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

async fn download_file(
    client: &Client,
    file_path: &Path,
    url: &str,
    server_url: &str,
) -> Result<()> {
    log_info!("[download] Запрос файла: {} → {:?}", url, file_path);
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

    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent).await
            .with_context(|| format!("Не удалось создать директорию {:?}", parent))?;
    }

    let tmp_path = {
        let mut name = file_path.as_os_str().to_os_string();
        name.push(".part");
        PathBuf::from(name)
    };
    let mut file = tokio::fs::File::create(&tmp_path).await
        .with_context(|| format!("Не удалось создать файл {:?}", tmp_path))?;
    let mut stream = response.bytes_stream();
    let mut total_bytes: u64 = 0;

    while let Some(item) = stream.next().await {
        let chunk = item
            .with_context(|| format!("Ошибка чтения потока при скачивании {}", url))?;
        total_bytes += chunk.len() as u64;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await
            .with_context(|| format!("Ошибка записи в файл {:?}", tmp_path))?;
    }
    drop(file);

    tokio::fs::rename(&tmp_path, file_path).await
        .with_context(|| format!("Не удалось переместить {:?} в {:?}", tmp_path, file_path))?;

    log_info!("[download] Готово: {} ({} байт)", url, total_bytes);
    Ok(())
}

pub async fn download_all_files(project_name: String, check_hashes: bool, state: &Mutex<GlobalState>) -> Result<String> {
    let (token, server_url, online) = {
        let guard = state.lock().await;
        let online = guard.project_config.online;
        let server_url = guard.project_config.resolved_server_url();
        if !online {
            (String::new(), server_url, false)
        } else {
            let token = guard
                .session
                .as_ref()
                .context("Необходима авторизация для скачивания файлов")?
                .access_token
                .clone();
            (token, server_url, true)
        }
    };

    if !online {
        log_info!("[files] Одиночный профиль {} — синхронизация с сервером не нужна", project_name);
        return Ok("Одиночный профиль: синхронизация не требуется".to_string());
    }

    let client = build_auth_client(&token)?;

    let list_step = StepHandle::start("files.list", "Получение списка файлов");
    log_info!("[files] Запрос списка файлов: {}/files/list", server_url);
    let response = step_try!(list_step, client
        .get(format!("{}/files/list", server_url))
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}/files/list", server_url)));

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("[files] Сервер вернул {}: {}", status, body);
        list_step.fail(format!("Сервер файлов вернул {}", status));
        anyhow::bail!("Сервер файлов вернул {} (проект: {}): {}", status, project_name, body);
    }

    let file_list: HashMap<String, String> = step_try!(list_step, response.json().await
        .with_context(|| format!("Не удалось распарсить JSON списка файлов (проект: {})", project_name)));
    list_step.finish(false);

    let core = crate::utils::env_info::launcher_patch(Some(&project_name))?;

    log_info!("[files] Получено файлов от сервера: {}", file_list.len());
    log_info!("[files] Папка проекта: {:?}", core);

    let download_step = StepHandle::start("files.download", "Скачивание файлов");

    let mut files_to_download: Vec<String> = Vec::new();

    for (key, expected_hash) in &file_list {
        if !is_safe_relative_path(key) {
            log_err!("[files] Отклонён небезопасный путь от сервера: {}", key);
            download_step.fail(format!("Сервер передал недопустимый путь: {}", key));
            anyhow::bail!("Сервер передал недопустимый путь файла: {}", key);
        }

        let file_path = core.join(key);
        if !file_path.exists() {
            files_to_download.push(key.clone());
        } else if check_hashes {
            match file_md5(&file_path).await {
                Ok(hash) if hash == *expected_hash => continue,
                _ => files_to_download.push(key.clone()),
            }
        }
    }

    log_info!("[files] Проверка завершена. К скачиванию: {} из {}", files_to_download.len(), file_list.len());

    let total_files = files_to_download.len();
    download_step.set_total(total_files as u64);

    if total_files == 0 {
        log_info!("[files] Все файлы уже на месте");
        download_step.finish(true);
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
    let step_counter = download_step.clone();
    let download_futures = semaphore_core(core.clone(), semaphore_list, move |url, dest| {
        let client = client.clone();
        let server_url = server_url.clone();
        async move {
            download_file(&client, &dest, &url, &server_url).await
        }
    }, Some(move |_: &str| step_counter.inc()));

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

    if errors > 0 {
        download_step.fail(format!("Не удалось скачать файлов: {}", errors));
    } else {
        download_step.finish(false);
    }

    for res in results {
        res?;
    }

    Ok(format!("Скачано файлов: {}", total_files))
}

pub async fn download_mods(project_name: String, state: &Mutex<GlobalState>) -> Result<String> {
    let (token, server_url, online) = {
        let guard = state.lock().await;
        let online = guard.project_config.online;
        let server_url = guard.project_config.resolved_server_url();
        if !online {
            (String::new(), server_url, false)
        } else {
            let token = guard
                .session
                .as_ref()
                .context("Необходима авторизация для скачивания модов")?
                .access_token
                .clone();
            (token, server_url, true)
        }
    };

    if !online {
        log_info!("[mods] Одиночный профиль {} — моды с сервера не скачиваются", project_name);
        return Ok("Одиночный профиль: моды с сервера не скачиваются".to_string());
    }

    let client = build_auth_client(&token)?;

    let list_step = StepHandle::start("mods.list", "Получение списка модов");
    log_info!("[mods] Запрос списка модов: {}/files/mods", server_url);
    let response = step_try!(list_step, client
        .get(format!("{}/files/mods", server_url))
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}/files/mods", server_url)));

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("[mods] Сервер вернул ошибку {}: {}", status, body);
        list_step.fail(format!("Сервер модов вернул {}", status));
        anyhow::bail!("Сервер модов вернул {} (проект: {}): {}", status, project_name, body);
    }

    let response_text = step_try!(list_step, response.text().await
        .with_context(|| format!("Не удалось прочитать ответ от {}/files/mods", server_url)));
    log_info!("[mods] Ответ сервера: {}", response_text);

    let mods: HashMap<String, String> = step_try!(list_step, serde_json::from_str(&response_text)
        .with_context(|| format!("Не удалось распарсить JSON списка модов (проект: {})", project_name)));
    list_step.finish(false);

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

    let clean_step = StepHandle::start("mods.clean", "Очистка лишних модов");
    if let Ok(mut entries) = tokio::fs::read_dir(&mods_dir).await {
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
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
    clean_step.finish(false);

    let download_step = StepHandle::start("mods.download", "Проверка и скачивание модов");

    if mods.is_empty() {
        log_info!("[mods] Список модов пуст");
        download_step.finish(true);
        return Ok("Нет модов для скачивания".to_string());
    }

    let mut files_to_download: Vec<String> = Vec::new();

    log_info!("[mods] Путь к папке модов: {:?}", mods_dir);

    for (server_key, expected_hash) in &mods {
        if !is_safe_relative_path(server_key) {
            log_err!("[mods] Отклонён небезопасный путь от сервера: {}", server_key);
            download_step.fail(format!("Сервер передал недопустимый путь: {}", server_key));
            anyhow::bail!("Сервер передал недопустимый путь мода: {}", server_key);
        }

        let file_name = server_key.strip_prefix("mods/").unwrap_or(server_key);
        let file_path = mods_dir.join(file_name);
        let exists = file_path.exists();
        if !exists {
            log_info!("[mods] Мод отсутствует: {}", file_name);
            files_to_download.push(server_key.clone());
        } else {
            match file_md5(&file_path).await {
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
    log_info!("[mods] Модов к скачиванию: {} из {}", total_to_download, mods.len());

    download_step.set_total(total_to_download as u64);

    if total_to_download == 0 {
        log_info!("[mods] Все моды актуальны");
        download_step.finish(true);
        return Ok(format!("Все моды актуальны: {}", mods.len()));
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

    let step_counter = download_step.clone();
    log_info!("[mods] Начало скачивания {} модов (макс. 15 параллельно)", total_to_download);
    let download_futures = semaphore_core(mods_dir, semaphore_list, move |url, dest| {
        let client = client.clone();
        let server_url = server_url.clone();
        async move {
            download_file(&client, &dest, &url, &server_url).await
        }
    }, Some(move |_: &str| step_counter.inc()));

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

    if errors > 0 {
        download_step.fail(format!("Не удалось скачать модов: {}", errors));
    } else {
        download_step.finish(false);
    }

    for res in results {
        res?;
    }

    Ok(format!("Скачано модов: {}/{}", downloaded, total_to_download))
}
