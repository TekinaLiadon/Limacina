use anyhow::Result;
use async_trait::async_trait;
use futures::future::BoxFuture;
use std::path::{Path, PathBuf};

use crate::{
    log_err, log_info,
    minecraft::{
        manifest::get_manifest_version,
        vanilla::{
            download::{
                extract_natives, natives_match_version, preflight_asset_disk_space,
                read_asset_index, VanillaPhaseInfo, PHASE_ASSET_INDEX, PHASE_NATIVES,
            },
            manifest::load_vanilla_index,
            pipeline::{run_vanilla_phases, VanillaPhaseExecutor},
            structs::{AssetIndexContent, VersionDetailsManifest},
        },
    },
    state::dto::ProjectConfig,
    step_try,
    utils::{
        download_file::download_file,
        env_info::launcher_path,
        errors::LauncherError,
        integrity::{check_integrity, IntegrityReport, IntegrityTarget},
        step_events::{StepChannel, StepHandle},
    },
};

pub async fn load_version_manifest(project: &ProjectConfig) -> Result<VersionDetailsManifest> {
    let versions = load_vanilla_index().await.map_err(|e| {
        LauncherError::GameDownload(format!(
            "Не удалось загрузить индекс манифеста версий: {e:#}"
        ))
    })?;

    let manifest = get_manifest_version(&project.mc_version, versions)
        .await
        .map_err(|e| {
            LauncherError::GameDownload(format!("Не удалось получить манифест версии: {e:#}"))
        })?;
    Ok(manifest)
}

fn url_download_fn(
) -> impl Fn(String, std::path::PathBuf) -> BoxFuture<'static, Result<(), anyhow::Error>>
       + Send
       + Sync
       + 'static {
    |url: String, dest: std::path::PathBuf| {
        Box::pin(async move {
            if dest.exists() {
                return Ok(());
            }
            download_file(&url, &dest).await
        })
    }
}

struct IntegrityPhases {
    base_path: PathBuf,
    report: IntegrityReport,
}

#[async_trait]
impl VanillaPhaseExecutor for IntegrityPhases {
    async fn fetch(
        &mut self,
        phase: &'static VanillaPhaseInfo,
        targets: Vec<IntegrityTarget>,
    ) -> Result<()> {
        let report = check_integrity(
            &self.base_path,
            targets,
            phase.id,
            phase.label,
            url_download_fn(),
        )
        .await
        .map_err(|e| {
            LauncherError::GameDownload(format!(
                "Не удалось проверить {}: {e:#}",
                phase.integrity_noun
            ))
        })?;
        self.report.merge(report);
        Ok(())
    }

    async fn natives(
        &mut self,
        mc_version: &str,
        natives_rel: Vec<(PathBuf, Option<Vec<String>>)>,
    ) -> Result<()> {
        let report = check_natives_integrity(&self.base_path, natives_rel, mc_version).await?;
        self.report.merge(report);
        Ok(())
    }

    async fn asset_index(&mut self, target: IntegrityTarget) -> Result<AssetIndexContent> {
        let index_path = self.base_path.join(&target.rel_path);
        let report = check_integrity(
            &self.base_path,
            vec![target],
            PHASE_ASSET_INDEX.id,
            PHASE_ASSET_INDEX.label,
            url_download_fn(),
        )
        .await
        .map_err(|e| {
            LauncherError::GameDownload(format!(
                "Не удалось проверить {}: {e:#}",
                PHASE_ASSET_INDEX.integrity_noun
            ))
        })?;
        let failed_downloads = report.failed.clone();
        self.report.merge(report);
        if !failed_downloads.is_empty() {
            return Err(LauncherError::GameDownload(format!(
                "Не удалось восстановить индекс ассетов: {}",
                failed_downloads.join(", ")
            ))
            .into());
        }

        let asset_index = read_asset_index(&index_path).await.map_err(|e| {
            LauncherError::GameDownload(format!("Не удалось прочитать индекс ассетов: {e:#}"))
        })?;
        preflight_asset_disk_space(&self.base_path, &asset_index).await?;
        Ok(asset_index)
    }
}

