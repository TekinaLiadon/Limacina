use anyhow::Result;
use tauri::AppHandle;

use crate::{
    log_info,
    minecraft::jvm::{
        jvm::LaunchConfig,
        utils::{
            build_classpath, build_launch_args, extract_arguments, load_version_json,
            spawn_game_process,
        },
    },
    utils::{env_info::launcher_patch, java::find_java},
};

pub async fn vanilla_start(
    app: AppHandle,
    username: String,
    uuid: String,
    access_token: String,
    mc_version: String,
) -> Result<(), String> {
    log_info!("🎮 Запуск Vanilla Minecraft {}...", mc_version);

    let base_dir = launcher_patch()?;
    let versions_dir = base_dir.join("versions");
    let version_dir = versions_dir.join(&mc_version);
    let version_json_path = version_dir.join(format!("{}.json", mc_version));

    let version_json = load_version_json(&version_json_path).await?;

    let config = LaunchConfig::new(
        username,
        uuid,
        access_token,
        mc_version.clone(),
        mc_version.clone(),
    )
    .await
    .map_err(|e| e.to_string())?;

    let client_jar = version_dir.join(format!("{}.jar", mc_version));
    let assets_index_id = version_json
        .assets
        .clone()
        .unwrap_or_else(|| mc_version.clone());

    let classpath = build_classpath(&version_json.libraries, &config.libraries_dir, &client_jar)?;

    let (jvm_args, game_args) =
        extract_arguments(&version_json, &config, &classpath, &assets_index_id);

    let java_path = find_java()?;
    log_info!("☕ Java: {:?}", java_path);

    let full_args = build_launch_args(
        &config,
        jvm_args,
        game_args,
        &classpath,
        &version_json.main_class,
    );

    log_info!("Main class: {}", version_json.main_class);
    log_info!("Game dir: {:?}", config.game_dir);

    spawn_game_process(app, &java_path, &full_args, &config.game_dir);

    Ok(())
}
