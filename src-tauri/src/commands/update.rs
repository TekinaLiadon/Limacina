use crate::state::dto::GlobalState;
use crate::updater::{
    apply_update, check_for_update, check_for_update_with_timeout, download_update,
    get_launcher_versions as fetch_launcher_versions, is_timeout_error, retain_current_platform,
    UpdateInfo, UpdateVersions,
};
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};
use serde::Deserialize;
use std::time::Duration;
use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex;

const STARTUP_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const STATUS_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

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
    let url = format!("{}/v1/common/status", server_url);
    let request = crate::utils::http::http_client()
        .get(&url)
        .timeout(STATUS_REQUEST_TIMEOUT);
    let status: ServerStatus = crate::utils::http::request_json(
        request,
        "Не удалось подключиться к серверу статуса",
        "Не удалось разобрать статус игрового сервера",
    )
    .await?;
    Ok(status)
}

#[tauri::command]
pub async fn check_update(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<Option<UpdateInfo>> {
    if crate::utils::env_info::is_offline_build() {
        log_info!("Офлайн-сборка, проверка обновлений пропущена");
        return Ok(None);
    }
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, проверка обновлений пропущена");
        return Ok(None);
    }
    let version = state.lock().await.app_version.clone();
    match check_for_update_with_timeout(&version, STARTUP_CHECK_TIMEOUT).await {
        Ok(info) => Ok(info),
        Err(e) => {
            if is_timeout_error(&e) {
                log_info!("Проверка обновлений прервана по таймауту, пропуск");
                Ok(None)
            } else {
                Err(e.into())
            }
        }
    }
}

#[tauri::command]
pub async fn get_launcher_versions() -> CommandResult<UpdateVersions> {
    let mut versions = fetch_launcher_versions().await?;
    retain_current_platform(&mut versions);
    Ok(versions)
}

#[tauri::command]
pub async fn apply_update_cmd(app: AppHandle, version: Option<String>) -> CommandResult<()> {
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, скачивание и применение обновления пропущены");
        return Ok(());
    }

    let target_version = match version {
        Some(v) => {
            let current_version = app.package_info().version.to_string();
            if v == current_version {
                log_err!("Версия v{} уже установлена", v);
                return Err(anyhow::anyhow!("Версия v{} уже установлена", v).into());
            }
            let versions = fetch_launcher_versions().await?;
            if !versions.versions.iter().any(|entry| entry.version == v) {
                log_err!("Версия v{} отсутствует на сервере", v);
                return Err(LauncherError::UpdateVersionMissing(v.clone()).into());
            }
            v
        }
        None => {
            let current_version = app.package_info().version.to_string();
            log_info!("Текущая версия: v{}", current_version);

            let info = check_for_update(&current_version).await?;
            match info {
                Some(info) => {
                    log_info!("Сервер предлагает обновление до v{}", info.version);
                    info.version
                }
                None => {
                    log_info!("Обновление не требуется");
                    return Ok(());
                }
            }
        }
    };

    log_info!("Установка версии лаунчера v{}", target_version);

    let archive_path = match download_update(&target_version).await {
        Ok(path) => {
            log_info!("Обновление v{} скачано: {:?}", target_version, path);
            path
        }
        Err(e) => {
            log_err!("Не удалось скачать обновление: {}", e);
            return Err(anyhow::anyhow!("Не удалось скачать версию v{}", target_version).into());
        }
    };

    match apply_update(&archive_path) {
        Ok(()) => {
            log_info!("Обновление применено, перезапуск...");
            app.restart();
        }
        Err(e) => {
            log_err!("Не удалось применить обновление: {}", e);
            let _ = std::fs::remove_file(&archive_path);
            Err(anyhow::anyhow!("Не удалось применить обновление").into())
        }
    }
}
