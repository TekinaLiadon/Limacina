use tokio::sync::Mutex;

use crate::api::dto::create_mod_loader;
use crate::minecraft::dto::MinecraftLoader;
use crate::state::dto::ModLoader;
use crate::state::dto::State;
use crate::{minecraft::mod_loader::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(state: tauri::State<'_, Mutex<State>>) -> CommandResult<String> {
    println!("[LOG]");
    let state = state.lock().await;
    let project_state = &state.project_info;
    println!("[LOG2]");
    Vanilla.setup(&project_state).await?;
    match project_state.mod_loader {
        ModLoader::Vanilla => Ok("Vanilla майнкрафт установлен успешно".to_string()),
        ModLoader::Fabric => {
            let loader = create_mod_loader(&ModLoader::Fabric)?;
            let manifest = loader.versions(&project_state.mc_version).await?;
            loader.setup(&project_state, &manifest).await?;
            Ok("Fabric майнкрафт установлен успешно".to_string())
        }
        ModLoader::Forge => Ok("Forge майнкрафт установлен успешно".to_string()),
    }
}
