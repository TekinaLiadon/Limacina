use std::time::Duration;

use anyhow::{anyhow, Context};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::minecraft::structs::{new_launch_config, MinecraftLoader};
use crate::minecraft::mod_loader::utils::spawn_game_process;
use crate::state::dto::{GlobalState, ModLoader};
use crate::utils::step_events::StepHandle;
use crate::{log_info, minecraft::vanilla::Vanilla, step_try, utils::tauri_err::CommandResult};

const GAME_WINDOW_TIMEOUT: Duration = Duration::from_secs(120);

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let config_step = StepHandle::start("launch.config", "Подготовка конфигурации");

    let (username, uuid, access_token, project, authlib_server_url, project_config) = {
        let state = state.lock().await;
        let session = step_try!(config_step, state
            .session
            .as_ref()
            .ok_or(anyhow!("Необходима авторизация для запуска. Сессия не найдена в состоянии.")));

        let project = state.project_config.project_name.clone();
        let mc_version = state.project_config.mc_version.clone();
        let mod_loader = state.project_config.mod_loader.clone();

        let authlib_server_url = if state.project_config.online {
            Some(state.project_config.resolved_server_url())
        } else {
            None
        };

        log_info!("[start] Запуск для проекта={}, версия={}, лоадер={:?}, пользователь={}, онлайн={}", project, mc_version, mod_loader, session.username, state.project_config.online);

        (
            session.username.clone(),
            session.uuid.clone(),
            session.access_token.clone(),
            project,
            authlib_server_url,
            state.project_config.clone(),
        )
    };

    let config = step_try!(config_step, new_launch_config(&username, &uuid, &access_token, &project_config).await
        .with_context(|| format!("Не удалось создать конфиг запуска (проект: {})", project)));
    let vanilla_config = step_try!(config_step, Vanilla.config(&project_config, &config).await
        .with_context(|| format!("Не удалось получить Vanilla конфиг (проект: {})", project)));

    let game_config = if matches!(project_config.mod_loader, ModLoader::Vanilla) {
        vanilla_config
    } else {
        let loader = step_try!(config_step, create_mod_loader(&project_config.mod_loader));
        let version = step_try!(config_step, loader.version_current(&project_config).await
            .with_context(|| format!("Не удалось получить текущую версию лоадера (проект: {})", project)));
        step_try!(config_step, loader
            .config(&project_config, vanilla_config, &version)
            .await
            .with_context(|| format!("Не удалось собрать конфиг игры (проект: {})", project)))
    };
    config_step.finish(false);

    let process_step = StepHandle::start("launch.process", "Запуск процесса игры");
    let process = step_try!(process_step, spawn_game_process(app, game_config, authlib_server_url.as_deref())
        .with_context(|| format!("Не удалось запустить Minecraft (проект: {})", project)));
    process_step.finish(false);

    let window_step = StepHandle::start("launch.window", "Ожидание окна игры");
    step_try!(window_step, process
        .wait_for_window(GAME_WINDOW_TIMEOUT)
        .await
        .with_context(|| format!("Проект: {}", project)));
    window_step.finish(false);

    Ok("Майнкрафт успешно запущен".to_string())
}
