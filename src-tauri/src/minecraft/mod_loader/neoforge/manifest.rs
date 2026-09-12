use anyhow::Result;

use crate::minecraft::{
    mod_loader::manifest::{get_loader_index, loader_libraries, LoaderIndex, Manifest, Metadata},
    structs::{LibraryMod, VersionMod},
};

const METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const CACHE_FILE: &str = "neoforge.json";
pub(crate) const MAVEN_BASE: &str = "https://maven.neoforged.net";
pub(crate) const MANIFEST_PREFIX: &str = "neoforge";

pub async fn get_manifest_index() -> Result<LoaderIndex> {
    get_loader_index(CACHE_FILE, METADATA_URL, group_neoforge_versions).await
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
        let mc_version = format!("1.{}.{}", major, minor);
        grouped_versions
            .entry(mc_version)
            .or_default()
            .push(v.to_string());
    }

    grouped_versions
}

pub fn transform_neoforge_manifest(neoforge_manifest: LoaderIndex) -> Vec<VersionMod> {
    let mut manifest: Vec<VersionMod> = Vec::new();

    for (mc_version, neoforge_versions) in &neoforge_manifest {
        for neoforge_version in neoforge_versions {
            let version_id = format!("{}-{}", mc_version, neoforge_version);
            let version_mod = VersionMod {
                url: format!("{}/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar", MAVEN_BASE, v = neoforge_version),
                id: version_id.clone(),
                main_class: "".to_string(),
                library: Vec::new(),
            };

            manifest.push(version_mod);
        }
    }
    manifest
}

pub fn get_library(manifest: Manifest) -> Result<Vec<LibraryMod>> {
    loader_libraries(manifest.libraries, MAVEN_BASE)
}
