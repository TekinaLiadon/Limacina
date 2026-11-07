use crate::{log_err, log_info, step_try, utils::errors::LauncherError};
use anyhow::{Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex as StdMutex, OnceLock};

use crate::launcher_server::{api_context, with_session_retry};
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::utils::download_file::{file_sha1, write_stream_to_atomic};
use crate::utils::env_info::{is_safe_relative_path, launcher_path};
use crate::utils::http::{read_body_capped, read_error_body_text};
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo, MAX_CONCURRENT_DOWNLOADS};
use crate::utils::step_events::StepHandle;
use tokio::sync::Mutex;

const MAX_AUTH_CLIENT_CACHE: usize = 16;
const MAX_LIST_BODY_BYTES: u64 = 16 * 1024 * 1024;

struct AuthClientCache {
    clients: HashMap<String, Client>,
    order: VecDeque<String>,
}

static AUTH_CLIENT_CACHE: OnceLock<StdMutex<AuthClientCache>> = OnceLock::new();

#[cfg(test)]
static AUTH_CLIENT_BUILD_COUNTS: OnceLock<StdMutex<HashMap<String, usize>>> = OnceLock::new();

#[cfg(test)]
static AUTH_CLIENT_TEST_LOCK: StdMutex<()> = StdMutex::new(());

#[cfg(test)]
fn reset_auth_client_cache() {
    let cache = AUTH_CLIENT_CACHE.get_or_init(|| {
        StdMutex::new(AuthClientCache {
            clients: HashMap::new(),
            order: VecDeque::new(),
        })
    });
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    guard.clients.clear();
    guard.order.clear();
}

pub(crate) fn build_auth_client(token: &str) -> Result<Client> {
    let cache = AUTH_CLIENT_CACHE.get_or_init(|| {
        StdMutex::new(AuthClientCache {
            clients: HashMap::new(),
            order: VecDeque::new(),
        })
    });
    {
        let guard = cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(client) = guard.clients.get(token) {
            return Ok(client.clone());
        }
    }
    let client = build_auth_client_uncached(token)?;
    #[cfg(test)]
    record_build_for_tests(token);
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.clients.contains_key(token) {
        while guard.order.len() >= MAX_AUTH_CLIENT_CACHE {
            if let Some(evicted) = guard.order.pop_front() {
                guard.clients.remove(&evicted);
            }
        }
        guard.order.push_back(token.to_string());
    }
    guard.clients.insert(token.to_string(), client.clone());
    Ok(client)
}

#[cfg(test)]
fn record_build_for_tests(token: &str) {
    let counts = AUTH_CLIENT_BUILD_COUNTS.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut guard = counts.lock().unwrap_or_else(|e| e.into_inner());
    *guard.entry(token.to_string()).or_insert(0) += 1;
}

#[cfg(test)]
fn auth_client_builds(token: &str) -> usize {
    AUTH_CLIENT_BUILD_COUNTS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(token)
        .copied()
        .unwrap_or(0)
}

fn build_auth_client_uncached(token: &str) -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token)).map_err(|e| {
            LauncherError::AuthServer(format!("Некорректный токен авторизации: {e:#}"))
        })?,
    );
    if let Some(id) = crate::utils::install_id::install_id() {
        headers.insert(
            crate::utils::install_id::LAUNCHER_ID_HEADER,
            HeaderValue::from_str(id).map_err(|e| {
                LauncherError::AuthServer(format!("Некорректный ID установки: {e:#}"))
            })?,
        );
    }
    Ok(crate::utils::http::base_client_builder()
        .default_headers(headers)
        .build()
        .map_err(|e| LauncherError::AuthServer(format!("Не удалось создать HTTP клиент: {e:#}")))?)
}

pub(crate) struct ApiContext {
    pub client: Client,
    pub server_url: String,
}

pub(crate) async fn require_api_client(state: &Mutex<GlobalState>) -> Result<ApiContext> {
    let (token, server_url) = api_context(state).await?;
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
    log_info!("[download] Запрос файла: {} -> {:?}", url, file_path);
    let body = BodyFile {
        url: url.to_string(),
    };

    let response = client
        .post(format!("{}/v1/launcher/files/download", server_url))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            LauncherError::LauncherServer(format!(
                "Не удалось отправить запрос на сервер для файла {url}: {e:#}"
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = read_error_body_text(response, url).await;
        log_err!(
            "[download] Ошибка сервера {} при скачивании {}: {}",
            status,
            url,
            body
        );
        return Err(LauncherError::HttpStatus {
            status: status.as_u16(),
            message: format!(
                "Сервер вернул {status} при скачивании {url}: {body} (путь: {file_path:?})"
            ),
        }
        .into());
    }

    let total_bytes = write_stream_to_atomic(response, file_path, url).await?;
    log_info!("[download] Скачано {} байт: {}", total_bytes, url);
    Ok(())
}

async fn download_and_verify(
    client: &Client,
    file_path: &Path,
    url: &str,
    server_url: &str,
    expected_hash: Option<&str>,
) -> Result<()> {
    let client = client.clone();
    let url = url.to_string();
    let server_url = server_url.to_string();
    crate::utils::download_file::download_and_verify_with(
        file_path,
        expected_hash,
        false,
        move |dest| async move { download_file(&client, &dest, &url, &server_url).await },
    )
    .await?;
    Ok(())
}

struct SyncSource {
    endpoint: &'static str,
    list_step_id: &'static str,
    list_step_label: &'static str,
    download_step_id: &'static str,
    download_step_label: &'static str,
    log_prefix: &'static str,
    item: &'static str,
    noun: &'static str,
    offline_note: &'static str,
}

const FILES_SOURCE: SyncSource = SyncSource {
    endpoint: "/v1/launcher/files/list",
    list_step_id: "files.list",
    list_step_label: "Получение списка файлов",
    download_step_id: "files.download",
    download_step_label: "Скачивание файлов",
    log_prefix: "[files]",
    item: "файла",
    noun: "файлов",
    offline_note: "синхронизация с сервером не нужна",
};

const MODS_SOURCE: SyncSource = SyncSource {
    endpoint: "/v1/launcher/files/mods",
    list_step_id: "mods.list",
    list_step_label: "Получение списка модов",
    download_step_id: "mods.download",
    download_step_label: "Проверка и скачивание модов",
    log_prefix: "[mods]",
    item: "мода",
    noun: "модов",
    offline_note: "моды с сервера не скачиваются",
};

const OPTIONAL_MODS_SOURCE: SyncSource = SyncSource {
    endpoint: "/v1/launcher/files/optional-mods",
    list_step_id: "mods.optional.list",
    list_step_label: "Получение списка необязательных модов",
    download_step_id: "mods.optional.download",
    download_step_label: "Синхронизация необязательных модов",
    log_prefix: "[optional-mods]",
    item: "мода",
    noun: "модов",
    offline_note: "",
};

async fn fetch_hash_map(
    client: &Client,
    server_url: &str,
    project_name: &str,
    source: &SyncSource,
) -> Result<HashMap<String, String>> {
    let list_step = StepHandle::start(source.list_step_id, source.list_step_label);
    let url = format!("{}{}", server_url, source.endpoint);
    log_info!(
        "{} Запрос списка {}: {}",
        source.log_prefix,
        source.noun,
        url
    );
    let response = step_try!(
        list_step,
        client.get(&url).send().await.map_err(|e| {
            LauncherError::LauncherServer(format!("Не удалось отправить запрос на {url}: {e:#}"))
        })
    );

    if !response.status().is_success() {
        let status = response.status();
        let body = read_error_body_text(response, &url).await;
        log_err!("{} Сервер вернул {}: {}", source.log_prefix, status, body);
        list_step.fail(format!("Сервер {} вернул {}", source.noun, status));
        return Err(LauncherError::HttpStatus {
            status: status.as_u16(),
            message: format!(
                "Сервер {} вернул {status} (проект: {project_name}): {body}",
                source.noun
            ),
        }
        .into());
    }

    let response_bytes = step_try!(
        list_step,
        read_body_capped(response, &url, MAX_LIST_BODY_BYTES).await
    );
    let response_text = String::from_utf8_lossy(&response_bytes).into_owned();

    let list: HashMap<String, String> = step_try!(
        list_step,
        serde_json::from_str(&response_text).map_err(|e| {
            LauncherError::LauncherServer(format!(
                "Не удалось распарсить JSON списка {} (проект: {project_name}): {e:#}",
                source.noun
            ))
        })
    );

    for (key, hash) in &list {
        if hash.trim().is_empty() {
            let message = format!("Сервер передал пустой хеш для {key} (проект: {project_name})");
            log_err!("{} {}", source.log_prefix, message);
            list_step.fail("Сервер передал пустой хеш файла");
            return Err(LauncherError::LauncherServer(message).into());
        }
    }

    log_info!(
        "{} Получено {}: {}",
        source.log_prefix,
        source.noun,
        list.len()
    );
    list_step.finish(false);
    Ok(list)
}

pub(crate) async fn fetch_mods_list(
    client: &Client,
    server_url: &str,
    project_name: &str,
) -> Result<HashMap<String, String>> {
    fetch_hash_map(client, server_url, project_name, &MODS_SOURCE).await
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
        Box::pin(async move { download_file(&client, &dest, &url, &server_url).await })
    }
}

