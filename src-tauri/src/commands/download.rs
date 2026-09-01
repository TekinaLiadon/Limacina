use tokio::sync::Mutex;

use crate::commands::dto::{create_mod_loader, resolve_latest_loader_version};
use crate::java::install_java;
use crate::java::alternative_java::{download_alt_java, get_java_distributions_list, JavaDistribution};
use crate::launcher_server::downloader::download_all_files;
use crate::launcher_server::downloader::download_mods;
use crate::minecraft::structs::MinecraftLoader;
use crate::state::dto::GlobalState;
use crate::state::dto::ModLoader as ConfigModLoader;
use crate::utils::step_events::StepHandle;
use crate::{minecraft::vanilla::Vanilla, utils::tauri_err::CommandResult};

#[tauri::command]
pub async fn download_minecraft(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let mut project_config = {
        let state = state.lock().await;
        state.project_config.clone()
    };

    resolve_latest_loader_version(&mut project_config).await?;
    project_config.save_config().await?;

    {
        let mut state = state.lock().await;
        state.project_config = project_config.clone();
    }

    let mod_loader = project_config.mod_loader.clone();

    let jar_path = crate::utils::env_info::launcher_patch(Some(&project_config.project_name))?
        .join(format!("{}.jar", &project_config.mc_version));
    if jar_path.exists() {
        let step = StepHandle::start("minecraft", "Установка Minecraft");
        step.finish(true);
        return Ok("Minecraft уже установлен".to_string());
    }

    Vanilla.setup(&project_config).await?;

    if matches!(mod_loader, ConfigModLoader::Vanilla) {
        return Ok("Vanilla майнкрафт установлен успешно".to_string());
    }

    let loader = create_mod_loader(&mod_loader)?;
    let manifest = loader.versions(&project_config).await?;
    loader.setup(&project_config, &manifest).await?;

    Ok("Модифицированный майнкрафт установлен успешно".to_string())
}

#[tauri::command]
pub async fn download_server_file(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let project_name = state
        .lock()
        .await
        .project_config
        .project_name
        .clone();
    download_all_files(project_name, false, &state).await?;
    Ok("Ok".to_string())
}

#[tauri::command]
pub async fn download_java(state: tauri::State<'_, Mutex<GlobalState>>) -> CommandResult<String> {
    let project_config = {
        let state = state.lock().await;
        state.project_config.clone()
    };

    let java_path = install_java(&project_config).await?;

    let mut state = state.lock().await;
    state.project_config.java_path = Some(java_path.to_string_lossy().into_owned());
    state.project_config.save_config().await?;
    Ok("Ok".to_string())
}

#[tauri::command]
pub async fn download_server_mods(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let project_name = state
        .lock()
        .await
        .project_config
        .project_name
        .clone();
    download_mods(project_name, &state).await.map_err(Into::into)
}

#[tauri::command]
pub async fn get_java_distributions() -> CommandResult<Vec<JavaDistribution>> {
    Ok(get_java_distributions_list())
}

#[tauri::command]
pub async fn download_alternative_java(
    state: tauri::State<'_, Mutex<GlobalState>>,
    distribution: String,
    java_version: Option<String>,
    replace_default: bool,
) -> CommandResult<String> {
    let mc_version = {
        let state = state.lock().await;
        state.project_config.mc_version.clone()
    };
    let java_path = download_alt_java(&distribution, java_version.as_deref(), &mc_version).await?;
    if replace_default {
        let mut state = state.lock().await;
        state.project_config.java_path = Some(java_path.to_string_lossy().into_owned());
        state.project_config.save_config().await?;
    }
    Ok("Ok".to_string())
}
