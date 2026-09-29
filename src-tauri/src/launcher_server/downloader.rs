use crate::{log_err, log_info, step_try, utils::errors::LauncherError};
use anyhow::{Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::launcher_server::api_context;
use crate::state::dto::GlobalState;
use crate::utils::download_file::{file_sha1, write_stream_to_atomic};
use crate::utils::env_info::{is_safe_relative_path, launcher_path};
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo, MAX_CONCURRENT_DOWNLOADS};
use crate::utils::step_events::StepHandle;
use tokio::sync::Mutex;

pub(crate) fn build_auth_client(token: &str) -> Result<Client> {
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
    log_info!("[download] Запрос файла: {} → {:?}", url, file_path);
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
        let body = response.text().await.unwrap_or_default();
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

struct ListSource {
    endpoint: &'static str,
    step_id: &'static str,
    step_label: &'static str,
    log_prefix: &'static str,
    noun: &'static str,
}

const FILES_LIST: ListSource = ListSource {
    endpoint: "/v1/launcher/files/list",
    step_id: "files.list",
    step_label: "Получение списка файлов",
    log_prefix: "[files]",
    noun: "файлов",
};

const MODS_LIST: ListSource = ListSource {
    endpoint: "/v1/launcher/files/mods",
    step_id: "mods.list",
    step_label: "Получение списка модов",
    log_prefix: "[mods]",
    noun: "модов",
};

async fn fetch_hash_map(
    client: &Client,
    server_url: &str,
    project_name: &str,
    source: &ListSource,
) -> Result<HashMap<String, String>> {
    let list_step = StepHandle::start(source.step_id, source.step_label);
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
        let body = response.text().await.unwrap_or_default();
        log_err!("{} Сервер вернул {}: {}", source.log_prefix, status, body);
        list_step.fail(format!("Сервер {} вернул {}", source.noun, status));
        return Err(LauncherError::LauncherServer(format!(
            "Сервер {} вернул {status} (проект: {project_name}): {body}",
            source.noun
        ))
        .into());
    }

    let response_text = step_try!(
        list_step,
        response.text().await.map_err(|e| {
            LauncherError::LauncherServer(format!("Не удалось прочитать ответ от {url}: {e:#}"))
        })
    );

    let list: HashMap<String, String> = step_try!(
        list_step,
        serde_json::from_str(&response_text).map_err(|e| {
            LauncherError::LauncherServer(format!(
                "Не удалось распарсить JSON списка {} (проект: {project_name}): {e:#}",
                source.noun
            ))
        })
    );
    log_info!(
        "{} Получено {}: {}",
        source.log_prefix,
        source.noun,
        list.len()
    );
    list_step.finish(false);
    Ok(list)
}

pub(crate) async fn fetch_file_list(
    client: &Client,
    server_url: &str,
    project_name: &str,
) -> Result<HashMap<String, String>> {
    fetch_hash_map(client, server_url, project_name, &FILES_LIST).await
}

