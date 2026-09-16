pub mod manifest;
pub mod structs;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;

use crate::{
    log_info,
    minecraft::{
        manifest::get_manifest_index,
        mod_loader::{
            config::merge_classpath,
            fabric::{manifest::transform_fabric_manifest, structs::FabricManifest},
            installer::install_loader_files,
            manifest::loader_version_or_err,
        },
        structs::{GameConfig, ModLoader, VersionMod},
    },
    state::dto::ProjectConfig,
    utils::{compare_versions, env_info::launcher_path, step_events::StepHandle},
};

const MOD_LOADER_NAME: &str = "fabric";

pub struct Fabric;
#[async_trait]
impl ModLoader for Fabric {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let version = &state.mc_version;
        let url_manifest = format!("https://meta.fabricmc.net/v2/versions/loader/{}", version);
        let manifest_fabric =
            get_manifest_index::<Vec<FabricManifest>>(MOD_LOADER_NAME, &url_manifest, version)
                .await
                .context("Не удалось загрузить манифест Fabric")?;
        let manifest: Vec<VersionMod> = transform_fabric_manifest(manifest_fabric)
            .context("Не удалось преобразовать манифест Fabric")?;
        Ok(manifest)
    }
    async fn version_current(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<VersionMod> {
        let version = loader_version_or_err(state)?;

        versions
            .iter()
            .find(|m| m.id == version)
            .cloned()
            .ok_or_else(|| anyhow!("Версия не найдена"))
    }
    async fn latest_version(
        &self,
        _state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String> {
        versions
            .iter()
            .map(|v| v.id.clone())
            .max_by(|a, b| compare_versions(a, b))
            .ok_or_else(|| anyhow!("Нет доступных версий Fabric"))
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        let target_version = loader_version_or_err(state)?;
        let version_info = manifest
            .iter()
            .find(|v| v.id == target_version)
            .ok_or_else(|| anyhow!("Версия не найдена"))?;

        let step = StepHandle::start("loader", "Установка Fabric");
        let base_path = launcher_path(Some(&state.project_name))
            .context("Не удалось определить путь к файлам проекта")?;
        install_loader_files(
            step.clone(),
            &base_path,
            &state.project_name,
            &version_info.id,
            &version_info.library,
            &version_info.url,
        )
        .await?;
        step.finish(false);
        Ok(())
    }
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        log_info!("Соединение classpath");
        let classpath = merge_classpath(
            &state.project_name,
            &version.id,
            &version.library,
            &vanilla_config.classpath,
        )?;

        Ok(vanilla_config.with_loader(classpath, version.main_class.clone()))
    }
}
