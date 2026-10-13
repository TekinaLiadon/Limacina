pub mod config;
pub mod download;
pub mod manifest;
pub mod pipeline;
pub mod rules;
pub mod structs;

use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;

use crate::minecraft::manifest::get_manifest_version;
use crate::minecraft::vanilla::config::get_classpath;
use crate::minecraft::vanilla::config::{get_game_args, get_jvm_args, ArgumentsMap};
use crate::minecraft::vanilla::download::{
    extract_natives, natives_match_version, preflight_asset_disk_space, read_asset_index,
    VanillaPhaseInfo, PHASE_ASSET_INDEX, PHASE_NATIVES,
};
use crate::minecraft::vanilla::manifest::load_vanilla_index;
use crate::minecraft::vanilla::pipeline::{run_vanilla_phases, VanillaPhaseExecutor};
use crate::minecraft::vanilla::structs::{AssetIndexContent, VersionDetailsManifest};
use crate::state::dto::ProjectConfig;
use crate::{
    log_info,
    minecraft::structs::{GameConfig, LaunchConfig, MinecraftLoader, Versions},
    step_try,
    utils::{
        blocking,
        env_info::launcher_path,
        errors::LauncherError,
        integrity::{ensure_files, settle_install_step, IntegrityTarget},
        java::find_java,
        step_events::StepHandle,
    },
};

pub struct Vanilla;

struct InstallPhases {
    base_path: PathBuf,
    project_name: String,
}

#[async_trait]
impl VanillaPhaseExecutor for InstallPhases {
    async fn fetch(
        &mut self,
        phase: &'static VanillaPhaseInfo,
        targets: Vec<IntegrityTarget>,
    ) -> Result<()> {
        let step = StepHandle::start(phase.id, phase.label);
        let report = step_try!(
            step,
            ensure_files(&step, &self.base_path, &self.project_name, targets).await
        );
        settle_install_step(step, &report)
    }

    async fn natives(
        &mut self,
        mc_version: &str,
        natives_rel: Vec<(PathBuf, Option<Vec<String>>)>,
    ) -> Result<()> {
        let step = StepHandle::start(PHASE_NATIVES.id, PHASE_NATIVES.label);
        let natives_dir = self.base_path.join("natives");
        if natives_match_version(&natives_dir, mc_version).await {
            step.finish(true);
            return Ok(());
        }
        step.detail("Распаковка");
        step_try!(
            step,
            extract_natives(&self.base_path, natives_rel, mc_version).await
        );
        step.finish(false);
        Ok(())
    }

    async fn asset_index(&mut self, target: IntegrityTarget) -> Result<AssetIndexContent> {
        let step = StepHandle::start(PHASE_ASSET_INDEX.id, PHASE_ASSET_INDEX.label);
        let index_rel = target.rel_path.clone();
        let report = step_try!(
            step,
            ensure_files(&step, &self.base_path, &self.project_name, vec![target]).await
        );
        if !report.failed.is_empty() {
            let error = match settle_install_step(step, &report) {
                Err(e) => e,
                Ok(()) => anyhow::Error::msg("Не удалось скачать индекс ассетов"),
            };
            return Err(error);
        }
        let index_path = self.base_path.join(&index_rel);
        let asset_index = step_try!(step, read_asset_index(&index_path).await);
        step_try!(
            step,
            preflight_asset_disk_space(&self.base_path, &asset_index).await
        );
        settle_install_step(step, &report)?;
        Ok(asset_index)
    }
}

#[async_trait]
impl MinecraftLoader for Vanilla {
    async fn versions(&self) -> Result<Vec<Versions>> {
        log_info!("Загрузка индекс манифеста");
        let versions = load_vanilla_index().await.map_err(|e| {
            LauncherError::ManifestParse(format!(
                "Не удалось загрузить индекс манифеста версий: {e:#}"
            ))
        })?;
        Ok(versions)
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

        let base_path = launcher_path(Some(&state.project_name)).map_err(|e| {
            LauncherError::GameDownload(format!(
                "Не удалось определить путь к файлам проекта: {e:#}"
            ))
        })?;
        let mut phases = InstallPhases {
            base_path,
            project_name: state.project_name.clone(),
        };
        run_vanilla_phases(&mut phases, &manifest).await?;
        Ok(())
    }
    async fn config(&self, state: &ProjectConfig, config: &LaunchConfig) -> Result<GameConfig> {
        log_info!("Получение Vanilla конфига {}...", config.mc_version);
        let versions: Vec<Versions> = self.versions().await.map_err(|e| {
            LauncherError::ManifestParse(format!(
                "Не удалось получить список версий Vanilla: {e:#}"
            ))
        })?;
        let version_type = versions
            .iter()
            .find(|v| v.id == config.mc_version)
            .map(|v| v.version_type.clone())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "release".to_string());
        let manifest_version: VersionDetailsManifest =
            get_manifest_version(&config.mc_version, versions)
                .await
                .map_err(|e| {
                    LauncherError::ManifestParse(format!(
                        "Не удалось получить манифест версии: {e:#}"
                    ))
                })?;

