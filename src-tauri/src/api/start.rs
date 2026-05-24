use tauri::AppHandle;

use crate::api::dto::ModLoaderFactory;
use crate::minecraft::dto::{new_launch_config, MinecraftLoader};
use crate::minecraft::mod_loader::utils::{generate_offline_uuid, spawn_game_process};
use crate::{minecraft::mod_loader::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    username: String,
    access_token: String,
    mc_version: String,
    loader_version: String,
    loader_name: String,
) -> CommandResult<String> {
    let uuid = generate_offline_uuid(&username);
    let config = new_launch_config(
        &username,
        &uuid,
        &access_token,
        &mc_version,
        &loader_version,
    )
    .await?;
    let vanilla_config = Vanilla.config(&config).await?;

    match loader_name.as_str() {
        "vanilla" => spawn_game_process(app, vanilla_config)?,
        _ => {
            let mod_config = config.clone();
            let loader = ModLoaderFactory::create(&loader_name)?;
            let manifest = loader.versions(&mod_config.mc_version).await?;
            let game_config = loader
                .config(&mod_config, vanilla_config, &manifest[0])
                .await?;
            spawn_game_process(app, game_config)?;
        }
    }
    Ok("Майнкрафт успешно запущен".to_string())
}
