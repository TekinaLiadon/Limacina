use crate::{
    log_info,
    minecraft::{
        structs::{GameConfig, ModLoader, VersionMod},
        mod_loader::{
            config::merge_classpath,
            download::download_libraries,
            neoforge::{
                structs::Manifest,
                installer::{create_installer_manifest, start_installer},
                manifest::{
                    get_library, get_manifest_index, modify_manifest, transform_neoforge_manifest,
                },
            },
            utils::filter_classpath,
        },
    },
    state::dto::ProjectConfig,
    utils::{
        compare_versions,
        download_file::{download_file, download_json},
        env_info::launcher_patch,
        get_classpath_separator,
    },
};
use ::anyhow::{anyhow, Result};
use anyhow::bail;
use async_trait::async_trait;

pub struct NeoForge;
#[async_trait]
impl ModLoader for NeoForge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let manifest_neoforge = get_manifest_index().await?;
        let mut manifest: Vec<VersionMod> = transform_neoforge_manifest(manifest_neoforge);

        let version = &state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;
        let neoforge_manifest = launcher_patch(None)?
            .join("manifest")
            .join(format!("neoforge_{}.json", &version));
        if neoforge_manifest.exists() {
            modify_manifest(&version, &mut manifest).await?;
        }

        Ok(manifest)
    }
    async fn version_current(&self, state: &ProjectConfig) -> Result<VersionMod> {
        let versions_list = self.versions(&state).await?;
        let version = &state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;
        let target_id = format!("{}-{}", state.mc_version, version);

        if let Some(neoforge_item) = versions_list.into_iter().find(|m| m.id == target_id) {
            return Ok(neoforge_item);
        }
        bail!("Версия не найдена")
    }
    async fn latest_version(&self, state: &ProjectConfig) -> Result<String> {
        let manifest_neoforge = get_manifest_index().await?;
        let versions = manifest_neoforge
            .get(&state.mc_version)
            .ok_or(anyhow!("Нет версий NeoForge для MC {}", state.mc_version))?;
        let latest = versions
            .iter()
            .max_by(|a, b| compare_versions(a, b))
            .ok_or(anyhow!("Нет доступных версий NeoForge"))?;
        Ok(latest.to_string())
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &Vec<VersionMod>) -> Result<()> {
        let base_url = launcher_patch(Some(&state.project_name))?;
        let target_version = format!(
            "{}-{}",
            &state.mc_version,
            state
                .loader_version
                .as_deref()
                .ok_or(anyhow!("Лоадер не выбран"))?
        );
        let version_info = manifest
            .iter()
            .find(|v| v.id == target_version)
            .expect("Версия не найдена");

        log_info!("Скачивание инсталлера NeoForge");
        let installer_path = base_url.join(format!("{}.jar", &target_version));
        download_file(&version_info.url, &installer_path).await?;
        create_installer_manifest(&base_url).await?;

        log_info!("Запуск инсталлера NeoForge");
        let manifest = start_installer(&installer_path, &base_url, &state).await?;
        let library = get_library(manifest)?;

        log_info!("Скачивание библиотек NeoForge");
        download_libraries(&state.project_name, library).await?;

        log_info!("Установка NeoForge завершена");
        Ok(())
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

        let neoforge_manifest = launcher_patch(None)?.join("manifest").join(format!(
            "neoforge_{}.json",
            target_version
        ));
        let manifest = download_json::<Manifest>(None, &neoforge_manifest).await?;

        let base_path = launcher_patch(Some(&state.project_name))?;
        let natives_dir = base_path.join("natives").to_string_lossy().to_string();
        let libraries_dir = base_path.join("libraries").to_string_lossy().to_string();

        let mut neoforge_libraries = get_library(manifest.clone())?;
        neoforge_libraries.extend(version.library.clone());
        let mut classpath = merge_classpath(
            &state.project_name,
            &target_version,
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

        let neoforge_jvm: Vec<String> = manifest.arguments.jvm_strings()
            .iter()
            .map(|arg| {
                let mut result = arg.replace("${natives_directory}", &natives_dir);
                result = result.replace("${library_directory}", &libraries_dir);
                result = result.replace("${classpath_separator}", get_classpath_separator());
                result = result.replace("${launcher_name}", "Limacina");
                result = result.replace("${launcher_version}", "1.0");
                result
            })
            .collect();
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
        let game_dir = launcher_patch(Some(&state.project_name))?;
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
