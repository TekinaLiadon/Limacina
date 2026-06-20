use ::anyhow::Result;

use crate::minecraft::{structs::Versions, vanilla::structs::VersionInfo};

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
