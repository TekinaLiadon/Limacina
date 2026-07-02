use std::path::PathBuf;
use serde::Serialize;
use sysinfo::System;
use tauri::State;
use tokio::sync::Mutex;

use crate::state::dto::GlobalState;
use crate::state::launcher_config::LauncherConfig;
use crate::utils::env_info::{get_home_dir, get_launcher_name};
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

#[tauri::command]
pub async fn get_app_init_data(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<AppInitData> {
    let config = LauncherConfig::load().ok().flatten();
    let version;
    {
        let mut state = state.lock().await;
        state.launcher_config = config.clone();
        version = state.app_version.clone();
    }

    let default_parent_path = get_home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut sys = System::new_all();
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

    let mut config = LauncherConfig::load()
        .ok()
        .flatten()
        .unwrap_or_default();
    config.launcher_path = launcher_path.clone();
    config.save()?;

    let base = PathBuf::from(&launcher_path);
    std::fs::create_dir_all(&base)
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"{}\": {}", base.display(), e))?;
    std::fs::create_dir_all(base.join("project"))
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"project\": {}", e))?;
    std::fs::create_dir_all(base.join("manifest"))
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"manifest\": {}", e))?;
    std::fs::create_dir_all(base.join("java"))
        .map_err(|e| anyhow::anyhow!("Не удалось создать папку \"java\": {}", e))?;

    {
        let mut state = state.lock().await;
        state.launcher_config = Some(config.clone());
    }
    Ok(config)
}