pub async fn check_minecraft_integrity(project: &ProjectConfig) -> Result<IntegrityReport> {
    let project_name = project.project_name.clone();

    let manifest_step = StepHandle::start_channel(
        StepChannel::Integrity,
        "mc.manifest",
        "Загрузка манифеста версии",
    );
    let manifest = step_try!(manifest_step, load_version_manifest(project).await);
    manifest_step.finish(false);

    let base_path = launcher_path(Some(&project_name)).map_err(|e| {
        LauncherError::GameDownload(format!(
            "Не удалось определить путь к файлам проекта: {e:#}"
        ))
    })?;

    let mut phases = IntegrityPhases {
        base_path,
        report: IntegrityReport::default(),
    };
    let phases_result = run_vanilla_phases(&mut phases, &manifest).await;
    let report = phases.report;
    log_info!(
        "[integrity] Minecraft {}: проверено {}, повреждено {}, восстановлено {}, ошибок {}",
        project_name,
        report.total,
        report.broken,
        report.repaired,
        report.failed.len()
    );

    if let Err(e) = phases_result {
        if report.failed.is_empty() {
            return Err(e);
        }
        log_err!("[integrity] Конвейер проверки прерван, возвращён частичный отчёт: {e:#}");
    }
    Ok(report)
}

async fn check_natives_integrity(
    base_path: &Path,
    natives_rel: Vec<(PathBuf, Option<Vec<String>>)>,
    mc_version: &str,
) -> Result<IntegrityReport> {
    let step = StepHandle::start_channel(
        StepChannel::Integrity,
        PHASE_NATIVES.id,
        PHASE_NATIVES.label,
    );
    step.set_total(1);
    let natives_dir = base_path.join("natives");
    if natives_match_version(&natives_dir, mc_version).await {
        step.finish(true);
        return Ok(IntegrityReport {
            total: 1,
            ..IntegrityReport::default()
        });
    }

    step.detail("Распаковка");
    match extract_natives(base_path, natives_rel, mc_version).await {
        Ok(()) => {
            step.finish(false);
            Ok(IntegrityReport {
                total: 1,
                ..IntegrityReport::default()
            })
        }
        Err(e) => {
            log_err!("[integrity] Не удалось распаковать нативные библиотеки: {e:?}");
            step.fail("Не удалось распаковать нативные библиотеки");
            Ok(IntegrityReport {
                total: 1,
                broken: 1,
                failed: vec!["natives".to_string()],
                ..IntegrityReport::default()
            })
        }
    }
}

#[cfg(test)]
mod step_event_tests {
    use super::{check_minecraft_integrity, IntegrityPhases};
    use crate::minecraft::vanilla::download::PHASE_ASSET_INDEX;
    use crate::minecraft::vanilla::pipeline::VanillaPhaseExecutor;
    use crate::state::dto::ProjectConfig;
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use crate::utils::integrity::{HashKind, IntegrityTarget, TargetDownload};
    use crate::utils::step_events::test_capture;
    use crate::utils::step_events::{StepChannel, StepEvent};
    use mockito::Server;
    use std::path::PathBuf;

    fn event_id(event: &StepEvent) -> &str {
        match event {
            StepEvent::Started { id, .. }
            | StepEvent::Progress { id, .. }
            | StepEvent::Detail { id, .. }
            | StepEvent::Finished { id, .. }
            | StepEvent::Failed { id, .. } => id,
        }
    }

    fn integrity_terminals(id: &str) -> Vec<StepEvent> {
        test_capture::captured()
            .into_iter()
            .filter(|(channel, event)| {
                matches!(channel, StepChannel::Integrity) && event_id(event) == id
            })
            .filter(|(_, event)| {
                matches!(event, StepEvent::Finished { .. } | StepEvent::Failed { .. })
            })
            .map(|(_, event)| event)
            .collect()
    }

