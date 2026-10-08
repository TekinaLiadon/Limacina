pub mod config;
pub mod download;
pub mod manifest;
pub mod pipeline;
pub mod rules;
pub mod structs;

use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;

use crate::minecraft::manifest::get_manifest_version;
use crate::minecraft::vanilla::config::get_classpath;
use crate::minecraft::vanilla::config::{get_game_args, get_jvm_args, ArgumentsMap};
use crate::minecraft::vanilla::download::{
    extract_natives, natives_match_version, read_asset_index, VanillaPhaseInfo, PHASE_ASSET_INDEX,
    PHASE_NATIVES,
};
use crate::minecraft::vanilla::manifest::load_vanilla_index;
use crate::minecraft::vanilla::pipeline::{run_vanilla_phases, VanillaPhaseExecutor};
use crate::minecraft::vanilla::structs::{AssetIndexContent, VersionDetailsManifest};
use crate::state::dto::ProjectConfig;
use crate::{
    log_info,
    minecraft::structs::{GameConfig, LaunchConfig, MinecraftLoader, Versions},
    step_try,
    utils::{
        blocking,
        env_info::launcher_path,
        errors::LauncherError,
        integrity::{ensure_files, IntegrityTarget},
        java::find_java,
        step_events::StepHandle,
    },
};

pub struct Vanilla;

struct InstallPhases {
    base_path: PathBuf,
    project_name: String,
}

#[async_trait]
impl VanillaPhaseExecutor for InstallPhases {
    async fn fetch(
        &mut self,
        phase: &'static VanillaPhaseInfo,
        targets: Vec<IntegrityTarget>,
    ) -> Result<()> {
        let step = StepHandle::start(phase.id, phase.label);
        step_try!(
            step,
            ensure_files(&step, &self.base_path, &self.project_name, targets).await
        );
        step.finish(false);
        Ok(())
    }

    async fn natives(
        &mut self,
        mc_version: &str,
        natives_rel: Vec<(PathBuf, Option<Vec<String>>)>,
    ) -> Result<()> {
        let step = StepHandle::start(PHASE_NATIVES.id, PHASE_NATIVES.label);
        let natives_dir = self.base_path.join("natives");
        if natives_match_version(&natives_dir, mc_version).await {
            step.finish(true);
            return Ok(());
        }
        step.detail("Распаковка");
        step_try!(
            step,
            extract_natives(&self.base_path, natives_rel, mc_version).await
        );
        step.finish(false);
        Ok(())
    }

    async fn asset_index(&mut self, target: IntegrityTarget) -> Result<AssetIndexContent> {
        let step = StepHandle::start(PHASE_ASSET_INDEX.id, PHASE_ASSET_INDEX.label);
        let index_rel = target.rel_path.clone();
        step_try!(
            step,
            ensure_files(&step, &self.base_path, &self.project_name, vec![target]).await
        );

        let index_path = self.base_path.join(&index_rel);
        let asset_index = match read_asset_index(&index_path).await {
            Ok(index) => index,
            Err(e) => {
                step.fail(e.to_string());
                return Err(e);
            }
        };
        step.finish(false);
        Ok(asset_index)
    }
}

#[async_trait]
impl MinecraftLoader for Vanilla {
    async fn versions(&self) -> Result<Vec<Versions>> {
        log_info!("Загрузка индекс манифеста");
        let versions = load_vanilla_index().await.map_err(|e| {
            LauncherError::ManifestParse(format!(
                "Не удалось загрузить индекс манифеста версий: {e:#}"
            ))
        })?;
        Ok(versions)
    }
    async fn setup(&self, state: &ProjectConfig) -> Result<()> {
        let version = &state.mc_version;
        log_info!("Загрузка версии {:?}", &version);

        let manifest_step = StepHandle::start("mc.manifest", "Загрузка манифеста версий");
        let versions: Vec<Versions> = step_try!(manifest_step, self.versions().await);
        manifest_step.finish(false);

        let version_step = StepHandle::start("mc.version", "Загрузка манифеста версии");
        let manifest: VersionDetailsManifest =
            step_try!(version_step, get_manifest_version(version, versions).await);
        version_step.finish(false);

        let base_path = launcher_path(Some(&state.project_name)).map_err(|e| {
            LauncherError::GameDownload(format!(
                "Не удалось определить путь к файлам проекта: {e:#}"
            ))
        })?;
        let mut phases = InstallPhases {
            base_path,
            project_name: state.project_name.clone(),
        };
        run_vanilla_phases(&mut phases, &manifest).await?;
        Ok(())
    }
    async fn config(&self, state: &ProjectConfig, config: &LaunchConfig) -> Result<GameConfig> {
        log_info!("Получение Vanilla конфига {}...", config.mc_version);
        let versions: Vec<Versions> = self.versions().await.map_err(|e| {
            LauncherError::ManifestParse(format!(
                "Не удалось получить список версий Vanilla: {e:#}"
            ))
        })?;
        let version_type = versions
            .iter()
            .find(|v| v.id == config.mc_version)
            .map(|v| v.version_type.clone())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "release".to_string());
        let manifest_version: VersionDetailsManifest =
            get_manifest_version(&config.mc_version, versions)
                .await
                .map_err(|e| {
                    LauncherError::ManifestParse(format!(
                        "Не удалось получить манифест версии: {e:#}"
                    ))
                })?;

        log_info!("Формирование classpath");
        let game_dir = launcher_path(Some(&state.project_name)).map_err(|e| {
            LauncherError::GameDownload(format!(
                "Не удалось определить путь к файлам проекта: {e:#}"
            ))
        })?;
        let mut classpath = get_classpath(&manifest_version.libraries, config).await?;
        let client_jar = game_dir.join(format!("{}.jar", config.mc_version));
        classpath.push(client_jar.to_string_lossy().to_string());

        log_info!("Формирование аргументов");
        let assets_index_id = manifest_version.assets.clone();
        let args_map = ArgumentsMap::new(config, &assets_index_id, &version_type);
        let jvm_args = get_jvm_args(&manifest_version, config, &args_map);
        let game_args = get_game_args(&manifest_version, &args_map);

        log_info!("Поиск java");
        let java_config = state.java_path.clone();
        let java_path = LauncherError::classify(
            blocking("Поиск Java в системе", move || {
                find_java(java_config)
            })
            .await?,
            LauncherError::Java,
        )?;

        Ok(GameConfig::new(
            java_path,
            jvm_args,
            game_args,
            classpath,
            manifest_version.main_class,
            game_dir,
        ))
    }
}
