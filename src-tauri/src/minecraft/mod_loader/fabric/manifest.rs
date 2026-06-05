use crate::minecraft::{
    dto::{LibraryMod, VersionMod},
    mod_loader::{
        fabric::dto::{FabricManifest, MainClass},
        utils::maven_to_url,
    },
};

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
