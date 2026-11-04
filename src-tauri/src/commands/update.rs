use crate::log_info;
use crate::state::config::current_project_config;
use crate::state::dto::GlobalState;
use crate::updater::{
    compare_with_current, get_launcher_versions as fetch_launcher_versions, is_timeout_error,
    retain_current_platform, updater_builder, updater_pubkey, UpdateInfo, UpdateRelease,
    STARTUP_CHECK_TIMEOUT,
};
use crate::utils::errors::LauncherError;
use crate::utils::http::with_launcher_id;
use crate::utils::tauri_err::CommandResult;
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex;

const STATUS_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const PING_TIMEOUT: Duration = Duration::from_secs(5);
const APPLY_CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const APPLY_CHECK_TIMEOUT_MESSAGE: &str =
    "Проверка обновлений прервана: истекло время ожидания ответа сервера";
const APPLY_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
const APPLY_DOWNLOAD_TIMEOUT_MESSAGE: &str =
    "Скачивание обновления прервано: истекло время ожидания";

static APPLY_UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[derive(Debug)]
struct UpdateApplyGuard;

impl Drop for UpdateApplyGuard {
    fn drop(&mut self) {
        APPLY_UPDATE_IN_PROGRESS.store(false, Ordering::Relaxed);
    }
}

fn begin_apply_update() -> Result<UpdateApplyGuard> {
    if APPLY_UPDATE_IN_PROGRESS.swap(true, Ordering::Relaxed) {
        return Err(LauncherError::Update(
            "Обновление уже устанавливается, дождитесь завершения".to_string(),
        )
        .into());
    }
    Ok(UpdateApplyGuard)
}

fn ensure_not_current(requested: &str, current_version: &str) -> Result<()> {
    if requested == current_version {
        log_info!("Версия v{} уже установлена", requested);
        bail!(LauncherError::Update(format!(
            "Версия v{} уже установлена",
            requested
        )));
    }
    Ok(())
}

fn resolve_target_version(requested: &str, releases: &[UpdateRelease]) -> Result<String> {
    if !releases.iter().any(|release| release.version == requested) {
        log_info!("Версия v{} отсутствует на сервере", requested);
        return Err(anyhow::Error::new(LauncherError::UpdateVersionMissing(
            requested.to_string(),
        )));
    }
    Ok(requested.to_string())
}

enum AutoDecision {
    NoUpdate,
    NotNewer(String),
    Target(String),
}

fn decide_auto_target(offered: Option<&str>, current_version: &str) -> AutoDecision {
    let Some(offered) = offered else {
        return AutoDecision::NoUpdate;
    };
    if !compare_with_current(offered, current_version) {
        return AutoDecision::NotNewer(offered.to_string());
    }
    AutoDecision::Target(offered.to_string())
}

