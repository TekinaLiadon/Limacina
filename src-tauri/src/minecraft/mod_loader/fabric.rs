use ::anyhow::Result;
use async_trait::async_trait;

use crate::{
    log_info,
    minecraft::{
        dto::{GameConfig, LaunchConfig, ModLoader, VersionMod},
        mod_loader::{
            config::merge_classpath,
            download::{download_jar, download_libraries},
            dto::fabric::FabricManifest,
            manifest::{get_manifest_index, transform_fabric_manifest},
        },
    },
    utils::env_info::launcher_patch,
};

const MOD_LOADER_NAME: &str = "fabric"; // enum

pub struct Fabric;
#[async_trait]
impl ModLoader for Fabric {
    async fn versions(&self, version: &str) -> Result<Vec<VersionMod>> {
        let url_manifest = format!("https://meta.fabricmc.net/v2/versions/loader/{}", version);
        let manifest_fabric =
            get_manifest_index::<Vec<FabricManifest>>(MOD_LOADER_NAME, &url_manifest, version)
                .await?;
        let manifest: Vec<VersionMod> = transform_fabric_manifest(manifest_fabric);
        Ok(manifest)
    }
    async fn setup(&self, manifest: &VersionMod) -> Result<()> {
        log_info!("Скачивание основного jar");
        download_jar(&manifest.id, &manifest.url).await?;

        log_info!("Скачивание библиотек");
        download_libraries(manifest.library.clone()).await?;

        // скачать моды

        Ok(())
    }
    async fn config(
        &self,
        config: &LaunchConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        log_info!("Соединение classpath");
        let classpath = merge_classpath(
            &config.loader_version,
            &version.library,
            &vanilla_config.classpath,
        )?;

        let main_class = version.main_class.clone();
        let game_dir = launcher_patch(Some("libra"))?;
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
