use std::collections::HashMap;

use ::anyhow::Result;
use tokio::fs;

use crate::{
    minecraft::{
        structs::{LibraryMod, VersionMod},
        mod_loader::{
            neoforge::structs::{Manifest, Metadata},
            utils::maven_to_url,
        },
    },
    utils::{
        download_file::{download_json, download_xml},
        env_info::launcher_patch,
    },
};

pub async fn get_manifest_index() -> Result<HashMap<String, Vec<String>>> {
    let json_path = launcher_patch(None)?.join("manifest").join("neoforge.json");
    if json_path.exists() {
        let file = fs::read_to_string(&json_path).await?;
        let json: HashMap<String, Vec<String>> = serde_json::from_str(&file)?;
        return Ok(json);
    }

    let url = "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
    let metadata = download_xml::<Metadata>(&url).await?;
    let mut grouped_versions: HashMap<String, Vec<String>> = HashMap::new();

    for v in metadata.versioning.versions.version_list {
        let parts: Vec<&str> = v.split('.').collect();
        if parts.len() < 2 {
            continue;
        }
        let major: u32 = match parts[0].parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let minor: u32 = match parts[1].parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let mc_version = format!("1.{}.{}", major, minor);
        grouped_versions
            .entry(mc_version)
            .or_default()
            .push(v.to_string());
    }

    let json = serde_json::to_string_pretty(&grouped_versions)?;
    if let Some(parent) = json_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(json_path, &json).await?;

    Ok(grouped_versions)
}

pub fn transform_neoforge_manifest(neoforge_manifest: HashMap<String, Vec<String>>) -> Vec<VersionMod> {
    let mut manifest: Vec<VersionMod> = Vec::new();

    for (mc_version, neoforge_versions) in &neoforge_manifest {
        for neoforge_version in neoforge_versions {
            let version_id = format!("{}-{}", mc_version, neoforge_version);
            let version_mod = VersionMod {
                url: format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{0}/neoforge-{0}-installer.jar", neoforge_version),
                id: version_id.clone(),
                main_class: "".to_string(),
                library: Vec::new(),
            };

            manifest.push(version_mod);
        }
    }
    manifest
}

pub async fn modify_manifest(version: &str, manifest: &mut Vec<VersionMod>) -> Result<()> {
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
    let mut library = Vec::new();

    for lib in manifest.libraries {
        let url = if !lib.downloads.artifact.url.is_empty() {
            lib.downloads.artifact.url.clone()
        } else {
            maven_to_url(&lib.name, "https://maven.neoforged.net")
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
