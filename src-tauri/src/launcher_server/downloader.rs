use crate::{log_err, log_info, step_try};
use anyhow::{Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::launcher_server::api_context;
use crate::state::dto::GlobalState;
use crate::utils::download_file::{file_sha1, write_stream_to_atomic};
use crate::utils::env_info::{is_safe_relative_path, launcher_path};
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};
use crate::utils::step_events::StepHandle;
use tokio::sync::Mutex;

pub(crate) fn build_auth_client(token: &str) -> Result<Client> {
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

pub(crate) struct ApiContext {
    pub client: Client,
    pub server_url: String,
}

pub(crate) async fn require_api_client(
    state: &Mutex<GlobalState>,
    auth_error: &str,
) -> Result<ApiContext> {
    let (token, server_url) = api_context(state, auth_error).await?;
    Ok(ApiContext {
        client: build_auth_client(&token)?,
        server_url,
    })
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
        .post(format!("{}/v1/launcher/files/download", server_url))
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

    let total_bytes = write_stream_to_atomic(response, file_path, url).await?;
    log_info!("[download] Скачано {} байт: {}", total_bytes, url);
    Ok(())
}

pub(crate) async fn fetch_file_list(
    client: &Client,
    server_url: &str,
    project_name: &str,
) -> Result<HashMap<String, String>> {
    let list_step = StepHandle::start("files.list", "Получение списка файлов");
    log_info!("[files] Запрос списка файлов: {}/v1/launcher/files/list", server_url);
    let response = step_try!(list_step, client
        .get(format!("{}/v1/launcher/files/list", server_url))
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}/v1/launcher/files/list", server_url)));

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
    Ok(file_list)
}

pub(crate) async fn fetch_mods_list(
    client: &Client,
    server_url: &str,
    project_name: &str,
) -> Result<HashMap<String, String>> {
    let list_step = StepHandle::start("mods.list", "Получение списка модов");
    log_info!("[mods] Запрос списка модов: {}/v1/launcher/files/mods", server_url);
    let response = step_try!(list_step, client
        .get(format!("{}/v1/launcher/files/mods", server_url))
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}/v1/launcher/files/mods", server_url)));

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("[mods] Сервер вернул ошибку {}: {}", status, body);
        list_step.fail(format!("Сервер модов вернул {}", status));
        anyhow::bail!("Сервер модов вернул {} (проект: {}): {}", status, project_name, body);
    }

    let response_text = step_try!(list_step, response.text().await
        .with_context(|| format!("Не удалось прочитать ответ от {}/v1/launcher/files/mods", server_url)));
    log_info!("[mods] Ответ сервера: {}", response_text);

    let mods: HashMap<String, String> = step_try!(list_step, serde_json::from_str(&response_text)
        .with_context(|| format!("Не удалось распарсить JSON списка модов (проект: {})", project_name)));
    list_step.finish(false);
    Ok(mods)
}

pub(crate) fn download_launcher_server_file(
    client: Client,
    server_url: String,
) -> impl Fn(String, PathBuf) -> futures::future::BoxFuture<'static, Result<(), anyhow::Error>>
       + Send
       + Sync
       + 'static {
    move |url: String, dest: PathBuf| {
        let client = client.clone();
        let server_url = server_url.clone();
        Box::pin(async move {
            download_file(&client, &dest, &url, &server_url).await
        })
    }
}

#[derive(Serialize, Default)]
pub struct FilesSyncReport {
    pub total: usize,
    pub downloaded: usize,
    pub skipped: bool,
}

struct SyncLabels {
    log_prefix: &'static str,
    item: &'static str,
    noun: &'static str,
}

const FILES_LABELS: SyncLabels = SyncLabels {
    log_prefix: "[files]",
    item: "файла",
    noun: "файлов",
};

const MODS_LABELS: SyncLabels = SyncLabels {
    log_prefix: "[mods]",
    item: "мода",
    noun: "модов",
};

