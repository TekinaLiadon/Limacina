use anyhow::Result;

use crate::minecraft::manifest::{get_manifest_index, VERSION_MANIFEST_URL};
use crate::minecraft::vanilla::structs::VanillaVersionsManifest;
use crate::minecraft::{structs::Versions, vanilla::structs::VersionInfo};

pub async fn load_vanilla_index() -> Result<Vec<Versions>> {
    let manifest_index =
        get_manifest_index::<VanillaVersionsManifest>("vanilla", VERSION_MANIFEST_URL, "index")
            .await?;
    Ok(create_manifest_versions(manifest_index.versions))
}

pub fn create_manifest_versions(manifest_index: Vec<VersionInfo>) -> Vec<Versions> {
    manifest_index
        .into_iter()
        .map(|version| Versions {
            url: version.url,
            id: version.id,
            version_type: version.version_type,
        })
        .collect()
}
