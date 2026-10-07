use crate::utils::errors::LauncherError;
use anyhow::Result;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
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
        download_file::{download_json, download_xml, write_atomic},
        env_info::{ensure_safe_relative_path, launcher_path},
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
    #[serde(rename = "minecraftArguments", default)]
    pub minecraft_arguments: Option<String>,
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
            path: self.downloads.artifact.path,
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

pub fn loader_manifest_path(prefix: &str, version: &str) -> Result<PathBuf> {
    ensure_safe_relative_path(version, "версии лоадера")?;
    Ok(launcher_path(None)?
        .join("manifest")
        .join(format!("{prefix}_{version}.json")))
}

pub async fn modify_loader_manifest(
    prefix: &str,
    version: &str,
    maven_base: &str,
    manifest: &mut [VersionMod],
) -> Result<()> {
    let manifest_path = loader_manifest_path(prefix, version)?;
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
        let manifest_path = loader_manifest_path(prefix, version)?;
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
    let serialized = serialize(&index)?;
    write_atomic(json_path, serialized.as_bytes())
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
            path: artifact.path,
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
    pub path: String,
    pub url: String,
    pub sha1: String,
    pub size: i64,
}

pub type LoaderIndex = BTreeMap<String, Vec<String>>;

pub(crate) struct LoaderDef {
    pub name: &'static str,
    pub metadata_url: &'static str,
    pub cache_file: &'static str,
    pub maven_base: &'static str,
    pub manifest_prefix: &'static str,
    pub group_versions: fn(Metadata) -> LoaderIndex,
    pub installer_url: fn(&str, &str) -> String,
}

async fn loader_index(def: &LoaderDef) -> Result<LoaderIndex> {
    get_loader_index(def.cache_file, def.metadata_url, def.group_versions)
        .await
        .map_err(|e| {
            LauncherError::LoaderSetup(format!("Не удалось получить индекс {}: {e:#}", def.name))
                .into()
        })
}

pub(crate) async fn versions_with_installed(
    def: &LoaderDef,
    state: &ProjectConfig,
) -> Result<Vec<VersionMod>> {
    let mut manifest = transform_loader_manifest(loader_index(def).await?, def.installer_url);
    apply_installed_manifest(state, def.manifest_prefix, def.maven_base, &mut manifest)
        .await
        .map_err(|e| {
            LauncherError::LoaderSetup(format!(
                "Не удалось применить установленный манифест {}: {e:#}",
                def.name
            ))
        })?;
    Ok(manifest)
}

pub(crate) async fn forge_manifest_index() -> Result<LoaderIndex> {
    loader_index(&FORGE).await
}

pub(crate) async fn neoforge_manifest_index() -> Result<LoaderIndex> {
    loader_index(&NEOFORGE).await
}

const FORGE_METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const FORGE_CACHE_FILE: &str = "forge.json";

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

const NEOFORGE_METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const NEOFORGE_CACHE_FILE: &str = "neoforge_index.json";
pub(crate) const NEOFORGE_MAVEN_BASE: &str = "https://maven.neoforged.net";
pub(crate) const NEOFORGE_MANIFEST_PREFIX: &str = "neoforge";

fn group_neoforge_versions(metadata: Metadata) -> LoaderIndex {
    let mut grouped_versions: LoaderIndex = BTreeMap::new();

    for v in metadata.versioning.versions.version_list {
        let parts: Vec<&str> = v.split('.').collect();
        if parts.len() < 2 {
            continue;
        }
        let (Ok(major), Ok(minor)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) else {
            continue;
        };
        let mc_version = neoforge_mc_version(major, minor);
        grouped_versions
            .entry(mc_version)
            .or_default()
            .push(v.to_string());
    }

    grouped_versions
}

fn neoforge_mc_version(major: u32, minor: u32) -> String {
    if minor == 0 {
        format!("1.{major}")
    } else {
        format!("1.{major}.{minor}")
    }
}

