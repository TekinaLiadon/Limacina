use std::collections::BTreeMap;

use crate::minecraft::mod_loader::manifest::{LoaderDef, LoaderIndex, Metadata};

const FORGE_METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const FORGE_CACHE_FILE: &str = "forge.json";

pub(crate) const FORGE_MAVEN_BASE: &str = "https://maven.minecraftforge.net";
pub(crate) const FORGE_MANIFEST_PREFIX: &str = "forge";

pub(crate) static FORGE: LoaderDef = LoaderDef {
    name: "Forge",
    metadata_url: FORGE_METADATA_URL,
    cache_file: FORGE_CACHE_FILE,
    maven_base: FORGE_MAVEN_BASE,
    manifest_prefix: FORGE_MANIFEST_PREFIX,
    group_versions: group_forge_versions,
    installer_url: forge_installer_url,
};

fn group_forge_versions(metadata: Metadata) -> LoaderIndex {
    let mut grouped_versions: LoaderIndex = BTreeMap::new();

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

fn forge_installer_url(v: &str, _loader_version: &str) -> String {
    format!("{FORGE_MAVEN_BASE}/net/minecraftforge/forge/{v}/forge-{v}-installer.jar")
}

#[cfg(test)]
mod tests {
    use super::group_forge_versions;
    use crate::test_support::loader_metadata;

    #[test]
    fn group_forge_versions_groups_by_mc_and_skips_unsuffixed() {
        let index = group_forge_versions(loader_metadata(&[
            "1.20.1-47.2.0",
            "1.20.1-47.1.3",
            "1.19.4-45.0.0",
            "bogus",
        ]));

        assert_eq!(
            index.get("1.20.1").map(Vec::as_slice),
            Some(&["47.2.0".to_string(), "47.1.3".to_string()][..])
        );
        assert_eq!(
            index.get("1.19.4").map(Vec::as_slice),
            Some(&["45.0.0".to_string()][..])
        );
        assert_eq!(index.len(), 2, "версия без суффикса mc пропускается");
    }
}
