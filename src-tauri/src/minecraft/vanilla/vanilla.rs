use ::anyhow::Result;
use async_trait::async_trait;

use crate::minecraft::download::download_jar;
use crate::minecraft::manifest::get_manifest_index;
use crate::minecraft::mod_loader::manifest::get_manifest_version;
use crate::minecraft::vanilla::config::get_classpath;
use crate::minecraft::vanilla::config::{get_game_args, get_jvm_args, ArgumentsMap};
use crate::minecraft::vanilla::download::{donwload_index_lib, download_assets, download_native};
use crate::minecraft::vanilla::dto::{VanillaVersionsManifest, VersionDetailsManifest};
use crate::minecraft::vanilla::manifest::create_manifest_versions;
use crate::state::dto::ProjectConfig;
use crate::{
    log_info,
    minecraft::dto::{GameConfig, LaunchConfig, MinecraftLoader, Versions},
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
    async fn setup(&self, state: &ProjectConfig) -> Result<()> {
        let version = &state.mc_version;
        log_info!("Загрузка версии {:?}", &version);
        let versions: Vec<Versions> = self.versions().await?;
        let manifest: VersionDetailsManifest = get_manifest_version(version, versions).await?;

        log_info!("Скачивание основного jar");
        download_jar(
            &state.project_name,
            &version,
            &manifest.downloads.client.url,
        )
        .await?;

        log_info!("Скачивание нативных библиотек");
        download_native(&state.project_name, &manifest).await?;

        log_info!("Скачивание assets");
        let index_lib = donwload_index_lib(&state.project_name, &manifest).await?;
        download_assets(&state.project_name, index_lib).await?;
        Ok(())
    }
    async fn config(&self, state: &ProjectConfig, config: &LaunchConfig) -> Result<GameConfig> {
        log_info!("Получение Vanilla конфига {}...", config.mc_version);
        let versions: Vec<Versions> = self.versions().await?;
        let manifest_version: VersionDetailsManifest =
            get_manifest_version(&config.mc_version, versions).await?;

        log_info!("Формирование classpath");
        let game_dir = launcher_patch(Some(&state.project_name))?;
        let mut classpath = get_classpath(&manifest_version.libraries, &config)?;
        let client_jar = game_dir.join(format!("{}.jar", config.mc_version));
        classpath.push(client_jar.to_string_lossy().to_string());

        log_info!("Формирование аргументов");
        let assets_index_id = manifest_version.assets.clone();
        let args_map = ArgumentsMap::new(&config, &assets_index_id);
        let jvm_args = get_jvm_args(&manifest_version, &config, &args_map);
        let game_args = get_game_args(&manifest_version, &args_map);

        log_info!("Поиск java");
        let java_path = find_java(state.java_path.clone())?;

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