pub(crate) async fn fetch_mods_list(
    client: &Client,
    server_url: &str,
    project_name: &str,
) -> Result<HashMap<String, String>> {
    fetch_hash_map(client, server_url, project_name, &MODS_LIST).await
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
            return Err(LauncherError::InvalidModFilename(format!(
                "Сервер передал недопустимый путь {}: {}",
                labels.item, key
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
        labels.noun,
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
        step.fail(format!("Не удалось скачать {}: {}", labels.noun, errors));
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
    let result = async {
        let online = state.lock().await.project_config.online;
        if !online {
            log_info!(
                "[files] Одиночный профиль {} — синхронизация с сервером не нужна",
                project_name
            );
            return Ok(FilesSyncReport::default());
        }

        let ctx = require_api_client(state).await?;
        let file_list = fetch_file_list(&ctx.client, &ctx.server_url, &project_name).await?;

        let core = launcher_path(Some(&project_name))?;

        log_info!("[files] Получено файлов от сервера: {}", file_list.len());
        log_info!("[files] Папка проекта: {:?}", core);

        let download_step = StepHandle::start("files.download", "Скачивание файлов");
        sync_server_files(
            &ctx,
            &file_list,
            &core,
            download_step,
            &FILES_LABELS,
            |key: &str| PathBuf::from(key),
        )
        .await
    }
    .await;

    LauncherError::classify(result, LauncherError::LauncherServer)
}

pub async fn download_mods(
    project_name: String,
    state: &Mutex<GlobalState>,
) -> Result<FilesSyncReport> {
    let result = async {
        let online = state.lock().await.project_config.online;
        if !online {
            log_info!(
                "[mods] Одиночный профиль {} — моды с сервера не скачиваются",
                project_name
            );
            return Ok(FilesSyncReport::default());
        }

        let ctx = require_api_client(state).await?;
        let mods = fetch_mods_list(&ctx.client, &ctx.server_url, &project_name).await?;

        log_info!("[mods] Получено модов: {}", mods.len());
        for (name, hash) in &mods {
            log_info!("  мод: {} (hash: {})", name, hash);
        }

        let mods_dir = launcher_path(Some(&project_name))?.join("mods");

        tokio::fs::create_dir_all(&mods_dir)
            .await
            .with_context(|| format!("Не удалось создать папку модов {mods_dir:?}"))?;

        let server_mods: HashSet<&str> = mods
            .keys()
            .map(|k| k.strip_prefix("mods/").unwrap_or(k))
            .collect();

        let download_step = StepHandle::start("mods.download", "Проверка и скачивание модов");
        log_info!("[mods] Путь к папке модов: {:?}", mods_dir);
        let report = sync_server_files(
            &ctx,
            &mods,
            &mods_dir,
            download_step,
            &MODS_LABELS,
            |key: &str| PathBuf::from(key.strip_prefix("mods/").unwrap_or(key)),
        )
        .await
        .context("Не удалось синхронизировать моды с сервером")?;

        let clean_step = StepHandle::start("mods.clean", "Очистка лишних модов");
        cleanup_extra_mods(&mods_dir, &server_mods).await?;
        clean_step.finish(false);
        Ok(report)
    }
    .await;

    LauncherError::classify(result, LauncherError::LauncherServer)
}

async fn cleanup_extra_mods(mods_dir: &Path, server_mods: &HashSet<&str>) -> Result<()> {
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
        log_info!("[mods] Удаление лишнего мода: {}", name);
        tokio::fs::remove_file(entry.path()).await.map_err(|e| {
            log_err!("[mods] Не удалось удалить лишний мод {}: {}", name, e);
            LauncherError::DiskIo(format!("Не удалось удалить лишний мод {name}: {e}"))
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod mock_server_tests {
    use super::*;
    use crate::state::dto::{GlobalState, ProjectConfig, SessionTokens};
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use crate::utils::http::http_client;
    use mockito::{Matcher, Server};
    use serde_json::json;

    async fn api_context(server: &Server) -> ApiContext {
        ApiContext {
            client: build_auth_client("test-token").expect("клиент"),
            server_url: server.url(),
        }
    }

    #[tokio::test]
    async fn sync_downloads_missing_and_changed_files_and_skips_intact() {
        let dir = LauncherDirGuard::acquire("files_sync").await;
        let mut server = Server::new_async().await;

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
        let report = sync_server_files(&ctx, &list, &base, step, &FILES_LABELS, |key: &str| {
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
        let dir = LauncherDirGuard::acquire("files_sync_bad_hash").await;
        let mut server = Server::new_async().await;
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
        let result = sync_server_files(&ctx, &list, &base, step, &FILES_LABELS, |key: &str| {
            PathBuf::from(key)
        })
        .await;

        assert!(
            result.is_err(),
            "несовпадающий хеш должен давать ошибку, а не успешный отчёт"
        );
        assert!(
            !base.join("mods/a.jar").exists(),
            "файл с неверным хешем должен быть удалён"
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
            &FILES_LABELS,
            |key: &str| PathBuf::from(key),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn download_all_files_redownloads_changed_server_file() {
        let dir = LauncherDirGuard::acquire("files_entry_changed").await;
        let mut server = Server::new_async().await;

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

        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Cordelia".to_string(),
                server_url: Some(server.url()),
                ..ProjectConfig::default()
            },
            session: Some(SessionTokens {
                access_token: "test-token".to_string(),
                uuid: String::new(),
                username: "tester".to_string(),
                project_name: "Cordelia".to_string(),
            }),
            ..GlobalState::default()
        });

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
    async fn fetch_file_list_sends_launcher_id_header() {
        crate::utils::install_id::override_install_id_for_tests("test-install-id");

        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/v1/launcher/files/list")
            .match_header("x-launcher-id", "test-install-id")
            .with_status(200)
            .with_body(json!({"mods/a.jar": "hash1"}).to_string())
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let _ = fetch_file_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect("список файлов");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn fetch_file_list_parses_server_response() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/files/list")
            .with_status(200)
            .with_body(json!({"mods/a.jar": "hash1", "config.json": "hash2"}).to_string())
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let list = fetch_file_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect("список файлов");

        assert_eq!(list.get("mods/a.jar").map(String::as_str), Some("hash1"));
        assert_eq!(list.len(), 2);
    }

    #[tokio::test]
    async fn fetch_file_list_fails_on_server_error() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/files/list")
            .with_status(500)
            .with_body("boom")
            .create_async()
            .await;

        let ctx = api_context(&server).await;
        let error = fetch_file_list(&ctx.client, &ctx.server_url, "Cordelia")
            .await
            .expect_err("сервер вернул 500");

        assert!(error.to_string().contains("500"), "{}", error);
    }

    #[tokio::test]
    async fn download_file_overwrites_existing_content() {
        let dir = LauncherDirGuard::acquire("files_overwrite").await;
        let mut server = Server::new_async().await;
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
        let dir = LauncherDirGuard::acquire("files_hash_ok").await;
        let mut server = Server::new_async().await;
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
        let dir = LauncherDirGuard::acquire("files_hash_bad").await;
        let mut server = Server::new_async().await;
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
        let dir = LauncherDirGuard::acquire("files_no_hash").await;
        let mut server = Server::new_async().await;
        mock_download_body(&mut server, b"any bytes".to_vec()).await;

        verify_download(&server, &dir, None)
            .await
            .expect("скачивание без хеша");

        let dest = dir.project_dir("Cordelia").join("mods/a.jar");
        assert_eq!(std::fs::read(&dest).unwrap(), b"any bytes");
    }
}
