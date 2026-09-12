use anyhow::Result;

use crate::minecraft::{
    mod_loader::manifest::{get_loader_index, loader_libraries, LoaderIndex, Manifest, Metadata},
    structs::{LibraryMod, VersionMod},
};

const METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const CACHE_FILE: &str = "forge.json";
pub(crate) const MAVEN_BASE: &str = "https://maven.minecraftforge.net";
pub(crate) const MANIFEST_PREFIX: &str = "forge";

pub async fn get_manifest_index() -> Result<LoaderIndex> {
    get_loader_index(CACHE_FILE, METADATA_URL, group_forge_versions).await
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
    let mut manifest: Vec<VersionMod> = Vec::new();

    for (mc_version, forge_versions) in &forge_manifest {
        for forge_version in forge_versions {
            let version = format!("{}-{}", mc_version, forge_version);
            let version_mod = VersionMod {
                url: format!("{}/net/minecraftforge/forge/{v}/forge-{v}-installer.jar", MAVEN_BASE, v = version),
                id: version.clone(),
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
