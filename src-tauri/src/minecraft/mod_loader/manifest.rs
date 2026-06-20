use crate::{
    minecraft::{structs::Versions, vanilla::structs::VersionDetailsManifest},
    utils::{download_file::download_json, env_info::launcher_patch},
};
use ::anyhow::{Context, Result};

pub async fn get_manifest_version(
    version: &str,
    manifest: Vec<Versions>,
) -> Result<VersionDetailsManifest> {
    let json_path = launcher_patch(None)?
        .join("manifest")
        .join(format!("{}.json", version));
    let version_url = manifest
        .iter()
        .find(|v| v.id == version)
        .map(|v| v.url.clone())
        .with_context(|| format!("Версия не найдена: {}", version))?;

    let manifest: VersionDetailsManifest =
        download_json(Some(&version_url), json_path.as_path()).await?;
    Ok(manifest)
}
