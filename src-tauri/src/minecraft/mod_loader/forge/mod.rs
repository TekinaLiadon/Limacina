pub mod manifest;

use crate::{
    log_info,
    minecraft::{
        mod_loader::{
            config::merge_classpath,
            forge::manifest::{
                get_library, get_manifest_index, transform_forge_manifest, MAVEN_BASE,
                MANIFEST_PREFIX,
            },
            installer::setup_loader,
            manifest::{
                apply_installed_manifest, current_loader_version, latest_index_version, Manifest,
            },
            utils::{filter_classpath, strip_classpath_args},
        },
        structs::{GameConfig, ModLoader, VersionMod},
    },
    state::dto::ProjectConfig,
    utils::{
        download_file::download_json,
        env_info::launcher_path,
    },
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;

pub struct Forge;
#[async_trait]
impl ModLoader for Forge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let mut manifest = transform_forge_manifest(get_manifest_index().await?);
        apply_installed_manifest(state, MANIFEST_PREFIX, MAVEN_BASE, &mut manifest).await?;
        Ok(manifest)
    }
    async fn version_current(&self, state: &ProjectConfig) -> Result<VersionMod> {
        let versions_list = self.versions(state).await?;
        current_loader_version(state, versions_list)
    }
    async fn latest_version(&self, state: &ProjectConfig) -> Result<String> {
        let index = get_manifest_index().await?;
        latest_index_version(&index, &state.mc_version, "Forge")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader("Forge", MANIFEST_PREFIX, state, manifest, get_library).await
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
            target_version,
            &version.library,
            &vanilla_config.classpath,
        )?;
        let clean_classpath = filter_classpath(classpath);

        let forge_manifest = launcher_path(None)?.join("manifest").join(format!(
            "forge_{}.json",
            &state
                .loader_version
                .as_deref()
                .ok_or(anyhow!("Лоадер не выбран"))?
        ));
        let manifest = download_json::<Manifest>(None, &forge_manifest).await?;
        let loader_game_args = manifest.arguments.game_strings();
        let jvm_args = [
            &vanilla_config.jvm_args[..],
            &strip_classpath_args(manifest.arguments.jvm_strings())[..],
        ]
        .concat();
        let game_args = [&vanilla_config.game_args[..], &loader_game_args[..]].concat();

        let main_class = version.main_class.clone();
        let game_dir = launcher_path(Some(&state.project_name))?;
        let game_config = GameConfig {
            java_path: vanilla_config.java_path,
            jvm_args,
            game_args,
            classpath: clean_classpath,
            main_class,
            game_dir,
        };
        Ok(game_config)
    }
}
