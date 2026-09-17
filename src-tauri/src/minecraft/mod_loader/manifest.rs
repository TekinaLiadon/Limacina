use crate::utils::errors::LauncherError;
use anyhow::Result;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

use crate::{
    log_err,
    minecraft::{
        mod_loader::utils::maven_to_url,
        rules::is_json_rules_allowed,
        structs::{LibraryMod, VersionMod},
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
pub struct Logging {}

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

pub fn loader_version_or_err(state: &ProjectConfig) -> Result<&str> {
    state
        .loader_version
        .as_deref()
        .ok_or(LauncherError::LoaderNotSelected.into())
}

pub fn current_loader_version(
    state: &ProjectConfig,
    versions: &[VersionMod],
) -> Result<VersionMod> {
    let version = loader_version_or_err(state)?;
    let target_id = format!("{}-{}", state.mc_version, version);

    versions
        .iter()
        .find(|m| m.id == target_id)
        .cloned()
        .ok_or_else(|| LauncherError::LoaderSetup("Версия не найдена".to_string()).into())
}

pub fn transform_loader_manifest(
    index: LoaderIndex,
    installer_url: impl Fn(&str, &str) -> String,
) -> Vec<VersionMod> {
    let mut manifest: Vec<VersionMod> = Vec::new();

    for (mc_version, loader_versions) in &index {
        for loader_version in loader_versions {
            let id = format!("{}-{}", mc_version, loader_version);
            let version_mod = VersionMod {
                url: installer_url(&id, loader_version),
                id,
                main_class: "".to_string(),
                library: Vec::new(),
            };

            manifest.push(version_mod);
        }
    }
    manifest
}

pub fn latest_list_version(
    versions: &[VersionMod],
    mc_version: &str,
    loader_name: &str,
) -> Result<String> {
    let prefix = format!("{}-", mc_version);
    versions
        .iter()
        .filter_map(|v| v.id.strip_prefix(&prefix))
        .max_by(|a, b| compare_versions(a, b))
        .map(str::to_string)
        .ok_or_else(|| {
            LauncherError::LoaderSetup(format!("Нет версий {loader_name} для MC {mc_version}"))
                .into()
        })
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
        fs::create_dir_all(parent).await.map_err(|e| {
            LauncherError::DiskIo(format!("Не удалось создать директорию {parent:?}: {e:#}"))
        })?;
    }
    fs::write(json_path, serialize(&index)?)
        .await
        .map_err(|e| {
            LauncherError::DiskIo(format!("Не удалось записать кэш {json_path:?}: {e:#}"))
        })?;

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

#[cfg(test)]
mod latest_version_tests {
    use super::*;

    fn version_mod(id: &str) -> VersionMod {
        VersionMod {
            url: String::new(),
            id: id.to_string(),
            main_class: String::new(),
            library: Vec::new(),
        }
    }

    #[test]
    fn latest_list_version_picks_max_for_mc_version() {
        let versions = vec![
            version_mod("1.20.1-47.1.0"),
            version_mod("1.20.1-47.2.0"),
            version_mod("1.20.4-49.0.0"),
        ];

        let latest = latest_list_version(&versions, "1.20.1", "Forge").expect("последняя версия");

        assert_eq!(latest, "47.2.0");
    }

    #[test]
    fn latest_list_version_errors_when_mc_version_missing() {
        let versions = vec![version_mod("1.20.1-47.1.0")];

        let result = latest_list_version(&versions, "1.19.4", "Forge");

        assert!(result.is_err());
    }
}
