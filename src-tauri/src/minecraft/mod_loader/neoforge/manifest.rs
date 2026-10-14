use std::collections::BTreeMap;

use crate::minecraft::mod_loader::manifest::{LoaderDef, LoaderIndex, Metadata};

const NEOFORGE_METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const NEOFORGE_CACHE_FILE: &str = "neoforge.json";

pub(crate) const NEOFORGE_MAVEN_BASE: &str = "https://maven.neoforged.net/releases";
pub(crate) const NEOFORGE_MANIFEST_PREFIX: &str = "neoforge";

pub(crate) static NEOFORGE: LoaderDef = LoaderDef {
    name: "NeoForge",
    metadata_url: NEOFORGE_METADATA_URL,
    cache_file: NEOFORGE_CACHE_FILE,
    maven_base: NEOFORGE_MAVEN_BASE,
    manifest_prefix: NEOFORGE_MANIFEST_PREFIX,
    group_versions: group_neoforge_versions,
    installer_url: neoforge_installer_url,
};

fn group_neoforge_versions(metadata: Metadata) -> LoaderIndex {
    let mut grouped_versions: LoaderIndex = BTreeMap::new();

    for v in metadata.versioning.versions.version_list {
        let parts: Vec<&str> = v.split('.').collect();
        let mc_version = match parts.as_slice() {
            [major, minor, _build] => neoforge_legacy_mc_version(major, minor),
            [major, minor, patch, _build] => neoforge_modern_mc_version(major, minor, patch),
            _ => None,
        };
        if let Some(mc_version) = mc_version {
            grouped_versions
                .entry(mc_version)
                .or_default()
                .push(v.to_string());
        }
    }

    grouped_versions
}

fn neoforge_legacy_mc_version(major: &str, minor: &str) -> Option<String> {
    let (Ok(major), Ok(minor)) = (major.parse::<u32>(), minor.parse::<u32>()) else {
        return None;
    };
    Some(if minor == 0 {
        format!("1.{major}")
    } else {
        format!("1.{major}.{minor}")
    })
}

fn neoforge_modern_mc_version(major: &str, minor: &str, patch: &str) -> Option<String> {
    let (Ok(major), Ok(minor), Ok(patch)) = (
        major.parse::<u32>(),
        minor.parse::<u32>(),
        patch.parse::<u32>(),
    ) else {
        return None;
    };
    Some(if patch == 0 {
        format!("{major}.{minor}")
    } else {
        format!("{major}.{minor}.{patch}")
    })
}

fn neoforge_installer_url(_mc_version: &str, v: &str) -> String {
    format!("{NEOFORGE_MAVEN_BASE}/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar")
}

#[cfg(test)]
mod tests {
    use super::{group_neoforge_versions, neoforge_installer_url, NEOFORGE, NEOFORGE_CACHE_FILE};
    use crate::minecraft::mod_loader::manifest::{
        current_loader_version, get_loader_index, latest_list_version, transform_loader_manifest,
        Metadata, VersionList, Versioning,
    };
    use crate::state::dto::ProjectConfig as ConfigProject;
    use crate::test_support::LauncherDirGuard;
    use mockito::Server;