        log_info!("Формирование classpath");
        let game_dir = launcher_path(Some(&state.project_name)).map_err(|e| {
            LauncherError::GameDownload(format!(
                "Не удалось определить путь к файлам проекта: {e:#}"
            ))
        })?;
        let mut classpath = get_classpath(&manifest_version.libraries, config).await?;
        let client_jar = game_dir.join(format!("{}.jar", config.mc_version));
        classpath.push(client_jar.to_string_lossy().to_string());

        log_info!("Формирование аргументов");
        let assets_index_id = manifest_version.assets.clone();
        let args_map = ArgumentsMap::new(config, &assets_index_id, &version_type);
        let jvm_args = get_jvm_args(&manifest_version, config, &args_map);
        let game_args = get_game_args(&manifest_version, &args_map);

        log_info!("Поиск java");
        let java_config = state.java_path.clone();
        let java_path = LauncherError::classify(
            blocking("Поиск Java в системе", move || {
                find_java(java_config)
            })
            .await?,
            LauncherError::Java,
        )?;

        Ok(GameConfig::new(
            java_path,
            jvm_args,
            game_args,
            classpath,
            manifest_version.main_class,
            game_dir,
        ))
    }
}

#[cfg(test)]
mod install_phases_tests {
    use super::InstallPhases;
    use crate::minecraft::vanilla::download::{PHASE_ASSET_INDEX, PHASE_CLIENT};
    use crate::minecraft::vanilla::pipeline::VanillaPhaseExecutor;
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use crate::utils::integrity::{HashKind, IntegrityTarget, TargetDownload};
    use crate::utils::step_events::test_capture;
    use crate::utils::step_events::StepEvent;
    use mockito::Server;
    use std::path::PathBuf;

