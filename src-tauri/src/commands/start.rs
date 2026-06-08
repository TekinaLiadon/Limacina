use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::minecraft::dto::{new_launch_config, MinecraftLoader};
use crate::minecraft::mod_loader::utils::{generate_offline_uuid, spawn_game_process};
use crate::state::dto::ModLoader;
use crate::state::dto::ProjectConfig;
use crate::{minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    state: tauri::State<'_, Mutex<ProjectConfig>>,
    username: String,
    access_token: String,
) -> CommandResult<String> {
    let state = state.lock().await;
    let project_state = &state;
    let uuid = generate_offline_uuid(&username);
    let config = new_launch_config(&username, &uuid, &access_token, &project_state).await?;
    let vanilla_config = Vanilla.config(&project_state, &config).await?;

    match project_state.mod_loader {
        ModLoader::Vanilla => spawn_game_process(app, vanilla_config)?,
        ModLoader::Forge => {
            let loader = create_mod_loader(&project_state.mod_loader)?;
            let forge_version = &project_state.loader_version.as_deref().unwrap_or("");
            let manifest = loader.versions(&forge_version).await?;

            let target_id = format!("{}-{}", state.mc_version, forge_version);
            if let Some(forge_item) = manifest.iter().find(|m| m.id == target_id) {
                let game_config = loader
                    .config(&project_state, vanilla_config, &forge_item)
                    .await?;
                spawn_game_process(app, game_config)?;
            }
        }
        _ => {
            let loader = create_mod_loader(&project_state.mod_loader)?;
            let manifest = loader.versions(&project_state.mc_version).await?;
            let game_config = loader
                .config(&project_state, vanilla_config, &manifest[0])
                .await?;
            spawn_game_process(app, game_config)?;
        }
    }
    Ok("Майнкрафт успешно запущен".to_string())
}
