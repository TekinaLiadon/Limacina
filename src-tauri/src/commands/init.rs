use anyhow::Result;
use tauri::State;
use tokio::sync::Mutex;

use crate::state::config::{load_repaired_project_config, update_project_config};
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::state::launcher_config::LauncherConfig;
use crate::utils::tauri_err::CommandResult;

#[tauri::command]
pub async fn initialize_launcher(
    state: State<'_, Mutex<GlobalState>>,
    parent_path: String,
) -> CommandResult<LauncherConfig> {
    Ok(crate::init::init_launcher(&state, &parent_path).await?)
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
    load_repaired_project_config(state, project_name).await
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
    async fn unknown_corrupt_profile_never_falls_back_to_empty_default() {
        let guard = LauncherDirGuard::acquire("initialize_corrupt_unknown").await;
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        std::fs::write(config_dir.join("Solo.toml"), "not [valid toml").expect("битый toml");
        let state = Mutex::new(GlobalState::default());

        let result = initialize_project_inner(&state, "Solo").await;

        assert!(
            config_dir.join("Solo.toml.bak").exists(),
            "битый файл сохраняется в бэкап: {}",
            guard.root().display()
        );
        match result {
            Ok(config) => {
                assert!(
                    !config.mc_version.trim().is_empty(),
                    "серверное восстановление не должно отдавать пустую версию: {config:?}"
                );
            }
            Err(_) => {
                assert!(
                    !config_dir.join("Solo.toml").exists(),
                    "при недоступном сервере пустой дефолтный конфиг не должен попадать на диск: {}",
                    guard.root().display()
                );
            }
        }
    }
}
