use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::launcher_server::downloader::download_all_files;
use crate::launcher_server::downloader::DownloadError;
use crate::minecraft::dto::MinecraftLoader;
use crate::state::dto::ModLoader;
use crate::state::dto::ProjectConfig;
use crate::{minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(
    state: tauri::State<'_, Mutex<ProjectConfig>>,
) -> CommandResult<String> {
    let state = state.lock().await;
    let project_state = &state;
    Vanilla.setup(&project_state).await?;
    match project_state.mod_loader {
        ModLoader::Vanilla => Ok("Vanilla майнкрафт установлен успешно".to_string()),
        ModLoader::Fabric => {
            let loader = create_mod_loader(&ModLoader::Fabric)?;
            let manifest = loader.versions(&project_state.mc_version).await?;
            loader.setup(&project_state, &manifest).await?;
            Ok("Fabric майнкрафт установлен успешно".to_string())
        }
        ModLoader::Forge => {
            let loader = create_mod_loader(&ModLoader::Forge)?;
            let loader_version = &project_state.loader_version.as_deref().unwrap_or("");
            let manifest = loader.versions(loader_version).await?;
            loader.setup(&project_state, &manifest).await?;
            Ok("Forge майнкрафт установлен успешно".to_string())
        }
    }
}

#[tauri::command]
pub async fn download_server_file(app: AppHandle) -> Result<String, DownloadError> {
    download_all_files(app).await?;
    Ok("Ok".to_string())
}
