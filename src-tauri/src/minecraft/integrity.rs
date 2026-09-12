use anyhow::{Context, Result};
use futures::future::BoxFuture;

use crate::log_info;
use crate::minecraft::manifest::{get_manifest_index, get_manifest_version, VERSION_MANIFEST_URL};
use crate::minecraft::vanilla::download::{
    collect_asset_index_target, collect_asset_targets, collect_client_jar_target,
    collect_library_targets,
};
use crate::minecraft::vanilla::manifest::create_manifest_versions;
use crate::minecraft::vanilla::structs::{AssetIndexContent, VanillaVersionsManifest};
use crate::state::dto::ProjectConfig;
use crate::utils::download_file::download_file;
use crate::utils::env_info::launcher_path;
use crate::utils::integrity::{check_integrity, IntegrityReport};
use crate::utils::step_events::{StepChannel, StepHandle};

pub async fn load_version_manifest(
    project: &ProjectConfig,
) -> Result<crate::minecraft::vanilla::structs::VersionDetailsManifest> {
    let manifest_index = get_manifest_index::<VanillaVersionsManifest>(
        "vanilla",
        VERSION_MANIFEST_URL,
        "index",
    )
    .await?;

    let versions = create_manifest_versions(manifest_index.versions)?;

    let manifest = get_manifest_version(&project.mc_version, versions).await?;
    Ok(manifest)
}

fn url_download_fn(
) -> impl Fn(String, std::path::PathBuf) -> BoxFuture<'static, Result<(), anyhow::Error>> + Send + Sync + 'static
{
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

    let manifest_step = StepHandle::start_channel(StepChannel::Integrity, "mc.manifest", "Загрузка манифеста версии");
    let manifest = load_version_manifest(project).await?;
    manifest_step.finish(false);

    let base_path = launcher_path(Some(&project_name))?;

    let jar_report = check_integrity(
        &base_path,
        vec![collect_client_jar_target(&manifest)],
        "mc.jar",
        "Клиент игры",
        url_download_fn(),
    )
    .await?;

    let libs_report = check_integrity(
        &base_path,
        collect_library_targets(&manifest),
        "mc.libs",
        "Библиотеки",
        url_download_fn(),
    )
    .await?;

    let index_target = collect_asset_index_target(&manifest);
    let index_report = check_integrity(
        &base_path,
        vec![index_target.clone()],
        "mc.assets.index",
        "Индекс ресурсов",
        url_download_fn(),
    )
    .await?;

    let index_path = base_path.join(&index_target.rel_path);
    let asset_index: AssetIndexContent = serde_json::from_str(
        &tokio::fs::read_to_string(&index_path)
            .await
            .with_context(|| format!("Не удалось прочитать индекс ресурсов: {:?}", index_path))?,
    )
    .context("Не удалось разобрать индекс ресурсов")?;

    let assets_report = check_integrity(
        &base_path,
        collect_asset_targets(&asset_index),
        "mc.assets",
        "Ресурсы игры",
        url_download_fn(),
    )
    .await?;

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
