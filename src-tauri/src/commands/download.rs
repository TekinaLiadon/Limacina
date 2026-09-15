use anyhow::{Context, Result};
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::java::alternative_java::{
    download_alt_java, get_java_distributions_list, JavaDistribution,
};
use crate::java::install_java;
use crate::java::parse_java_major;
use crate::java::resolve_java_version;
use crate::launcher_server::downloader::{download_all_files, download_mods};
use crate::minecraft::structs::MinecraftLoader;
use crate::state::dto::ModLoader as ConfigModLoader;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::utils::errors::LauncherError;
use crate::{minecraft::vanilla::Vanilla, utils::tauri_err::CommandResult};

async fn update_project_config(
    state: &tauri::State<'_, Mutex<GlobalState>>,
    mutate: impl AsyncFnOnce(&mut ProjectConfig) -> Result<()>,
) -> CommandResult<ProjectConfig> {
    let mut project_config = {
        let state = state.lock().await;
        state.project_config.clone()
    };
    mutate(&mut project_config).await?;
    project_config.save_config().await?;
    {
        let mut state = state.lock().await;
        state.project_config = project_config.clone();
    }
    Ok(project_config)
}

#[tauri::command]
pub async fn download_minecraft(state: tauri::State<'_, Mutex<GlobalState>>) -> CommandResult<()> {
    let result = download_minecraft_inner(state).await;
    crate::state::launch_state::clear_on_error(result)
}

async fn download_minecraft_inner(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let mut project_config = {
        let state = state.lock().await;
        state.project_config.clone()
    };
    let mod_loader = project_config.mod_loader.clone();

    let loader_manifest = if matches!(mod_loader, ConfigModLoader::Vanilla) {
        None
    } else {
        let loader = create_mod_loader(&mod_loader)?;
        let manifest = LauncherError::classify(
            loader.versions(&project_config).await,
            LauncherError::ManifestParse,
        )?;
        if project_config.loader_version.is_none() {
            let version = LauncherError::classify(
                loader
                    .latest_version(&project_config, &manifest)
                    .await
                    .with_context(|| {
                        format!(
                            "Не удалось определить последнюю версию лоадера (проект: {})",
                            project_config.project_name
                        )
                    }),
                LauncherError::ManifestParse,
            )?;
            project_config.loader_version = Some(version);
            project_config.save_config().await?;
            let mut state = state.lock().await;
            state.project_config = project_config.clone();
        }
        Some(manifest)
    };

    LauncherError::classify(
        Vanilla.setup(&project_config).await,
        LauncherError::GameDownload,
    )?;

    if let Some(manifest) = loader_manifest {
        let loader = create_mod_loader(&mod_loader)?;
        LauncherError::classify(
            loader.setup(&project_config, &manifest).await,
            LauncherError::LoaderSetup,
        )?;
    }

    Ok(())
}

#[tauri::command]
pub async fn download_server_file(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let result = async {
        let project_name = state.lock().await.project_config.project_name.clone();
        download_all_files(project_name, false, &state).await?;
        Ok(())
    }
    .await;
    crate::state::launch_state::clear_on_error(result)
}

#[tauri::command]
pub async fn download_java(state: tauri::State<'_, Mutex<GlobalState>>) -> CommandResult<()> {
    let result = update_project_config(&state, async |project_config: &mut ProjectConfig| {
        let (java_path, java_version) =
            LauncherError::classify(install_java(project_config).await, LauncherError::Java)?;
        project_config.java_path = Some(java_path.to_string_lossy().into_owned());
        project_config.java_version = Some(parse_java_major(&java_version)?);
        Ok(())
    })
    .await
    .map(|_| ());
    crate::state::launch_state::clear_on_error(result)
}

#[tauri::command]
pub async fn download_server_mods(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let result = async {
        let project_name = state.lock().await.project_config.project_name.clone();
        download_mods(project_name, &state).await?;
        Ok(())
    }
    .await;
    crate::state::launch_state::clear_on_error(result)
}

#[tauri::command]
pub async fn get_java_distributions() -> CommandResult<Vec<JavaDistribution>> {
    Ok(get_java_distributions_list())
}

#[tauri::command]
pub async fn get_java_version(mc_version: String) -> CommandResult<String> {
    Ok(resolve_java_version(&mc_version).await)
}

#[tauri::command]
pub async fn download_alternative_java(
    state: tauri::State<'_, Mutex<GlobalState>>,
    distribution: String,
    java_version: Option<String>,
    replace_default: bool,
) -> CommandResult<()> {
    let mc_version = {
        let state = state.lock().await;
        state.project_config.mc_version.clone()
    };
    let (java_path, alt_java_version) = LauncherError::classify(
        download_alt_java(&distribution, java_version.as_deref(), &mc_version).await,
        LauncherError::Java,
    )?;
    if replace_default {
        update_project_config(&state, async |project_config: &mut ProjectConfig| {
            project_config.java_path = Some(java_path.to_string_lossy().into_owned());
            project_config.java_version = Some(parse_java_major(&alt_java_version)?);
            Ok(())
        })
        .await?;
    }
    Ok(())
}
