use anyhow::Result;
use serde::de::DeserializeOwned;

use crate::utils::errors::LauncherError;
use crate::{
    minecraft::structs::Versions,
    minecraft::vanilla::structs::VersionDetailsManifest,
    utils::{
        download_file::download_json,
        env_info::{ensure_safe_relative_path, launcher_path},
    },
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
    ensure_safe_relative_path(version, "версии игры")?;
    let json_path = launcher_path(None)?
        .join("manifest")
        .join(format!("{}.json", version));
    let version_url = manifest
        .iter()
        .find(|v| v.id == version)
        .map(|v| v.url.clone())
        .ok_or_else(|| LauncherError::ManifestParse(format!("Версия не найдена: {version}")))?;

    let manifest: VersionDetailsManifest =
        download_json(Some(&version_url), json_path.as_path()).await?;
    Ok(manifest)
}

#[cfg(test)]
mod version_validation_tests {
    use super::get_manifest_version;

    #[tokio::test]
    async fn traversal_version_is_rejected_before_lookup() {
        let error = get_manifest_version("../evil", vec![])
            .await
            .expect_err("версия с обходом пути должна быть отклонена");
        assert!(
            error
                .to_string()
                .contains("Некорректное значение версии игры"),
            "ошибка должна объяснять проблему: {error}"
        );
    }

    #[tokio::test]
    async fn windows_style_traversal_version_is_rejected() {
        assert!(get_manifest_version("..\\evil", vec![]).await.is_err());
    }
}