fn neoforge_installer_url(_mc_version: &str, v: &str) -> String {
    format!("{NEOFORGE_MAVEN_BASE}/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar")
}

pub(crate) static NEOFORGE: LoaderDef = LoaderDef {
    name: "NeoForge",
    metadata_url: NEOFORGE_METADATA_URL,
    cache_file: NEOFORGE_CACHE_FILE,
    maven_base: NEOFORGE_MAVEN_BASE,
    manifest_prefix: NEOFORGE_MANIFEST_PREFIX,
    group_versions: group_neoforge_versions,
    installer_url: neoforge_installer_url,
};

#[cfg(test)]
mod latest_version_tests {
    use super::*;

    pub(super) fn version_mod(id: &str) -> VersionMod {
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

    #[test]
    fn transform_loader_manifest_orders_versions_deterministically() {
        let mut index = LoaderIndex::new();
        index.insert("1.20.1".to_string(), vec!["47.1.0".to_string()]);
        index.insert("1.7.10".to_string(), vec!["10.13.4".to_string()]);
        index.insert("1.21".to_string(), vec!["21.0.143".to_string()]);

        let first: Vec<String> = transform_loader_manifest(index.clone(), |id, _| id.to_string())
            .into_iter()
            .map(|v| v.id)
            .collect();
        let second: Vec<String> = transform_loader_manifest(index, |id, _| id.to_string())
            .into_iter()
            .map(|v| v.id)
            .collect();

        assert_eq!(first, second);
        assert_eq!(
            first,
            vec![
                "1.20.1-47.1.0".to_string(),
                "1.21-21.0.143".to_string(),
                "1.7.10-10.13.4".to_string()
            ]
        );
    }
}

#[cfg(test)]
mod loader_libraries_tests {
    use super::{loader_libraries, Artifact, Downloads, Library};

    fn library(name: &str, path: &str, url: &str) -> Library {
        Library {
            name: name.to_string(),
            downloads: Downloads {
                artifact: Artifact {
                    path: path.to_string(),
                    url: url.to_string(),
                    sha1: "hash-1".to_string(),
                    size: 1,
                },
            },
        }
    }

    #[test]
    fn libraries_keep_manifest_path_and_hash() {
        let mods = loader_libraries(
            vec![library(
                "org.ow2.asm:asm-util:9.7@jar",
                "org/ow2/asm/asm-util/9.7/asm-util-9.7.jar",
                "",
            )],
            "https://maven.neoforged.net/release",
        )
        .expect("библиотеки лоадера");

        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].path, "org/ow2/asm/asm-util/9.7/asm-util-9.7.jar");
        assert_eq!(mods[0].hash, "hash-1");
    }

    #[test]
    fn libraries_build_classifier_aware_fallback_url() {
        let mods = loader_libraries(
            vec![library("net.neoforged:mergetool:2.0.3:api@jar", "", "")],
            "https://maven.neoforged.net/release",
        )
        .expect("библиотеки лоадера");

        assert_eq!(
            mods[0].url,
            "https://maven.neoforged.net/release/net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar"
        );
    }
}

#[cfg(test)]
mod neoforge_index_tests {
    use super::*;
    use crate::state::dto::ProjectConfig as ConfigProject;
    use crate::test_support::LauncherDirGuard;
    use mockito::Server;

    fn metadata(versions: &[&str]) -> Metadata {
        let latest = versions
            .last()
            .map(|v| (*v).to_string())
            .unwrap_or_default();
        Metadata {
            versioning: Versioning {
                latest: latest.clone(),
                release: latest,
                versions: VersionList {
                    version_list: versions.iter().map(|v| (*v).to_string()).collect(),
                },
            },
        }
    }

