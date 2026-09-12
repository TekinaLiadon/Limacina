use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct VanillaVersionsManifest {
    pub latest: Latest,
    pub versions: Vec<VersionInfo>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionInfo {
    pub id: String,
    pub url: String,

    #[serde(rename = "type", default)]
    pub version_type: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VersionDetailsManifest {
    pub id: String,
    pub downloads: Downloads,
    pub libraries: Vec<Library>,
    #[serde(rename = "assetIndex")]
    pub asset_index: AssetIndex,
    pub assets: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>,
    pub arguments: Option<Arguments>,
    #[serde(rename = "javaVersion")]
    pub java_version: Option<JavaVersionInfo>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JavaVersionInfo {
    pub component: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Downloads {
    pub client: DownloadInfo,
    pub server: Option<DownloadInfo>,
    #[serde(rename = "client_mappings")]
    pub client_mappings: Option<DownloadInfo>,
    #[serde(rename = "server_mappings")]
    pub server_mappings: Option<DownloadInfo>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DownloadInfo {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibDownloads>,
    pub natives: Option<HashMap<String, String>>,
    pub rules: Option<Vec<Rule>>,
    pub extract: Option<ExtractRules>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExtractRules {
    pub exclude: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LibDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Artifact {
    pub path: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssetIndexContent {
    pub objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<ArgumentValue>,
    #[serde(default)]
    pub jvm: Vec<ArgumentValue>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ArgumentValue {
    Simple(String),
    Conditional {
        rules: Vec<Rule>,
        value: StringOrVec,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum StringOrVec {
    Single(String),
    Multiple(Vec<String>),
}
