use anyhow::{Context, Result};
use futures::future::BoxFuture;

use crate::log_info;
use crate::minecraft::manifest::{get_manifest_index, get_manifest_version, VERSION_MANIFEST_URL};
use crate::minecraft::vanilla::download::{
    collect_asset_targets, collect_install_targets, read_asset_index, PHASE_ASSETS,
    PHASE_ASSET_INDEX, PHASE_CLIENT, PHASE_LIBRARIES,
};
use crate::minecraft::vanilla::manifest::create_manifest_versions;
use crate::minecraft::vanilla::structs::VanillaVersionsManifest;
use crate::state::dto::ProjectConfig;
use crate::utils::download_file::download_file;
use crate::utils::env_info::launcher_path;
use crate::utils::integrity::{check_integrity, IntegrityReport};
use crate::utils::step_events::{StepChannel, StepHandle};

pub async fn load_version_manifest(
    project: &ProjectConfig,
) -> Result<crate::minecraft::vanilla::structs::VersionDetailsManifest> {
    let manifest_index =
        get_manifest_index::<VanillaVersionsManifest>("vanilla", VERSION_MANIFEST_URL, "index")
            .await
            .context("Не удалось загрузить индекс манифеста версий")?;

    let versions = create_manifest_versions(manifest_index.versions);

    let manifest = get_manifest_version(&project.mc_version, versions)
        .await
        .context("Не удалось получить манифест версии")?;
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
    let manifest = load_version_manifest(project)
        .await
        .context("Не удалось загрузить манифест версии")?;
    manifest_step.finish(false);

    let base_path = launcher_path(Some(&project_name))
        .context("Не удалось определить путь к файлам проекта")?;
    let targets = collect_install_targets(&manifest);

    let jar_report = check_integrity(
        &base_path,
        vec![targets.client],
        PHASE_CLIENT.id,
        PHASE_CLIENT.label,
        url_download_fn(),
    )
    .await
    .context("Не удалось проверить клиентский jar")?;

    let libs_report = check_integrity(
        &base_path,
        targets.libraries,
        PHASE_LIBRARIES.id,
        PHASE_LIBRARIES.label,
        url_download_fn(),
    )
    .await
    .context("Не удалось проверить библиотеки")?;

    let index_report = check_integrity(
        &base_path,
        vec![targets.asset_index.clone()],
        PHASE_ASSET_INDEX.id,
        PHASE_ASSET_INDEX.label,
        url_download_fn(),
    )
    .await
    .context("Не удалось проверить индекс ассетов")?;

    let index_path = base_path.join(&targets.asset_index.rel_path);
    let asset_index = read_asset_index(&index_path)
        .await
        .context("Не удалось прочитать индекс ассетов")?;

    let assets_report = check_integrity(
        &base_path,
        collect_asset_targets(&asset_index),
        PHASE_ASSETS.id,
        PHASE_ASSETS.label,
        url_download_fn(),
    )
    .await
    .context("Не удалось проверить ассеты")?;

    let mut report = jar_report;
    report.merge(libs_report);
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
