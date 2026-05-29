use tokio::sync::Mutex;

use crate::state::dto::State;
use crate::{
    state::{config::load_config, dto::ProjectConfig},
    utils::tauri_err::CommandResult,
};

#[tauri::command]
pub async fn save_settings_project(
    state: tauri::State<'_, Mutex<State>>,
    config: ProjectConfig,
) -> CommandResult<String> {
    let mut state = state.lock().await;
    config.save_config().await?;
    state.project_info = config;
    Ok("Настройки изменены".to_string())
}

#[tauri::command]
pub async fn load_settings_project(
    state: tauri::State<'_, Mutex<State>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    println!("[LOG] 1");
    let mut state = state.lock().await;
    let config = load_config(&project_name).await?;
    state.project_info = config.clone();
    println!("[LOG] 2");
    Ok(config)
}
