use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::Result;

use crate::log_err;
use crate::utils::env_info::launcher_path;
use crate::utils::errors::LauncherError;

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct InstallManifest {
    pub files: HashMap<String, String>,
}

fn manifest_path(project_name: &str) -> Result<PathBuf> {
    Ok(launcher_path(None)?
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
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось прочитать {path:?}: {e:#}")))?;
    match serde_json::from_str::<InstallManifest>(&content) {
        Ok(manifest) => Ok(manifest),
        Err(e) => {
            log_err!(
                "Манифест установленных файлов {path:?} повреждён ({e}), перестраивается с нуля"
            );
            Ok(InstallManifest::default())
        }
    }
}

pub async fn save_install_manifest(project_name: &str, manifest: &InstallManifest) -> Result<()> {
    let path = manifest_path(project_name)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось создать директорию для {parent:?}: {e:#}"
            ))
        })?;
    }
    let content = serde_json::to_string_pretty(manifest).map_err(|e| {
        LauncherError::ManifestParse(format!(
            "Не удалось сериализовать манифест установки: {e:#}"
        ))
    })?;
    crate::utils::download_file::write_atomic(&path, content.as_bytes()).await?;
    Ok(())
}

pub fn merge_installed(manifest: &mut InstallManifest, rel_path: &str, hash: &str) {
    manifest
        .files
        .insert(rel_path.to_string(), hash.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::LauncherDirGuard;

    #[test]
    fn manifest_round_trip_preserves_files() {
        let mut manifest = InstallManifest::default();
        merge_installed(&mut manifest, "fabric-loader-0.16.9.jar", "abc123");
        merge_installed(
            &mut manifest,
            "libraries/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar",
            "def456",
        );

        let json = serde_json::to_string(&manifest).expect("сериализация манифеста");
        let parsed: InstallManifest = serde_json::from_str(&json).expect("разбор манифеста");

        assert_eq!(
            parsed
                .files
                .get("fabric-loader-0.16.9.jar")
                .map(String::as_str),
            Some("abc123")
        );
        assert_eq!(parsed.files.len(), 2);
    }

    #[test]
    fn merge_overwrites_existing_hash() {
        let mut manifest = InstallManifest::default();
        merge_installed(&mut manifest, "loader.jar", "old");
        merge_installed(&mut manifest, "loader.jar", "new");
        assert_eq!(
            manifest.files.get("loader.jar").map(String::as_str),
            Some("new")
        );
    }

    #[tokio::test]
    async fn broken_manifest_loads_empty_and_is_repaired_on_save() {
        let dir = LauncherDirGuard::acquire("install_manifest_broken").await;
        dir.write_broken_install_manifest("Cordelia");

        let manifest = load_install_manifest("Cordelia")
            .await
            .expect("битый манифест должен читаться как пустой");
        assert!(
            manifest.files.is_empty(),
            "битый манифест должен быть пустым"
        );

        let mut repaired = InstallManifest::default();
        merge_installed(&mut repaired, "fabric-loader.jar", "abc123");
        save_install_manifest("Cordelia", &repaired)
            .await
            .expect("сохранение восстановленного манифеста");

        let manifest_path = dir.root().join("manifest").join("installed_Cordelia.json");
        let raw = std::fs::read_to_string(&manifest_path).expect("чтение манифеста");
        let parsed: InstallManifest = serde_json::from_str(&raw).expect("валидный json");
        assert_eq!(
            parsed.files.get("fabric-loader.jar").map(String::as_str),
            Some("abc123")
        );

        let again = load_install_manifest("Cordelia")
            .await
            .expect("чтение восстановленного манифеста");
        assert_eq!(
            again.files.get("fabric-loader.jar").map(String::as_str),
            Some("abc123")
        );
    }
}
