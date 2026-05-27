use std::collections::HashMap;

use ::anyhow::Result;
use async_trait::async_trait;

use crate::{
    log_info,
    minecraft::{
        dto::{GameConfig, LaunchConfig, MinecraftLoader, Versions},
        mod_loader::{
            config::{get_classpath, get_game_args, get_jvm_args, ArgumentsMap},
            download::{donwload_index_lib, download_assets, download_jar, download_native},
            dto::vanilla::{VanillaVersionsManifest, VersionDetailsManifest},
            manifest::{create_manifest_versions, get_manifest_index, get_manifest_version},
        },
    },
    utils::{env_info::launcher_patch, java::find_java},
};

const LOADER_NAME: &str = "vanilla"; // enum

pub struct Vanilla;
#[async_trait]
impl MinecraftLoader for Vanilla {
    async fn versions(&self) -> Result<Vec<Versions>> {
        log_info!("Загрузка индекс манифеста");
        let url = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
        let manifest_index =
            get_manifest_index::<VanillaVersionsManifest>(LOADER_NAME, &url, "index").await?;
        let manifest = create_manifest_versions(manifest_index.versions)?;
        Ok(manifest)
    }
    async fn setup(&self, version: &str) -> Result<()> {
        log_info!("Загрузка версии {}", version);
        let versions: Vec<Versions> = self.versions().await?;
        let manifest: VersionDetailsManifest = get_manifest_version(version, versions).await?;

        log_info!("Скачивание основного jar");
        download_jar(&manifest.id, &manifest.downloads.client.url).await?;

        log_info!("Скачивание нативных библиотек");
        download_native(&manifest).await?;

        log_info!("Скачивание assets");
        let index_lib = donwload_index_lib(&manifest).await?;
        download_assets(index_lib).await?;
        Ok(())
    }
    async fn config(&self, config: &LaunchConfig) -> Result<GameConfig> {
        log_info!("Получение Vanilla конфига {}...", config.mc_version);
        let versions: Vec<Versions> = self.versions().await?;
        let manifest_version: VersionDetailsManifest =
            get_manifest_version(&config.mc_version, versions).await?;

        log_info!("Формирование classpath");
        let classpath = get_classpath(&manifest_version.libraries, &config)?;

        log_info!("Формирование аргументов");
        let assets_index_id = manifest_version.assets.clone();
        let mut args_map = ArgumentsMap {
            map: HashMap::new(),
        };
        args_map.create_map(&config, &classpath, &assets_index_id);
        let jvm_args = get_jvm_args(&manifest_version, &config, &args_map);
        let game_args = get_game_args(&manifest_version, &args_map);

        log_info!("Поиск java");
        let java_path = find_java()?;

        let game_dir = launcher_patch(Some("libra"))?;
        let game_config = GameConfig {
            java_path,
            jvm_args,
            game_args,
            classpath,
            main_class: manifest_version.main_class,
            game_dir,
        };
        Ok(game_config)
    }
}
