use crate::state::dto::GlobalState;
use crate::updater::{
    compare_with_current, get_launcher_versions as fetch_launcher_versions, is_timeout_error,
    retain_current_platform, updater_builder, updater_pubkey, UpdateInfo, UpdateVersions,
    STARTUP_CHECK_TIMEOUT,
};
use crate::utils::errors::LauncherError;
use crate::utils::http::with_launcher_id;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};
use anyhow::{bail, Context};
use serde::Deserialize;
use std::time::Duration;
use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex;

const STATUS_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const PING_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ServerStatus {
    pub online: u32,
    pub max: u32,
    pub version: String,
}

#[tauri::command]
pub async fn get_server_status(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<ServerStatus> {
    let (online, server_url) = {
        let guard = state.lock().await;
        (
            guard.project_config.online,
            guard.project_config.resolved_server_url(),
        )
    };
    if !online {
        return Err(LauncherError::OfflineProfile(
            "статус доступен только для серверных профилей".to_string(),
        )
        .into());
    }
    let server_url = server_url.ok_or(LauncherError::ServerUrlMissing)?;
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
pub async fn get_launcher_versions() -> CommandResult<UpdateVersions> {
    let result = async {
        let mut versions = fetch_launcher_versions().await?;
        retain_current_platform(&mut versions);
        Ok(versions)
    }
    .await;

    Ok(LauncherError::classify(result, LauncherError::Update)?)
}

#[tauri::command]
pub async fn apply_update_cmd(app: AppHandle, version: Option<String>) -> CommandResult<()> {
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, скачивание и применение обновления пропущены");
        return Ok(());
    }

    let current_version = app.package_info().version.to_string();

    let result = async {
        let target_version = match version {
            Some(v) => {
                if v == current_version {
                    log_err!("Версия v{} уже установлена", v);
                    bail!(LauncherError::Update(format!(
                        "Версия v{} уже установлена",
                        v
                    )));
                }
                let versions = fetch_launcher_versions().await?;
                if !versions.versions.iter().any(|entry| entry.version == v) {
                    log_err!("Версия v{} отсутствует на сервере", v);
                    return Err(anyhow::Error::new(LauncherError::UpdateVersionMissing(
                        v.clone(),
                    )));
                }
                v
            }
            None => {
                log_info!("Текущая версия: v{}", current_version);
                let updater = updater_builder(&app, None)?
                    .build()
                    .context("Не удалось инициализировать проверку обновлений")?;
                match updater
                    .check()
                    .await
                    .context("Не удалось проверить обновления")?
                {
                    Some(update) => {
                        if !compare_with_current(&update.version, &current_version) {
                            log_info!(
                                "Сервер предлагает v{}, но она не новее текущей v{}, обновление пропущено",
                                update.version,
                                current_version
                            );
                            return Ok(());
                        }
                        log_info!("Сервер предлагает обновление до v{}", update.version);
                        update.version
                    }
                    None => {
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
        let update = updater
            .check()
            .await
            .with_context(|| format!("Не удалось получить релиз v{target_version}"))?
            .ok_or_else(|| anyhow::anyhow!("Сервер не отдал релиз v{target_version}"))?;

        if update.version != target_version {
            bail!(LauncherError::Update(format!(
                "Сервер вернул релиз v{} вместо v{}",
                update.version, target_version
            )));
        }

        log_info!("Скачивание обновления v{}...", update.version);
        let bytes = update
            .download(|_chunk, _total| {}, || {})
            .await
            .context("Не удалось скачать обновление")?;

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
