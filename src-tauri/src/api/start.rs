use tauri::AppHandle;

use crate::minecraft::dto::{new_launch_config, ModLoader};
use crate::minecraft::mod_loader::utils::{generate_offline_uuid, spawn_game_process};
use crate::{minecraft::mod_loader::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    username: String,
    access_token: String,
    mc_version: String,
) -> CommandResult<String> {
    let uuid = generate_offline_uuid(&username);
    let config = new_launch_config(username, uuid, access_token, mc_version).await?;
    let game_config = Vanilla.config(&config).await?;
    spawn_game_process(app, game_config)?;
    Ok("Vanilla майнкрафт успешно запущен".to_string())
}
