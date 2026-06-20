use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::java::install_java;
use crate::launcher_server::downloader::download_all_files;
use crate::launcher_server::downloader::DownloadError;
use crate::minecraft::structs::MinecraftLoader;
use crate::state::dto::GlobalState;
use crate::state::dto::ModLoader as ConfigModLoader;
use crate::{minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let mut state = state.lock().await;
    Vanilla.setup(&state.project_config).await?;

    if matches!(state.project_config.mod_loader, ConfigModLoader::Vanilla) {
        return Ok("Vanilla майнкрафт установлен успешно".to_string());
    }

    let loader = create_mod_loader(&state.project_config.mod_loader)?;
    let manifest = loader.versions(&state.project_config).await?;
    loader.setup(&state.project_config, &manifest).await?;
    state.loader = Some(loader);
    Ok("Модифицированный майнкрафт установлен успешно".to_string())
}

#[tauri::command]
pub async fn download_server_file(app: AppHandle) -> Result<String, DownloadError> {
    download_all_files(app).await?;
    Ok("Ok".to_string())
}

#[tauri::command]
pub async fn download_java(state: tauri::State<'_, Mutex<GlobalState>>) -> CommandResult<String> {
    let mut state = state.lock().await;
    let java_path = install_java(&state.project_config).await?;
    state.project_config.java_path = Some(java_path.to_string_lossy().into_owned());
    state.project_config.save_config().await?;
    Ok("Ok".to_string())
}
