use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

use crate::{
    log_err,
    minecraft::{
        structs::{LibraryMod, Versions},
        mod_loader::utils::maven_to_url,
        vanilla::structs::VersionDetailsManifest,
    },
    utils::{download_file::download_json, env_info::launcher_patch},
};

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

pub async fn read_or_fetch_index<T: DeserializeOwned>(
    json_path: &Path,
    rebuild: impl AsyncFnOnce() -> Result<T>,
    serialize: impl FnOnce(&T) -> Result<String>,
) -> Result<T> {
    if json_path.exists() {
        if let Ok(content) = fs::read_to_string(json_path).await {
            match serde_json::from_str::<T>(&content) {
                Ok(index) => return Ok(index),
                Err(e) => {
                    log_err!("Кэш {:?} повреждён ({}), перекачивание", json_path, e);
                }
            }
        }
        let _ = fs::remove_file(json_path).await;
    }

    let index = rebuild().await?;

    if let Some(parent) = json_path.parent() {
        fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать директорию {:?}", parent))?;
    }
    fs::write(json_path, serialize(&index)?)
        .await
        .with_context(|| format!("Не удалось записать кэш {:?}", json_path))?;

    Ok(index)
}

pub fn loader_libraries<L: LoaderLibrary>(
    libraries: Vec<L>,
    maven_base: &str,
) -> Result<Vec<LibraryMod>> {
    let mut result = Vec::new();
    for lib in libraries {
        let name = lib.name();
        let artifact = lib.into_artifact();
        let url = if !artifact.url.is_empty() {
            artifact.url
        } else {
            maven_to_url(&name, maven_base)?
        };
        result.push(LibraryMod {
            name,
            url,
            hash: artifact.sha1,
            size: artifact.size,
        });
    }
    Ok(result)
}

pub trait LoaderLibrary {
    fn name(&self) -> String;
    fn into_artifact(self) -> LoaderArtifact;
}

pub struct LoaderArtifact {
    pub url: String,
    pub sha1: String,
    pub size: i64,
}

pub type LoaderIndex = HashMap<String, Vec<String>>;
