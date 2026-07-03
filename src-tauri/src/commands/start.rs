use anyhow::{anyhow, Context};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::minecraft::structs::{new_launch_config, MinecraftLoader};
use crate::minecraft::mod_loader::utils::spawn_game_process;
use crate::state::dto::{GlobalState, ModLoader};
use crate::{log_info, minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let mut state = state.lock().await;
    let session = state
        .session
        .as_ref()
        .ok_or(anyhow!("Необходима авторизация для запуска. Сессия не найдена в состоянии."))?;

    let uuid = session.uuid.clone();
    let username = session.username.clone();
    let access_token = session.access_token.clone();
    let project = state.project_config.project_name.clone();
    let mc_version = state.project_config.mc_version.clone();
    let mod_loader = state.project_config.mod_loader.clone();

    log_info!("[start] Запуск для проекта={}, версия={}, лоадер={:?}, пользователь={}", project, mc_version, mod_loader, username);

    let config = new_launch_config(&username, &uuid, &access_token, &state.project_config).await
        .with_context(|| format!("Не удалось создать конфиг запуска (проект: {})", project))?;
    let vanilla_config = Vanilla.config(&state.project_config, &config).await
        .with_context(|| format!("Не удалось получить Vanilla конфиг (проект: {})", project))?;

    if matches!(mod_loader, ModLoader::Vanilla) {
        spawn_game_process(app, vanilla_config)
            .with_context(|| format!("Не удалось запустить Vanilla (проект: {})", project))?;
        return Ok("Vanilla майнкрафт установлен успешно".to_string());
    }

    if state.loader.is_none() {
        let new_loader = create_mod_loader(&mod_loader)?;
        state.loader = Some(new_loader);
    }

    let loader = state
        .loader
        .as_deref()
        .ok_or(anyhow!("Лоадер не инициализирован (проект: {})", project))?;
    let version = loader.version_current(&state.project_config).await
        .with_context(|| format!("Не удалось получить текущую версию лоадера (проект: {})", project))?;
    let game_config = loader
        .config(&state.project_config, vanilla_config, &version)
        .await
        .with_context(|| format!("Не удалось собрать конфиг игры (проект: {}, лоадер: {:?})", project, mod_loader))?;
    spawn_game_process(app, game_config)
        .with_context(|| format!("Не удалось запустить Minecraft (проект: {})", project))?;
    Ok("Майнкрафт успешно запущен".to_string())
}
