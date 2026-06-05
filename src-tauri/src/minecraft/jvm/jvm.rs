use anyhow::{anyhow, Result};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{collections::HashMap, path::PathBuf};
use tauri::AppHandle;
use tokio::fs;

use serde::{Deserialize, Serialize};

use crate::{
    launcher_server::downloader::DownloadError,
    minecraft::jvm::{forge::forge_start, utils::generate_offline_uuid},
    utils::{env_info::launcher_patch, tauri_err::CommandResult},
};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    #[serde(default)]
    pub id: String,

    #[serde(default)]
    pub inherits_from: Option<String>,

    #[serde(rename = "mainClass", default)]
    pub main_class: String,

    #[serde(default)]
    pub libraries: Vec<Library>,

    #[serde(default)]
    pub arguments: Option<Arguments>,

    #[serde(default)]
    pub minecraft_arguments: Option<String>,

    #[serde(default)]
    pub asset_index: Option<AssetIndex>,

    #[serde(default)]
    pub assets: Option<String>,

    #[serde(rename = "type", default)]
    pub version_type: Option<String>,

    #[serde(default)]
    pub time: Option<String>,

    #[serde(default)]
    pub release_time: Option<String>,

    #[serde(default)]
    pub minimum_launcher_version: Option<i32>,

    #[serde(default)]
    pub compliance_level: Option<i32>,

    #[serde(default)]
    pub java_version: Option<JavaVersion>,

    #[serde(default)]
    pub logging: Option<serde_json::Value>,

    #[serde(default)]
    pub downloads: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JavaVersion {
    pub component: Option<String>,
    #[serde(rename = "majorVersion")]
    pub major_version: Option<i32>,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Rule {
    pub action: String,
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OsRule {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Library {
    pub name: String,

    #[serde(default)]
    pub downloads: Option<Downloads>,

    #[serde(default)]
    pub rules: Option<Vec<Rule>>,

    #[serde(default)]
    pub natives: Option<HashMap<String, String>>,

    // Для Forge
    #[serde(default)]
    pub url: Option<String>,

    #[serde(default)]
    pub checksums: Option<Vec<String>>,

    #[serde(default)]
    pub serverreq: Option<bool>,

    #[serde(default)]
    pub clientreq: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Downloads {
    #[serde(default)]
    pub artifact: Option<Artifact>,

    #[serde(default)]
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Artifact {
    pub path: String,

    #[serde(default)]
    pub sha1: Option<String>,

    #[serde(default)]
    pub size: Option<u64>,

    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssetIndex {
    pub id: String,

    #[serde(default)]
    pub sha1: Option<String>,

    #[serde(default)]
    pub size: Option<u64>,

    #[serde(default)]
    pub total_size: Option<u64>,

    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LaunchConfig {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub mc_version: String,
    pub loader_version: String,
    pub game_dir: PathBuf,
    pub assets_dir: PathBuf,
    pub libraries_dir: PathBuf,
    pub natives_dir: PathBuf,
    pub min_memory: String,
    pub max_memory: String,
    pub window_width: u32,
    pub window_height: u32,
}

#[derive(Clone, serde::Serialize)]
pub struct ConsolePayload {
    pub line: String,
    pub is_error: bool,
}

impl LaunchConfig {
    pub async fn new(
        username: String,
        uuid: String,
        access_token: String,
        mc_version: String,
        loader_version: String,
    ) -> Result<Self> {
        let raw_base_dir =
            launcher_patch(Some("libra")).map_err(|e| DownloadError::SystemError(e.to_string()))?;
        let base_dir = dunce::canonicalize(&raw_base_dir).unwrap_or(raw_base_dir);

        let natives_dir = base_dir.join("natives").join(&mc_version);

        if !base_dir.exists() {
            fs::create_dir_all(&base_dir).await?;
        }
        fs::create_dir_all(&natives_dir).await?;

        Ok(Self {
            username,
            uuid,
            access_token,
            mc_version: mc_version.clone(),
            loader_version,
            game_dir: base_dir.clone(),
            assets_dir: base_dir.join("assets"),
            libraries_dir: base_dir.join("libraries"),
            natives_dir,
            min_memory: "512M".to_string(),
            max_memory: "4G".to_string(),
            window_width: 1280,
            window_height: 720,
        })
    }
}

#[tauri::command]
pub async fn start_jvm(
    app: AppHandle,
    username: String,
    access_token: String,
    type_minecraft: String,
    mc_version: Option<String>,
) -> CommandResult<String> {
    let version = mc_version.unwrap_or_else(|| "1.16.5".to_string());
    let uuid = generate_offline_uuid(&username);

    match type_minecraft.as_str() {
        "forge" => {
            forge_start(app, username, uuid, access_token, version).await?;
            Ok("Forge запущен успешно".to_string())
        }
        _ => Err(anyhow!("Неизвестный тип: {}", type_minecraft))?,
    }
}
