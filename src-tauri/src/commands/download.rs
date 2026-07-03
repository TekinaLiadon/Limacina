use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::commands::dto::{create_mod_loader, resolve_latest_loader_version};
use crate::java::install_java;
use crate::launcher_server::downloader::download_all_files;
use crate::launcher_server::downloader::download_mods;
use crate::minecraft::structs::MinecraftLoader;
use crate::state::dto::GlobalState;
use crate::state::dto::ModLoader as ConfigModLoader;
use crate::{minecraft::vanilla::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let (project_config, mod_loader) = {
        let mut state = state.lock().await;
        resolve_latest_loader_version(&mut state.project_config).await?;
        state.project_config.save_config().await?;
        (state.project_config.clone(), state.project_config.mod_loader.clone())
    };

    let jar_path = crate::utils::env_info::launcher_patch(Some(&project_config.project_name))?
        .join(format!("{}.jar", &project_config.mc_version));
    if jar_path.exists() {
        return Ok("Minecraft уже установлен".to_string());
    }

    Vanilla.setup(&project_config).await?;

    if matches!(mod_loader, ConfigModLoader::Vanilla) {
        return Ok("Vanilla майнкрафт установлен успешно".to_string());
    }

    let loader = create_mod_loader(&mod_loader)?;
    let manifest = loader.versions(&project_config).await?;
    loader.setup(&project_config, &manifest).await?;

    {
        let mut state = state.lock().await;
        state.loader = Some(loader);
    }

    Ok("Модифицированный майнкрафт установлен успешно".to_string())
}

#[tauri::command]
pub async fn download_server_file(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let project_name = state
        .lock()
        .await
        .project_config
        .project_name
        .clone();
    download_all_files(app, project_name, false, &state).await?;
    Ok("Ok".to_string())
}

#[tauri::command]
pub async fn download_java(state: tauri::State<'_, Mutex<GlobalState>>) -> CommandResult<String> {
    let mut state = state.lock().await;
    let java_path = install_java(&state.project_config).await?;
    state.project_config.java_path = Some(java_path.to_string_lossy().into_owned());
    state.project_config.save_config().await?;
    Ok("Ok".to_string())
}

#[tauri::command]
pub async fn download_server_mods(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let project_name = state
        .lock()
        .await
        .project_config
        .project_name
        .clone();
    download_mods(app, project_name, &state).await.map_err(Into::into)
}
