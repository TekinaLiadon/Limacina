use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

use crate::{
    log_err,
    minecraft::{
        rules::is_json_rules_allowed,
        structs::{LibraryMod, VersionMod},
        mod_loader::utils::maven_to_url,
    },
    state::dto::ProjectConfig,
    utils::{
        compare_versions,
        download_file::{download_json, download_xml},
        env_info::launcher_path,
    },
};

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub time: String,
    pub release_time: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub main_class: String,
    #[serde(default)]
    pub inherits_from: String,
    #[serde(default)]
    pub logging: Logging,
    #[serde(default)]
    pub arguments: Arguments,
    pub libraries: Vec<Library>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Logging {
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<Value>,
    #[serde(default)]
    pub jvm: Vec<Value>,
}

impl Arguments {
    pub fn game_strings(&self) -> Vec<String> {
        extract_value_strings(&self.game)
    }

    pub fn jvm_strings(&self) -> Vec<String> {
        extract_value_strings(&self.jvm)
    }
}

fn extract_value_strings(values: &[Value]) -> Vec<String> {
    let mut result = Vec::new();
    for v in values {
        match v {
            Value::String(s) => result.push(s.clone()),
            Value::Object(obj) => {
                if let Some(rules) = obj.get("rules").and_then(|r| r.as_array()) {
                    if !is_json_rules_allowed(rules) {
                        continue;
                    }
                }
                if let Some(value) = obj.get("value") {
                    match value {
                        Value::String(s) => result.push(s.clone()),
                        Value::Array(arr) => {
                            for item in arr {
                                if let Value::String(s) = item {
                                    result.push(s.clone());
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    result
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub name: String,
    pub downloads: Downloads,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloads {
    pub artifact: Artifact,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub path: String,
    pub url: String,
    pub sha1: String,
    pub size: i64,
}

impl LoaderLibrary for Library {
    fn name(&self) -> String {
        self.name.clone()
    }

    fn into_artifact(self) -> LoaderArtifact {
        LoaderArtifact {
            url: self.downloads.artifact.url,
            sha1: self.downloads.artifact.sha1,
            size: self.downloads.artifact.size,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Metadata {
    pub versioning: Versioning,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Versioning {
    pub latest: String,
    pub release: String,
    pub versions: VersionList,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VersionList {
    #[serde(rename = "version")]
    pub version_list: Vec<String>,
}

pub async fn get_loader_index(
    cache_file: &str,
    metadata_url: &str,
    group_versions: fn(Metadata) -> LoaderIndex,
) -> Result<LoaderIndex> {
    let json_path = launcher_path(None)?.join("manifest").join(cache_file);
    read_or_fetch_index(
        &json_path,
        || async {
            let metadata = download_xml::<Metadata>(metadata_url).await?;
            Ok(group_versions(metadata))
        },
        |index| Ok(serde_json::to_string_pretty(index)?),
    )
    .await
}

pub async fn modify_loader_manifest(
    prefix: &str,
    version: &str,
    maven_base: &str,
    manifest: &mut [VersionMod],
) -> Result<()> {
    let manifest_path = launcher_path(None)?
        .join("manifest")
        .join(format!("{}_{}.json", prefix, version));
    let version_manifest = download_json::<Manifest>(None, &manifest_path).await?;
    let main_class = version_manifest.main_class.clone();
    let target_id = format!("{}-{}", version_manifest.inherits_from.clone(), version);
    let library = loader_libraries(version_manifest.libraries, maven_base)?;

    if let Some(mod_item) = manifest.iter_mut().find(|m| m.id == target_id) {
        mod_item.main_class = main_class;
        mod_item.library = library;
    }
    Ok(())
}

pub async fn apply_installed_manifest(
    state: &ProjectConfig,
    prefix: &str,
    maven_base: &str,
    manifest: &mut [VersionMod],
) -> Result<()> {
    if let Some(version) = state.loader_version.as_deref() {
        let manifest_path = launcher_path(None)?
            .join("manifest")
            .join(format!("{}_{}.json", prefix, version));
        if manifest_path.exists() {
            modify_loader_manifest(prefix, version, maven_base, manifest).await?;
        }
    }
    Ok(())
}

pub fn current_loader_version(
    state: &ProjectConfig,
    versions: Vec<VersionMod>,
) -> Result<VersionMod> {
    let version = state
        .loader_version
        .as_deref()
        .ok_or_else(|| anyhow!("Лоадер не выбран"))?;
    let target_id = format!("{}-{}", state.mc_version, version);

    versions
        .into_iter()
        .find(|m| m.id == target_id)
        .ok_or_else(|| anyhow!("Версия не найдена"))
}

pub fn latest_index_version(
    index: &LoaderIndex,
    mc_version: &str,
    loader_name: &str,
) -> Result<String> {
    let versions = index
        .get(mc_version)
        .ok_or_else(|| anyhow!("Нет версий {} для MC {}", loader_name, mc_version))?;
    let latest = versions
        .iter()
        .max_by(|a, b| compare_versions(a, b))
        .ok_or_else(|| anyhow!("Нет доступных версий {}", loader_name))?;
    Ok(latest.to_string())
}

pub async fn read_or_fetch_index<T: DeserializeOwned>(
    json_path: &Path,
    rebuild: impl AsyncFnOnce() -> Result<T>,
    serialize: impl FnOnce(&T) -> Result<String>,
) -> Result<T> {
    if json_path.exists() {
        if let Ok(content) = fs::read_to_string(json_path).await {
            match serde_json::from_str::<T>(&content) {
                Ok(index) => return Ok(index),
                Err(e) => {
                    log_err!("Кэш {:?} повреждён ({}), перекачивание", json_path, e);
                }
            }
        }
        let _ = fs::remove_file(json_path).await;
    }

    let index = rebuild().await?;

    if let Some(parent) = json_path.parent() {
        fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать директорию {:?}", parent))?;
    }
    fs::write(json_path, serialize(&index)?)
        .await
        .with_context(|| format!("Не удалось записать кэш {:?}", json_path))?;

    Ok(index)
}

pub fn loader_libraries<L: LoaderLibrary>(
    libraries: Vec<L>,
    maven_base: &str,
) -> Result<Vec<LibraryMod>> {
    let mut result = Vec::new();
    for lib in libraries {
        let name = lib.name();
        let artifact = lib.into_artifact();
        let url = if !artifact.url.is_empty() {
            artifact.url
        } else {
            maven_to_url(&name, maven_base)?
        };
        result.push(LibraryMod {
            name,
            url,
            hash: artifact.sha1,
            size: artifact.size,
        });
    }
    Ok(result)
}

pub trait LoaderLibrary {
    fn name(&self) -> String;
    fn into_artifact(self) -> LoaderArtifact;
}

pub struct LoaderArtifact {
    pub url: String,
    pub sha1: String,
    pub size: i64,
}

pub type LoaderIndex = HashMap<String, Vec<String>>;
