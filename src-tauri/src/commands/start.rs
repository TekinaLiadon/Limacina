use anyhow::anyhow;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::minecraft::structs::{new_launch_config, MinecraftLoader};
use crate::minecraft::mod_loader::utils::spawn_game_process;
use crate::state::dto::{GlobalState, ModLoader};
use crate::{minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let mut state = state.lock().await;
    let session = state
        .session
        .as_ref()
        .ok_or(anyhow!("Необходима авторизация для запуска"))?;

    let uuid = session.uuid.clone();
    let username = session.username.clone();
    let access_token = session.access_token.clone();

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