#[derive(Serialize, Default)]
pub struct FilesSyncReport {
    pub total: usize,
    pub downloaded: usize,
    pub skipped: bool,
}

async fn fetch_online_list(
    project_name: &str,
    state: &Mutex<GlobalState>,
    source: &SyncSource,
) -> Result<Option<(ApiContext, HashMap<String, String>)>> {
    let online = state.lock().await.project_config.online;
    if !online {
        log_info!(
            "{} Одиночный профиль {}: {}",
            source.log_prefix,
            project_name,
            source.offline_note
        );
        return Ok(None);
    }

    let ctx = require_api_client(state).await?;
    let list = fetch_hash_map(&ctx.client, &ctx.server_url, project_name, source).await?;
    Ok(Some((ctx, list)))
}

async fn sync_server_files(
    ctx: &ApiContext,
    list: &HashMap<String, String>,
    base_dir: &Path,
    step: StepHandle,
    source: &SyncSource,
    dest_for: impl Fn(&str) -> PathBuf,
) -> Result<FilesSyncReport> {
    let client = ctx.client.clone();
    let server_url = ctx.server_url.clone();
    let prefix = source.log_prefix;

    let mut files_to_download: Vec<String> = Vec::new();

    for (key, expected_hash) in list {
        if !is_safe_relative_path(key) {
            log_err!("{} Отклонён небезопасный путь от сервера: {}", prefix, key);
            step.fail(format!("Сервер передал недопустимый путь: {}", key));
            return Err(LauncherError::InvalidModFilename(format!(
                "Сервер передал недопустимый путь {}: {}",
                source.item, key
            ))
            .into());
        }

        let file_path = base_dir.join(dest_for(key));
        if !file_path.exists() {
            log_info!("{} Отсутствует: {}", prefix, dest_for(key).display());
            files_to_download.push(key.clone());
        } else {
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
                    log_info!(
                        "{} Ошибка чтения {}: {}",
                        prefix,
                        dest_for(key).display(),
                        e
                    );
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
        "{} Начало скачивания {} {} (макс. {} параллельно)",
        prefix,
        total,
        source.noun,
        MAX_CONCURRENT_DOWNLOADS
    );
    let step_counter = step.clone();
    let verify_hashes: HashMap<String, String> = files_to_download
        .iter()
        .filter_map(|key| list.get(key).cloned().map(|hash| (key.clone(), hash)))
        .collect();
    let download_futures = semaphore_core(
        base_dir.to_path_buf(),
        semaphore_list,
        move |url, dest| {
            let client = client.clone();
            let server_url = server_url.clone();
            let expected = verify_hashes.get(&url).cloned();
            async move {
                download_and_verify(&client, &dest, &url, &server_url, expected.as_deref()).await
            }
        },
        Some(move |_: &str| step_counter.inc()),
    );

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

    log_info!(
        "{} Итого: скачано {}, ошибок: {}, всего: {}",
        prefix,
        downloaded,
        errors,
        total
    );

    if errors > 0 {
        step.fail(format!("Не удалось скачать {}: {}", source.noun, errors));
    } else {
        step.finish(false);
    }

    for res in results {
        res?;
    }

    Ok(FilesSyncReport {
        total: list.len(),
        downloaded,
        skipped: false,
    })
}

pub async fn download_all_files(
    project_name: String,
    state: &Mutex<GlobalState>,
) -> Result<FilesSyncReport> {
    let result = with_session_retry(state, || async {
        let Some((ctx, file_list)) = fetch_online_list(&project_name, state, &FILES_SOURCE).await?
        else {
            return Ok(FilesSyncReport::default());
        };

        let core = launcher_path(Some(&project_name))?;

        log_info!("[files] Получено файлов от сервера: {}", file_list.len());
        log_info!("[files] Папка проекта: {:?}", core);

        let download_step = StepHandle::start(
            FILES_SOURCE.download_step_id,
            FILES_SOURCE.download_step_label,
        );
        sync_server_files(
            &ctx,
            &file_list,
            &core,
            download_step,
            &FILES_SOURCE,
            |key: &str| PathBuf::from(key),
        )
        .await
    })
    .await;

    LauncherError::classify(result, LauncherError::LauncherServer)
}

pub async fn download_mods(
    project_name: String,
    state: &Mutex<GlobalState>,
) -> Result<FilesSyncReport> {
    let result = with_session_retry(state, || async {
        let Some((ctx, mods)) = fetch_online_list(&project_name, state, &MODS_SOURCE).await? else {
            return Ok(FilesSyncReport::default());
        };

        log_info!("[mods] Получено модов: {}", mods.len());
        for (name, hash) in &mods {
            log_info!("  мод: {} (hash: {})", name, hash);
        }

        let mods_dir = launcher_path(Some(&project_name))?.join("mods");

        tokio::fs::create_dir_all(&mods_dir)
            .await
            .with_context(|| format!("Не удалось создать папку модов {mods_dir:?}"))?;

        let server_mods: HashSet<String> = mods
            .keys()
            .map(|k| k.strip_prefix("mods/").unwrap_or(k).to_string())
            .collect();

        let download_step = StepHandle::start(
            MODS_SOURCE.download_step_id,
            MODS_SOURCE.download_step_label,
        );
        log_info!("[mods] Путь к папке модов: {:?}", mods_dir);
        let report = sync_server_files(
            &ctx,
            &mods,
            &mods_dir,
            download_step,
            &MODS_SOURCE,
            |key: &str| PathBuf::from(key.strip_prefix("mods/").unwrap_or(key)),
        )
        .await
        .context("Не удалось синхронизировать моды с сервером")?;

        let config = state.lock().await.project_config.clone();
        let cache_dir = launcher_path(Some(&project_name))?.join("optional-mods-cache");
        let optional_protected = match sync_optional_mods(
            &ctx,
            &config,
            &mods_dir,
            &cache_dir,
            &server_mods,
        )
        .await
        {
            Ok(protected) => protected,
            Err(e) => {
                log_err!(
                    "[optional-mods] Синк необязательных модов не удался, запуск продолжается: {e:#}"
                );
                HashSet::new()
            }
        };

        let clean_step = StepHandle::start("mods.clean", "Очистка лишних модов");
        step_try!(
            clean_step,
            cleanup_extra_mods(&mods_dir, &server_mods, &optional_protected).await
        );
        clean_step.finish(false);
        Ok(report)
    })
    .await;

    LauncherError::classify(result, LauncherError::LauncherServer)
}

async fn cleanup_extra_mods(
    mods_dir: &Path,
    server_mods: &HashSet<String>,
    protected: &HashSet<String>,
) -> Result<()> {
    if server_mods.is_empty() {
        log_info!(
            "[mods] Сервер передал пустой список модов — очистка лишних файлов пропущена, \
             локальные моды не тронуты"
        );
        return Ok(());
    }

    let mut entries = tokio::fs::read_dir(mods_dir).await.map_err(|e| {
        log_err!(
            "[mods] Не удалось открыть папку модов {:?}: {}",
            mods_dir,
            e
        );
        LauncherError::DiskIo(format!("Не удалось открыть папку модов {mods_dir:?}: {e}"))
    })?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        log_err!("[mods] Не удалось прочитать запись в папке модов: {}", e);
        LauncherError::DiskIo(format!("Не удалось прочитать запись в папке модов: {e}"))
    })? {
        let is_file = entry
            .file_type()
            .await
            .map_err(|e| {
                log_err!(
                    "[mods] Не удалось определить тип записи {:?}: {}",
                    entry.path(),
                    e
                );
                LauncherError::DiskIo(format!("Не удалось определить тип записи: {e}"))
            })?
            .is_file();
        if !is_file {
            continue;
        }

        let name_os = entry.file_name();
        let name = name_os.to_string_lossy();
        if server_mods.contains(name.as_ref()) {
            continue;
        }
        if protected.contains(name.as_ref()) {
            log_info!(
                "[mods] Мод защищён от очистки (включённый необязательный): {}",
                name
            );
            continue;
        }
        log_info!("[mods] Удаление лишнего мода: {}", name);
        tokio::fs::remove_file(entry.path()).await.map_err(|e| {
            log_err!("[mods] Не удалось удалить лишний мод {}: {}", name, e);
            LauncherError::DiskIo(format!("Не удалось удалить лишний мод {name}: {e}"))
        })?;
    }
    Ok(())
}

