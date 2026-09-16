pub mod manifest;

use crate::{
    log_info,
    minecraft::{
        mod_loader::{
            config::merge_classpath,
            installer::setup_loader,
            manifest::{
                apply_installed_manifest, current_loader_version, latest_list_version,
                loader_libraries, loader_version_or_err, Manifest,
            },
            neoforge::manifest::{
                get_manifest_index, transform_neoforge_manifest, MANIFEST_PREFIX, MAVEN_BASE,
            },
        },
        structs::{GameConfig, ModLoader, VersionMod},
        vanilla::config::{filter_classpath, strip_classpath_args},
    },
    state::dto::ProjectConfig,
    utils::{
        download_file::download_json,
        env_info::{get_launcher_name, launcher_path},
        get_classpath_separator,
    },
};
use anyhow::{Context, Result};
use async_trait::async_trait;

pub struct NeoForge;
#[async_trait]
impl ModLoader for NeoForge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let mut manifest = transform_neoforge_manifest(
            get_manifest_index()
                .await
                .context("Не удалось получить индекс NeoForge")?,
        );
        apply_installed_manifest(state, MANIFEST_PREFIX, MAVEN_BASE, &mut manifest)
            .await
            .context("Не удалось применить установленный манифест NeoForge")?;
        Ok(manifest)
    }
    async fn version_current(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<VersionMod> {
        current_loader_version(state, versions)
    }
    async fn latest_version(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String> {
        latest_list_version(versions, &state.mc_version, "NeoForge")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader("NeoForge", MANIFEST_PREFIX, state, manifest, MAVEN_BASE).await
    }
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        log_info!("Соединение classpath NeoForge");
        let target_version = loader_version_or_err(state)?;

        let neoforge_manifest = launcher_path(None)
            .context("Не удалось определить путь к файлам лаунчера")?
            .join("manifest")
            .join(format!("neoforge_{}.json", target_version));
        let manifest = download_json::<Manifest>(None, &neoforge_manifest)
            .await
            .context("Не удалось скачать манифест NeoForge")?;

        let base_path = launcher_path(Some(&state.project_name))
            .context("Не удалось определить путь к файлам проекта")?;
        let natives_dir = base_path.join("natives").to_string_lossy().to_string();
        let libraries_dir = base_path.join("libraries").to_string_lossy().to_string();

        let neoforge_libraries = if version.library.is_empty() {
            loader_libraries(manifest.libraries.clone(), MAVEN_BASE)
                .context("Не удалось собрать библиотеки NeoForge")?
        } else {
            version.library.clone()
        };
        let mut classpath = merge_classpath(
            &state.project_name,
            &version.id,
            &neoforge_libraries,
            &Vec::new(),
        )
        .context("Не удалось собрать classpath NeoForge")?;
        let vanilla_client_jar = format!("{}.jar", state.mc_version);
        let vanilla_filtered: Vec<String> = vanilla_config
            .classpath
            .iter()
            .filter(|p| !p.ends_with(&vanilla_client_jar))
            .cloned()
            .collect();
        classpath.extend(vanilla_filtered);
        let clean_classpath = filter_classpath(classpath);
        let launcher_name = get_launcher_name();

        let neoforge_jvm: Vec<String> = strip_classpath_args(
            manifest
                .arguments
                .jvm_strings()
                .into_iter()
                .map(|arg| {
                    let mut result = arg.replace("${natives_directory}", &natives_dir);
                    result = result.replace("${library_directory}", &libraries_dir);
                    result = result.replace("${classpath_separator}", get_classpath_separator());
                    result = result.replace("${launcher_name}", &launcher_name);
                    result = result.replace("${launcher_version}", "1.0");
                    result
                })
                .collect(),
        );
        let jvm_args = [&vanilla_config.jvm_args[..], &neoforge_jvm[..]].concat();

        let mut game_args = vanilla_config.game_args.clone();
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

        Ok(vanilla_config
            .with_args(jvm_args, game_args)
            .with_loader(clean_classpath, manifest.main_class.clone()))
    }
}
