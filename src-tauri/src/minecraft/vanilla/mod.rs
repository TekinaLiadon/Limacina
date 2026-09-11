pub mod config;
pub mod download;
pub mod structs;
pub mod manifest;
pub mod rules;

use anyhow::Result;
use async_trait::async_trait;

use crate::minecraft::manifest::get_manifest_index;
use crate::minecraft::mod_loader::manifest::get_manifest_version;
use crate::minecraft::vanilla::config::get_classpath;
use crate::minecraft::vanilla::config::{get_game_args, get_jvm_args, ArgumentsMap};
use crate::minecraft::vanilla::download::{
    collect_asset_index_target, collect_asset_targets, collect_client_jar_target,
    collect_library_targets, collect_natives_to_extract, extract_natives,
};
use crate::minecraft::vanilla::structs::{AssetIndexContent, VanillaVersionsManifest, VersionDetailsManifest};
use crate::minecraft::vanilla::manifest::create_manifest_versions;
use crate::state::dto::ProjectConfig;
use crate::{
    log_info,
    minecraft::structs::{GameConfig, LaunchConfig, MinecraftLoader, Versions},
    step_try,
    utils::{env_info::launcher_patch, integrity::ensure_files, java::find_java, step_events::StepHandle},
};

const LOADER_NAME: &str = "vanilla";

pub struct Vanilla;
#[async_trait]
impl MinecraftLoader for Vanilla {
    async fn versions(&self) -> Result<Vec<Versions>> {
        log_info!("Загрузка индекс манифеста");
        let url = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
        let manifest_index =
            get_manifest_index::<VanillaVersionsManifest>(LOADER_NAME, url, "index").await?;
        let manifest = create_manifest_versions(manifest_index.versions)?;
        Ok(manifest)
    }
    async fn setup(&self, state: &ProjectConfig) -> Result<()> {
        let version = &state.mc_version;
        log_info!("Загрузка версии {:?}", &version);

        let manifest_step = StepHandle::start("mc.manifest", "Загрузка манифеста версий");
        let versions: Vec<Versions> = step_try!(manifest_step, self.versions().await);
        manifest_step.finish(false);

        let version_step = StepHandle::start("mc.version", "Загрузка манифеста версии");
        let manifest: VersionDetailsManifest =
            step_try!(version_step, get_manifest_version(version, versions).await);
        version_step.finish(false);

        let base_path = launcher_patch(Some(&state.project_name))?;
        let project_name = &state.project_name;

        let jar_step = StepHandle::start("mc.jar", "Клиент игры");
        step_try!(jar_step, ensure_files(
            &jar_step,
            &base_path,
            project_name,
            vec![collect_client_jar_target(&manifest)],
        )
        .await);
        jar_step.finish(false);

        let libs_step = StepHandle::start("mc.libs", "Библиотеки игры");
        step_try!(libs_step, ensure_files(
            &libs_step,
            &base_path,
            project_name,
            collect_library_targets(&manifest),
        )
        .await);
        libs_step.finish(false);

        let natives_rel = collect_natives_to_extract(&manifest);
        let natives_step = StepHandle::start("mc.natives", "Нативные библиотеки");
        let natives_dir = base_path.join("natives");
        let natives_empty = match tokio::fs::read_dir(&natives_dir).await {
            Ok(mut entries) => entries.next_entry().await.map(|e| e.is_none()).unwrap_or(true),
            Err(_) => true,
        };
        if natives_empty {
            natives_step.detail("Распаковка");
            step_try!(natives_step, extract_natives(&base_path, natives_rel).await);
            natives_step.finish(false);
        } else {
            natives_step.finish(true);
        }

        let index_step = StepHandle::start("mc.assets.index", "Загрузка индекса ресурсов");
        let index_target = collect_asset_index_target(&manifest);
        step_try!(index_step, ensure_files(
            &index_step,
            &base_path,
            project_name,
            vec![index_target.clone()],
        )
        .await);

        let index_path = base_path.join(&index_target.rel_path);
        let asset_index: AssetIndexContent = match tokio::fs::read_to_string(&index_path).await {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(index) => index,
                Err(e) => {
                    index_step.fail(e.to_string());
                    return Err(anyhow::Error::new(e).context("Не удалось разобрать индекс ресурсов"));
                }
            },
            Err(e) => {
                index_step.fail(e.to_string());
                return Err(anyhow::Error::new(e).context("Не удалось прочитать индекс ресурсов"));
            }
        };
        index_step.finish(false);

        let assets_step = StepHandle::start("mc.assets", "Загрузка ресурсов");
        step_try!(assets_step, ensure_files(
            &assets_step,
            &base_path,
            project_name,
            collect_asset_targets(&asset_index),
        )
        .await);
        assets_step.finish(false);

        Ok(())
    }
    async fn config(&self, state: &ProjectConfig, config: &LaunchConfig) -> Result<GameConfig> {
        log_info!("Получение Vanilla конфига {}...", config.mc_version);
        let versions: Vec<Versions> = self.versions().await?;
        let manifest_version: VersionDetailsManifest =
            get_manifest_version(&config.mc_version, versions).await?;

        log_info!("Формирование classpath");
        let game_dir = launcher_patch(Some(&state.project_name))?;
        let mut classpath = get_classpath(&manifest_version.libraries, config)?;
        let client_jar = game_dir.join(format!("{}.jar", config.mc_version));
        classpath.push(client_jar.to_string_lossy().to_string());

        log_info!("Формирование аргументов");
        let assets_index_id = manifest_version.assets.clone();
        let args_map = ArgumentsMap::new(config, &assets_index_id);
        let jvm_args = get_jvm_args(&manifest_version, config, &args_map);
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
