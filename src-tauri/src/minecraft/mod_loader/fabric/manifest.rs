use crate::minecraft::{
    mod_loader::{
        fabric::structs::{FabricManifest, MainClass},
        utils::maven_to_url,
    },
    structs::{LibraryMod, VersionMod},
};
use crate::utils::errors::LauncherError;
use anyhow::Result;

pub fn transform_fabric_manifest(manifest_fabric: Vec<FabricManifest>) -> Result<Vec<VersionMod>> {
    let mut manifest: Vec<VersionMod> = Vec::new();

    for version in manifest_fabric {
        let mut library: Vec<LibraryMod> = Vec::new();
        let url = "https://maven.fabricmc.net";
        for common in version.launcher_meta.libraries.common {
            let url_maven = maven_to_url(&common.name, url).map_err(|e| {
                LauncherError::LoaderSetup(format!(
                    "Не удалось определить URL библиотеки Fabric: {e:#}"
                ))
            })?;
            let lib = LibraryMod {
                name: common.name,
                path: String::new(),
                url: url_maven,
                hash: common.sha1.unwrap_or("".to_string()),
                size: common.size.unwrap_or(1),
            };
            library.push(lib)
        }
        let url_intermediary = maven_to_url(&version.intermediary.maven, url).map_err(|e| {
            LauncherError::LoaderSetup(format!("Не удалось определить URL intermediary: {e:#}"))
        })?;
        let intermediary = LibraryMod {
            name: version.intermediary.maven,
            path: String::new(),
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
            url: maven_to_url(&version.loader.maven, url).map_err(|e| {
                LauncherError::LoaderSetup(format!(
                    "Не удалось определить URL загрузчика Fabric: {e:#}"
                ))
            })?,
            id: version.loader.version,
            main_class: main_class_client.to_string(),
            library,
        };
        manifest.push(data);
    }
    Ok(manifest)
}

#[cfg(test)]
mod transform_tests {
    use super::transform_fabric_manifest;
    use crate::minecraft::mod_loader::fabric::structs::FabricManifest;
    use serde_json::json;

    fn fabric_manifest_json(main_class: serde_json::Value) -> serde_json::Value {
        json!({
            "loader": {
                "separator": ".", "build": 1, "maven": "net.fabricmc:fabric-loader:0.16.9",
                "version": "0.16.9", "stable": true
            },
            "intermediary": {
                "maven": "net.fabricmc:intermediary:1.20.1", "version": "1.20.1", "stable": true
            },
            "launcherMeta": {
                "version": 1, "minJavaVersion": null,
                "libraries": {
                    "common": [
                        {"name": "org.ow2.asm:asm:9.6", "url": null, "sha1": "hash-asm", "size": 120},
                        {"name": "net.fabricmc:tiny-remapper:0.8.2", "url": null, "md5": "x"}
                    ]
                },
                "mainClass": main_class
            }
        })
    }

    #[test]
    fn transform_builds_versions_with_loader_intermediary_and_common_libraries() {
        let manifest: FabricManifest = serde_json::from_value(fabric_manifest_json(json!(
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        )))
        .expect("парсинг манифеста Fabric");

        let versions = transform_fabric_manifest(vec![manifest]).expect("трансформация");

        assert_eq!(versions.len(), 1);
        let version = &versions[0];
        assert_eq!(version.id, "0.16.9");
        assert_eq!(
            version.main_class,
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        assert_eq!(
            version.url,
            "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"
        );

        assert_eq!(version.library.len(), 3);
        assert_eq!(
            version.library[0].url,
            "https://maven.fabricmc.net/org/ow2/asm/asm/9.6/asm-9.6.jar"
        );
        assert_eq!(version.library[0].hash, "hash-asm");
        assert_eq!(version.library[0].size, 120);
        assert_eq!(
            version.library[1].hash, "",
            "библиотека без sha1 получает пустой хеш"
        );
        assert_eq!(
            version.library[1].size, 1,
            "библиотека без размера получает единицу"
        );
        assert_eq!(
            version.library[2].name, "net.fabricmc:intermediary:1.20.1",
            "intermediary добавляется последней библиотекой"
        );
    }

    #[test]
    fn transform_reads_client_main_class_from_object_form() {
        let manifest: FabricManifest = serde_json::from_value(fabric_manifest_json(json!({
            "client": "cpw.mods.ClientMain",
            "server": "cpw.mods.ServerMain"
        })))
        .expect("парсинг манифеста Fabric");

        let versions = transform_fabric_manifest(vec![manifest]).expect("трансформация");

        assert_eq!(
            versions[0].main_class, "cpw.mods.ClientMain",
            "объектная форма mainClass берёт client"
        );
    }
}
