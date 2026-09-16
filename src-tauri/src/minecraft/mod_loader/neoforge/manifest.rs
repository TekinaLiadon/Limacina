use anyhow::{Context, Result};

use crate::minecraft::{
    mod_loader::manifest::{get_loader_index, transform_loader_manifest, LoaderIndex, Metadata},
    structs::VersionMod,
};

const METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const CACHE_FILE: &str = "neoforge_index.json";
pub(crate) const MAVEN_BASE: &str = "https://maven.neoforged.net";
pub(crate) const MANIFEST_PREFIX: &str = "neoforge";

pub async fn get_manifest_index() -> Result<LoaderIndex> {
    get_loader_index(CACHE_FILE, METADATA_URL, group_neoforge_versions)
        .await
        .context("Не удалось получить индекс NeoForge")
}

fn group_neoforge_versions(metadata: Metadata) -> LoaderIndex {
    let mut grouped_versions: LoaderIndex = std::collections::HashMap::new();

    for v in metadata.versioning.versions.version_list {
        let parts: Vec<&str> = v.split('.').collect();
        if parts.len() < 2 {
            continue;
        }
        let (Ok(major), Ok(minor)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) else {
            continue;
        };
        let mc_version = neoforge_mc_version(major, minor);
        grouped_versions
            .entry(mc_version)
            .or_default()
            .push(v.to_string());
    }

    grouped_versions
}

fn neoforge_mc_version(major: u32, minor: u32) -> String {
    if minor == 0 {
        format!("1.{}", major)
    } else {
        format!("1.{}.{}", major, minor)
    }
}

pub fn transform_neoforge_manifest(neoforge_manifest: LoaderIndex) -> Vec<VersionMod> {
    transform_loader_manifest(neoforge_manifest, |_, v| {
        format!("{MAVEN_BASE}/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar")
    })
}

#[cfg(test)]
mod neoforge_index_tests {
    use super::*;
    use crate::minecraft::mod_loader::manifest::{current_loader_version, VersionList, Versioning};
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;
    use mockito::Server;

    fn metadata(versions: &[&str]) -> Metadata {
        let latest = versions.last().map(|v| (*v).to_string()).unwrap_or_default();
        Metadata {
            versioning: Versioning {
                latest: latest.clone(),
                release: latest,
                versions: VersionList {
                    version_list: versions.iter().map(|v| (*v).to_string()).collect(),
                },
            },
        }
    }

    #[test]
    fn groups_patch_zero_under_short_mc_version_key() {
        let index = group_neoforge_versions(metadata(&[
            "21.0.0-beta",
            "21.0.143",
            "21.1.1",
            "20.6.121",
        ]));

        assert_eq!(
            index.get("1.21").map(Vec::as_slice),
            Some(&["21.0.0-beta".to_string(), "21.0.143".to_string()][..])
        );
        assert_eq!(index.get("1.21.1").map(Vec::as_slice), Some(&["21.1.1".to_string()][..]));
        assert_eq!(
            index.get("1.20.6").map(Vec::as_slice),
            Some(&["20.6.121".to_string()][..])
        );
        assert!(!index.contains_key("1.21.0"));
    }

    #[test]
    fn skips_non_numeric_loader_versions() {
        let index = group_neoforge_versions(metadata(&["0.25w14craftmine.3-beta", "21.0.1-beta"]));

        assert_eq!(index.len(), 1);
        assert!(index.contains_key("1.21"));
    }

    #[tokio::test]
    async fn real_metadata_fixture_groups_1_21_under_short_key() {
        let dir = LauncherDirGuard::acquire("neoforge_index").await;
        let mut server = Server::new_async().await;
        let body = concat!(
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            "<metadata><groupId>net.neoforged</groupId><artifactId>neoforge</artifactId>",
            "<versioning><latest>21.1.1</latest><release>21.1.1</release><versions>",
            "<version>20.6.121</version><version>21.0.0-beta</version><version>21.0.143</version>",
            "<version>21.1.1</version>",
            "</versions></versioning></metadata>"
        );
        server
            .mock("GET", "/maven-metadata.xml")
            .with_status(200)
            .with_header("content-type", "application/xml")
            .with_body(body)
            .create_async()
            .await;

        let index = get_loader_index(
            CACHE_FILE,
            &format!("{}/maven-metadata.xml", server.url()),
            group_neoforge_versions,
        )
        .await
        .expect("индекс NeoForge");

        let cached = std::fs::read_to_string(dir.root().join("manifest").join(CACHE_FILE))
            .expect("кэш индекса");
        assert!(cached.contains("\"1.21\""));
        assert!(!cached.contains("\"1.21.0\""));

        assert!(index.get("1.21").map(Vec::as_slice).is_some_and(|v| v.contains(&"21.0.143".to_string())));

        let manifest = transform_neoforge_manifest(index);
        let state = ProjectConfig {
            mc_version: "1.21".to_string(),
            loader_version: Some("21.0.143".to_string()),
            ..ProjectConfig::default()
        };
        let resolved = current_loader_version(&state, &manifest).expect("версия найдена");
        assert_eq!(resolved.id, "1.21-21.0.143");
    }
}
