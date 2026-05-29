use ::anyhow::anyhow;
use std::sync::Mutex;

use crate::{
    state::{
        config::{load_config, save_config},
        dto::{ProjectConfig, State},
    },
    utils::tauri_err::CommandResult,
};

#[tauri::command]
pub async fn save_settings_project(
    state: tauri::State<'_, Mutex<State>>,
    config: ProjectConfig,
) -> CommandResult<String> {
    let new_config = save_config(config).await?;
    let mut state = state.lock().map_err(|e| anyhow!("Ошибка: {}", e))?;
    state.project_info = new_config;
    Ok("Настройки изменены".to_string())
}

#[tauri::command]
pub async fn load_settings_project(
    state: tauri::State<'_, Mutex<State>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    let config = load_config(&project_name).await?;
    let mut state = state.lock().map_err(|e| anyhow!("Ошибка: {}", e))?;
    state.project_info = config.clone();
    Ok(config)
}
