use ::anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::minecraft::{
    dto::{GameConfig, LaunchConfig, LibraryMod, ModLoader, VersionMod},
    mod_loader::download::{create_mod_config, download_jar, download_libraries, get_mod_manifest},
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricManifest {
    pub loader: Loader,
    pub intermediary: Intermediary,
    pub launcher_meta: LauncherMeta,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loader {
    pub separator: String,
    pub build: i64,
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Intermediary {
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherMeta {
    pub version: i64,
    #[serde(rename = "min_java_version")]
    pub min_java_version: Option<i64>,
    pub libraries: Libraries,
    pub main_class: MainClass,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Libraries {
    pub client: Vec<Value>,
    pub common: Vec<Common>,
    pub server: Vec<Value>,
    pub development: Option<Vec<Common>>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Common {
    pub name: String,
    pub url: Option<String>,
    pub md5: Option<String>,
    pub sha1: Option<String>,
    pub sha256: Option<String>,
    pub sha512: Option<String>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MainClass {
    AsString(String),
    AsObject(MainClassData),
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainClassData {
    pub client: String,
    pub server: String,
}

const MOD_LOADER_NAME: &str = "fabric"; // enum

pub struct Fabric;
#[async_trait]
impl ModLoader for Fabric {
    async fn versions(&self, version: &str) -> Result<Vec<VersionMod>> {
        let url_manifest = format!("https://meta.fabricmc.net/v2/versions/loader/{}", version);
        let manifest_fabric =
            get_mod_manifest::<FabricManifest>(MOD_LOADER_NAME, &url_manifest, version).await?;
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
        Ok(manifest)
    }
    async fn setup(&self, manifest: &VersionMod) -> Result<()> {
        download_jar(&manifest.id, &manifest.url).await?;
        download_libraries(manifest.library.clone()).await?;
        // скачать мод

        Ok(())
    }
    async fn config(
        &self,
        config: &LaunchConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        let main_class = version.main_class.clone();
        let game_config = create_mod_config(
            vanilla_config,
            &config.loader_version,
            &version.library,
            main_class,
        )
        .await?;
        Ok(game_config)
    }
}

fn maven_to_url(coord: &str) -> String {
    let parts: Vec<&str> = coord.split(':').collect();
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    format!(
        "https://maven.fabricmc.net/{}/{}/{}/{}-{}.jar",
        group, artifact, version, artifact, version
    )
}
