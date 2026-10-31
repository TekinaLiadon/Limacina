use anyhow::{Context, Result};
use tauri::State;
use tokio::sync::Mutex;

use crate::init;
use crate::state::config::{
    in_memory_project_config, is_corrupt_config, is_missing_config, load_config,
    recover_project_config, update_project_config,
};
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
    let _guard = crate::state::launch_state::try_acquire_launch_step()?;
    Ok(initialize_project_inner(state.inner(), &project_name).await?)
}

async fn initialize_project_inner(
    state: &Mutex<GlobalState>,
    project_name: &str,
) -> Result<ProjectConfig> {
    let config = match load_config(project_name).await {
        Ok(config) => config,
        Err(e) if is_corrupt_config(&e) => recover_project_config(state, project_name, e).await?,
        Err(e) if is_missing_config(&e) => {
            match in_memory_project_config(state, project_name).await {
                Some(config) => config,
                None => {
                    let launcher_path = LauncherConfig::resolved_launcher_path()
                        .to_string_lossy()
                        .to_string();
                    init::init_project_config(&launcher_path, project_name, None).await?
                }
            }
        }
        Err(e) => {
            return Err(e).context(format!(
                "Не удалось прочитать конфиг проекта {project_name}"
            ))
        }
    };

    let stored = update_project_config(state, async |stored: &mut ProjectConfig| {
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

#[cfg(test)]
mod initialize_tests {
    use super::initialize_project_inner;
    use crate::state::config::load_config;
    use crate::state::dto::GlobalState;
    use crate::test_support::{offline_project_config, LauncherDirGuard};
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn initialize_recovers_offline_profile_without_server() {
        let _guard = LauncherDirGuard::acquire("initialize_missing_offline").await;
        let state = Mutex::new(GlobalState {
            project_config: offline_project_config("Solo"),
            ..GlobalState::default()
        });

        let config = initialize_project_inner(&state, "Solo")
            .await
            .expect("потерянный конфиг офлайн-профиля восстанавливается из памяти");

        assert!(
            !config.online,
            "офлайн-профиль не должен становиться онлайн"
        );
        assert_eq!(config.mc_version, "1.20.1");
        let restored = load_config("Solo")
            .await
            .expect("восстановленный конфиг должен персиститься");
        assert!(!restored.online);
    }

    #[tokio::test]
    async fn initialize_recovers_corrupt_profile_with_backup() {
        let guard = LauncherDirGuard::acquire("initialize_corrupt_offline").await;
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        std::fs::write(config_dir.join("Solo.toml"), "not [valid toml").expect("битый toml");
        let state = Mutex::new(GlobalState {
            project_config: offline_project_config("Solo"),
            ..GlobalState::default()
        });

        let config = initialize_project_inner(&state, "Solo")
            .await
            .expect("битый конфиг офлайн-профиля восстанавливается без сервера");

        assert!(
            !config.online,
            "офлайн-профиль не должен становиться онлайн"
        );
        assert!(
            config_dir.join("Solo.toml.bak").exists(),
            "битый файл сохраняется в бэкап"
        );
        let restored = load_config("Solo")
            .await
            .expect("конфиг должен быть перезаписан рабочим");
        assert!(!restored.online);
    }

    #[tokio::test]
    async fn initialize_recovers_unknown_corrupt_profile_to_default_without_server() {
        let guard = LauncherDirGuard::acquire("initialize_corrupt_unknown").await;
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        std::fs::write(config_dir.join("Solo.toml"), "not [valid toml").expect("битый toml");
        let state = Mutex::new(GlobalState::default());

        let config = initialize_project_inner(&state, "Solo")
            .await
            .expect("битый конфиг неизвестного профиля не должен тянуть сервер");

        assert_eq!(config.project_name, "Solo");
        assert!(
            config_dir.join("Solo.toml.bak").exists(),
            "битый файл сохраняется в бэкап: {}",
            guard.root().display()
        );
    }
}
