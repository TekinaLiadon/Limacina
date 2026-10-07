use tauri::State;
use tokio::sync::Mutex;

use crate::init;
use crate::state::config::update_project_config;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::state::launcher_config::LauncherConfig;
use crate::utils::tauri_err::CommandResult;

#[tauri::command]
pub async fn initialize_launcher(
    state: State<'_, Mutex<GlobalState>>,
    parent_path: String,
) -> CommandResult<LauncherConfig> {
    Ok(init::init_launcher(&state, &parent_path).await?)
}

#[tauri::command]
pub async fn initialize_project(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    let _guard = crate::state::launch_state::acquire_launch_step();
    initialize_project_inner(state, project_name).await
}

async fn initialize_project_inner(
    state: State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    let launcher_path = LauncherConfig::resolved_launcher_path()
        .to_string_lossy()
        .to_string();

    let config = init::init_project_config(&launcher_path, &project_name, None).await?;

    let stored = update_project_config(&state, async |stored: &mut ProjectConfig| {
        *stored = config;
        Ok(())
    })
    .await?;

    Ok(stored)
}

#[tauri::command]
pub async fn set_initialized(state: State<'_, Mutex<GlobalState>>) -> CommandResult<ProjectConfig> {
    update_project_config(&state, async |config: &mut ProjectConfig| {
        config.initialized = true;
        Ok(())
    })
    .await
    .map_err(Into::into)
}
