use crate::updater::{check_for_update, download_update, apply_update, UpdateInfo};
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};
use anyhow::Context;
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
#[allow(unreachable_code)]
pub async fn apply_update_cmd(
    app: AppHandle,
) -> CommandResult<()> {
    if cfg!(debug_assertions) {
        log_info!("Режим разработки, скачивание и применение обновления пропущены");
        return Ok(());
    }

    let version = app.package_info().version.to_string();
    log_info!("Текущая версия: v{}", version);

    let server_url = env!("LAUNCHER_SERVER_URL");
    let url = format!("{}/launcher/version", server_url);
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .context("Не удалось подключиться к серверу обновлений")?;

    if !resp.status().is_success() {
        log_err!("Сервер обновлений вернул статус {}", resp.status());
        return Err(anyhow::anyhow!("Сервер обновлений недоступен").into());
    }

    let info: UpdateInfo = resp
        .json()
        .await
        .context("Не удалось распарсить информацию об обновлении")?;

    log_info!("Сервер предлагает обновление до v{}", info.version);

    let archive_path = match download_update(&info).await {
        Ok(path) => {
            log_info!("Обновление v{} скачано: {:?}", info.version, path);
            path
        }
        Err(e) => {
            log_err!("Не удалось скачать обновление: {}", e);
            return Ok(());
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
        }
    }

    Ok(())
}
