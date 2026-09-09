use std::collections::HashMap;

use anyhow::Result;
use tokio::fs;

use crate::{
    minecraft::{
        structs::{LibraryMod, VersionMod},
        mod_loader::{
            forge::structs::{Manifest, Metadata},
            utils::maven_to_url,
        },
    },
    utils::{
        download_file::{download_json, download_xml},
        env_info::launcher_patch,
    },
};

pub async fn get_manifest_index() -> Result<HashMap<String, Vec<String>>> {
    let json_path = launcher_patch(None)?.join("manifest").join("forge.json");
    if json_path.exists() {
        let file = fs::read_to_string(&json_path).await?;
        let json: HashMap<String, Vec<String>> = serde_json::from_str(&file)?;
        return Ok(json);
    }

    let url = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
    let metadata = download_xml::<Metadata>(url).await?;
    let mut grouped_versions: HashMap<String, Vec<String>> = HashMap::new();

    for v in metadata.versioning.versions.version_list {
        if let Some((mc_ver, forge_ver)) = v.split_once('-') {
            grouped_versions
                .entry(mc_ver.to_string())
                .or_default()
                .push(forge_ver.to_string());
        }
    }

    let json = serde_json::to_string_pretty(&grouped_versions)?;
    fs::write(json_path, &json).await?;

    Ok(grouped_versions)
}

pub fn transform_forge_manifest(forge_manifect: HashMap<String, Vec<String>>) -> Vec<VersionMod> {
    let mut manifest: Vec<VersionMod> = Vec::new();

    for (mc_version, forge_versions) in &forge_manifect {
        for forge_version in forge_versions {
            let version = format!("{}-{}", mc_version, forge_version);
            let version_mod = VersionMod {
                url: format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{0}/forge-{0}-installer.jar", version),
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
    let mut library = Vec::new();

    for lib in manifest.libraries {
        let url = if !lib.downloads.artifact.url.is_empty() {
            lib.downloads.artifact.url.clone()
        } else {
            maven_to_url(&lib.name, "https://maven.minecraftforge.net")?
        };
        let new_lib = LibraryMod {
            name: lib.name.clone(),
            url,
            hash: lib.downloads.artifact.sha1,
            size: lib.downloads.artifact.size,
        };
        library.push(new_lib);
    }
    Ok(library)
}