async fn sync_server_files(
    ctx: &ApiContext,
    list: &HashMap<String, String>,
    base_dir: &Path,
    check_hashes: bool,
    step: StepHandle,
    labels: &SyncLabels,
    dest_for: impl Fn(&str) -> PathBuf,
) -> Result<FilesSyncReport> {
    let client = ctx.client.clone();
    let server_url = ctx.server_url.clone();
    let prefix = labels.log_prefix;

    let mut files_to_download: Vec<String> = Vec::new();

    for (key, expected_hash) in list {
        if !is_safe_relative_path(key) {
            log_err!("{} Отклонён небезопасный путь от сервера: {}", prefix, key);
            step.fail(format!("Сервер передал недопустимый путь: {}", key));
            anyhow::bail!("Сервер передал недопустимый путь {}: {}", labels.item, key);
        }

        let file_path = base_dir.join(dest_for(key));
        if !file_path.exists() {
            log_info!("{} Отсутствует: {}", prefix, dest_for(key).display());
            files_to_download.push(key.clone());
        } else if check_hashes {
            match file_sha1(&file_path).await {
                Ok(hash) if hash == *expected_hash => continue,
                Ok(hash) => {
                    log_info!(
                        "{} Изменился: {} (ожидается {}, есть {})",
                        prefix,
                        dest_for(key).display(),
                        expected_hash,
                        hash
                    );
                    files_to_download.push(key.clone());
                }
                Err(e) => {
                    log_info!("{} Ошибка чтения {}: {}", prefix, dest_for(key).display(), e);
                    files_to_download.push(key.clone());
                }
            }
        }
    }

    let total = files_to_download.len();
    log_info!("{} К скачиванию: {} из {}", prefix, total, list.len());
    step.set_total(total as u64);

    if total == 0 {
        log_info!("{} Всё актуально, скачивание не требуется", prefix);
        step.finish(true);
        return Ok(FilesSyncReport {
            total: list.len(),
            downloaded: 0,
            skipped: true,
        });
    }

    for key in &files_to_download {
        log_info!("{} Будет скачан: {}", prefix, key);
    }

    let semaphore_list: Vec<SemaphoreInfo> = files_to_download
        .iter()
        .map(|key| SemaphoreInfo {
            url: key.clone(),
            dest: dest_for(key),
        })
        .collect();

    log_info!(
        "{} Начало скачивания {} {} (макс. 15 параллельно)",
        prefix,
        total,
        labels.noun
    );
    let step_counter = step.clone();
    let download_futures = semaphore_core(base_dir.to_path_buf(), semaphore_list, move |url, dest| {
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
                log_err!("{} Ошибка: {:?}", prefix, e);
            }
        }
    }

    log_info!("{} Итого: скачано {}, ошибок: {}, всего: {}", prefix, downloaded, errors, total);

    if errors > 0 {
        step.fail(format!("Не удалось скачать {}: {}", labels.noun, errors));
    } else {
        step.finish(false);
    }

    for res in results {
        res?;
    }

    Ok(FilesSyncReport {
        total,
        downloaded,
        skipped: false,
    })
}

pub async fn download_all_files(project_name: String, check_hashes: bool, state: &Mutex<GlobalState>) -> Result<FilesSyncReport> {
    let online = state.lock().await.project_config.online;
    if !online {
        log_info!("[files] Одиночный профиль {} — синхронизация с сервером не нужна", project_name);
        return Ok(FilesSyncReport::default());
    }

    let ctx = require_api_client(state, "Необходима авторизация для скачивания файлов").await?;
    let file_list = fetch_file_list(&ctx.client, &ctx.server_url, &project_name).await?;

    let core = launcher_path(Some(&project_name))?;

    log_info!("[files] Получено файлов от сервера: {}", file_list.len());
    log_info!("[files] Папка проекта: {:?}", core);

    let download_step = StepHandle::start("files.download", "Скачивание файлов");
    sync_server_files(
        &ctx,
        &file_list,
        &core,
        check_hashes,
        download_step,
        &FILES_LABELS,
        |key: &str| PathBuf::from(key),
    )
    .await
}

pub async fn download_mods(project_name: String, state: &Mutex<GlobalState>) -> Result<FilesSyncReport> {
    let online = state.lock().await.project_config.online;
    if !online {
        log_info!("[mods] Одиночный профиль {} — моды с сервера не скачиваются", project_name);
        return Ok(FilesSyncReport::default());
    }

    let ctx = require_api_client(state, "Необходима авторизация для скачивания модов").await?;
    let mods = fetch_mods_list(&ctx.client, &ctx.server_url, &project_name).await?;

    log_info!("[mods] Получено модов: {}", mods.len());
    for (name, hash) in &mods {
        log_info!("  мод: {} (hash: {})", name, hash);
    }

    let mods_dir = launcher_path(Some(&project_name))?.join("mods");

    tokio::fs::create_dir_all(&mods_dir).await?;

    let server_mods: HashSet<&str> = mods.keys()
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
    log_info!("[mods] Путь к папке модов: {:?}", mods_dir);
    sync_server_files(
        &ctx,
        &mods,
        &mods_dir,
        true,
        download_step,
        &MODS_LABELS,
        |key: &str| PathBuf::from(key.strip_prefix("mods/").unwrap_or(key)),
    )
    .await
}
