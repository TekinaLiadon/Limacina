use tokio::sync::Mutex;

use crate::init::init_project_config;
use crate::state::config::load_config;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::utils::tauri_err::CommandResult;

#[tauri::command]
pub async fn save_settings_project(
    state: tauri::State<'_, Mutex<GlobalState>>,
    config: ProjectConfig,
) -> CommandResult<String> {
    let mut state = state.lock().await;
    config.save_config().await?;
    state.project_config = config;
    Ok("Настройки изменены".to_string())
}

#[tauri::command]
pub async fn load_settings_project(
    state: tauri::State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    let mut state = state.lock().await;

    if let Ok(config) = load_config(&project_name).await {
        state.project_config = config.clone();
        return Ok(config);
    }

    let launcher_path = state
        .launcher_config
        .as_ref()
        .map(|c| c.launcher_path.clone())
        .unwrap_or_default();

    let config = init_project_config(&launcher_path, &project_name, None).await?;
    state.project_config = config.clone();
    Ok(config)
}