    fn metadata(versions: &[&str]) -> Metadata {
        let latest = versions
            .last()
            .map(|v| (*v).to_string())
            .unwrap_or_default();
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
        let index =
            group_neoforge_versions(metadata(&["21.0.0-beta", "21.0.143", "21.1.1", "20.6.121"]));

        assert_eq!(
            index.get("1.21").map(Vec::as_slice),
            Some(&["21.0.0-beta".to_string(), "21.0.143".to_string()][..])
        );
        assert_eq!(
            index.get("1.21.1").map(Vec::as_slice),
            Some(&["21.1.1".to_string()][..])
        );
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

    #[test]
    fn groups_modern_scheme_without_one_prefix() {
        let index = group_neoforge_versions(metadata(&[
            "26.3.0.75-beta",
            "26.3.0.76",
            "26.1.2.116",
            "26.2.0.89",
        ]));

        assert_eq!(
            index.get("26.3").map(Vec::as_slice),
            Some(&["26.3.0.75-beta".to_string(), "26.3.0.76".to_string()][..])
        );
        assert_eq!(
            index.get("26.1.2").map(Vec::as_slice),
            Some(&["26.1.2.116".to_string()][..])
        );
        assert_eq!(
            index.get("26.2").map(Vec::as_slice),
            Some(&["26.2.0.89".to_string()][..])
        );
        assert!(
            !index.keys().any(|k| k.starts_with("1.26")),
            "ключи новой схемы не должны получать префикс 1.: {:?}",
            index.keys().collect::<Vec<_>>()
        );
    }

    const REAL_VANILLA_RELEASES: &[&str] = &[
        "26.3", "26.2", "26.1.2", "26.1.1", "26.1", "1.21.11", "1.21.10", "1.21.9", "1.21.8",
        "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3", "1.21.2", "1.21.1", "1.21", "1.20.6",
        "1.20.5", "1.20.4", "1.20.3", "1.20.2", "1.20.1", "1.20", "1.19.4", "1.19.3", "1.19.2",
        "1.19.1", "1.19", "1.18.2", "1.18.1", "1.18", "1.17.1", "1.17", "1.16.5", "1.16.4",
        "1.16.3", "1.16.2", "1.16.1", "1.16", "1.15.2", "1.15.1", "1.15", "1.14.4", "1.14.3",
        "1.14.2", "1.14.1", "1.14", "1.13.2", "1.13.1", "1.13", "1.12.2", "1.12.1", "1.12",
        "1.11.2", "1.11.1", "1.11", "1.10.2", "1.10.1", "1.10", "1.9.4", "1.9.3", "1.9.2", "1.9.1",
        "1.9", "1.8.9", "1.8.8", "1.8", "1.7.10", "1.7.2", "1.6.4", "1.5.2", "1.4.7", "1.4.2",
        "1.3.2", "1.2.5", "1.2.1", "1.1", "1.0",
    ];

    fn real_neoforge_metadata() -> Metadata {
        metadata(&[
            "26.1.0.19-beta",
            "26.1.1.15-beta",
            "26.1.2.115",
            "26.1.2.116",
            "26.2.0.89",
            "26.2.0.90",
            "26.3.0.75-beta",
            "26.3.0.76",
            "20.6.60-beta",
            "20.6.121",
            "21.0.0-beta",
            "21.0.143",
            "21.1.1",
            "21.1.259",
            "0.25w14craftmine.3-beta",
            "26.1.0.0-alpha.1+snapshot-1",
        ])
    }

    #[test]
    fn groups_legacy_and_modern_schemes_side_by_side() {
        let index = group_neoforge_versions(real_neoforge_metadata());

        let keys: Vec<&str> = index.keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            vec!["1.20.6", "1.21", "1.21.1", "26.1", "26.1.1", "26.1.2", "26.2", "26.3"],
            "легаси-ключи сохраняют префикс 1., ключи новой схемы без него, \
             alpha-снапшоты и шуточные версии пропускаются"
        );
        assert_eq!(
            index.get("1.21.1").map(Vec::as_slice),
            Some(&["21.1.1".to_string(), "21.1.259".to_string()][..])
        );
        assert_eq!(
            index.get("26.3").map(Vec::as_slice),
            Some(&["26.3.0.75-beta".to_string(), "26.3.0.76".to_string()][..])
        );
    }

    #[test]
    fn grouped_keys_exist_in_real_vanilla_manifest() {
        let index = group_neoforge_versions(real_neoforge_metadata());

        let missing: Vec<&str> = index
            .keys()
            .filter(|k| !REAL_VANILLA_RELEASES.contains(&k.as_str()))
            .map(String::as_str)
            .collect();
        assert!(
            missing.is_empty(),
            "ключи NeoForge без пары в ванильном манифесте: {missing:?}"
        );
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
            NEOFORGE_CACHE_FILE,
            &format!("{}/maven-metadata.xml", server.url()),
            group_neoforge_versions,
        )
        .await
        .expect("индекс NeoForge");