    fn url_target(rel: &str, hash: &str, url: String) -> IntegrityTarget {
        IntegrityTarget {
            rel_path: PathBuf::from(rel),
            hash: hash.to_string(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(url),
        }
    }

    fn event_id(event: &StepEvent) -> &str {
        match event {
            StepEvent::Started { id, .. }
            | StepEvent::Progress { id, .. }
            | StepEvent::Detail { id, .. }
            | StepEvent::Finished { id, .. }
            | StepEvent::Failed { id, .. } => id,
        }
    }

    fn terminals(id: &str) -> Vec<StepEvent> {
        test_capture::captured()
            .into_iter()
            .filter(|(_, event)| event_id(event) == id)
            .filter(|(_, event)| {
                matches!(event, StepEvent::Finished { .. } | StepEvent::Failed { .. })
            })
            .map(|(_, event)| event)
            .collect()
    }

    #[tokio::test]
    async fn fetch_intact_files_finish_step_once_as_skipped() {
        let dir = LauncherDirGuard::acquire("vanilla_fetch_intact").await;
        let _capture = test_capture::CaptureGuard::new();
        let base = dir.project_dir("Cordelia");
        std::fs::create_dir_all(base.join("libraries")).expect("создание директории");
        std::fs::write(base.join("libraries/a.jar"), b"content").expect("целый файл");

        let mut phases = InstallPhases {
            base_path: base,
            project_name: "Cordelia".to_string(),
        };

        phases
            .fetch(
                &PHASE_CLIENT,
                vec![url_target(
                    "libraries/a.jar",
                    &sha1_hex(b"content"),
                    "http://127.0.0.1:1/a".to_string(),
                )],
            )
            .await
            .expect("фаза с целыми файлами");

        let step_terminals = terminals(PHASE_CLIENT.id);
        assert_eq!(
            step_terminals.len(),
            1,
            "ровно одно терминальное событие на шаг: {step_terminals:?}"
        );
        assert!(
            matches!(
                step_terminals.first(),
                Some(StepEvent::Finished { skipped: true, .. })
            ),
            "шаг без скачиваний должен финишировать как пропущенный: {step_terminals:?}"
        );
    }

    #[tokio::test]
    async fn fetch_failed_download_fails_step_once() {
        let dir = LauncherDirGuard::acquire("vanilla_fetch_failed").await;
        let _capture = test_capture::CaptureGuard::new();
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/libs/a.jar")
            .with_status(404)
            .create_async()
            .await;
        let base = dir.project_dir("Cordelia");

        let mut phases = InstallPhases {
            base_path: base,
            project_name: "Cordelia".to_string(),
        };

        let error = phases
            .fetch(
                &PHASE_CLIENT,
                vec![url_target(
                    "libraries/a.jar",
                    &sha1_hex(b"good jar"),
                    format!("{}/libs/a.jar", server.url()),
                )],
            )
            .await
            .expect_err("неудачное скачивание должно прерывать фазу");

        assert!(
            error.to_string().contains("Не удалось скачать файлов"),
            "неожиданная ошибка: {error}"
        );
        let step_terminals = terminals(PHASE_CLIENT.id);
        assert_eq!(
            step_terminals.len(),
            1,
            "ровно одно терминальное событие: {step_terminals:?}"
        );
        assert!(
            matches!(step_terminals.first(), Some(StepEvent::Failed { .. })),
            "шаг должен фейлиться, а не финишировать: {step_terminals:?}"
        );
    }

    fn phases(base: PathBuf) -> InstallPhases {
        InstallPhases {
            base_path: base,
            project_name: "Cordelia".to_string(),
        }
    }

    #[tokio::test]
    async fn asset_index_intact_finishes_step_once_as_skipped() {
        let dir = LauncherDirGuard::acquire("vanilla_index_intact").await;
        let _capture = test_capture::CaptureGuard::new();
        let base = dir.project_dir("Cordelia");
        let index_json = r#"{"objects": {}}"#;
        let rel = PathBuf::from("assets/indexes/5.json");
        std::fs::create_dir_all(base.join(&rel).parent().unwrap()).expect("директория индекса");
        std::fs::write(base.join(&rel), index_json).expect("целый индекс");

        phases(base)
            .asset_index(url_target(
                rel.to_string_lossy().as_ref(),
                &sha1_hex(index_json.as_bytes()),
                "http://127.0.0.1:1/index".to_string(),
            ))
            .await
            .expect("фаза индекса ассетов по целому файлу");

        let step_terminals = terminals(PHASE_ASSET_INDEX.id);
        assert_eq!(
            step_terminals.len(),
            1,
            "ровно одно терминальное событие на шаг: {step_terminals:?}"
        );
        assert!(
            matches!(
                step_terminals.first(),
                Some(StepEvent::Finished { skipped: true, .. })
            ),
            "целый индекс должен финишировать как пропущенный: {step_terminals:?}"
        );
    }

    #[tokio::test]
    async fn asset_index_failed_download_fails_step_once() {
        let dir = LauncherDirGuard::acquire("vanilla_index_failed").await;
        let _capture = test_capture::CaptureGuard::new();
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/index.json")
            .with_status(404)
            .create_async()
            .await;

        let error = phases(dir.project_dir("Cordelia"))
            .asset_index(url_target(
                "assets/indexes/5.json",
                &sha1_hex(b"index"),
                format!("{}/index.json", server.url()),
            ))
            .await
            .expect_err("неудачное скачивание индекса должно прерывать фазу");

        assert!(
            error.to_string().contains("Не удалось скачать файлов"),
            "неожиданная ошибка: {error}"
        );
        let step_terminals = terminals(PHASE_ASSET_INDEX.id);
        assert_eq!(
            step_terminals.len(),
            1,
            "ровно одно терминальное событие: {step_terminals:?}"
        );
        assert!(
            matches!(step_terminals.first(), Some(StepEvent::Failed { .. })),
            "шаг должен фейлиться: {step_terminals:?}"
        );
    }

    #[tokio::test]
    async fn asset_index_unparseable_file_fails_step_once() {
        let dir = LauncherDirGuard::acquire("vanilla_index_corrupt").await;
        let _capture = test_capture::CaptureGuard::new();
        let base = dir.project_dir("Cordelia");
        let broken_json = b"not json at all";
        let rel = PathBuf::from("assets/indexes/5.json");
        std::fs::create_dir_all(base.join(&rel).parent().unwrap()).expect("директория индекса");
        std::fs::write(base.join(&rel), broken_json).expect("непарсящийся индекс");

        let error = phases(base)
            .asset_index(url_target(
                rel.to_string_lossy().as_ref(),
                &sha1_hex(broken_json),
                "http://127.0.0.1:1/index".to_string(),
            ))
            .await
            .expect_err("битый индекс должен прерывать фазу после проверки хеша");

        assert!(
            error
                .to_string()
                .contains("Не удалось разобрать индекс ресурсов"),
            "неожиданная ошибка: {error}"
        );
        let step_terminals = terminals(PHASE_ASSET_INDEX.id);
        assert_eq!(
            step_terminals.len(),
            1,
            "после успешного скачивания сбой чтения должен давать единственный Failed: {step_terminals:?}"
        );
        assert!(
            matches!(step_terminals.first(), Some(StepEvent::Failed { .. })),
            "шаг должен фейлиться, а не финишировать: {step_terminals:?}"
        );
    }
}
