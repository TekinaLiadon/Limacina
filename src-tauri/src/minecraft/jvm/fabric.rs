use std::path::Path;

use crate::{
    log_info,
    minecraft::jvm::{
        jvm::LaunchConfig,
        utils::{find_all_jar_files, spawn_game_process},
    },
    utils::{env_info::launcher_patch, java::find_java, os::get_classpath_separator},
};
use anyhow::{Context, Result};
use tauri::AppHandle;

pub async fn fabric_start(
    app: AppHandle,
    username: String,
    uuid: String,
    access_token: String,
    mc_version: String,
) -> Result<()> {
    log_info!("🎮 Запуск Minecraft {} с Fabric...", mc_version);

    let config = LaunchConfig::new(
        username.clone(),
        uuid.clone(),
        access_token.clone(),
        mc_version.clone(),
        format!("fabric-{}", mc_version),
    )
    .await
    .context("Ошибка создания конфига")?;

    let base_dir = launcher_patch()?;

    let mut jar_files = find_all_jar_files(&config.libraries_dir)?;
    log_info!("Найдено библиотек: {}", jar_files.len());

    let fabric_loader = jar_files
        .iter()
        .find(|path| path.contains("fabric-loader"))
        .cloned();

    match &fabric_loader {
        Some(loader_path) => {
            log_info!("Fabric Loader найден: {}", loader_path);
            if !Path::new(loader_path).exists() {
                log_info!("ОШИБКА: Файл Fabric Loader не существует!");
            }
        }
        None => {
            log_info!("Fabric Loader НЕ найден в библиотеках");
        }
    }

    let game_jar_path = base_dir
        .join("versions")
        .join(&mc_version)
        .join(format!("{}.jar", mc_version));

    let game_jar_path = if game_jar_path.exists() {
        dunce::canonicalize(&game_jar_path).unwrap_or(game_jar_path)
    } else {
        game_jar_path
    };

    jar_files.push(game_jar_path.to_string_lossy().to_string());

    let separator = get_classpath_separator();
    let classpath = jar_files.join(separator);

    let args = vec![
        format!("-Xms{}", config.min_memory),
        format!("-Xmx{}", config.max_memory),
        format!(
            "-Djava.library.path={}",
            config.natives_dir.to_string_lossy()
        ),
        "-XX:+UnlockExperimentalVMOptions".to_string(),
        "-XX:+UseG1GC".to_string(),
        "-Duser.language=ru".to_string(),
        //"--enable-native-access=ALL-UNNAMED".to_string(), // Java 17+
        "-cp".to_string(),
        classpath,
        format!("-Dfabric.gameJarPath={}", game_jar_path.to_string_lossy()),
        "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string(),
        "--username".to_string(),
        username,
        "--uuid".to_string(),
        uuid,
        "--accessToken".to_string(),
        access_token,
        "--userProperties".to_string(),
        "{}".to_string(),
        "--assetsDir".to_string(),
        config.assets_dir.to_string_lossy().to_string(),
        "--assetIndex".to_string(),
        mc_version,
        "--gameDir".to_string(),
        config.game_dir.to_string_lossy().to_string(),
        "--width".to_string(),
        "1280".to_string(),
        "--height".to_string(),
        "720".to_string(),
        "--versionType".to_string(),
        "release".to_string(),
    ];

    let java_path = find_java()?;
    log_info!("☕ Java: {:?}", java_path);

    spawn_game_process(app, &java_path, &args, &config.game_dir)?;
    Ok(())
}
