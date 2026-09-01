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
    let mut guard = state.lock().await;
    let mut config = match guard.launcher_config.clone() {
        Some(config) => config,
        None => LauncherConfig::load().ok().flatten().unwrap_or_default(),
    };

    mutate(&mut config);
    config.save()?;

    guard.launcher_config = Some(config.clone());
    Ok(config)
}

#[tauri::command]
pub async fn get_app_init_data(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<AppInitData> {
    let mut config = LauncherConfig::load().ok().flatten();

    if let Some(ref mut cfg) = config {
        if cfg.project_names.is_empty() {
            let server_url = env!("LAUNCHER_SERVER_URL");
            let url = format!("{}/launcher/config", server_url);
            if let Ok(response) = http_client().get(&url).send().await {
                if let Ok(server_config) = response.json::<crate::state::dto::ProjectConfig>().await {
                    if !server_config.project_name.is_empty() {
                        cfg.project_names = vec![server_config.project_name];
                        let _ = cfg.save();
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
    std::fs::create_dir_all(&base)
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"{}\": {}", base.display(), e))?;
    std::fs::create_dir_all(base.join("project"))
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"project\": {}", e))?;
    std::fs::create_dir_all(base.join("manifest"))
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"manifest\": {}", e))?;
    std::fs::create_dir_all(base.join("java"))
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"java\": {}", e))?;

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
    update_launcher_config(&state, |config| {
        config.discord_activity = settings.discord_activity;
        config.keep_old_configs = settings.keep_old_configs;
        config.download_speed_limit = settings.download_speed_limit;
        config.auto_update = settings.auto_update;
        config.system_notifications = settings.system_notifications;
        config.debug_mode = settings.debug_mode;
        config.start_with_system = settings.start_with_system;
        config.close_after_launch = settings.close_after_launch;
    })
    .await
    .map_err(Into::into)
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
