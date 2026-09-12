use anyhow::{bail, Context, Result};
use tokio::sync::Mutex;

use crate::init::init_project_config;
use crate::state::config::load_config;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::utils::env_info::launcher_path;
use crate::utils::tauri_err::CommandResult;
use crate::log_info;

#[tauri::command]
pub async fn save_settings_project(
    state: tauri::State<'_, Mutex<GlobalState>>,
    config: ProjectConfig,
) -> CommandResult<()> {
    config.save_config().await?;
    let mut state = state.lock().await;
    state.project_config = config;
    Ok(())
}

#[tauri::command]
pub async fn load_settings_project(
    state: tauri::State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    if let Ok(config) = load_config(&project_name).await {
        let mut state = state.lock().await;
        state.project_config = config.clone();
        return Ok(config);
    }

    let launcher_path = crate::state::launcher_config::LauncherConfig::resolved_launcher_path()
        .to_string_lossy()
        .to_string();

    let config = init_project_config(&launcher_path, &project_name, None).await?;

    let mut state = state.lock().await;
    state.project_config = config.clone();
    Ok(config)
}

#[tauri::command]
pub async fn clear_minecraft_config(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let (project_name, keep_old_configs) = {
        let guard = state.lock().await;
        (
            guard.project_config.project_name.clone(),
            guard
                .launcher_config
                .as_ref()
                .map(|c| c.keep_old_configs)
                .unwrap_or(false),
        )
    };

    clear_minecraft_config_inner(&project_name, keep_old_configs)
        .await
        .map_err(Into::into)
}

async fn clear_minecraft_config_inner(
    project_name: &str,
    keep_old_configs: bool,
) -> Result<String> {
    if project_name.trim().is_empty() {
        bail!("Проект не выбран");
    }

    let game_dir = launcher_path(Some(project_name))?;
    let config_dir = game_dir.join("config");

    if !config_dir.exists() {
        return Ok("Папка конфигов отсутствует".to_string());
    }

    if keep_old_configs {
        let old_dir = game_dir.join("old_config");
        if old_dir.exists() {
            tokio::fs::remove_dir_all(&old_dir)
                .await
                .with_context(|| format!("Не удалось удалить старую папку {:?}", old_dir))?;
        }
        tokio::fs::rename(&config_dir, &old_dir)
            .await
            .with_context(|| format!("Не удалось переименовать папку {:?}", config_dir))?;
        log_info!("Конфиги проекта {} перемещены в old_config", project_name);
        Ok("Конфиги перемещены в резервную копию".to_string())
    } else {
        tokio::fs::remove_dir_all(&config_dir)
            .await
            .with_context(|| format!("Не удалось удалить папку {:?}", config_dir))?;
        log_info!("Папка config проекта {} удалена", project_name);
        Ok("Папка конфигов удалена".to_string())
    }
}
