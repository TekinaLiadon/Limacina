use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::launcher_server::downloader::download_all_files;
use crate::launcher_server::downloader::DownloadError;
use crate::minecraft::dto::MinecraftLoader;
use crate::state::dto::ModLoader as ConfigModLoader;
use crate::state::dto::ProjectConfig;
use crate::{minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(
    state: tauri::State<'_, Mutex<ProjectConfig>>,
) -> CommandResult<String> {
    let state = state.lock().await;
    let project_state = &state;
    Vanilla.setup(&project_state).await?;

    if matches!(project_state.mod_loader, ConfigModLoader::Vanilla) {
        return Ok("Vanilla майнкрафт установлен успешно".to_string());
    }

    let loader = create_mod_loader(&project_state.mod_loader)?;
    let manifest = loader.versions(&project_state).await?;
    loader.setup(&project_state, &manifest).await?;
    Ok("Модифицированный майнкрафт установлен успешно".to_string())
}

#[tauri::command]
pub async fn download_server_file(app: AppHandle) -> Result<String, DownloadError> {
    download_all_files(app).await?;
    Ok("Ok".to_string())
}