    #[test]
    fn groups_patch_zero_under_short_mc_version_key() {
        let index =
            group_neoforge_versions(metadata(&["21.0.0-beta", "21.0.143", "21.1.1", "20.6.121"]));

        assert_eq!(
            index.get("1.21").map(Vec::as_slice),
            Some(&["21.0.0-beta".to_string(), "21.0.143".to_string()][..])
        );
        assert_eq!(
            index.get("1.21.1").map(Vec::as_slice),
            Some(&["21.1.1".to_string()][..])
        );
        assert_eq!(
            index.get("1.20.6").map(Vec::as_slice),
            Some(&["20.6.121".to_string()][..])
        );
        assert!(!index.contains_key("1.21.0"));
    }

    #[test]
    fn skips_non_numeric_loader_versions() {
        let index = group_neoforge_versions(metadata(&["0.25w14craftmine.3-beta", "21.0.1-beta"]));

        assert_eq!(index.len(), 1);
        assert!(index.contains_key("1.21"));
    }

    #[tokio::test]
    async fn real_metadata_fixture_groups_1_21_under_short_key() {
        let dir = LauncherDirGuard::acquire("neoforge_index").await;
        let mut server = Server::new_async().await;
        let body = concat!(
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            "<metadata><groupId>net.neoforged</groupId><artifactId>neoforge</artifactId>",
            "<versioning><latest>21.1.1</latest><release>21.1.1</release><versions>",
            "<version>20.6.121</version><version>21.0.0-beta</version><version>21.0.143</version>",
            "<version>21.1.1</version>",
            "</versions></versioning></metadata>"
        );
        server
            .mock("GET", "/maven-metadata.xml")
            .with_status(200)
            .with_header("content-type", "application/xml")
            .with_body(body)
            .create_async()
            .await;

        let index = get_loader_index(
            NEOFORGE_CACHE_FILE,
            &format!("{}/maven-metadata.xml", server.url()),
            group_neoforge_versions,
        )
        .await
        .expect("индекс NeoForge");

        let cached = std::fs::read_to_string(dir.root().join("manifest").join(NEOFORGE_CACHE_FILE))
            .expect("кэш индекса");
        assert!(cached.contains("\"1.21\""));
        assert!(!cached.contains("\"1.21.0\""));

        assert!(index
            .get("1.21")
            .map(Vec::as_slice)
            .is_some_and(|v| v.contains(&"21.0.143".to_string())));

        let manifest = transform_loader_manifest(index, neoforge_installer_url);
        let state = ConfigProject {
            mc_version: "1.21".to_string(),
            loader_version: Some("21.0.143".to_string()),
            ..ConfigProject::default()
        };
        let resolved = current_loader_version(&state, &manifest).expect("версия найдена");
        assert_eq!(resolved.id, "1.21-21.0.143");
    }

    #[test]
    fn loader_manifest_path_rejects_traversal_version() {
        let error = loader_manifest_path("forge", "../../evil")
            .expect_err("версия лоадера с обходом пути должна быть отклонена");
        assert!(
            error
                .to_string()
                .contains("Некорректное значение версии лоадера"),
            "ошибка должна объяснять проблему: {error}"
        );
        assert!(loader_manifest_path("forge", "..\\evil").is_err());
    }

    #[test]
    fn loader_manifest_path_accepts_normal_version() {
        let path = loader_manifest_path("forge", "47.2.0").expect("валидная версия лоадера");
        assert!(path
            .to_string_lossy()
            .ends_with("manifest/forge_47.2.0.json"));
    }
}

#[cfg(test)]
mod loader_manifest_apply_tests {
    use super::latest_version_tests::version_mod;
    use super::*;
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;

    fn forge_metadata(versions: &[&str]) -> Metadata {
        let latest = versions
            .last()
            .map(|v| (*v).to_string())
            .unwrap_or_default();
        Metadata {
            versioning: Versioning {
                latest: latest.clone(),
                release: latest,
                versions: VersionList {
                    version_list: versions.iter().map(|v| (*v).to_string()).collect(),
                },
            },
        }
    }