    fn url_target(rel: &str, hash: &str, url: String) -> IntegrityTarget {
        IntegrityTarget {
            rel_path: PathBuf::from(rel),
            hash: hash.to_string(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(url),
        }
    }

    fn seed_vanilla_index_cache(dir: &LauncherDirGuard) {
        let manifest_dir = dir.root().join("manifest");
        std::fs::create_dir_all(&manifest_dir).expect("каталог манифестов");
        std::fs::write(
            manifest_dir.join("vanilla_index.json"),
            r#"{"latest": {"release": "1.20.1", "snapshot": "1.20.1"}, "versions": [{"id": "1.20.1", "url": "http://127.0.0.1:1/1.20.1.json", "type": "release"}]}"#,
        )
        .expect("кэш индекса версий");
    }

    #[tokio::test]
    async fn manifest_load_failure_fails_manifest_step() {
        let dir = LauncherDirGuard::acquire("integrity_manifest_fail").await;
        let _capture = test_capture::CaptureGuard::new();
        seed_vanilla_index_cache(&dir);

        let project = ProjectConfig {
            project_name: "Cordelia".to_string(),
            mc_version: "9.9.9".to_string(),
            ..ProjectConfig::default()
        };
        let error = check_minecraft_integrity(&project)
            .await
            .expect_err("неизвестная версия должна прерывать проверку");

        assert!(
            error.to_string().contains("Версия не найдена"),
            "неожиданная ошибка: {error}"
        );
        let step_terminals = integrity_terminals("mc.manifest");
        assert_eq!(
            step_terminals.len(),
            1,
            "шаг манифеста не должен оставаться активным после ошибки: {step_terminals:?}"
        );
        assert!(
            matches!(step_terminals.first(), Some(StepEvent::Failed { .. })),
            "ошибка загрузки манифеста должна фейлить шаг: {step_terminals:?}"
        );
    }

    #[tokio::test]
    async fn asset_index_download_failure_surfaces_original_error_and_keeps_report() {
        let dir = LauncherDirGuard::acquire("integrity_index_fail").await;
        let _capture = test_capture::CaptureGuard::new();
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/index.json")
            .with_status(404)
            .create_async()
            .await;

        let mut phases = IntegrityPhases {
            base_path: dir.project_dir("Cordelia"),
            report: Default::default(),
        };
        let error = phases
            .asset_index(url_target(
                "assets/indexes/5.json",
                &sha1_hex(b"index"),
                format!("{}/index.json", server.url()),
            ))
            .await
            .expect_err("неудачное скачивание индекса должно прерывать фазу");

        assert!(
            error
                .to_string()
                .contains("Не удалось восстановить индекс ассетов"),
            "ошибка должна называть сбой скачивания, а не чтения: {error}"
        );
        assert_eq!(
            phases.report.failed,
            vec!["assets/indexes/5.json".to_string()],
            "накопленный отчёт не должен теряться при сбое фазы"
        );
        let step_terminals = integrity_terminals(PHASE_ASSET_INDEX.id);
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
    async fn check_integrity_returns_partial_report_when_asset_index_download_fails() {
        let dir = LauncherDirGuard::acquire("integrity_partial_report").await;
        let _capture = test_capture::CaptureGuard::new();
        seed_vanilla_index_cache(&dir);
        let mut server = Server::new_async().await;

        let client_jar = b"client jar bytes".to_vec();
        server
            .mock("GET", "/client.jar")
            .with_status(200)
            .with_body(client_jar.clone())
            .create_async()
            .await;
        server
            .mock("GET", "/index.json")
            .with_status(404)
            .create_async()
            .await;

        std::fs::write(
            dir.root().join("manifest").join("1.20.1.json"),
            serde_json::json!({
                "id": "1.20.1",
                "downloads": {
                    "client": {
                        "sha1": sha1_hex(&client_jar),
                        "size": 1,
                        "url": format!("{}/client.jar", server.url())
                    }
                },
                "libraries": [],
                "assetIndex": {
                    "id": "5",
                    "sha1": sha1_hex(b"index"),
                    "size": 1,
                    "url": format!("{}/index.json", server.url()),
                    "totalSize": 1
                },
                "assets": "5",
                "mainClass": "net.minecraft.client.main.Main"
            })
            .to_string(),
        )
        .expect("кэш манифеста версии");

        let project = ProjectConfig {
            project_name: "Cordelia".to_string(),
            mc_version: "1.20.1".to_string(),
            ..ProjectConfig::default()
        };
        let report = check_minecraft_integrity(&project)
            .await
            .expect("сбой скачивания индекса должен возвращать частичный отчёт, а не ошибку");

        assert!(
            report.failed.contains(&"assets/indexes/5.json".to_string()),
            "отчёт должен содержать сбой индекса ассетов: {:?}",
            report.failed
        );
        assert!(report.repaired >= 1, "успешные фазы должны попасть в отчёт");
        let step_terminals = integrity_terminals(PHASE_ASSET_INDEX.id);
        assert_eq!(
            step_terminals.len(),
            1,
            "ровно одно терминальное событие: {step_terminals:?}"
        );
        assert!(
            matches!(step_terminals.first(), Some(StepEvent::Failed { .. })),
            "шаг индекса должен фейлиться: {step_terminals:?}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::check_natives_integrity;
    use crate::minecraft::vanilla::download::collect_natives_to_extract;
    use crate::minecraft::vanilla::structs::VersionDetailsManifest;
    use crate::test_support::LauncherDirGuard;
    use crate::utils::env_info::get_current_os;
    use serde_json::json;
    use std::io::Write;
    use std::path::Path;

    fn make_jar(path: &Path, entries: &[(&str, &[u8])]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let file = std::fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (name, data) in entries {
            writer
                .start_file(name.to_string(), zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }

    fn natives_manifest_json() -> serde_json::Value {
        let os = get_current_os();
        json!({
            "id": "1.18.2",
            "downloads": {
                "client": {
                    "sha1": "2e9a3e3107cca00d6bc9c97bf7d149cae163ef21",
                    "size": 1,
                    "url": "https://example.invalid/client.jar"
                }
            },
            "libraries": [
                {
                    "name": "org.lwjgl:lwjgl:3.2.2",
                    "downloads": {
                        "artifact": {
                            "path": "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar",
                            "sha1": "8ad6294407e15780b43e84929c40e4c5e997972e",
                            "size": 1,
                            "url": ""
                        },
                        "classifiers": {
                            format!("natives-{os}"): {
                                "path": "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-test.jar",
                                "sha1": "ae7976827ca2a3741f6b9a843a89bacd637af350",
                                "size": 1,
                                "url": "https://example.invalid/natives.jar"
                            }
                        }
                    },
                    "natives": { os: format!("natives-{os}") }
                }
            ],
            "assetIndex": {
                "id": "1.18",
                "sha1": "d31a2e85ae149dd1b1a7070b22cb8887892fda6c",
                "size": 1,
                "url": "https://example.invalid/1.18.json",
                "totalSize": 1
            },
            "assets": "1.18",
            "mainClass": "net.minecraft.client.main.Main"
        })
    }

    #[tokio::test]
    async fn integrity_natives_phase_extracts_and_reports_extraction_failure() {
        let dir = LauncherDirGuard::acquire("integrity_natives").await;
        let base = dir.project_dir("Cordelia");

        let natives_jar = base.join("libraries/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-test.jar");
        make_jar(&natives_jar, &[("liblwjgl.so", b"so bytes".as_slice())]);

        let manifest: VersionDetailsManifest =
            serde_json::from_value(natives_manifest_json()).unwrap();

        let report = check_natives_integrity(
            &base,
            collect_natives_to_extract(&manifest).expect("список natives"),
            &manifest.id,
        )
        .await
        .expect("фаза natives проверки целостности");

        assert!(report.failed.is_empty());
        assert_eq!(report.total, 1);
        assert_eq!(
            std::fs::read(base.join("natives/liblwjgl.so")).unwrap(),
            b"so bytes"
        );

        std::fs::remove_file(&natives_jar).unwrap();

        let report = check_natives_integrity(
            &base,
            collect_natives_to_extract(&manifest).expect("список natives"),
            &manifest.id,
        )
        .await
        .expect("отчёт фазы natives при совпадающей версии");

        assert!(
            report.failed.is_empty(),
            "при совпадающем маркере версии распаковка пропускается: {report:?}"
        );
        assert_eq!(
            std::fs::read(base.join("natives/liblwjgl.so")).unwrap(),
            b"so bytes"
        );

        let report = check_natives_integrity(
            &base,
            collect_natives_to_extract(&manifest).expect("список natives"),
            "1.20.1",
        )
        .await
        .expect("отчёт фазы natives при смене версии");

        assert_eq!(report.failed, vec!["natives".to_string()]);
        assert_eq!(
            report.total, 1,
            "фаза natives считается одной единицей отчёта"
        );
        assert_eq!(
            report.broken, 1,
            "числа отчёта должны быть согласованы: total == broken при полном сбое фазы"
        );
        let natives_clean = std::fs::read_dir(base.join("natives"))
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(true);
        assert!(
            natives_clean,
            "после неудачной распаковки папка natives должна остаться пустой"
        );
    }
}
