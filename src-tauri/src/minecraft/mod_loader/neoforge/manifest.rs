use anyhow::Result;

use crate::{
    minecraft::{
        structs::{LibraryMod, VersionMod},
        mod_loader::{
            manifest::{read_or_fetch_index, LoaderIndex, LoaderLibrary, LoaderArtifact, loader_libraries},
            neoforge::structs::{Library, Manifest, Metadata},
        },
    },
    utils::{
        download_file::{download_json, download_xml},
        env_info::launcher_patch,
    },
};

const METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const CACHE_FILE: &str = "neoforge.json";
const MAVEN_BASE: &str = "https://maven.neoforged.net";

pub async fn get_manifest_index() -> Result<LoaderIndex> {
    let json_path = launcher_patch(None)?.join("manifest").join(CACHE_FILE);
    let index = read_or_fetch_index(
        &json_path,
        || async {
            let metadata = download_xml::<Metadata>(METADATA_URL).await?;
            Ok(group_neoforge_versions(metadata))
        },
        |index| Ok(serde_json::to_string_pretty(index)?),
    )
    .await?;
    Ok(index)
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

pub async fn modify_manifest(version: &str, manifest: &mut [VersionMod]) -> Result<()> {
    let neoforge_url = launcher_patch(None)?
        .join("manifest")
        .join(format!("neoforge_{}.json", &version));
    let version_manifest = download_json::<Manifest>(None, &neoforge_url).await?;
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
