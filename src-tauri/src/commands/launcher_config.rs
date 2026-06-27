use std::path::PathBuf;
use serde::Serialize;
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
}

#[tauri::command]
pub async fn get_app_init_data(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<AppInitData> {
    let config = LauncherConfig::load().ok().flatten();
    {
        let mut state = state.lock().await;
        state.launcher_config = config.clone();
    }

    let default_parent_path = get_home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(AppInitData {
        launcher_name: get_launcher_name(),
        default_parent_path,
        launcher_config: config,
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
    let _ = std::fs::create_dir_all(&base);
    let _ = std::fs::create_dir_all(base.join("project"));
    let _ = std::fs::create_dir_all(base.join("manifest"));
    let _ = std::fs::create_dir_all(base.join("java"));

    {
        let mut state = state.lock().await;
        state.launcher_config = Some(config.clone());
    }
    Ok(config)
}