        let cached = std::fs::read_to_string(dir.root().join("manifest").join(NEOFORGE_CACHE_FILE))
            .expect("кэш индекса");
        assert!(cached.contains("\"1.21\""));
        assert!(!cached.contains("\"1.21.0\""));

        assert!(index
            .get("1.21")
            .map(Vec::as_slice)
            .is_some_and(|v| v.contains(&"21.0.143".to_string())));

        let manifest = transform_loader_manifest(index, neoforge_installer_url);
        let state = ConfigProject {
            mc_version: "1.21".to_string(),
            loader_version: Some("21.0.143".to_string()),
            ..ConfigProject::default()
        };
        let resolved = current_loader_version(&state, &manifest).expect("версия найдена");
        assert_eq!(resolved.id, "1.21-21.0.143");
    }

    #[tokio::test]
    async fn modern_scheme_resolves_current_loader_version() {
        let _dir = LauncherDirGuard::acquire("neoforge_modern_current").await;
        let mut server = Server::new_async().await;
        let body = concat!(
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            "<metadata><groupId>net.neoforged</groupId><artifactId>neoforge</artifactId>",
            "<versioning><latest>26.3.0.76</latest><release>26.3.0.76</release><versions>",
            "<version>21.1.259</version><version>26.1.2.116</version><version>26.3.0.75-beta</version>",
            "<version>26.3.0.76</version>",
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
            NEOFORGE_CACHE_FILE,
            &format!("{}/maven-metadata.xml", server.url()),
            group_neoforge_versions,
        )
        .await
        .expect("индекс NeoForge");

        let manifest = transform_loader_manifest(index, neoforge_installer_url);
        let state = ConfigProject {
            mc_version: "26.3".to_string(),
            loader_version: Some("26.3.0.76".to_string()),
            ..ConfigProject::default()
        };
        let resolved = current_loader_version(&state, &manifest).expect("версия найдена");
        assert_eq!(resolved.id, "26.3-26.3.0.76");
        assert_eq!(
            resolved.url,
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/26.3.0.76/neoforge-26.3.0.76-installer.jar"
        );

        let latest =
            latest_list_version(&manifest, "26.3", NEOFORGE.name).expect("последняя версия");
        assert_eq!(latest, "26.3.0.76");
    }

    #[tokio::test]
    async fn stale_legacy_cache_is_ignored_after_cache_file_rename() {
        let dir = LauncherDirGuard::acquire("neoforge_cache_rename").await;
        let manifest_dir = dir.root().join("manifest");
        tokio::fs::create_dir_all(&manifest_dir)
            .await
            .expect("создание папки manifest");
        let legacy_cache = serde_json::json!({ "1.26.3": ["26.3.0.76"] });
        tokio::fs::write(
            manifest_dir.join("neoforge_index.json"),
            legacy_cache.to_string(),
        )
        .await
        .expect("посев старого кэша");

        let mut server = Server::new_async().await;
        let body = concat!(
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            "<metadata><groupId>net.neoforged</groupId><artifactId>neoforge</artifactId>",
            "<versioning><latest>26.3.0.76</latest><release>26.3.0.76</release><versions>",
            "<version>21.1.259</version><version>26.1.2.116</version><version>26.3.0.75-beta</version>",
            "<version>26.3.0.76</version>",
            "</versions></versioning></metadata>"
        );
        let mock = server
            .mock("GET", "/maven-metadata.xml")
            .with_status(200)
            .with_header("content-type", "application/xml")
            .with_body(body)
            .create_async()
            .await;

        let index = get_loader_index(
            NEOFORGE_CACHE_FILE,
            &format!("{}/maven-metadata.xml", server.url()),
            group_neoforge_versions,
        )
        .await
        .expect("индекс NeoForge");

        mock.assert_async().await;
        assert!(index.contains_key("26.3"));
        assert!(!index.contains_key("1.26.3"));
        let cached =
            std::fs::read_to_string(manifest_dir.join(NEOFORGE_CACHE_FILE)).expect("новый кэш");
        assert!(cached.contains("\"26.3\""));
        assert!(!cached.contains("\"1.26.3\""));
    }
}
