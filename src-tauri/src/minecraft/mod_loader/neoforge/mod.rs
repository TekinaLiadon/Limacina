pub mod manifest;

use crate::{
    log_info,
    minecraft::{
        mod_loader::{
            config::merge_classpath,
            installer::setup_loader,
            manifest::{
                apply_installed_manifest, current_loader_version, latest_index_version, Manifest,
            },
            neoforge::manifest::{
                get_library, get_manifest_index, transform_neoforge_manifest, MAVEN_BASE,
                MANIFEST_PREFIX,
            },
            utils::{filter_classpath, strip_classpath_args},
        },
        structs::{GameConfig, ModLoader, VersionMod},
    },
    state::dto::ProjectConfig,
    utils::{download_file::download_json, env_info::launcher_path, get_classpath_separator},
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;

pub struct NeoForge;
#[async_trait]
impl ModLoader for NeoForge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let mut manifest = transform_neoforge_manifest(get_manifest_index().await?);
        apply_installed_manifest(state, MANIFEST_PREFIX, MAVEN_BASE, &mut manifest).await?;
        Ok(manifest)
    }
    async fn version_current(&self, state: &ProjectConfig) -> Result<VersionMod> {
        let versions_list = self.versions(state).await?;
        current_loader_version(state, versions_list)
    }
    async fn latest_version(&self, state: &ProjectConfig) -> Result<String> {
        let index = get_manifest_index().await?;
        latest_index_version(&index, &state.mc_version, "NeoForge")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader("NeoForge", MANIFEST_PREFIX, state, manifest, get_library).await
    }
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        log_info!("Соединение classpath NeoForge");
        let target_version = state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;

        let neoforge_manifest = launcher_path(None)?.join("manifest").join(format!(
            "neoforge_{}.json",
            target_version
        ));
        let manifest = download_json::<Manifest>(None, &neoforge_manifest).await?;

        let base_path = launcher_path(Some(&state.project_name))?;
        let natives_dir = base_path.join("natives").to_string_lossy().to_string();
        let libraries_dir = base_path.join("libraries").to_string_lossy().to_string();

        let neoforge_libraries = if version.library.is_empty() {
            get_library(manifest.clone())?
        } else {
            version.library.clone()
        };
        let mut classpath = merge_classpath(
            &state.project_name,
            target_version,
            &neoforge_libraries,
            &Vec::new(),
        )?;
        let vanilla_client_jar = format!("{}.jar", state.mc_version);
        let vanilla_filtered: Vec<String> = vanilla_config.classpath
            .iter()
            .filter(|p| !p.ends_with(&vanilla_client_jar))
            .cloned()
            .collect();
        classpath.extend(vanilla_filtered);
        let clean_classpath = filter_classpath(classpath);

        let neoforge_jvm: Vec<String> = strip_classpath_args(
            manifest
                .arguments
                .jvm_strings()
                .into_iter()
                .map(|arg| {
                    let mut result = arg.replace("${natives_directory}", &natives_dir);
                    result = result.replace("${library_directory}", &libraries_dir);
                    result = result.replace("${classpath_separator}", get_classpath_separator());
                    result = result.replace("${launcher_name}", "Limacina");
                    result = result.replace("${launcher_version}", "1.0");
                    result
                })
                .collect(),
        );
        let jvm_args = [&vanilla_config.jvm_args[..], &neoforge_jvm[..]].concat();

        let mut game_args = vanilla_config.game_args;
        let neoforge_game = manifest.arguments.game_strings();
        let mut i = 0;
        while i < neoforge_game.len() {
            let arg = &neoforge_game[i];
            if arg.starts_with("--") {
                let flag = arg.clone();
                let value = neoforge_game.get(i + 1).cloned().unwrap_or_default();
                if value.starts_with("${") {
                    i += 1;
                    continue;
                }
                if !game_args.iter().any(|a| a == &flag) {
                    game_args.push(flag);
                    game_args.push(value);
                    i += 1;
                }
            }
            i += 1;
        }

        let main_class = manifest.main_class.clone();
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
