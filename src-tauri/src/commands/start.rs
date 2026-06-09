use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::minecraft::dto::{new_launch_config, MinecraftLoader};
use crate::minecraft::mod_loader::utils::{generate_offline_uuid, spawn_game_process};
use crate::state::dto::{GlobalState, ModLoader};
use crate::{minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
    username: String,
    access_token: String,
) -> CommandResult<String> {
    let state = state.lock().await;
    let project_state = &state.project_config;
    let uuid = generate_offline_uuid(&username);
    let config = new_launch_config(&username, &uuid, &access_token, &project_state).await?;
    let vanilla_config = Vanilla.config(&project_state, &config).await?;

    if matches!(project_state.mod_loader, ModLoader::Vanilla) {
        spawn_game_process(app, vanilla_config)?;
        return Ok("Vanilla майнкрафт установлен успешно".to_string());
    }

    let loader = state.loader.as_ref().unwrap();
    let version = loader.version_current(&project_state).await?;
    let game_config = loader
        .config(&project_state, vanilla_config, &version)
        .await?;
    spawn_game_process(app, game_config)?;
    Ok("Майнкрафт успешно запущен".to_string())
}
