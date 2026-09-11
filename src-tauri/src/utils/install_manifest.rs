use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::utils::env_info::launcher_patch;

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct InstallManifest {
    pub files: HashMap<String, String>,
}

fn manifest_path(project_name: &str) -> Result<PathBuf> {
    Ok(launcher_patch(None)?
        .join("manifest")
        .join(format!("installed_{}.json", project_name)))
}

pub async fn load_install_manifest(project_name: &str) -> Result<InstallManifest> {
    let path = manifest_path(project_name)?;
    if !path.exists() {
        return Ok(InstallManifest::default());
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .with_context(|| format!("Не удалось прочитать {:?}", path))?;
    let manifest: InstallManifest = serde_json::from_str(&content)
        .with_context(|| format!("Неверный формат {:?}", path))?;
    Ok(manifest)
}

pub async fn save_install_manifest(project_name: &str, manifest: &InstallManifest) -> Result<()> {
    let path = manifest_path(project_name)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать директорию для {:?}", parent))?;
    }
    let content = serde_json::to_string_pretty(manifest)
        .context("Не удалось сериализовать манифест установки")?;
    crate::utils::download_file::write_atomic(&path, content.as_bytes()).await?;
    Ok(())
}

pub fn merge_installed(manifest: &mut InstallManifest, rel_path: &str, hash: &str) {
    manifest.files.insert(rel_path.to_string(), hash.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_round_trip_preserves_files() {
        let mut manifest = InstallManifest::default();
        merge_installed(&mut manifest, "fabric-loader-0.16.9.jar", "abc123");
        merge_installed(&mut manifest, "libraries/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar", "def456");

        let json = serde_json::to_string(&manifest).expect("сериализация манифеста");
        let parsed: InstallManifest = serde_json::from_str(&json).expect("разбор манифеста");

        assert_eq!(
            parsed.files.get("fabric-loader-0.16.9.jar").map(String::as_str),
            Some("abc123")
        );
        assert_eq!(parsed.files.len(), 2);
    }

    #[test]
    fn merge_overwrites_existing_hash() {
        let mut manifest = InstallManifest::default();
        merge_installed(&mut manifest, "loader.jar", "old");
        merge_installed(&mut manifest, "loader.jar", "new");
        assert_eq!(manifest.files.get("loader.jar").map(String::as_str), Some("new"));
    }
}
