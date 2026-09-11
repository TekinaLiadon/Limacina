use anyhow::{Context, Result};
use std::path::Path;

use crate::minecraft::mod_loader::{
    installer::{
        locate_installed_manifest, manifest_paths, move_version_jar, run_loader_installer,
    },
    forge::structs::Manifest,
};
use crate::state::dto::ProjectConfig;
use crate::utils::download_file::download_json;

const LOADER_NAME: &str = "Forge";
const MANIFEST_PREFIX: &str = "forge";

pub async fn start_installer(
    installer_path: &Path,
    vanilla_dir: &Path,
    state_project: &ProjectConfig,
) -> Result<Manifest> {
    run_loader_installer(LOADER_NAME, installer_path, vanilla_dir, state_project).await?;

    let (forge_manifest, base_url) = manifest_paths(state_project, MANIFEST_PREFIX)?;
    let versions_dir = base_url.join("versions");

    let forge_name_manifest = format!(
        "{}_forge_{}",
        state_project.mc_version,
        state_project
            .loader_version
            .as_deref()
            .unwrap_or_default()
    );
    let expected_manifest = versions_dir
        .join(&forge_name_manifest)
        .join(format!("{}.json", forge_name_manifest));

    let source = if expected_manifest.exists() {
        expected_manifest
    } else {
        locate_installed_manifest(
            &versions_dir,
            &state_project.mc_version,
            &forge_manifest,
        )
        .await?
    };

    move_version_jar(&base_url, &state_project.mc_version).await?;

    if source != forge_manifest {
        if let Some(parent) = forge_manifest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("Не удалось создать {:?}", parent))?;
        }
        tokio::fs::rename(&source, &forge_manifest)
            .await
            .with_context(|| format!("Не удалось переместить {:?} в {:?}", source, forge_manifest))?;
    }

    let _ = tokio::fs::remove_dir_all(versions_dir).await;

    let manifest = download_json::<Manifest>(None, &forge_manifest).await?;
    Ok(manifest)
}
