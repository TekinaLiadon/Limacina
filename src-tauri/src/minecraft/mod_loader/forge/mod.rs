pub mod installer;
pub mod manifest;
pub mod structs;

use crate::{
    log_info,
    minecraft::{
        structs::{GameConfig, ModLoader, VersionMod},
        mod_loader::{
            config::merge_classpath,
            download::library_targets,
            forge::{
                structs::Manifest,
                installer::{create_installer_manifest, start_installer},
                manifest::{
                    get_library, get_manifest_index, modify_manifest, transform_forge_manifest,
                },
            },
            utils::{filter_classpath, strip_classpath_args},
        },
    },
    state::dto::ProjectConfig,
    step_try,
    utils::{
        compare_versions,
        download_file::{download_file, download_json},
        env_info::launcher_patch,
        integrity::{ensure_files, record_installed_hash, HashKind, IntegrityTarget, TargetDownload},
        step_events::StepHandle,
    },
};
use anyhow::{anyhow, Result};
use anyhow::bail;
use async_trait::async_trait;
use std::path::PathBuf;

pub struct Forge;
#[async_trait]
impl ModLoader for Forge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let manifest_forge = get_manifest_index().await?;
        let mut manifest: Vec<VersionMod> = transform_forge_manifest(manifest_forge);

        if let Some(version) = state.loader_version.as_deref() {
            let forge_manifest = launcher_patch(None)?
                .join("manifest")
                .join(format!("forge_{}.json", &version));
            if forge_manifest.exists() {
                modify_manifest(version, &mut manifest).await?;
            }
        }

        Ok(manifest)
    }
    async fn version_current(&self, state: &ProjectConfig) -> Result<VersionMod> {
        let versions_list = self.versions(state).await?;
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
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
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

        let step = StepHandle::start("loader", "Установка Forge");
        let project_name = &state.project_name;

        let forge_manifest_path = launcher_patch(None)?
            .join("manifest")
            .join(format!("forge_{}.json", state.loader_version.as_deref().unwrap_or_default()));

        if forge_manifest_path.exists() {
            let version_manifest = download_json::<Manifest>(None, &forge_manifest_path).await?;
            let library = get_library(version_manifest)?;
            let mut targets = library_targets(&library)?;
            targets.push(IntegrityTarget {
                rel_path: PathBuf::from(format!("{}.jar", &target_version)),
                hash: String::new(),
                hash_kind: HashKind::Sha1,
                download: TargetDownload::Url(version_info.url.clone()),
            });
            step_try!(step, ensure_files(&step, &base_url, project_name, targets).await);
            step_try!(step, record_installed_hash(
                project_name,
                HashKind::Sha1,
                &base_url,
                &PathBuf::from(format!("{}.jar", &target_version)),
            )
            .await);
            log_info!("Forge уже установлен, проверка файлов завершена");
            step.finish(true);
            return Ok(());
        }

        step.detail("Скачивание инсталлера");
        step.set_total(1);
        let installer_path = base_url.join(format!("{}.jar", &target_version));
        step_try!(step, download_file(&version_info.url, &installer_path).await);
        step.inc();

        step_try!(step, create_installer_manifest(&base_url).await);

        step.detail("Запуск инсталлера");
        log_info!("Запуск инсталлера");
        let manifest = step_try!(step, start_installer(&installer_path, &base_url, state).await);
        let library = step_try!(step, get_library(manifest));

        step.detail("Скачивание библиотек");
        log_info!("Скачивание библиотек");
        let mut targets = library_targets(&library)?;
        targets.push(IntegrityTarget {
            rel_path: PathBuf::from(format!("{}.jar", &target_version)),
            hash: String::new(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(version_info.url.clone()),
        });
        step_try!(step, ensure_files(&step, &base_url, project_name, targets).await);
        step_try!(step, record_installed_hash(
            project_name,
            HashKind::Sha1,
            &base_url,
            &PathBuf::from(format!("{}.jar", &target_version)),
        )
        .await);

        log_info!("Установка завершена");
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
        let clean_classpath = filter_classpath(classpath);

        let forge_manifest = launcher_patch(None)?.join("manifest").join(format!(
            "forge_{}.json",
            &state
                .loader_version
                .as_deref()
                .ok_or(anyhow!("Лоадер не выбран"))?
        ));
        let manifest = download_json::<Manifest>(None, &forge_manifest).await?;
        let jvm_args = [
            &vanilla_config.jvm_args[..],
            &strip_classpath_args(manifest.arguments.jvm.clone())[..],
        ]
        .concat();
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