enum OptionalAction {
    ToCache,
    FromCache,
    Download,
}

async fn purge_stale_cache(cache_dir: &Path, server_files: &HashMap<String, String>) {
    let mut entries = match tokio::fs::read_dir(cache_dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            log_err!(
                "[optional-mods] Не удалось открыть папку кеша {:?}: {}",
                cache_dir,
                e
            );
            return;
        }
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(e) => {
                log_err!("[optional-mods] Не удалось прочитать папку кеша: {}", e);
                return;
            }
        };
        let is_file = match entry.file_type().await {
            Ok(file_type) => file_type.is_file(),
            Err(e) => {
                log_err!(
                    "[optional-mods] Не удалось определить тип записи {:?}: {}",
                    entry.path(),
                    e
                );
                continue;
            }
        };
        if !is_file {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if server_files.contains_key(&name) {
            continue;
        }
        log_info!("[optional-mods] Удаление осиротевшего файла кеша: {}", name);
        if let Err(e) = tokio::fs::remove_file(entry.path()).await {
            log_err!(
                "[optional-mods] Не удалось удалить осиротевший файл кеша {}: {}",
                name,
                e
            );
        }
    }
}

async fn apply_optional_action(
    ctx: &ApiContext,
    mods_dir: &Path,
    cache_dir: &Path,
    name: &str,
    hash: &str,
    action: &OptionalAction,
) -> Result<()> {
    let mods_path = mods_dir.join(name);
    let cache_path = cache_dir.join(name);
    match action {
        OptionalAction::ToCache => {
            tokio::fs::create_dir_all(cache_dir)
                .await
                .with_context(|| {
                    format!("Не удалось создать папку кеша необязательных модов {cache_dir:?}")
                })?;
            if cache_path.exists() {
                tokio::fs::remove_file(&cache_path).await.with_context(|| {
                    format!(
                        "Не удалось удалить старую копию кеша {}",
                        cache_path.display()
                    )
                })?;
            }
            tokio::fs::rename(&mods_path, &cache_path)
                .await
                .with_context(|| {
                    format!(
                        "Не удалось переместить выключенный мод {} в кеш",
                        mods_path.display()
                    )
                })?;
            log_info!("[optional-mods] Выключенный мод перемещён в кеш: {}", name);
        }
        OptionalAction::FromCache => {
            if mods_path.exists() {
                tokio::fs::remove_file(&mods_path).await.with_context(|| {
                    format!("Не удалось удалить устаревший мод {}", mods_path.display())
                })?;
            }
            tokio::fs::rename(&cache_path, &mods_path)
                .await
                .with_context(|| {
                    format!(
                        "Не удалось переместить включённый мод из кеша {}",
                        cache_path.display()
                    )
                })?;
            log_info!("[optional-mods] Включённый мод перемещён из кеша: {}", name);
        }
        OptionalAction::Download => {
            let key = format!("optional-mods/{name}");
            log_info!("[optional-mods] Докачка необязательного мода: {}", name);
            download_and_verify(&ctx.client, &mods_path, &key, &ctx.server_url, Some(hash))
                .await
                .with_context(|| format!("Не удалось скачать необязательный мод {name}"))?;
            log_info!("[optional-mods] Необязательный мод скачан: {}", name);
        }
    }
    Ok(())
}

pub(crate) async fn sync_optional_mods(
    ctx: &ApiContext,
    project: &ProjectConfig,
    mods_dir: &Path,
    cache_dir: &Path,
    mandatory_names: &HashSet<String>,
) -> Result<HashSet<String>> {
    let list = fetch_hash_map(
        &ctx.client,
        &ctx.server_url,
        &project.project_name,
        &OPTIONAL_MODS_SOURCE,
    )
    .await?;

    if list.is_empty() {
        log_info!(
            "[optional-mods] Сервер не передал необязательных модов — синк пропущен, локальные данные не тронуты"
        );
        return Ok(HashSet::new());
    }

    let mut server_files: HashMap<String, String> = HashMap::new();
    for (key, hash) in &list {
        if !is_safe_relative_path(key) {
            log_err!(
                "[optional-mods] Отклонён небезопасный путь от сервера: {}",
                key
            );
            continue;
        }
        let Some(name) = key.strip_prefix("optional-mods/") else {
            log_err!(
                "[optional-mods] Неожиданный ключ списка без префикса optional-mods/: {}",
                key
            );
            continue;
        };
        server_files.insert(name.to_string(), hash.clone());
    }

    if server_files.is_empty() {
        log_err!(
            "[optional-mods] Сервер передал список без валидных необязательных модов — синк пропущен, локальные данные не тронуты"
        );
        return Ok(HashSet::new());
    }

    let enabled: HashSet<String> = project
        .optional_mods
        .iter()
        .filter(|key| list.contains_key(*key))
        .filter_map(|key| key.strip_prefix("optional-mods/"))
        .filter(|name| server_files.contains_key(*name))
        .map(str::to_string)
        .collect();
    let protected: HashSet<String> = enabled.difference(mandatory_names).cloned().collect();

    purge_stale_cache(cache_dir, &server_files).await;

    let mut actions: Vec<(String, String, OptionalAction)> = Vec::new();
    for (name, hash) in &server_files {
        if mandatory_names.contains(name) {
            log_info!(
                "[optional-mods] Необязательный мод {} совпадает по имени с обязательным — пропущен без перемещений и докачки",
                name
            );
            continue;
        }
        let mods_path = mods_dir.join(name);
        let cache_path = cache_dir.join(name);
        if enabled.contains(name) {
            let mods_fresh = mods_path.exists()
                && matches!(file_sha1(&mods_path).await, Ok(actual) if actual == *hash);
            if mods_fresh {
                continue;
            }
            let cache_fresh = cache_path.exists()
                && matches!(file_sha1(&cache_path).await, Ok(actual) if actual == *hash);
            let action = if cache_fresh {
                OptionalAction::FromCache
            } else {
                OptionalAction::Download
            };
            actions.push((name.clone(), hash.clone(), action));
        } else if mods_path.exists() {
            actions.push((name.clone(), hash.clone(), OptionalAction::ToCache));
        }
    }

    let step = StepHandle::start(
        OPTIONAL_MODS_SOURCE.download_step_id,
        OPTIONAL_MODS_SOURCE.download_step_label,
    );
    log_info!(
        "{} Запланировано операций: {}",
        OPTIONAL_MODS_SOURCE.log_prefix,
        actions.len()
    );
    step.set_total(actions.len() as u64);

    let mut errors: Vec<String> = Vec::new();
    for (name, hash, action) in &actions {
        if let Err(e) = apply_optional_action(ctx, mods_dir, cache_dir, name, hash, action).await {
            log_err!("{} {}", OPTIONAL_MODS_SOURCE.log_prefix, e);
            errors.push(format!("{name}: {e:#}"));
        }
        step.inc();
    }

    if errors.is_empty() {
        step.finish(actions.is_empty());
    } else {
        let summary = format!(
            "Не удалось синхронизировать необязательные моды: {} из {}, первая причина: {}",
            errors.len(),
            actions.len(),
            errors[0]
        );
        log_err!("{} {}", OPTIONAL_MODS_SOURCE.log_prefix, summary);
        step.fail(summary.clone());
    }
    Ok(protected)
}