fn ensure_server_release_matches(actual: &str, expected: &str) -> Result<()> {
    if actual != expected {
        bail!(LauncherError::Update(format!(
            "Сервер вернул релиз v{} вместо v{}",
            actual, expected
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ServerStatus {
    pub online: u32,
    pub max: u32,
    pub version: String,
}

async fn with_timeout<T>(
    timeout: Duration,
    message: &str,
    fut: impl Future<Output = Result<T>>,
) -> Result<T> {
    match tokio::time::timeout(timeout, fut).await {
        Ok(result) => result,
        Err(_) => bail!(LauncherError::Update(message.to_string())),
    }
}

#[tauri::command]
pub async fn get_server_status(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<ServerStatus> {
    let config = current_project_config(state.inner()).await?;
    if !config.online {
        return Err(LauncherError::OfflineProfile(
            "статус доступен только в серверных профилях".to_string(),
        )
        .into());
    }
    let server_url = config
        .resolved_server_url()
        .ok_or(LauncherError::ServerUrlMissing)?;
    let url = format!("{server_url}/v1/common/status");
    let request = with_launcher_id(
        crate::utils::http::http_client()
            .get(&url)
            .timeout(STATUS_REQUEST_TIMEOUT),
    );
    let status: ServerStatus = LauncherError::classify(
        crate::utils::http::request_json(
            request,
            "Не удалось подключиться к серверу статуса",
            "Не удалось разобрать статус игрового сервера",
        )
        .await,
        LauncherError::LauncherServer,
    )?;
    Ok(status)
}

#[tauri::command]
pub async fn ping_launcher_server(state: State<'_, Mutex<GlobalState>>) -> CommandResult<bool> {
    let server_url = state.lock().await.project_config.resolved_server_url();
    let Some(server_url) = server_url else {
        return Ok(false);
    };
    let url = format!("{server_url}/v1/launcher/update/version");
    let request = with_launcher_id(
        crate::utils::http::http_client()
            .get(&url)
            .timeout(PING_TIMEOUT),
    );
    match request.send().await {
        Ok(_) => Ok(true),
        Err(e) => {
            log_info!("Сервер лаунчера недоступен: {}", e);
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> CommandResult<Option<UpdateInfo>> {
    if crate::utils::env_info::is_offline_build() {
        log_info!("Офлайн-сборка, проверка обновлений пропущена");
        return Ok(None);
    }
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, проверка обновлений пропущена");
        return Ok(None);
    }
    if updater_pubkey(&app).is_none() {
        log_info!("Обновления отключены: не задан plugins.updater.pubkey, проверка пропущена");
        return Ok(None);
    }
    let result = async {
        let updater = updater_builder(&app, None)?
            .timeout(STARTUP_CHECK_TIMEOUT)
            .build()
            .context("Не удалось инициализировать проверку обновлений")?;
        match updater.check().await {
            Ok(Some(update)) => Ok(Some(UpdateInfo {
                version: update.version,
            })),
            Ok(None) => Ok(None),
            Err(e) => {
                let e = anyhow::Error::new(e);
                if is_timeout_error(&e) {
                    log_info!("Проверка обновлений прервана по таймауту, пропуск");
                    Ok(None)
                } else {
                    Err(e.context("Не удалось проверить обновления"))
                }
            }
        }
    }
    .await;

    Ok(LauncherError::classify(result, LauncherError::Update)?)
}

#[tauri::command]
pub async fn get_launcher_versions() -> CommandResult<Vec<UpdateRelease>> {
    let result = async {
        let mut releases = fetch_launcher_versions().await?;
        retain_current_platform(&mut releases)?;
        Ok(releases)
    }
    .await;

    Ok(LauncherError::classify(result, LauncherError::Update)?)
}

#[tauri::command]
pub async fn apply_update_cmd(app: AppHandle, version: Option<String>) -> CommandResult<()> {
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, скачивание и применение обновления пропущено");
        return Ok(());
    }
    let _apply_guard = begin_apply_update()?;

    let current_version = app.package_info().version.to_string();

    let result = async {
        let target_version = match version {
            Some(v) => {
                ensure_not_current(&v, &current_version)?;
                let mut releases = fetch_launcher_versions().await?;
                retain_current_platform(&mut releases)?;
                resolve_target_version(&v, &releases)?
            }
            None => {
                log_info!("Текущая версия: v{}", current_version);
                let updater = updater_builder(&app, None)?
                    .build()
                    .context("Не удалось инициализировать проверку обновлений")?;
                let check = with_timeout(
                    APPLY_CHECK_TIMEOUT,
                    APPLY_CHECK_TIMEOUT_MESSAGE,
                    async { updater.check().await.context("Не удалось проверить обновления") },
                )
                .await?;
                match decide_auto_target(check.map(|update| update.version).as_deref(), &current_version)
                {
                    AutoDecision::Target(target) => {
                        log_info!("Сервер предлагает обновление до v{}", target);
                        target
                    }
                    AutoDecision::NotNewer(offered) => {
                        log_info!(
                            "Сервер предлагает v{}, но она не новее текущей v{}, обновление пропущено",
                            offered,
                            current_version
                        );
                        return Ok(());
                    }
                    AutoDecision::NoUpdate => {
                        log_info!("Обновление не требуется");
                        return Ok(());
                    }
                }
            }
        };

        log_info!("Установка версии лаунчера v{}", target_version);

        let updater = updater_builder(&app, Some(&target_version))?
            .build()
            .context("Не удалось инициализировать установку обновления")?;
        let update = with_timeout(
            APPLY_CHECK_TIMEOUT,
            APPLY_CHECK_TIMEOUT_MESSAGE,
            async {
                updater
                    .check()
                    .await
                    .with_context(|| format!("Не удалось получить релиз v{target_version}"))
            },
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("Сервер не отдал релиз v{target_version}"))?;

        ensure_server_release_matches(&update.version, &target_version)?;

        log_info!("Скачивание обновления v{}...", update.version);
        let bytes = with_timeout(
            APPLY_DOWNLOAD_TIMEOUT,
            APPLY_DOWNLOAD_TIMEOUT_MESSAGE,
            async {
                update
                    .download(|_chunk, _total| {}, || {})
                    .await
                    .context("Не удалось скачать обновление")
            },
        )
        .await?;

        log_info!("Обновление v{} скачано, установка...", update.version);
        update
            .install(bytes)
            .context("Не удалось установить обновление")?;

        log_info!("Обновление применено, перезапуск...");
        app.restart()
    }
    .await;

    Ok(LauncherError::classify(result, LauncherError::Update)?)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    use anyhow::Result;
    use mockito::Server;

    use super::{
        begin_apply_update, decide_auto_target, ensure_not_current, ensure_server_release_matches,
        resolve_target_version, with_timeout, AutoDecision, UpdateApplyGuard,
        APPLY_CHECK_TIMEOUT_MESSAGE, APPLY_DOWNLOAD_TIMEOUT_MESSAGE, APPLY_UPDATE_IN_PROGRESS,
    };
    use crate::updater::UpdateRelease;
    use crate::utils::errors::LauncherError;
    use crate::utils::http::http_client;

    static APPLY_FLAG_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn releases(versions: &[&str]) -> Vec<UpdateRelease> {
        versions
            .iter()
            .map(|v| UpdateRelease {
                version: (*v).to_string(),
                platforms: Vec::new(),
            })
            .collect()
    }

    #[tokio::test]
    async fn begin_apply_update_rejects_reentry_and_releases_on_drop() {
        let _flag_lock = APPLY_FLAG_LOCK.lock().await;

        let guard = begin_apply_update().expect("первый запуск должен захватывать флаг");
        let error = begin_apply_update()
            .expect_err("повторный запуск во время установки должен отклоняться");
        assert!(
            error.to_string().contains("уже устанавливается"),
            "ошибка должна объяснять повторный запуск: {error}"
        );
        drop(guard);

        let second = begin_apply_update().expect("после снятия guard запуск снова возможен");
        drop(second);
        assert!(
            !APPLY_UPDATE_IN_PROGRESS.load(Ordering::Relaxed),
            "флаг должен сниматься guard'ом"
        );
    }

    #[test]
    fn ensure_not_current_rejects_current_version() {
        let error = ensure_not_current("1.2.3", "1.2.3")
            .expect_err("уже установленная версия должна отклоняться");
        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::Update(_))
            ),
            "ожидается ошибка Update: {error:#}"
        );
        assert!(
            error.to_string().contains("уже установлена"),
            "ошибка должна называть причину: {error}"
        );
    }

    #[test]
    fn resolve_target_version_rejects_version_missing_on_server() {
        let error = resolve_target_version("9.9.9", &releases(&["1.2.3"]))
            .expect_err("версия вне списка сервера должна отклоняться");
        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::UpdateVersionMissing(v)) if v == "9.9.9"
            ),
            "ожидается UpdateVersionMissing: {error:#}"
        );
    }

    #[test]
    fn resolve_target_version_accepts_listed_version() {
        let target = resolve_target_version("1.2.3", &releases(&["1.2.3", "1.1.0"]))
            .expect("версия из списка принимается");
        assert_eq!(target, "1.2.3");
    }

    #[test]
    fn decide_auto_target_skips_missing_and_not_newer_offers() {
        assert!(
            matches!(decide_auto_target(None, "1.0.0"), AutoDecision::NoUpdate),
            "без предложения сервера обновление не требуется"
        );
        assert!(
            matches!(
                decide_auto_target(Some("1.0.0"), "1.0.0"),
                AutoDecision::NotNewer(v) if v == "1.0.0"
            ),
            "равная версия не новее текущей"
        );
        assert!(
            matches!(
                decide_auto_target(Some("0.9.0"), "1.0.0"),
                AutoDecision::NotNewer(v) if v == "0.9.0"
            ),
            "старшая предложенная версия не новее текущей"
        );
        assert!(
            matches!(
                decide_auto_target(Some("1.1.0"), "1.0.0"),
                AutoDecision::Target(v) if v == "1.1.0"
            ),
            "более новая версия должна становиться целью"
        );
    }

    #[test]
    fn ensure_server_release_matches_requires_exact_version() {
        ensure_server_release_matches("1.2.3", "1.2.3").expect("совпадающий релиз принимается");
        let error = ensure_server_release_matches("1.2.4", "1.2.3")
            .expect_err("релиз не той версии должен отклоняться");
        assert!(
            error.to_string().contains("вместо"),
            "ошибка должна называть обе версии: {error}"
        );
    }

    #[tokio::test]
    async fn hung_server_times_out_releases_guard_and_allows_retry() {
        let _flag_lock = APPLY_FLAG_LOCK.lock().await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/hang")
            .with_chunked_body(|writer| {
                writer.write_all(b"partial")?;
                std::thread::sleep(Duration::from_secs(2));
                Ok(())
            })
            .create_async()
            .await;
        server
            .mock("GET", "/ok")
            .with_status(200)
            .with_body("done")
            .create_async()
            .await;

        assert!(!APPLY_UPDATE_IN_PROGRESS.load(Ordering::Relaxed));
        assert!(!APPLY_UPDATE_IN_PROGRESS.swap(true, Ordering::Relaxed));
        let guard = UpdateApplyGuard;

        let started = Instant::now();
        let error = with_timeout(
            Duration::from_millis(300),
            APPLY_CHECK_TIMEOUT_MESSAGE,
            async {
                let response = http_client()
                    .get(format!("{}/hang", server.url()))
                    .send()
                    .await?;
                response.text().await?;
                Ok(())
            },
        )
        .await
        .expect_err("зависший ответ должен обрываться по таймауту");

        drop(guard);

        assert!(
            started.elapsed() < Duration::from_secs(1),
            "таймаут должен сработать раньше паузы сервера: {:?}",
            started.elapsed()
        );
        let text = error.to_string();
        assert!(
            text.contains("Проверка обновлений прервана: истекло время ожидания"),
            "ошибка должна называть таймаут по-русски: {text}"
        );
        assert!(
            !APPLY_UPDATE_IN_PROGRESS.load(Ordering::Relaxed),
            "guard должен сниматься после таймаута"
        );

        let retried = with_timeout(Duration::from_secs(5), APPLY_CHECK_TIMEOUT_MESSAGE, async {
            let response = http_client()
                .get(format!("{}/ok", server.url()))
                .send()
                .await?;
            response.text().await?;
            Ok(())
        })
        .await;
        assert!(
            retried.is_ok(),
            "повторная попытка должна проходить без перезапуска: {retried:?}"
        );
    }

    #[tokio::test]
    async fn with_timeout_preserves_fast_results_and_inner_errors() {
        let value = with_timeout(
            Duration::from_millis(200),
            APPLY_DOWNLOAD_TIMEOUT_MESSAGE,
            async { Ok(7) },
        )
        .await
        .expect("быстрый результат проходит насквозь");
        assert_eq!(value, 7);

        let inner = with_timeout(
            Duration::from_millis(200),
            APPLY_DOWNLOAD_TIMEOUT_MESSAGE,
            async { Err(anyhow::anyhow!("внутренняя ошибка")) as Result<()> },
        )
        .await
        .expect_err("внутренняя ошибка должна пробрасываться без обёртки");
        assert_eq!(inner.to_string(), "внутренняя ошибка");
    }
}
