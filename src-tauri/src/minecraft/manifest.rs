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

    let version_manifest: VersionDetailsManifest =
        download_json(Some(&version_url), json_path.as_path()).await?;
    if version_manifest.id != version {
        return Err(LauncherError::ManifestParse(format!(
            "Манифест версии {version} содержит чужой id {}",
            version_manifest.id
        ))
        .into());
    }
    Ok(version_manifest)
}

#[cfg(test)]
mod version_validation_tests {
    use super::get_manifest_version;
    use crate::minecraft::structs::Versions;
    use crate::test_support::LauncherDirGuard;
    use mockito::Server;

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

    fn manifest_json(id: &str) -> String {
        serde_json::json!({
            "id": id,
            "downloads": {
                "client": {
                    "sha1": "2e9a3e3107cca00d6bc9c97bf7d149cae163ef21",
                    "size": 1,
                    "url": "https://piston-data.example/client.jar"
                }
            },
            "libraries": [],
            "assetIndex": {
                "id": "1.18",
                "sha1": "d31a2e85ae149dd1b1a7070b22cb8887892fda6c",
                "size": 1,
                "url": "https://piston-meta.example/1.18.json",
                "totalSize": 1
            },
            "assets": "1.18",
            "mainClass": "net.minecraft.client.main.Main"
        })
        .to_string()
    }

    async fn mock_version_server() -> (LauncherDirGuard, mockito::ServerGuard) {
        let guard = LauncherDirGuard::acquire("manifest_id_check").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/1.20.1.json")
            .with_status(200)
            .with_body(manifest_json("1.20.2"))
            .create_async()
            .await;
        (guard, server)
    }

    #[tokio::test]
    async fn manifest_with_foreign_id_is_rejected() {
        let (_guard, server) = mock_version_server().await;
        let versions = vec![Versions {
            id: "1.20.1".to_string(),
            url: format!("{}/1.20.1.json", server.url()),
        }];
        let error = get_manifest_version("1.20.1", versions)
            .await
            .expect_err("расхождение manifest.id и запрошенной версии должно быть ошибкой");

        assert!(
            error.to_string().contains("чужой id"),
            "ошибка должна называть расхождение id: {error}"
        );
    }

    #[tokio::test]
    async fn manifest_with_matching_id_is_accepted() {
        let _guard = LauncherDirGuard::acquire("manifest_id_match").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/1.20.1.json")
            .with_status(200)
            .with_body(manifest_json("1.20.1"))
            .create_async()
            .await;

        let versions = vec![Versions {
            id: "1.20.1".to_string(),
            url: format!("{}/1.20.1.json", server.url()),
        }];
        let manifest = get_manifest_version("1.20.1", versions)
            .await
            .expect("манифест с совпадающим id");
        assert_eq!(manifest.id, "1.20.1");
    }
}

#[cfg(test)]
mod manifest_index_tests {
    use super::get_manifest_index;
    use crate::minecraft::structs::Versions;
    use crate::test_support::LauncherDirGuard;
    use mockito::Server;

    #[tokio::test]
    async fn get_manifest_index_downloads_once_then_reads_from_cache() {
        let _guard = LauncherDirGuard::acquire("manifest_index_cache").await;
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/versions")
            .with_status(200)
            .with_body(r#"[{"url": "https://example.com/1.20.1.json", "id": "1.20.1"}]"#)
            .expect(1)
            .create_async()
            .await;

        let first: Vec<Versions> =
            get_manifest_index("vanilla", &format!("{}/versions", server.url()), "index")
                .await
                .expect("первая загрузка индекса");
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id, "1.20.1");

        let second: Vec<Versions> =
            get_manifest_index("vanilla", &format!("{}/versions", server.url()), "index")
                .await
                .expect("повторное чтение идёт из кэша");
        assert_eq!(second[0].id, first[0].id);
        assert_eq!(second[0].url, first[0].url);

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn get_manifest_index_errors_on_invalid_json() {
        let _guard = LauncherDirGuard::acquire("manifest_index_bad").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/versions")
            .with_status(200)
            .with_body("not json")
            .create_async()
            .await;

        let result: anyhow::Result<Vec<Versions>> =
            get_manifest_index("fabric", &format!("{}/versions", server.url()), "broken").await;

        assert!(result.is_err());
    }
}
