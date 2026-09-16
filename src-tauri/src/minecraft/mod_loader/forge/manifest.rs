use anyhow::{Context, Result};

use crate::minecraft::{
    mod_loader::manifest::{get_loader_index, transform_loader_manifest, LoaderIndex, Metadata},
    structs::VersionMod,
};

const METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const CACHE_FILE: &str = "forge.json";
pub(crate) const MAVEN_BASE: &str = "https://maven.minecraftforge.net";
pub(crate) const MANIFEST_PREFIX: &str = "forge";

pub async fn get_manifest_index() -> Result<LoaderIndex> {
    get_loader_index(CACHE_FILE, METADATA_URL, group_forge_versions)
        .await
        .context("Не удалось получить индекс Forge")
}

fn group_forge_versions(metadata: Metadata) -> LoaderIndex {
    let mut grouped_versions: LoaderIndex = std::collections::HashMap::new();

    for v in metadata.versioning.versions.version_list {
        if let Some((mc_ver, forge_ver)) = v.split_once('-') {
            grouped_versions
                .entry(mc_ver.to_string())
                .or_default()
                .push(forge_ver.to_string());
        }
    }

    grouped_versions
}

pub fn transform_forge_manifest(forge_manifest: LoaderIndex) -> Vec<VersionMod> {
    transform_loader_manifest(forge_manifest, |v, _| {
        format!("{MAVEN_BASE}/net/minecraftforge/forge/{v}/forge-{v}-installer.jar")
    })
}
