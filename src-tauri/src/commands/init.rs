use tauri::State;
use tokio::sync::Mutex;

use crate::init;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::state::launcher_config::LauncherConfig;
use crate::utils::tauri_err::CommandResult;

#[tauri::command]
pub async fn initialize_launcher(
    state: State<'_, Mutex<GlobalState>>,
    parent_path: String,
) -> CommandResult<LauncherConfig> {
    let config = init::init_launcher(&parent_path)?;

    {
        let mut state = state.lock().await;
        state.launcher_config = Some(config.clone());
    }

    Ok(config)
}

#[tauri::command]
pub async fn initialize_project(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    let launcher_path = state
        .lock()
        .await
        .launcher_config
        .as_ref()
        .map(|c| c.launcher_path.clone())
        .unwrap_or_default();

    let config = init::init_project_config(&launcher_path, &project_name).await?;

    {
        let mut state = state.lock().await;
        state.project_config = config.clone();
    }

    Ok(config)
}

#[tauri::command]
pub async fn set_initialized(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let mut state = state.lock().await;
    state.project_config.initialized = true;
    state.project_config.save_config().await?;
    Ok(())
}
