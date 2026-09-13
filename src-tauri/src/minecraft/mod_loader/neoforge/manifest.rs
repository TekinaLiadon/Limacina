use anyhow::Result;

use crate::minecraft::{
    mod_loader::manifest::{get_loader_index, transform_loader_manifest, LoaderIndex, Metadata},
    structs::VersionMod,
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
    transform_loader_manifest(neoforge_manifest, |_, v| {
        format!("{MAVEN_BASE}/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar")
    })
}