    #[test]
    fn group_forge_versions_groups_by_mc_and_skips_unsuffixed() {
        let index = group_forge_versions(forge_metadata(&[
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

    async fn seed_loader_manifest(version: &str, main_class: &str) {
        let path = loader_manifest_path(FORGE_MANIFEST_PREFIX, version).expect("путь манифеста");
        let json = serde_json::json!({
            "id": format!("1.20.1-forge-{version}"),
            "time": "2023-01-01T00:00:00Z",
            "releaseTime": "2023-01-01T00:00:00Z",
            "type": "release",
            "mainClass": main_class,
            "inheritsFrom": "1.20.1",
            "libraries": []
        });
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(&path, json.to_string())
            .await
            .expect("запись манифеста лоадера");
    }

    fn forge_state(loader_version: Option<&str>) -> ProjectConfig {
        ProjectConfig {
            mc_version: "1.20.1".to_string(),
            loader_version: loader_version.map(str::to_string),
            ..ProjectConfig::default()
        }
    }

    #[tokio::test]
    async fn modify_loader_manifest_updates_only_matching_entry() {
        let _guard = LauncherDirGuard::acquire("loader_manifest_modify").await;
        seed_loader_manifest("47.2.0", "cpw.mods.bootstraplauncher.BootstrapLauncher").await;

        let mut manifest = vec![version_mod("1.20.1-47.2.0"), version_mod("1.20.1-47.1.3")];
        modify_loader_manifest(
            FORGE_MANIFEST_PREFIX,
            "47.2.0",
            FORGE_MAVEN_BASE,
            &mut manifest,
        )
        .await
        .expect("применение манифеста лоадера");

        assert_eq!(
            manifest[0].main_class, "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "совпадающая запись получает main_class из манифеста"
        );
        assert!(
            manifest[1].main_class.is_empty(),
            "чужая запись не должна затрагиваться"
        );
    }

    #[tokio::test]
    async fn modify_loader_manifest_silently_skips_missing_target_entry() {
        let _guard = LauncherDirGuard::acquire("loader_manifest_skip").await;
        seed_loader_manifest("47.2.0", "cpw.mods.bootstraplauncher.BootstrapLauncher").await;

        let mut manifest = vec![version_mod("1.20.1-47.1.3")];
        modify_loader_manifest(
            FORGE_MANIFEST_PREFIX,
            "47.2.0",
            FORGE_MAVEN_BASE,
            &mut manifest,
        )
        .await
        .expect("отсутствие целевой записи не должно быть ошибкой");

        assert!(
            manifest[0].main_class.is_empty(),
            "silent-skip: манифест остаётся без изменений"
        );
    }

    #[tokio::test]
    async fn apply_installed_manifest_requires_cached_manifest_file() {
        let _guard = LauncherDirGuard::acquire("loader_manifest_apply").await;

        let mut untouched = vec![version_mod("1.20.1-47.2.0")];
        apply_installed_manifest(
            &forge_state(None),
            FORGE_MANIFEST_PREFIX,
            FORGE_MAVEN_BASE,
            &mut untouched,
        )
        .await
        .expect("без выбранной версии лоадера — no-op");
        assert!(untouched[0].main_class.is_empty());

        let mut missing = vec![version_mod("1.20.1-47.2.0")];
        apply_installed_manifest(
            &forge_state(Some("99.0.0")),
            FORGE_MANIFEST_PREFIX,
            FORGE_MAVEN_BASE,
            &mut missing,
        )
        .await
        .expect("незакэшированный манифест — тихий пропуск");
        assert!(missing[0].main_class.is_empty());

        seed_loader_manifest("47.2.0", "cpw.mods.bootstraplauncher.BootstrapLauncher").await;
        let mut present = vec![version_mod("1.20.1-47.2.0")];
        apply_installed_manifest(
            &forge_state(Some("47.2.0")),
            FORGE_MANIFEST_PREFIX,
            FORGE_MAVEN_BASE,
            &mut present,
        )
        .await
        .expect("закэшированный манифест применяется");
        assert_eq!(
            present[0].main_class,
            "cpw.mods.bootstraplauncher.BootstrapLauncher"
        );
    }
}
