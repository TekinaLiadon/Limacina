pub mod manifest;
pub mod structs;

use anyhow::Result;
use async_trait::async_trait;

use crate::utils::errors::LauncherError;
use crate::{
    log_info,
    minecraft::{
        manifest::get_manifest_index,
        mod_loader::{
            config::merge_classpath,
            fabric::{manifest::transform_fabric_manifest, structs::FabricManifest},
            installer::install_loader_files,
            manifest::loader_version_or_err,
        },
        structs::{GameConfig, ModLoader, VersionMod},
    },
    state::dto::ProjectConfig,
    utils::{compare_versions, env_info::launcher_path, step_events::StepHandle},
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
                .await
                .map_err(|e| {
                    LauncherError::LoaderSetup(format!(
                        "Не удалось загрузить манифест Fabric: {e:#}"
                    ))
                })?;
        let manifest: Vec<VersionMod> =
            transform_fabric_manifest(manifest_fabric).map_err(|e| {
                LauncherError::LoaderSetup(format!(
                    "Не удалось преобразовать манифест Fabric: {e:#}"
                ))
            })?;
        Ok(manifest)
    }
    async fn version_current(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<VersionMod> {
        let version = loader_version_or_err(state)?;

        versions
            .iter()
            .find(|m| m.id == version)
            .cloned()
            .ok_or_else(|| LauncherError::LoaderSetup("Версия не найдена".to_string()).into())
    }
    async fn latest_version(
        &self,
        _state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String> {
        versions
            .iter()
            .map(|v| v.id.clone())
            .max_by(|a, b| compare_versions(a, b))
            .ok_or_else(|| {
                LauncherError::LoaderSetup("Нет доступных версий Fabric".to_string()).into()
            })
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        let target_version = loader_version_or_err(state)?;
        let version_info = manifest
            .iter()
            .find(|v| v.id == target_version)
            .ok_or_else(|| LauncherError::LoaderSetup("Версия не найдена".to_string()))?;

        let step = StepHandle::start("loader", "Установка Fabric");
        let base_path = launcher_path(Some(&state.project_name)).map_err(|e| {
            LauncherError::LoaderSetup(format!(
                "Не удалось определить путь к файлам проекта: {e:#}"
            ))
        })?;
        install_loader_files(
            step.clone(),
            &base_path,
            &state.project_name,
            &version_info.id,
            &version_info.library,
            &version_info.url,
        )
        .await?;
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
        let classpath = merge_classpath(
            &state.project_name,
            &version.id,
            &version.library,
            &vanilla_config.classpath,
        )
        .await?;

        Ok(vanilla_config.with_loader(classpath, version.main_class.clone()))
    }
}

#[cfg(test)]
mod config_tests {
    use super::Fabric;
    use crate::minecraft::process::validate_jvm_args;
    use crate::minecraft::structs::{GameConfig, ModLoader, VersionMod};
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;
    use std::path::PathBuf;

    #[tokio::test]
    async fn fabric_config_keeps_user_jvm_args_on_validated_spawn_path() {
        let dir = LauncherDirGuard::acquire("fabric_args_guard").await;
        let game_root = dir.project_dir("FabGuard");
        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xmx4G".to_string(), "-javaagent:evil.jar".to_string()],
            vec![],
            vec![],
            "net.minecraft.client.main.Main".to_string(),
            game_root,
        );
        let version = VersionMod {
            url: String::new(),
            id: "1.20.1-fabric0.16.9".to_string(),
            main_class: "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string(),
            library: Vec::new(),
        };
        let state = ProjectConfig {
            project_name: "FabGuard".to_string(),
            mc_version: "1.20.1".to_string(),
            ..ProjectConfig::default()
        };

        let config = Fabric
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг Fabric");

        assert!(
            config.jvm_args.contains(&"-javaagent:evil.jar".to_string()),
            "пользовательский аргумент должен пройти через конфиг лоадера: {:?}",
            config.jvm_args
        );
        let error = validate_jvm_args(&config.jvm_args)
            .expect_err("пользовательский debug-аргумент должен быть отклонён");
        assert!(
            error.to_string().contains("-javaagent:evil.jar"),
            "ошибка должна называть аргумент: {error}"
        );
    }
}
