use anyhow::Result;
use futures::future::BoxFuture;
use std::path::Path;

use crate::log_err;
use crate::log_info;
use crate::minecraft::manifest::{get_manifest_index, get_manifest_version, VERSION_MANIFEST_URL};
use crate::minecraft::vanilla::download::{
    collect_asset_targets, collect_install_targets, collect_natives_to_extract, extract_natives,
    read_asset_index, PHASE_ASSETS, PHASE_ASSET_INDEX, PHASE_CLIENT, PHASE_LIBRARIES,
};
use crate::minecraft::vanilla::manifest::create_manifest_versions;
use crate::minecraft::vanilla::structs::{VanillaVersionsManifest, VersionDetailsManifest};
use crate::state::dto::ProjectConfig;
use crate::utils::download_file::download_file;
use crate::utils::env_info::launcher_path;
use crate::utils::errors::LauncherError;
use crate::utils::integrity::{check_integrity, IntegrityReport};
use crate::utils::step_events::{StepChannel, StepHandle};

pub async fn load_version_manifest(
    project: &ProjectConfig,
) -> Result<crate::minecraft::vanilla::structs::VersionDetailsManifest> {
    let manifest_index =
        get_manifest_index::<VanillaVersionsManifest>("vanilla", VERSION_MANIFEST_URL, "index")
            .await
            .map_err(|e| {
                LauncherError::GameDownload(format!(
                    "Не удалось загрузить индекс манифеста версий: {e:#}"
                ))
            })?;

    let versions = create_manifest_versions(manifest_index.versions);

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

pub async fn check_minecraft_integrity(project: &ProjectConfig) -> Result<IntegrityReport> {
    let project_name = project.project_name.clone();

    let manifest_step = StepHandle::start_channel(
        StepChannel::Integrity,
        "mc.manifest",
        "Загрузка манифеста версии",
    );
    let manifest = load_version_manifest(project).await.map_err(|e| {
        LauncherError::GameDownload(format!("Не удалось загрузить манифест версии: {e:#}"))
    })?;
    manifest_step.finish(false);

    let base_path = launcher_path(Some(&project_name)).map_err(|e| {
        LauncherError::GameDownload(format!(
            "Не удалось определить путь к файлам проекта: {e:#}"
        ))
    })?;
    let targets = collect_install_targets(&manifest);

    let jar_report = check_integrity(
        &base_path,
        vec![targets.client],
        PHASE_CLIENT.id,
        PHASE_CLIENT.label,
        url_download_fn(),
    )
    .await
    .map_err(|e| {
        LauncherError::GameDownload(format!("Не удалось проверить клиентский jar: {e:#}"))
    })?;

    let libs_report = check_integrity(
        &base_path,
        targets.libraries,
        PHASE_LIBRARIES.id,
        PHASE_LIBRARIES.label,
        url_download_fn(),
    )
    .await
    .map_err(|e| LauncherError::GameDownload(format!("Не удалось проверить библиотеки: {e:#}")))?;

    let natives_report = check_natives_integrity(&base_path, &manifest).await?;

    let index_report = check_integrity(
        &base_path,
        vec![targets.asset_index.clone()],
        PHASE_ASSET_INDEX.id,
        PHASE_ASSET_INDEX.label,
        url_download_fn(),
    )
    .await
    .map_err(|e| {
        LauncherError::GameDownload(format!("Не удалось проверить индекс ассетов: {e:#}"))
    })?;

    let index_path = base_path.join(&targets.asset_index.rel_path);
    let asset_index = read_asset_index(&index_path).await.map_err(|e| {
        LauncherError::GameDownload(format!("Не удалось прочитать индекс ассетов: {e:#}"))
    })?;

    let assets_report = check_integrity(
        &base_path,
        collect_asset_targets(&asset_index),
        PHASE_ASSETS.id,
        PHASE_ASSETS.label,
        url_download_fn(),
    )
    .await
    .map_err(|e| LauncherError::GameDownload(format!("Не удалось проверить ассеты: {e:#}")))?;

    let mut report = jar_report;
    report.merge(libs_report);
    report.merge(natives_report);
    report.merge(index_report);
    report.merge(assets_report);

    log_info!(
        "[integrity] Minecraft {}: проверено {}, повреждено {}, восстановлено {}, ошибок {}",
        project_name,
        report.total,
        report.broken,
        report.repaired,
        report.failed.len()
    );

    Ok(report)
}

async fn check_natives_integrity(
    base_path: &Path,
    manifest: &VersionDetailsManifest,
) -> Result<IntegrityReport> {
    let step =
        StepHandle::start_channel(StepChannel::Integrity, "mc.natives", "Нативные библиотеки");
    let natives_rel = collect_natives_to_extract(manifest);
    let total = natives_rel.len() as u64;
    step.set_total(total);
    step.detail("Распаковка");

    match extract_natives(base_path, natives_rel).await {
        Ok(()) => {
            step.finish(false);
            Ok(IntegrityReport {
                total,
                ..IntegrityReport::default()
            })
        }
        Err(e) => {
            log_err!("[integrity] Не удалось распаковать нативные библиотеки: {e:?}");
            step.fail("Не удалось распаковать нативные библиотеки");
            Ok(IntegrityReport {
                total,
                broken: 1,
                failed: vec!["natives".to_string()],
                ..IntegrityReport::default()
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::check_natives_integrity;
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

        let report = check_natives_integrity(&base, &manifest)
            .await
            .expect("фаза natives проверки целостности");

        assert!(report.failed.is_empty());
        assert_eq!(
            std::fs::read(base.join("natives/liblwjgl.so")).unwrap(),
            b"so bytes"
        );

        std::fs::remove_file(&natives_jar).unwrap();

        let report = check_natives_integrity(&base, &manifest)
            .await
            .expect("отчёт фазы natives при сбое");

        assert_eq!(report.failed, vec!["natives".to_string()]);
        let natives_clean = std::fs::read_dir(base.join("natives"))
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(true);
        assert!(
            natives_clean,
            "после неудачной распаковки папка natives должна остаться пустой"
        );
    }
}
