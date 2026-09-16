use crate::minecraft::{structs::Versions, vanilla::structs::VersionInfo};

pub fn create_manifest_versions(manifest_index: Vec<VersionInfo>) -> Vec<Versions> {
    manifest_index
        .into_iter()
        .map(|version| Versions {
            url: version.url,
            id: version.id,
        })
        .collect()
}
