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
    let config = crate::utils::blocking(
        "Не удалось выполнить инициализацию лаунчера",
        move || init::init_launcher(&parent_path),
    )
    .await??;

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

    {
        let mut state = state.lock().await;
        state.project_config = config.clone();
    }

    Ok(config)
}

#[tauri::command]
pub async fn set_initialized(state: State<'_, Mutex<GlobalState>>) -> CommandResult<ProjectConfig> {
    crate::state::config::update_project_config(&state, async |config: &mut ProjectConfig| {
        config.initialized = true;
        Ok(())
    })
    .await
    .map_err(Into::into)
}