#[cfg(test)]
mod mock_server_tests {
    use super::*;
    use crate::auth::storage;
    use crate::commands::auth::wipe_project_credentials;
    use crate::state::dto::{GlobalState, ProjectConfig, SessionTokens};
    use crate::test_support::{
        rotation_payload, seed_online_project, sha1_hex, step_event_id, LauncherDirGuard, MockEnv,
    };
    use crate::utils::http::http_client;
    use crate::utils::step_events::StepEvent;
    use mockito::{Matcher, Server};
    use serde_json::json;

    async fn api_context(server: &Server) -> ApiContext {
        ApiContext {
            client: build_auth_client("test-token").expect("клиент"),
            server_url: server.url(),
        }
    }

    fn state_with_server(server_url: &str, access_token: &str) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Cordelia".to_string(),
                server_url: Some(server_url.to_string()),
                ..ProjectConfig::default()
            },
            session: Some(SessionTokens {
                access_token: access_token.to_string(),
                uuid: String::new(),
                username: "tester".to_string(),
                project_name: "Cordelia".to_string(),
            }),
            ..GlobalState::default()
        })
    }

    async fn mock_mods_list(server: &mut Server, mods: &[(&str, &str)]) {
        let body: HashMap<&str, &str> = mods.iter().copied().collect();
        server
            .mock("GET", "/v1/launcher/files/mods")
            .with_status(200)
            .with_body(json!(body).to_string())
            .create_async()
            .await;
    }

    fn seed_mods_dir(dir: &LauncherDirGuard, files: &[(&str, &[u8])]) -> PathBuf {
        let mods_dir = dir.project_dir("Cordelia").join("mods");
        std::fs::create_dir_all(&mods_dir).expect("создание папки модов");
        for (name, content) in files {
            std::fs::write(mods_dir.join(name), content).expect("запись тестового мода");
        }
        mods_dir
    }

    #[tokio::test]
    async fn sync_downloads_missing_and_changed_files_and_skips_intact() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_sync").await;

        let alpha = b"alpha config".to_vec();
        let beta = b"beta jar".to_vec();
        let gamma = b"gamma".to_vec();

        let alpha_mock = server
            .mock("POST", "/v1/launcher/files/download")
            .match_body(Matcher::PartialJsonString(
                json!({"url": "configs/settings.json"}).to_string(),
            ))
            .match_header("authorization", "Bearer test-token")
            .with_status(200)
            .with_body(alpha.clone())
            .create_async()
            .await;
        let beta_mock = server
            .mock("POST", "/v1/launcher/files/download")
            .match_body(Matcher::PartialJsonString(
                json!({"url": "mods/a.jar"}).to_string(),
            ))
            .match_header("authorization", "Bearer test-token")
            .with_status(200)
            .with_body(beta.clone())
            .create_async()
            .await;

        let list = HashMap::from([
            ("configs/settings.json".to_string(), sha1_hex(&alpha)),
            ("mods/a.jar".to_string(), sha1_hex(&beta)),
            ("configs/ok.json".to_string(), sha1_hex(&gamma)),
        ]);

        let base = dir.project_dir("Cordelia");
        std::fs::create_dir_all(base.join("configs")).unwrap();
        std::fs::create_dir_all(base.join("mods")).unwrap();
        std::fs::write(base.join("configs/ok.json"), &gamma).unwrap();
        std::fs::write(base.join("mods/a.jar"), b"stale").unwrap();

        let ctx = api_context(&server).await;
        let step = StepHandle::start("files.download", "Скачивание файлов");
        let report = sync_server_files(&ctx, &list, &base, step, &FILES_SOURCE, |key: &str| {
            PathBuf::from(key)
        })
        .await
        .expect("синхронизация файлов");

        assert_eq!(report.total, 3);
        assert_eq!(report.downloaded, 2);
        assert!(!report.skipped);
        assert_eq!(
            std::fs::read(base.join("configs/settings.json")).unwrap(),
            alpha
        );
        assert_eq!(std::fs::read(base.join("mods/a.jar")).unwrap(), beta);
        assert_eq!(std::fs::read(base.join("configs/ok.json")).unwrap(), gamma);

        alpha_mock.assert_async().await;
        beta_mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_reports_error_when_downloaded_hash_mismatches() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_sync_bad_hash").await;
        server
            .mock("POST", "/v1/launcher/files/download")
            .with_status(200)
            .with_body("corrupt bytes")
            .create_async()
            .await;

        let expected_hash = sha1_hex(b"good bytes");
        let base = dir.project_dir("Cordelia");
        std::fs::create_dir_all(base.join("mods")).unwrap();
        std::fs::write(base.join("mods/a.jar"), b"stale").unwrap();

        let list = HashMap::from([("mods/a.jar".to_string(), expected_hash)]);
        let ctx = api_context(&server).await;
        let step = StepHandle::start("files.download", "Скачивание файлов");
        let result = sync_server_files(&ctx, &list, &base, step, &FILES_SOURCE, |key: &str| {
            PathBuf::from(key)
        })
        .await;

        assert!(
            result.is_err(),
            "несовпадающий хеш должен давать ошибку, а не успешный отчёт"
        );
        assert_eq!(
            std::fs::read(base.join("mods/a.jar")).unwrap(),
            b"stale",
            "битая загрузка не должна перезаписывать существующий файл: прежнее содержимое переживает сбой"
        );
    }

    #[tokio::test]
    async fn sync_rejects_unsafe_paths_from_server() {
        let dir = LauncherDirGuard::acquire("files_unsafe").await;
        let server = Server::new_async().await;

        let list = HashMap::from([("../evil.jar".to_string(), "hash".to_string())]);
        let ctx = api_context(&server).await;
        let step = StepHandle::start("files.download", "Скачивание файлов");
        let result = sync_server_files(
            &ctx,
            &list,
            &dir.project_dir("Cordelia"),
            step,
            &FILES_SOURCE,
            |key: &str| PathBuf::from(key),
        )
        .await;

        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mods_clean_failure_fails_clean_step() {
        use crate::utils::step_events::test_capture;
        use crate::utils::step_events::{StepChannel, StepEvent};
        use std::os::unix::fs::PermissionsExt;

        let MockEnv { dir, mut server } = MockEnv::acquire("mods_clean_fail").await;
        let _capture = test_capture::CaptureGuard::new();

        let intact = b"intact mod".to_vec();
        mock_mods_list(&mut server, &[("mods/a.jar", &sha1_hex(&intact))]).await;

        let mods_dir = seed_mods_dir(&dir, &[("a.jar", &intact), ("extra.jar", b"stale")]);
        std::fs::set_permissions(&mods_dir, std::fs::Permissions::from_mode(0o500))
            .expect("каталог без права на запись");

        let state = state_with_server(&server.url(), "test-token");

        let result = download_mods("Cordelia".to_string(), &state).await;
        std::fs::set_permissions(&mods_dir, std::fs::Permissions::from_mode(0o755))
            .expect("восстановление прав");

        let error = result
            .err()
            .expect("ошибка удаления лишнего мода должна прерывать синхронизацию");
        assert!(
            error.to_string().contains("Не удалось удалить лишний мод"),
            "неожиданная ошибка: {error}"
        );

        let terminals: Vec<StepEvent> = test_capture::captured()
            .into_iter()
            .filter(|(channel, event)| {
                matches!(channel, StepChannel::Launch)
                    && matches!(event, StepEvent::Finished { .. } | StepEvent::Failed { .. })
                    && step_event_id(event) == "mods.clean"
            })
            .map(|(_, event)| event)
            .collect();
        assert_eq!(
            terminals.len(),
            1,
            "шаг очистки не должен оставаться активным после ошибки: {terminals:?}"
        );
        assert!(
            matches!(terminals.first(), Some(StepEvent::Failed { .. })),
            "ошибка очистки должна фейлить шаг: {terminals:?}"
        );
    }

    #[tokio::test]
    async fn cleanup_extra_mods_keeps_local_mods_when_server_list_empty() {
        let dir = LauncherDirGuard::acquire("mods_clean_empty_list").await;
        let mods_dir = seed_mods_dir(&dir, &[("a.jar", b"alpha"), ("b.jar", b"beta")]);

        cleanup_extra_mods(&mods_dir, &HashSet::new(), &HashSet::new())
            .await
            .expect("очистка с пустым списком сервера");

        assert!(
            mods_dir.join("a.jar").exists() && mods_dir.join("b.jar").exists(),
            "пустой список от сервера не должен удалять ни одного локального мода"
        );
    }

    #[tokio::test]
    async fn cleanup_extra_mods_removes_only_files_missing_from_nonempty_list() {
        let dir = LauncherDirGuard::acquire("mods_clean_nonempty_list").await;
        let mods_dir = seed_mods_dir(&dir, &[("a.jar", b"alpha"), ("extra.jar", b"stale")]);

        cleanup_extra_mods(
            &mods_dir,
            &HashSet::from(["a.jar".to_string()]),
            &HashSet::new(),
        )
        .await
        .expect("очистка с непустым списком сервера");

        assert!(
            mods_dir.join("a.jar").exists(),
            "мод, присутствующий на сервере, должен остаться"
        );
        assert!(
            !mods_dir.join("extra.jar").exists(),
            "мод, отсутствующий на сервере, должен удаляться"
        );
    }

    #[tokio::test]
    async fn download_mods_empty_server_list_keeps_local_mods() {
        let MockEnv { dir, mut server } = MockEnv::acquire("mods_sync_empty_list").await;
        mock_mods_list(&mut server, &[]).await;

        let mods_dir = seed_mods_dir(&dir, &[("a.jar", b"alpha"), ("b.jar", b"beta")]);

        let state = state_with_server(&server.url(), "test-token");

        let report = download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синхронизация с пустым списком модов");

        assert_eq!(report.total, 0);
        assert_eq!(report.downloaded, 0);
        assert!(
            mods_dir.join("a.jar").exists() && mods_dir.join("b.jar").exists(),
            "пустой список модов от сервера не должен вычищать локальную папку mods"
        );
    }

    #[tokio::test]
    async fn download_mods_offline_profile_skips_sync_and_keeps_local_mods() {
        let dir = LauncherDirGuard::acquire("mods_sync_offline").await;
        let mods_dir = seed_mods_dir(&dir, &[("a.jar", b"alpha")]);

        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Cordelia".to_string(),
                online: false,
                ..ProjectConfig::default()
            },
            ..GlobalState::default()
        });

        let report = download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синхронизация одиночного профиля");

        assert_eq!(report.total, 0);
        assert_eq!(report.downloaded, 0);
        assert!(
            mods_dir.join("a.jar").exists(),
            "у одиночного профиля нет списка модов — локальные файлы должны остаться"
        );
    }

    #[tokio::test]
    async fn download_mods_removes_local_mods_missing_from_server_list() {
        let MockEnv { dir, mut server } = MockEnv::acquire("mods_sync_extra_cleanup").await;

        let intact = b"intact mod".to_vec();
        mock_mods_list(&mut server, &[("mods/a.jar", &sha1_hex(&intact))]).await;

        let mods_dir = seed_mods_dir(&dir, &[("a.jar", &intact), ("extra.jar", b"stale")]);

        let state = state_with_server(&server.url(), "test-token");

        let report = download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синхронизация модов");

        assert_eq!(report.total, 1);
        assert_eq!(report.downloaded, 0);
        assert!(
            mods_dir.join("a.jar").exists(),
            "мод с сервера должен остаться"
        );
        assert!(
            !mods_dir.join("extra.jar").exists(),
            "при непустом списке лишний локальный мод должен удаляться как раньше"
        );
    }

    #[tokio::test]
    async fn download_all_files_redownloads_changed_server_file() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_entry_changed").await;

        let fresh = b"fresh config v2".to_vec();
        let intact = b"intact bytes".to_vec();

        let list_mock = server
            .mock("GET", "/v1/launcher/files/list")
            .with_status(200)
            .with_body(
                json!({
                    "configs/settings.json": sha1_hex(&fresh),
                    "configs/intact.json": sha1_hex(&intact),
                })
                .to_string(),
            )
            .create_async()
            .await;
        let changed_mock = server
            .mock("POST", "/v1/launcher/files/download")
            .match_body(Matcher::PartialJsonString(
                json!({"url": "configs/settings.json"}).to_string(),
            ))
            .with_status(200)
            .with_body(fresh.clone())
            .create_async()
            .await;
        let intact_mock = server
            .mock("POST", "/v1/launcher/files/download")
            .match_body(Matcher::PartialJsonString(
                json!({"url": "configs/intact.json"}).to_string(),
            ))
            .expect(0)
            .with_status(200)
            .with_body(intact.clone())
            .create_async()
            .await;

        let base = dir.project_dir("Cordelia");
        std::fs::create_dir_all(base.join("configs")).unwrap();
        std::fs::write(base.join("configs/settings.json"), b"stale local").unwrap();
        std::fs::write(base.join("configs/intact.json"), &intact).unwrap();

        let state = state_with_server(&server.url(), "test-token");

        let report = download_all_files("Cordelia".to_string(), &state)
            .await
            .expect("синхронизация файлов сервера");

        assert_eq!(report.total, 2);
        assert_eq!(report.downloaded, 1);
        assert!(!report.skipped);
        assert_eq!(
            std::fs::read(base.join("configs/settings.json")).unwrap(),
            fresh
        );
        assert_eq!(
            std::fs::read(base.join("configs/intact.json")).unwrap(),
            intact
        );

        list_mock.assert_async().await;
        changed_mock.assert_async().await;
        intact_mock.assert_async().await;
    }

    #[tokio::test]
    async fn fetch_mods_list_sends_launcher_id_header() {
        crate::utils::install_id::override_install_id_for_tests("test-install-id");

        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/v1/launcher/files/mods")
            .match_header("x-launcher-id", "test-install-id")
            .with_status(200)
            .with_body(json!({"mods/a.jar": "hash1"}).to_string())
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let _ = fetch_mods_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect("список модов");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn fetch_mods_list_parses_server_response() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/files/mods")
            .with_status(200)
            .with_body(json!({"mods/a.jar": "hash1", "mods/b.jar": "hash2"}).to_string())
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let list = fetch_mods_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect("список модов");

        assert_eq!(list.get("mods/a.jar").map(String::as_str), Some("hash1"));
        assert_eq!(list.len(), 2);
    }

    #[tokio::test]
    async fn fetch_mods_list_fails_on_server_error() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/files/mods")
            .with_status(500)
            .with_body("boom")
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let error = fetch_mods_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect_err("сервер вернул 500");

        assert!(error.to_string().contains("500"), "{}", error);
    }

    #[tokio::test]
    async fn fetch_mods_list_rejects_oversized_list_body() {
        let mut server = Server::new_async().await;
        let padding = "a".repeat(MAX_LIST_BODY_BYTES as usize);
        server
            .mock("GET", "/v1/launcher/files/mods")
            .with_status(200)
            .with_body(format!("{{\"mods/a.jar\": \"{padding}\"}}"))
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let error = fetch_mods_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect_err("список сверх лимита должен отклоняться");

        assert!(
            error.chain().any(|cause| matches!(
                cause.downcast_ref::<LauncherError>(),
                Some(LauncherError::SizeLimit(_))
            )),
            "ожидался SizeLimit: {error}"
        );
        assert!(
            error.to_string().contains("превысил"),
            "ошибка должна называть превышение размера: {error}"
        );
    }

    #[tokio::test]
    async fn download_file_error_body_is_bounded() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_error_body").await;
        let padding = "x".repeat(2 * 1024 * 1024);
        server
            .mock("POST", "/v1/launcher/files/download")
            .with_status(500)
            .with_body(format!("boom-{padding}"))
            .create_async()
            .await;

        let dest = dir.project_dir("Cordelia").join("mods/a.jar");
        let error = download_file(http_client(), &dest, "mods/a.jar", &server.url())
            .await
            .expect_err("ошибка сервера должна пробрасываться");

        let rendered = error.to_string();
        assert!(
            !rendered.contains(&padding),
            "тело ошибки не должно попадать в сообщение целиком: {}",
            rendered.len()
        );
        assert!(
            rendered.contains("не прочитано"),
            "ошибка должна называть причину непрочитанного тела: {rendered}"
        );
        assert!(!dest.exists(), "файл назначения не должен появиться");
    }

    #[tokio::test]
    async fn fetch_mods_list_rejects_empty_hash() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/files/mods")
            .with_status(200)
            .with_body(json!({"mods/a.jar": "", "mods/b.jar": "   "}).to_string())
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let error = fetch_mods_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect_err("пустой хеш должен отклоняться");

        assert!(
            error.to_string().contains("пустой хеш"),
            "ошибка должна называть пустой хеш: {error}"
        );
    }

    #[tokio::test]
    async fn download_all_files_retries_after_401_with_rotated_token() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_auth_retry").await;

        let fresh = b"fresh config".to_vec();

        let expired_list = server
            .mock("GET", "/v1/launcher/files/list")
            .match_header("authorization", "Bearer access-stale")
            .with_status(401)
            .with_body("expired")
            .create_async()
            .await;
        let refresh_mock = server
            .mock("POST", "/v1/common/auth/refresh")
            .match_body(Matcher::PartialJsonString(
                json!({"refresh_token": "tok-old"}).to_string(),
            ))
            .with_status(200)
            .with_body(rotation_payload("access-2", "tok-new"))
            .create_async()
            .await;
        let rotated_list = server
            .mock("GET", "/v1/launcher/files/list")
            .match_header("authorization", "Bearer access-2")
            .with_status(200)
            .with_body(json!({"configs/settings.json": sha1_hex(&fresh)}).to_string())
            .create_async()
            .await;
        let download_mock = server
            .mock("POST", "/v1/launcher/files/download")
            .match_header("authorization", "Bearer access-2")
            .with_status(200)
            .with_body(fresh.clone())
            .create_async()
            .await;

        seed_online_project("Cordelia", &server.url()).await;
        storage::save_fallback("Cordelia", "tester", "refresh_token", "tok-old")
            .expect("сохранение refresh-токена");

        let state = state_with_server(&server.url(), "access-stale");

        let report = download_all_files("Cordelia".to_string(), &state)
            .await
            .expect("синхронизация после ротации токена");

        assert_eq!(report.downloaded, 1);
        assert!(!report.skipped);
        assert_eq!(
            std::fs::read(dir.project_dir("Cordelia").join("configs/settings.json")).unwrap(),
            fresh
        );
        assert_eq!(
            state
                .lock()
                .await
                .session
                .as_ref()
                .expect("сессия")
                .access_token,
            "access-2",
            "токен сессии должен обновиться после ротации"
        );
        assert_eq!(
            storage::get_credential("Cordelia", "tester", "refresh_token")
                .await
                .expect("токен хранилища"),
            "tok-new",
            "refresh-токен должен перезаписаться ротацией"
        );

        expired_list.assert_async().await;
        refresh_mock.assert_async().await;
        rotated_list.assert_async().await;
        download_mock.assert_async().await;

        wipe_project_credentials("Cordelia", &["tester".to_string()])
            .await
            .expect("очистка хранилища");
    }

    #[tokio::test]
    async fn download_file_overwrites_existing_content() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_overwrite").await;
        server
            .mock("POST", "/v1/launcher/files/download")
            .with_status(200)
            .with_body("fresh")
            .create_async()
            .await;

        let dest = dir.project_dir("Cordelia").join("mods/a.jar");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, b"old").unwrap();

        download_file(http_client(), &dest, "mods/a.jar", &server.url())
            .await
            .expect("скачивание");

        assert_eq!(std::fs::read(&dest).unwrap(), b"fresh");
    }

    async fn mock_download_body(server: &mut Server, body: Vec<u8>) {
        server
            .mock("POST", "/v1/launcher/files/download")
            .with_status(200)
            .with_body(body)
            .create_async()
            .await;
    }

    async fn verify_download(
        server: &Server,
        dir: &LauncherDirGuard,
        expected: Option<&str>,
    ) -> Result<(), anyhow::Error> {
        let dest = dir.project_dir("Cordelia").join("mods/a.jar");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();

        download_and_verify(
            &build_auth_client("test-token").expect("клиент"),
            &dest,
            "mods/a.jar",
            &server.url(),
            expected,
        )
        .await
    }

    #[tokio::test]
    async fn download_and_verify_keeps_file_with_matching_hash() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_hash_ok").await;
        let body = b"good bytes".to_vec();
        mock_download_body(&mut server, body.clone()).await;

        verify_download(&server, &dir, Some(&sha1_hex(&body)))
            .await
            .expect("скачивание с проверкой хеша");

        let dest = dir.project_dir("Cordelia").join("mods/a.jar");
        assert_eq!(std::fs::read(&dest).unwrap(), body);
    }

    #[tokio::test]
    async fn download_and_verify_deletes_file_with_mismatched_hash() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_hash_bad").await;
        mock_download_body(&mut server, b"corrupt bytes".to_vec()).await;

        let result = verify_download(
            &server,
            &dir,
            Some("0000000000000000000000000000000000000000"),
        )
        .await;

        assert!(result.is_err(), "битая загрузка должна быть ошибкой");
        assert!(
            !dir.project_dir("Cordelia").join("mods/a.jar").exists(),
            "файл с неверным хешем должен быть удалён"
        );
    }

    #[tokio::test]
    async fn download_and_verify_skips_check_without_expected_hash() {
        let MockEnv { dir, mut server } = MockEnv::acquire("files_no_hash").await;
        mock_download_body(&mut server, b"any bytes".to_vec()).await;

        verify_download(&server, &dir, None)
            .await
            .expect("скачивание без хеша");

        let dest = dir.project_dir("Cordelia").join("mods/a.jar");
        assert_eq!(std::fs::read(&dest).unwrap(), b"any bytes");
    }

    async fn mock_optional_list(server: &mut Server, mods: &[(&str, &str)]) {
        let body: HashMap<&str, &str> = mods.iter().copied().collect();
        server
            .mock("GET", "/v1/launcher/files/optional-mods")
            .with_status(200)
            .with_body(json!(body).to_string())
            .create_async()
            .await;
    }

    async fn optional_download_mock(
        server: &mut Server,
        key: &str,
        status: usize,
        body: &[u8],
        expect_hits: usize,
    ) -> mockito::Mock {
        server
            .mock("POST", "/v1/launcher/files/download")
            .match_body(Matcher::PartialJsonString(json!({"url": key}).to_string()))
            .match_header("authorization", "Bearer test-token")
            .expect(expect_hits)
            .with_status(status)
            .with_body(body)
            .create_async()
            .await
    }

    fn seed_cache_dir(dir: &LauncherDirGuard, files: &[(&str, &[u8])]) -> PathBuf {
        let cache_dir = dir.project_dir("Cordelia").join("optional-mods-cache");
        std::fs::create_dir_all(&cache_dir).expect("создание папки кеша");
        for (name, content) in files {
            std::fs::write(cache_dir.join(name), content).expect("запись тестового кеша");
        }
        cache_dir
    }

    fn state_with_optional(
        server_url: &str,
        access_token: &str,
        selection: &[&str],
    ) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Cordelia".to_string(),
                server_url: Some(server_url.to_string()),
                optional_mods: selection.iter().map(|key| key.to_string()).collect(),
                ..ProjectConfig::default()
            },
            session: Some(SessionTokens {
                access_token: access_token.to_string(),
                uuid: String::new(),
                username: "tester".to_string(),
                project_name: "Cordelia".to_string(),
            }),
            ..GlobalState::default()
        })
    }

    fn dir_snapshot(dir: &Path) -> HashMap<String, Vec<u8>> {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().is_file())
            .map(|entry| {
                (
                    entry.file_name().to_string_lossy().into_owned(),
                    std::fs::read(entry.path()).expect("чтение снимка папки"),
                )
            })
            .collect()
    }

    fn launch_terminals(id: &str) -> Vec<StepEvent> {
        use crate::utils::step_events::StepChannel;

        crate::utils::step_events::test_capture::captured()
            .into_iter()
            .filter(|(channel, event)| {
                matches!(channel, StepChannel::Launch)
                    && matches!(event, StepEvent::Finished { .. } | StepEvent::Failed { .. })
                    && step_event_id(event) == id
            })
            .map(|(_, event)| event)
            .collect()
    }

    fn assert_finished(id: &str) {
        let terminals = launch_terminals(id);
        assert_eq!(
            terminals.len(),
            1,
            "шаг {id} должен завершиться ровно один раз: {terminals:?}"
        );
        assert!(
            matches!(terminals.first(), Some(StepEvent::Finished { .. })),
            "шаг {id} должен завершиться успехом: {terminals:?}"
        );
    }

    fn assert_failed(id: &str) {
        let terminals = launch_terminals(id);
        assert_eq!(
            terminals.len(),
            1,
            "шаг {id} должен завершиться ровно один раз: {terminals:?}"
        );
        assert!(
            matches!(terminals.first(), Some(StepEvent::Failed { .. })),
            "шаг {id} должен завершиться ошибкой: {terminals:?}"
        );
    }

    #[tokio::test]
    async fn optional_sync_downloads_enabled_mod_missing_everywhere() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_download").await;
        let _capture = test_capture::CaptureGuard::new();

        let base = b"base jar".to_vec();
        let opt = b"optional jar".to_vec();

        mock_mods_list(&mut server, &[("mods/base.jar", &sha1_hex(&base))]).await;
        mock_optional_list(&mut server, &[("optional-mods/opt.jar", &sha1_hex(&opt))]).await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/opt.jar", 200, &opt, 1).await;

        let mods_dir = seed_mods_dir(&dir, &[("base.jar", &base)]);

        let state = state_with_optional(&server.url(), "test-token", &["optional-mods/opt.jar"]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк необязательных модов при запуске");

        assert_eq!(
            std::fs::read(mods_dir.join("opt.jar")).expect("файл opt.jar в mods"),
            opt,
            "включённый мод должен быть скачан в mods с проверкой sha1"
        );
        assert_eq!(
            std::fs::read(mods_dir.join("base.jar")).expect("файл base.jar в mods"),
            base,
            "обязательный мод должен остаться на месте"
        );

        assert_finished("mods.optional.list");
        assert_finished("mods.optional.download");
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_moves_cached_enabled_mod_without_download() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_cache_hit").await;
        let _capture = test_capture::CaptureGuard::new();

        let base = b"base jar".to_vec();
        let opt = b"optional jar".to_vec();

        mock_mods_list(&mut server, &[("mods/base.jar", &sha1_hex(&base))]).await;
        mock_optional_list(&mut server, &[("optional-mods/opt.jar", &sha1_hex(&opt))]).await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/opt.jar", 200, &opt, 0).await;

        let mods_dir = seed_mods_dir(&dir, &[("base.jar", &base)]);
        let cache_dir = seed_cache_dir(&dir, &[("opt.jar", &opt)]);

        let state = state_with_optional(&server.url(), "test-token", &["optional-mods/opt.jar"]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк необязательных модов из кеша");

        assert_eq!(
            std::fs::read(mods_dir.join("opt.jar")).expect("файл opt.jar в mods"),
            opt,
            "включённый мод должен перемещаться из кеша в mods без сети"
        );
        assert!(
            !cache_dir.join("opt.jar").exists(),
            "файл должен исчезнуть из кеша после перемещения"
        );
        assert_eq!(
            std::fs::read(mods_dir.join("base.jar")).expect("файл base.jar в mods"),
            base,
            "обязательный мод должен остаться на месте"
        );

        assert_finished("mods.optional.list");
        assert_finished("mods.optional.download");
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_moves_disabled_mod_from_mods_to_cache() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_disable").await;
        let _capture = test_capture::CaptureGuard::new();

        let base = b"base jar".to_vec();
        let opt = b"optional jar".to_vec();

        mock_mods_list(&mut server, &[("mods/base.jar", &sha1_hex(&base))]).await;
        mock_optional_list(&mut server, &[("optional-mods/opt.jar", &sha1_hex(&opt))]).await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/opt.jar", 200, &opt, 0).await;

        let mods_dir = seed_mods_dir(&dir, &[("base.jar", &base), ("opt.jar", &opt)]);

        let state = state_with_optional(&server.url(), "test-token", &[]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк необязательных модов при выключенном выборе");

        assert!(
            !mods_dir.join("opt.jar").exists(),
            "выключенный мод должен исчезнуть из mods"
        );
        assert_eq!(
            std::fs::read(
                dir.project_dir("Cordelia")
                    .join("optional-mods-cache/opt.jar")
            )
            .expect("файл opt.jar в кеше"),
            opt,
            "выключенный мод должен переехать в кеш без перекачки"
        );
        assert_eq!(
            std::fs::read(mods_dir.join("base.jar")).expect("файл base.jar в mods"),
            base,
            "обязательные моды не должны быть задеты"
        );

        assert_finished("mods.optional.list");
        assert_finished("mods.optional.download");
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_redownloads_enabled_mod_with_stale_hash() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_stale_hash").await;
        let _capture = test_capture::CaptureGuard::new();

        let base = b"base jar".to_vec();
        let fresh_opt = b"optional jar v2".to_vec();

        mock_mods_list(&mut server, &[("mods/base.jar", &sha1_hex(&base))]).await;
        mock_optional_list(
            &mut server,
            &[("optional-mods/opt.jar", &sha1_hex(&fresh_opt))],
        )
        .await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/opt.jar", 200, &fresh_opt, 1).await;

        let mods_dir = seed_mods_dir(
            &dir,
            &[("base.jar", &base), ("opt.jar", b"optional jar v1")],
        );

        let state = state_with_optional(&server.url(), "test-token", &["optional-mods/opt.jar"]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк необязательных модов со сменой хеша");

        assert_eq!(
            std::fs::read(mods_dir.join("opt.jar")).expect("файл opt.jar в mods"),
            fresh_opt,
            "мод со старым хешем должен быть перекачан до версии сервера"
        );
        assert_eq!(
            std::fs::read(mods_dir.join("base.jar")).expect("файл base.jar в mods"),
            base,
            "обязательный мод должен остаться на месте"
        );

        assert_finished("mods.optional.list");
        assert_finished("mods.optional.download");
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_failure_does_not_break_launch_or_cleanup() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_failure").await;
        let _capture = test_capture::CaptureGuard::new();

        let base = b"base jar".to_vec();
        let opt = b"optional jar".to_vec();

        mock_mods_list(&mut server, &[("mods/base.jar", &sha1_hex(&base))]).await;
        mock_optional_list(&mut server, &[("optional-mods/opt.jar", &sha1_hex(&opt))]).await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/opt.jar", 500, b"boom", 1).await;

        let mods_dir = seed_mods_dir(&dir, &[("base.jar", &base), ("extra.jar", b"stale")]);

        let state = state_with_optional(&server.url(), "test-token", &["optional-mods/opt.jar"]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("сбой синка необязательных модов не должен прерывать запуск");

        assert!(
            !mods_dir.join("opt.jar").exists(),
            "нескачанный необязательный мод не должен появиться в mods"
        );
        assert_eq!(
            std::fs::read(mods_dir.join("base.jar")).expect("файл base.jar в mods"),
            base,
            "обязательные моды должны остаться на месте при сбое синка"
        );
        assert!(
            !mods_dir.join("extra.jar").exists(),
            "mods.clean должен отработать несмотря на сбой синка необязательных"
        );

        assert_finished("mods.optional.list");
        assert_failed("mods.optional.download");
        assert_finished("mods.clean");
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_empty_list_is_noop() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_empty").await;
        let _capture = test_capture::CaptureGuard::new();

        let base = b"base jar".to_vec();
        let cached = b"cached optional".to_vec();

        mock_mods_list(&mut server, &[("mods/base.jar", &sha1_hex(&base))]).await;
        mock_optional_list(&mut server, &[]).await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/opt.jar", 200, &cached, 0).await;

        let mods_dir = seed_mods_dir(&dir, &[("base.jar", &base)]);
        let cache_dir = seed_cache_dir(&dir, &[("opt.jar", &cached)]);
        let mods_before = dir_snapshot(&mods_dir);
        let cache_before = dir_snapshot(&cache_dir);

        let state = state_with_optional(&server.url(), "test-token", &["optional-mods/opt.jar"]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк с пустым списком необязательных");

        assert_eq!(
            dir_snapshot(&mods_dir),
            mods_before,
            "пустой список не должен менять содержимое mods байт-в-байт"
        );
        assert_eq!(
            dir_snapshot(&cache_dir),
            cache_before,
            "пустой список не должен менять содержимое кеша байт-в-байт"
        );

        assert_finished("mods.optional.list");
        assert!(
            launch_terminals("mods.optional.download").is_empty(),
            "пустой список не должен открывать шаг синка необязательных: {:?}",
            launch_terminals("mods.optional.download")
        );
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_purges_mod_missing_from_nonempty_server_list() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_purge_gone").await;
        let _capture = test_capture::CaptureGuard::new();

        let base = b"base jar".to_vec();
        let keep = b"kept optional".to_vec();

        mock_mods_list(&mut server, &[("mods/base.jar", &sha1_hex(&base))]).await;
        mock_optional_list(&mut server, &[("optional-mods/keep.jar", &sha1_hex(&keep))]).await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/keep.jar", 200, &keep, 0).await;

        let mods_dir = seed_mods_dir(
            &dir,
            &[
                ("base.jar", &base),
                ("keep.jar", &keep),
                ("gone.jar", b"gone"),
            ],
        );
        let cache_dir = seed_cache_dir(&dir, &[("gone.jar", b"gone copy")]);

        let state = state_with_optional(
            &server.url(),
            "test-token",
            &["optional-mods/keep.jar", "optional-mods/gone.jar"],
        );
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк после исчезновения мода с сервера");

        assert!(
            !mods_dir.join("gone.jar").exists(),
            "мод, исчезнувший с сервера, должен исчезнуть из mods"
        );
        assert!(
            !cache_dir.join("gone.jar").exists(),
            "копия исчезнувшего мода должна быть вычищена из кеша"
        );
        assert_eq!(
            std::fs::read(mods_dir.join("keep.jar")).expect("файл keep.jar в mods"),
            keep,
            "включённый мод, оставшийся на сервере, должен остаться в mods"
        );
        assert_eq!(
            std::fs::read(mods_dir.join("base.jar")).expect("файл base.jar в mods"),
            base,
            "обязательные моды не должны быть задеты"
        );

        assert_finished("mods.optional.list");
        assert_finished("mods.optional.download");
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_name_conflict_keeps_mandatory_mod() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_name_conflict").await;
        let _capture = test_capture::CaptureGuard::new();

        let mandatory = b"mandatory clash".to_vec();
        let optional = b"optional clash".to_vec();

        mock_mods_list(&mut server, &[("mods/clash.jar", &sha1_hex(&mandatory))]).await;
        mock_optional_list(
            &mut server,
            &[("optional-mods/clash.jar", &sha1_hex(&optional))],
        )
        .await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/clash.jar", 200, &optional, 0).await;

        let mods_dir = seed_mods_dir(&dir, &[("clash.jar", &mandatory)]);

        let state = state_with_optional(&server.url(), "test-token", &["optional-mods/clash.jar"]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк при конфликте имён с обязательным модом");

        assert_eq!(
            std::fs::read(mods_dir.join("clash.jar")).expect("файл clash.jar в mods"),
            mandatory,
            "обязательный мод должен выиграть конфликт имён: хеш основного списка"
        );
        assert!(
            !dir.project_dir("Cordelia")
                .join("optional-mods-cache/clash.jar")
                .exists(),
            "конфликтный файл не должен прятаться в кеш вместо обязательного"
        );

        assert_finished("mods.optional.list");
        assert_finished("mods.optional.download");
        opt_download.assert_async().await;
    }

    #[tokio::test]
    async fn optional_sync_name_conflict_keeps_mandatory_mod_when_disabled() {
        use crate::utils::step_events::test_capture;

        let MockEnv { dir, mut server } = MockEnv::acquire("optional_sync_conflict_disabled").await;
        let _capture = test_capture::CaptureGuard::new();

        let mandatory = b"mandatory clash".to_vec();
        let optional = b"optional clash".to_vec();

        mock_mods_list(&mut server, &[("mods/clash.jar", &sha1_hex(&mandatory))]).await;
        mock_optional_list(
            &mut server,
            &[("optional-mods/clash.jar", &sha1_hex(&optional))],
        )
        .await;
        let opt_download =
            optional_download_mock(&mut server, "optional-mods/clash.jar", 200, &optional, 0).await;

        let mods_dir = seed_mods_dir(&dir, &[("clash.jar", &mandatory)]);

        let state = state_with_optional(&server.url(), "test-token", &[]);
        download_mods("Cordelia".to_string(), &state)
            .await
            .expect("синк при выключенном необязательном моде с конфликтом имён");

        assert_eq!(
            std::fs::read(mods_dir.join("clash.jar")).expect("файл clash.jar в mods"),
            mandatory,
            "выключенный конфликтный необязательный мод не должен перемещать обязательный в кеш"
        );
        assert!(
            !dir.project_dir("Cordelia")
                .join("optional-mods-cache/clash.jar")
                .exists(),
            "обязательный мод не должен оказаться в кеше необязательных"
        );

        assert_finished("mods.optional.list");
        assert_finished("mods.optional.download");
        opt_download.assert_async().await;
    }
}

#[cfg(test)]
mod auth_client_cache_tests {
    use super::{
        auth_client_builds, build_auth_client, reset_auth_client_cache, AUTH_CLIENT_TEST_LOCK,
        MAX_AUTH_CLIENT_CACHE,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    static EVICTION_TOKENS: AtomicUsize = AtomicUsize::new(0);

    fn next_eviction_token() -> String {
        format!(
            "eviction-probe-token-{}",
            EVICTION_TOKENS.fetch_add(1, Ordering::SeqCst)
        )
    }

    #[test]
    fn auth_client_is_rebuilt_only_for_new_tokens() {
        let _guard = AUTH_CLIENT_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_auth_client_cache();

        build_auth_client("cache-probe-token-a").expect("клиент для первого токена");
        let before = auth_client_builds("cache-probe-token-a");

        build_auth_client("cache-probe-token-a").expect("клиент для того же токена");
        assert_eq!(
            auth_client_builds("cache-probe-token-a"),
            before,
            "повторный вызов с тем же токеном должен переиспользовать клиент"
        );

        build_auth_client("cache-probe-token-b").expect("клиент для нового токена");
        assert_eq!(
            auth_client_builds("cache-probe-token-b"),
            1,
            "новый токен должен собирать отдельный клиент"
        );
    }

    #[test]
    fn auth_client_cache_evicts_oldest_beyond_capacity() {
        let _guard = AUTH_CLIENT_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_auth_client_cache();

        let oldest = next_eviction_token();
        build_auth_client(&oldest).expect("первый токен в кеше");
        assert_eq!(auth_client_builds(&oldest), 1);
        for _ in 1..MAX_AUTH_CLIENT_CACHE {
            build_auth_client(&next_eviction_token()).expect("наполнение кеша");
        }

        let newest = next_eviction_token();
        build_auth_client(&newest).expect("токен сверх вместимости");

        build_auth_client(&oldest).expect("вытесненный токен собирается заново");
        assert_eq!(
            auth_client_builds(&oldest),
            2,
            "самый старый клиент должен вытесняться, а не накапливаться вечно"
        );
        build_auth_client(&newest).expect("свежий токен");
        assert_eq!(
            auth_client_builds(&newest),
            1,
            "свежий токен не должен вытесняться"
        );
    }
}
