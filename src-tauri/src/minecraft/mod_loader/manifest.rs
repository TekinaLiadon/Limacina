use crate::{
    minecraft::{
        dto::{LibraryMod, VersionMod, Versions},
        mod_loader::{
            dto::{
                fabric::{FabricManifest, MainClass},
                vanilla::{VersionDetailsManifest, VersionInfo},
            },
            utils::maven_to_url,
        },
    },
    utils::{download_file::download_json, env_info::launcher_patch},
};
use ::anyhow::{Context, Result};
use serde::de::DeserializeOwned;

pub async fn get_manifest_index<T: DeserializeOwned>(
    mod_loader: &str,
    url: &str,
    json_name: &str,
) -> Result<T> {
    let json_path = launcher_patch(None)?
        .join("manifest")
        .join(format!("{}_{}.json", mod_loader, json_name));
    let manifest: T = download_json(Some(url), json_path.as_path()).await?;
    Ok(manifest)
}

pub fn create_manifest_versions(manifest_index: Vec<VersionInfo>) -> Result<Vec<Versions>> {
    let mut manifest: Vec<Versions> = Vec::new();

    for version in manifest_index {
        let data = Versions {
            url: version.url,
            id: version.id,
        };
        manifest.push(data);
    }
    Ok(manifest)
}

pub async fn get_manifest_version(
    version: &str,
    manifest: Vec<Versions>,
) -> Result<VersionDetailsManifest> {
    let json_path = launcher_patch(None)?
        .join("manifest")
        .join(format!("{}.json", version));
    let version_url = manifest
        .iter()
        .find(|v| v.id == version)
        .map(|v| v.url.clone())
        .with_context(|| format!("Версия не найдена: {}", version))?;

    let manifest: VersionDetailsManifest =
        download_json(Some(&version_url), json_path.as_path()).await?;
    Ok(manifest)
}

pub fn transform_fabric_manifest(manifest_fabric: Vec<FabricManifest>) -> Vec<VersionMod> {
    let mut manifest: Vec<VersionMod> = Vec::new();

    for version in manifest_fabric {
        let mut library: Vec<LibraryMod> = Vec::new();
        for common in version.launcher_meta.libraries.common {
            let url = maven_to_url(&common.name);
            let lib = LibraryMod {
                name: common.name,
                url,
                hash: common.sha1.unwrap_or("".to_string()),
                size: common.size.unwrap_or(1),
            };
            library.push(lib)
        }
        let url_intermediary = maven_to_url(&version.intermediary.maven);
        let intermediary = LibraryMod {
            name: version.intermediary.maven,
            url: url_intermediary,
            hash: "".to_string(),
            size: 1,
        };
        library.push(intermediary);

        let main_class_client = match &version.launcher_meta.main_class {
            MainClass::AsString(s) => s.as_str(),
            MainClass::AsObject(data) => &data.client,
        };
        let data = VersionMod {
            url: maven_to_url(&version.loader.maven),
            id: version.loader.version,
            main_class: main_class_client.to_string(),
            library,
        };
        manifest.push(data);
    }
    manifest
}
