use anyhow::{Context, Result};
use std::path::Path;

use crate::minecraft::mod_loader::{
    installer::{
        locate_installed_manifest, manifest_paths, move_version_jar, run_loader_installer,
    },
    neoforge::structs::Manifest,
};
use crate::state::dto::ProjectConfig;
use crate::utils::download_file::download_json;

const LOADER_NAME: &str = "NeoForge";
const MANIFEST_PREFIX: &str = "neoforge";

pub async fn start_installer(
    installer_path: &Path,
    vanilla_dir: &Path,
    state_project: &ProjectConfig,
) -> Result<Manifest> {
    run_loader_installer(LOADER_NAME, installer_path, vanilla_dir, state_project).await?;

    let (neoforge_manifest, base_url) = manifest_paths(state_project, MANIFEST_PREFIX)?;
    let versions_dir = base_url.join("versions");

    let _ = move_version_jar(&base_url, &state_project.mc_version).await;

    let found = locate_installed_manifest(
        &versions_dir,
        &state_project.mc_version,
        &neoforge_manifest,
    )
    .await?;

    if found != neoforge_manifest {
        if let Some(parent) = neoforge_manifest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("Не удалось создать {:?}", parent))?;
        }
        tokio::fs::rename(&found, &neoforge_manifest)
            .await
            .with_context(|| format!("Не удалось переместить {:?} в {:?}", found, neoforge_manifest))?;
    }

    let manifest = download_json::<Manifest>(None, &neoforge_manifest).await?;
    Ok(manifest)
}
