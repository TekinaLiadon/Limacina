use std::path::PathBuf;
use serde::Serialize;
use sysinfo::System;
use tauri::State;
use tokio::sync::Mutex;

use crate::state::dto::GlobalState;
use crate::state::launcher_config::LauncherConfig;
use crate::utils::env_info::{get_home_dir, get_launcher_name};
use crate::utils::http::http_client;
use crate::utils::tauri_err::CommandResult;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInitData {
    pub launcher_name: String,
    pub default_parent_path: String,
    pub launcher_config: Option<LauncherConfig>,
    pub version: String,
    pub total_memory_mb: u64,
}




pub(crate) async fn update_launcher_config(
    state: &State<'_, Mutex<GlobalState>>,
    mutate: impl FnOnce(&mut LauncherConfig),
) -> anyhow::Result<LauncherConfig> {
    let (config, content, path) = {
        let mut guard = state.lock().await;
        let mut config = match guard.launcher_config.clone() {
            Some(config) => config,
            None => LauncherConfig::load().ok().flatten().unwrap_or_default(),
        };

        mutate(&mut config);

        let content = config
            .serialize_for_save()
            .map_err(|e| anyhow::anyhow!("Не удалось сериализовать конфиг: {}", e))?;
        let path = LauncherConfig::config_file_path_public()
            .map_err(|e| anyhow::anyhow!("Не удалось определить путь конфига: {}", e))?;

        guard.launcher_config = Some(config.clone());
        (config, content, path)
    };

    let content_clone = content.clone();
    let path_clone = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        LauncherConfig::write_serialized(&path_clone, &content_clone)
    })
    .await
    .map_err(|e| anyhow::anyhow!("Не удалось выполнить запись конфига: {}", e))??;

    config.on_saved_update_path();
    Ok(config)
}

#[tauri::command]
pub async fn get_app_init_data(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<AppInitData> {
    let mut config = tauri::async_runtime::spawn_blocking(LauncherConfig::load)
        .await
        .map_err(|e| anyhow::anyhow!("Не удалось выполнить чтение конфига: {}", e))?
        .ok()
        .flatten();

    if let Some(ref mut cfg) = config {
        if cfg.project_names.is_empty() {
            let server_url = env!("LAUNCHER_SERVER_URL");
            let url = format!("{}/v1/launcher/config", server_url);
            if let Ok(response) = http_client().get(&url).send().await {
                if let Ok(server_config) = response.json::<crate::state::dto::ProjectConfig>().await {
                    if !server_config.project_name.is_empty() {
                        cfg.project_names = vec![server_config.project_name];
                        let cfg_clone = cfg.clone();
                        let _ = tauri::async_runtime::spawn_blocking(move || cfg_clone.save())
                            .await
                            .map_err(|e| anyhow::anyhow!("Не удалось выполнить запись конфига: {}", e))?;
                    }
                }
            }
        }
    }

    let version;
    {
        let mut state = state.lock().await;
        state.launcher_config = config.clone();
        version = state.app_version.clone();
    }

    let default_parent_path = get_home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut sys = System::new();
    sys.refresh_memory();
    let total_memory_mb = sys.total_memory() / 1024 / 1024;

    Ok(AppInitData {
        launcher_name: get_launcher_name(),
        default_parent_path,
        launcher_config: config,
        version,
        total_memory_mb,
    })
}

#[tauri::command]
pub async fn save_launcher_config(
    state: State<'_, Mutex<GlobalState>>,
    parent_path: String,
) -> CommandResult<LauncherConfig> {
    let name = get_launcher_name();
    let launcher_path = PathBuf::from(&parent_path)
        .join(&name)
        .to_string_lossy()
        .to_string();

    let config = update_launcher_config(&state, |config| {
        config.launcher_path = launcher_path.clone();
    })
    .await?;

    let base = PathBuf::from(&config.launcher_path);
    let dirs_to_create = [base.clone(), base.join("project"), base.join("manifest"), base.join("java")];
    tauri::async_runtime::spawn_blocking(move || {
        for dir in dirs_to_create {
            std::fs::create_dir_all(&dir)
                .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"{}\": {}", dir.display(), e))?;
        }
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|e| anyhow::anyhow!("Не удалось выполнить создание папок: {}", e))??;

    Ok(config)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettingsPayload {
    pub discord_activity: bool,
    pub keep_old_configs: bool,
    pub download_speed_limit: Option<u64>,
    pub auto_update: bool,
    pub system_notifications: bool,
    pub debug_mode: bool,
    pub start_with_system: bool,
    pub close_after_launch: bool,
}

#[tauri::command]
pub async fn save_launcher_settings(
    state: State<'_, Mutex<GlobalState>>,
    settings: LauncherSettingsPayload,
) -> CommandResult<LauncherConfig> {
    let config = update_launcher_config(&state, |config| {
        config.discord_activity = settings.discord_activity;
        config.keep_old_configs = settings.keep_old_configs;
        config.download_speed_limit = settings.download_speed_limit;
        config.auto_update = settings.auto_update;
        config.system_notifications = settings.system_notifications;
        config.debug_mode = settings.debug_mode;
        config.start_with_system = settings.start_with_system;
        config.close_after_launch = settings.close_after_launch;
    })
    .await?;

    crate::utils::bandwidth::set_limit(config.download_speed_limit);

    crate::utils::logger_utils::set_console_emit_enabled(config.debug_mode);
    crate::utils::logger_utils::set_game_output_enabled(config.debug_mode);

    let discord_enabled = config.discord_activity;
    tauri::async_runtime::spawn_blocking(move || {
        crate::discord::on_settings_saved(discord_enabled);
    });

    Ok(config)
}

#[tauri::command]
pub async fn save_theme(
    state: State<'_, Mutex<GlobalState>>,
    theme: String,
) -> CommandResult<LauncherConfig> {
    update_launcher_config(&state, |config| {
        config.theme = theme.clone();
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn save_animations_enabled(
    state: State<'_, Mutex<GlobalState>>,
    animations_enabled: bool,
) -> CommandResult<LauncherConfig> {
    update_launcher_config(&state, |config| {
        config.animations_enabled = animations_enabled;
    })
    .await
    .map_err(Into::into)
}
