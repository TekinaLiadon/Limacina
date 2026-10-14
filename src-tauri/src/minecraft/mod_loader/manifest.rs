use crate::utils::errors::LauncherError;
use anyhow::Result;
use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::{
    log_err,
    minecraft::{
        mod_loader::{
            config::{build_loader_config, LoaderConfigOptions, VanillaClientJar},
            installer::setup_loader,
            utils::maven_to_url,
        },
        rules::is_json_rules_allowed,
        structs::{GameConfig, LibraryMod, ModLoader, VersionMod},
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
    } else {
        return Err(LauncherError::LoaderSetup(format!(
            "В списке версий лоадера нет записи {target_id}, манифест {prefix}_{version} не применён"
        ))
        .into());
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

pub fn loader_libraries(libraries: Vec<Library>, maven_base: &str) -> Result<Vec<LibraryMod>> {
    let mut result = Vec::new();
    for lib in libraries {
        let name = lib.name;
        let artifact = lib.downloads.artifact;
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

pub(crate) async fn loader_index(def: &LoaderDef) -> Result<LoaderIndex> {
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

#[derive(Clone, Copy)]
pub(crate) struct InstallerLoader {
    pub def: &'static LoaderDef,
    pub client_jar: VanillaClientJar,
}

#[async_trait]
impl ModLoader for InstallerLoader {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        versions_with_installed(self.def, state).await
    }

    async fn latest_version(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String> {
        latest_list_version(versions, &state.mc_version, self.def.name)
    }

    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader(
            self.def.name,
            self.def.manifest_prefix,
            state,
            manifest,
            self.def.maven_base,
        )
        .await
    }

    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        build_loader_config(
            self.def,
            state,
            vanilla_config,
            version,
            LoaderConfigOptions {
                vanilla_client_jar: self.client_jar,
            },
        )
        .await
    }
}

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
    use super::loader_libraries;
    use super::{Artifact, Downloads, Library};
    use crate::minecraft::mod_loader::neoforge::manifest::NEOFORGE_MAVEN_BASE;

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
            NEOFORGE_MAVEN_BASE,
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
            NEOFORGE_MAVEN_BASE,
        )
        .expect("библиотеки лоадера");

        assert_eq!(
            mods[0].url,
            "https://maven.neoforged.net/releases/net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar",
            "fallback-URL строится от продовой базы с /releases, иначе maven отдаёт 404"
        );
    }
}

#[cfg(test)]
mod loader_manifest_path_tests {
    use super::loader_manifest_path;

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
    use crate::minecraft::mod_loader::forge::manifest::{FORGE_MANIFEST_PREFIX, FORGE_MAVEN_BASE};
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;

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
    async fn modify_loader_manifest_errors_on_missing_target_entry() {
        let _guard = LauncherDirGuard::acquire("loader_manifest_skip").await;
        seed_loader_manifest("47.2.0", "cpw.mods.bootstraplauncher.BootstrapLauncher").await;

        let mut manifest = vec![version_mod("1.20.1-47.1.3")];
        let error = modify_loader_manifest(
            FORGE_MANIFEST_PREFIX,
            "47.2.0",
            FORGE_MAVEN_BASE,
            &mut manifest,
        )
        .await
        .expect_err("ненайденный target_id должен давать явную ошибку, а не silent-skip");

        assert!(
            error.to_string().contains("нет записи 1.20.1-47.2.0"),
            "ошибка должна называть отсутствующую запись: {error}"
        );
        assert!(
            manifest[0].main_class.is_empty(),
            "чужая запись не должна затрагиваться"
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
