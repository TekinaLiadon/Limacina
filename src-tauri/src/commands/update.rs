use crate::updater::{
    apply_update, check_for_update, download_update, get_launcher_versions as fetch_launcher_versions,
    UpdateInfo, UpdateVersions,
};
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};
use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex;
use crate::state::dto::GlobalState;

#[tauri::command]
pub async fn check_update(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<Option<UpdateInfo>> {
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, проверка обновлений пропущена");
        return Ok(None);
    }
    let version = state.lock().await.app_version.clone();
    let info = check_for_update(&version).await?;
    Ok(info)
}

#[tauri::command]
pub async fn get_launcher_versions() -> CommandResult<UpdateVersions> {
    let versions = fetch_launcher_versions().await?;
    Ok(versions)
}

#[tauri::command]
#[allow(unreachable_code)]
pub async fn apply_update_cmd(
    app: AppHandle,
    version: Option<String>,
) -> CommandResult<()> {
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, скачивание и применение обновления пропущены");
        return Ok(());
    }

    let target_version = match version {
        Some(v) => v,
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
            return Err(anyhow::anyhow!("Не удалось применить обновление").into());
        }
    }

    Ok(())
}
