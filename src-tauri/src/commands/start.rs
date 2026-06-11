use anyhow::anyhow;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
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
    let mut state = state.lock().await;
    let uuid = generate_offline_uuid(&username);
    let config = new_launch_config(&username, &uuid, &access_token, &state.project_config).await?;
    let vanilla_config = Vanilla.config(&state.project_config, &config).await?;

    if matches!(state.project_config.mod_loader, ModLoader::Vanilla) {
        spawn_game_process(app, vanilla_config)?;
        return Ok("Vanilla майнкрафт установлен успешно".to_string());
    }

    if state.loader.is_none() {
        let new_loader = create_mod_loader(&state.project_config.mod_loader)?;
        state.loader = Some(new_loader);
    }

    let loader = state
        .loader
        .as_deref()
        .ok_or(anyhow!("Лоадер не инициализирован"))?;
    let version = loader.version_current(&state.project_config).await?;
    let game_config = loader
        .config(&state.project_config, vanilla_config, &version)
        .await?;
    spawn_game_process(app, game_config)?;
    Ok("Майнкрафт успешно запущен".to_string())
}
