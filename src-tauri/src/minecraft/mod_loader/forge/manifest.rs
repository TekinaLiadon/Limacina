use anyhow::Result;

use crate::{
    minecraft::{
        structs::{LibraryMod, VersionMod},
        mod_loader::{
            forge::structs::{Library, Manifest, Metadata},
            manifest::{read_or_fetch_index, LoaderIndex, LoaderLibrary, LoaderArtifact, loader_libraries},
        },
    },
    utils::{
        download_file::{download_json, download_xml},
        env_info::launcher_patch,
    },
};

const METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const CACHE_FILE: &str = "forge.json";
const MAVEN_BASE: &str = "https://maven.minecraftforge.net";

pub async fn get_manifest_index() -> Result<LoaderIndex> {
    let json_path = launcher_patch(None)?.join("manifest").join(CACHE_FILE);
    let index = read_or_fetch_index(
        &json_path,
        || async {
            let metadata = download_xml::<Metadata>(METADATA_URL).await?;
            Ok(group_forge_versions(metadata))
        },
        |index| Ok(serde_json::to_string_pretty(index)?),
    )
    .await?;
    Ok(index)
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

pub fn transform_forge_manifest(forge_manifect: LoaderIndex) -> Vec<VersionMod> {
    let mut manifest: Vec<VersionMod> = Vec::new();

    for (mc_version, forge_versions) in &forge_manifect {
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

pub async fn modify_manifest(version: &str, manifest: &mut [VersionMod]) -> Result<()> {
    let forge_url = launcher_patch(None)?
        .join("manifest")
        .join(format!("forge_{}.json", &version));
    let version_manifest = download_json::<Manifest>(None, &forge_url).await?;
    let main_class = version_manifest.main_class.clone();
    let target_id = format!("{}-{}", version_manifest.inherits_from.clone(), version);
    let library = get_library(version_manifest)?;

    if let Some(mod_item) = manifest.iter_mut().find(|m| m.id == target_id) {
        mod_item.main_class = main_class;
        mod_item.library = library;
    }
    Ok(())
}

pub fn get_library(manifest: Manifest) -> Result<Vec<LibraryMod>> {
    loader_libraries(manifest.libraries, MAVEN_BASE)
}

impl LoaderLibrary for Library {
    fn name(&self) -> String {
        self.name.clone()
    }

    fn into_artifact(self) -> LoaderArtifact {
        LoaderArtifact {
            url: self.downloads.artifact.url,
            sha1: self.downloads.artifact.sha1,
            size: self.downloads.artifact.size,
        }
    }
}
