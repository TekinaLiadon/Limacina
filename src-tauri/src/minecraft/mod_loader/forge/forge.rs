use crate::{
    log_info,
    minecraft::{
        structs::{GameConfig, ModLoader, VersionMod},
        mod_loader::{
            config::merge_classpath,
            download::download_libraries,
            forge::{
                structs::Manifest,
                installer::{create_installer_manifest, start_installer},
                manifest::{
                    get_library, get_manifest_index, modify_manifest, transform_forge_manifest,
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
    },
};
use ::anyhow::{anyhow, Result};
use anyhow::bail;
use async_trait::async_trait;

pub struct Forge;
#[async_trait]
impl ModLoader for Forge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let manifest_forge = get_manifest_index().await?;
        let mut manifest: Vec<VersionMod> = transform_forge_manifest(manifest_forge);

        let version = &state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;
        let forge_manifest = launcher_patch(None)?
            .join("manifest")
            .join(format!("forge_{}.json", &version));
        if forge_manifest.exists() {
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

        if let Some(forge_item) = versions_list.into_iter().find(|m| m.id == target_id) {
            return Ok(forge_item);
        }
        bail!("Версия не найдена")
    }
    async fn latest_version(&self, state: &ProjectConfig) -> Result<String> {
        let manifest_forge = get_manifest_index().await?;
        let versions = manifest_forge
            .get(&state.mc_version)
            .ok_or(anyhow!("Нет версий Forge для MC {}", state.mc_version))?;
        let latest = versions
            .iter()
            .max_by(|a, b| compare_versions(a, b))
            .ok_or(anyhow!("Нет доступных версий Forge"))?;
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
            .ok_or_else(|| anyhow!("Версия не найдена"))?;

        log_info!("Скачивание инсталлера");
        let installer_path = base_url.join(format!("{}.jar", &target_version));
        download_file(&version_info.url, &installer_path).await?;
        create_installer_manifest(&base_url).await?;

        log_info!("Запуск инсталлера");
        let manifest = start_installer(&installer_path, &base_url, &state).await?;
        let library = get_library(manifest)?;

        log_info!("Скачивание библиотек");
        download_libraries(&state.project_name, library).await?; // Вероятно инсталлер сам скачивает

        log_info!("Установка завершена");
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
        let clean_classpath = filter_classpath(classpath);

        let forge_manifest = launcher_patch(None)?.join("manifest").join(format!(
            "forge_{}.json",
            &state
                .loader_version
                .as_deref()
                .ok_or(anyhow!("Лоадер не выбран"))?
        ));
        let manifest = download_json::<Manifest>(None, &forge_manifest).await?;
        let jvm_args = [&vanilla_config.jvm_args[..], &manifest.arguments.jvm[..]].concat();
        let game_args = [&vanilla_config.game_args[..], &manifest.arguments.game[..]].concat();

        let main_class = version.main_class.clone();
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
