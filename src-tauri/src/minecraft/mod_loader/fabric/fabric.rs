use ::anyhow::Result;
use anyhow::{anyhow, bail};
use async_trait::async_trait;

use crate::{
    log_info,
    minecraft::{
        download::download_jar,
        structs::{GameConfig, ModLoader, VersionMod},
        manifest::get_manifest_index,
        mod_loader::{
            config::merge_classpath,
            download::download_libraries,
            fabric::{structs::FabricManifest, manifest::transform_fabric_manifest},
        },
    },
    state::dto::ProjectConfig,
    utils::env_info::launcher_patch,
};

const MOD_LOADER_NAME: &str = "fabric"; // enum

pub struct Fabric;
#[async_trait]
impl ModLoader for Fabric {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let version = &state.mc_version;
        let url_manifest = format!("https://meta.fabricmc.net/v2/versions/loader/{}", version);
        let manifest_fabric =
            get_manifest_index::<Vec<FabricManifest>>(MOD_LOADER_NAME, &url_manifest, version)
                .await?;
        let manifest: Vec<VersionMod> = transform_fabric_manifest(manifest_fabric);
        Ok(manifest)
    }
    async fn version_current(&self, state: &ProjectConfig) -> Result<VersionMod> {
        let versions_list = self.versions(&state).await?;
        let version = state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;

        if let Some(fabric_item) = versions_list.into_iter().find(|m| m.id == version) {
            return Ok(fabric_item);
        }
        bail!("Версия не найдена")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &Vec<VersionMod>) -> Result<()> {
        let target_version = state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;
        let version_info = manifest
            .iter()
            .find(|v| v.id == target_version)
            .expect("Версия не найдена");
        log_info!("Скачивание основного jar");
        download_jar(&state.project_name, &version_info.id, &version_info.url).await?;

        log_info!("Скачивание библиотек");
        download_libraries(&state.project_name, version_info.library.clone()).await?;

        // скачать моды

        Ok(())
    }
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        log_info!("Соединение classpath");
        let target_version = state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;
        let classpath = merge_classpath(
            &state.project_name,
            &target_version,
            &version.library,
            &vanilla_config.classpath,
        )?;

        let main_class = version.main_class.clone();
        let game_dir = launcher_patch(Some(&state.project_name))?;
        let game_config = GameConfig {
            java_path: vanilla_config.java_path,
            jvm_args: vanilla_config.jvm_args,
            game_args: vanilla_config.game_args,
            classpath,
            main_class,
            game_dir,
        };
        Ok(game_config)
    }
}
