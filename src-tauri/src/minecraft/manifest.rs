use anyhow::{Context, Result};
use serde::de::DeserializeOwned;

use crate::{
    minecraft::structs::Versions,
    minecraft::vanilla::structs::VersionDetailsManifest,
    utils::{download_file::download_json, env_info::launcher_path},
};

pub const VERSION_MANIFEST_URL: &str =
    "https://launchermeta.mojang.com/mc/game/version_manifest.json";

pub async fn get_manifest_index<T: DeserializeOwned>(
    mod_loader: &str,
    url: &str,
    json_name: &str,
) -> Result<T> {
    let json_path = launcher_path(None)?
        .join("manifest")
        .join(format!("{}_{}.json", mod_loader, json_name));
    let manifest: T = download_json(Some(url), json_path.as_path()).await?;
    Ok(manifest)
}

pub async fn get_manifest_version(
    version: &str,
    manifest: Vec<Versions>,
) -> Result<VersionDetailsManifest> {
    let json_path = launcher_path(None)?
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
