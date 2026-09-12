pub mod structs;
pub mod manifest;

use anyhow::Result;
use anyhow::{anyhow, bail};
use async_trait::async_trait;
use std::path::PathBuf;

use crate::{
    log_info,
    minecraft::{
        structs::{GameConfig, ModLoader, VersionMod},
        manifest::get_manifest_index,
        mod_loader::{
            config::merge_classpath,
            download::library_targets,
            fabric::{structs::FabricManifest, manifest::transform_fabric_manifest},
        },
    },
    state::dto::ProjectConfig,
    step_try,
    utils::{
        env_info::launcher_path,
        integrity::{ensure_files, record_installed_hash, HashKind, IntegrityTarget, TargetDownload},
        step_events::StepHandle,
    },
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
                .await?;
        let manifest: Vec<VersionMod> = transform_fabric_manifest(manifest_fabric)?;
        Ok(manifest)
    }
    async fn version_current(&self, state: &ProjectConfig) -> Result<VersionMod> {
        let versions_list = self.versions(state).await?;
        let version = state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;

        if let Some(fabric_item) = versions_list.into_iter().find(|m| m.id == version) {
            return Ok(fabric_item);
        }
        bail!("Версия не найдена")
    }
    async fn latest_version(&self, state: &ProjectConfig) -> Result<String> {
        let versions_list = self.versions(state).await?;
        versions_list
            .into_iter()
            .next()
            .map(|v| v.id)
            .ok_or_else(|| anyhow!("Нет доступных версий Fabric"))
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        let target_version = state
            .loader_version
            .as_deref()
            .ok_or(anyhow!("Лоадер не выбран"))?;
        let version_info = manifest
            .iter()
            .find(|v| v.id == target_version)
            .ok_or_else(|| anyhow!("Версия не найдена"))?;

        let step = StepHandle::start("loader", "Установка Fabric");
        let base_path = launcher_path(Some(&state.project_name))?;
        let project_name = &state.project_name;

        let mut targets = library_targets(&version_info.library)?;
        targets.push(IntegrityTarget {
            rel_path: PathBuf::from(format!("{}.jar", version_info.id)),
            hash: String::new(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(version_info.url.clone()),
        });

        step_try!(step, ensure_files(&step, &base_path, project_name, targets).await);

        step_try!(step, record_installed_hash(
            project_name,
            &base_path,
            &PathBuf::from(format!("{}.jar", version_info.id)),
        )
        .await);

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

        let main_class = version.main_class.clone();
        let game_dir = launcher_path(Some(&state.project_name))?;
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
