use crate::minecraft::fabric::download::get_fabric_version;
use crate::utils::download_file::download_file;
use crate::utils::env_info::launcher_patch;
use crate::{ log_info};
use anyhow::{Result};
use serde::{Deserialize, Serialize};

use super::download::download_fabric_libraries;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricProfile {
    pub id: String,
    pub time: String,
    pub release_time: String,
    #[serde(rename = "type")]
    pub profile_type: String,
    pub main_class: String,
    pub java_version: Option<JavaVersion>,
    pub arguments: Option<Arguments>,
    pub minimum_launcher_version: Option<i32>,
    pub inherits_from: Option<String>,
    pub asset_index: Option<AssetIndexFabric>,
    pub assets: Option<String>,
    pub downloads: Option<DownloadsFabric>,
    pub libraries: Vec<LibraryFabric>,
    pub logging: Option<Logging>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LibraryFabric {
    pub name: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<i64>,
    pub md5: Option<String>,
    pub sha256: Option<String>,
    pub sha512: Option<String>,

    pub extract: Option<Extract>,
    pub natives: Option<std::collections::HashMap<String, String>>,
    pub rules: Option<Vec<Rule>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JavaVersion {
    pub component: String,
    pub major_version: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Arguments {
    pub game: Vec<String>,
    pub jvm: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Rule {
    pub action: String,
    pub os: Option<RuleOs>,
    pub features: std::collections::HashMap<String, bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuleOs {
    pub name: Option<String>,
    pub version: Option<String>,
    pub arch: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssetIndexFabric {
    pub id: String,
    pub sha1: String,
    pub size: i64,
    pub url: String,
    pub total_size: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DownloadsFabric {
    pub client: DownloadLink,
    pub server: DownloadLink,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DownloadLink {
    pub sha1: String,
    pub size: i64,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Extract {
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Logging {
    pub client: Option<LoggingEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingEntry {
    pub argument: String,
    pub file: LoggingFile,
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingFile {
    pub id: String,
    pub sha1: String,
    pub size: i64,
    pub url: String,
}

#[tauri::command]
pub async fn get_fabric(mc_version: String) -> Result<String, String> {
    let loader_ver = get_fabric_version(&mc_version).await?;
    let version_id = format!("fabric-loader-{}-{}", loader_ver, mc_version);
    log_info!("Выбрана версия загрузчика: {}", loader_ver);

    let base_path = launcher_patch()?;
    let version_dir = base_path.join("fabric").join(&version_id);
    tokio::fs::create_dir_all(&version_dir).await.map_err(|e| {
        format!(
            "Ошибка создания директории {}: {}",
            version_dir.display(),
            e
        )
    })?;

    let json_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        mc_version, loader_ver
    );
    log_info!("Скачиваем: {}", json_url);
    let json_dest = version_dir.join(format!("{}.json", version_id));
    download_file(&json_url, &json_dest)
        .await
        .map_err(|e| format!("Не удалось скачать JSON профиль: {}", e))?;

    let jar_url = format!(
        "https://maven.fabricmc.net/net/fabricmc/fabric-loader/{}/fabric-loader-{}.jar",
        loader_ver, loader_ver
    );
    log_info!("Скачиваем: {}", jar_url);
    let jar_dest = version_dir.join(format!("{}.jar", version_id));
    download_file(&jar_url, &jar_dest)
        .await
        .map_err(|e| format!("Не удалось скачать JAR файл загрузчика: {}", e))?;
    log_info!("Fabric Loader успешно скачан!");

    let libraries_path = base_path.join("libraries");
    log_info!("Fabric: {}", json_dest.display());
    download_fabric_libraries(&json_dest, &libraries_path)
        .await
        .map_err(|e| format!("Не удалось скачать библиотеки: {}", e))?;

    Ok(format!(
        "Fabric {} для Minecraft {} успешно установлен!",
        loader_ver, mc_version
    ))
}
