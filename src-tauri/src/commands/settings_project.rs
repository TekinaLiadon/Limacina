use tokio::sync::Mutex;

use crate::{
    state::{
        config::load_config,
        dto::{GlobalState, ProjectConfig},
    },
    utils::tauri_err::CommandResult,
};

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
    println!("[LOG] 1");
    let mut state = state.lock().await;
    let config = load_config(&project_name).await?;
    state.project_config = config.clone();
    println!("[LOG] 2");
    Ok(config)
}
