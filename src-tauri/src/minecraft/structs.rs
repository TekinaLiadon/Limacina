use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::minecraft::mod_loader::manifest::current_loader_version;
use crate::state::dto::ProjectConfig;
use crate::utils::env_info::launcher_path;
use crate::utils::errors::LauncherError;

#[derive(Debug, Deserialize, Serialize)]
pub struct Versions {
    pub url: String,
    pub id: String,
    #[serde(default)]
    pub version_type: String,
}

#[derive(Debug, Clone)]
pub struct LaunchConfig {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub mc_version: String,
    pub game_dir: PathBuf,
    pub assets_dir: PathBuf,
    pub libraries_dir: PathBuf,
    pub natives_dir: PathBuf,
    pub jvm_sub_arg: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GameConfig {
    pub java_path: PathBuf,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
    pub classpath: Vec<String>,
    pub main_class: String,
    pub game_dir: PathBuf,
}

impl GameConfig {
    pub fn new(
        java_path: PathBuf,
        jvm_args: Vec<String>,
        game_args: Vec<String>,
        classpath: Vec<String>,
        main_class: String,
        game_dir: PathBuf,
    ) -> Self {
        Self {
            java_path,
            jvm_args,
            game_args,
            classpath,
            main_class,
            game_dir,
        }
    }

    pub fn with_args(mut self, jvm_args: Vec<String>, game_args: Vec<String>) -> Self {
        self.jvm_args = jvm_args;
        self.game_args = game_args;
        self
    }

    pub fn with_loader(mut self, classpath: Vec<String>, main_class: String) -> Self {
        self.classpath = classpath;
        self.main_class = main_class;
        self
    }
}

pub fn new_launch_config(
    username: &str,
    uuid: &str,
    access_token: &str,
    state_project: &ProjectConfig,
) -> Result<LaunchConfig> {
    let base_dir = launcher_path(Some(&state_project.project_name)).map_err(|e| {
        LauncherError::GameDownload(format!(
            "Не удалось определить путь к файлам проекта: {e:#}"
        ))
    })?;
    let mut jvm_sub_arg = vec![
        state_project.min_memory.clone(),
        state_project.max_memory.clone(),
    ];
    jvm_sub_arg.extend(
        state_project
            .jvm_args
            .iter()
            .filter(|arg| !arg.is_empty())
            .cloned(),
    );

    Ok(LaunchConfig {
        username: username.to_string(),
        uuid: uuid.to_string(),
        access_token: access_token.to_string(),
        mc_version: state_project.mc_version.clone(),
        game_dir: base_dir.clone(),
        assets_dir: base_dir.join("assets"),
        libraries_dir: base_dir.join("libraries"),
        natives_dir: base_dir.join("natives"),
        jvm_sub_arg,
    })
}

#[async_trait]
pub trait MinecraftLoader {
    async fn versions(&self) -> Result<Vec<Versions>>;
    async fn setup(&self, state: &ProjectConfig) -> Result<()>;
    async fn config(&self, state: &ProjectConfig, config: &LaunchConfig) -> Result<GameConfig>;
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionMod {
    pub url: String,
    pub id: String,
    pub main_class: String,
    pub library: Vec<LibraryMod>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMod {
    pub name: String,
    #[serde(default)]
    pub path: String,
    pub url: String,
    pub hash: String,
    pub size: i64,
}

#[async_trait]
pub trait ModLoader: Send + Sync {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>>;
    async fn version_current(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<VersionMod> {
        current_loader_version(state, versions)
    }
    async fn latest_version(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String>;
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()>;
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig>;
}

pub const INDEX_CACHE_FILES: [&str; 4] = [
    "vanilla_index.json",
    "forge.json",
    "neoforge_index.json",
    "neoforge.json",
];

pub const INDEX_CACHE_PREFIXES: [&str; 1] = ["fabric_"];

#[cfg(test)]
mod launch_config_tests {
    use super::*;
    use crate::test_support::LauncherDirGuard;

    fn project() -> ProjectConfig {
        ProjectConfig {
            project_name: "Cordelia".to_string(),
            mc_version: "1.20.1".to_string(),
            min_memory: "-Xms512M".to_string(),
            max_memory: "-Xmx4G".to_string(),
            jvm_args: vec!["-XX:+UseG1GC".to_string(), String::new()],
            ..ProjectConfig::default()
        }
    }

    #[tokio::test]
    async fn new_launch_config_builds_dirs_and_filters_empty_jvm_args() {
        let guard = LauncherDirGuard::acquire("launch_config_dirs").await;
        let state = project();

        let config =
            new_launch_config("Steve", "uuid-1", "token-1", &state).expect("конфиг запуска");

        let base = guard.project_dir("Cordelia");
        assert_eq!(config.username, "Steve");
        assert_eq!(config.uuid, "uuid-1");
        assert_eq!(config.access_token, "token-1");
        assert_eq!(config.mc_version, "1.20.1");
        assert_eq!(config.game_dir, base);
        assert_eq!(config.assets_dir, base.join("assets"));
        assert_eq!(config.libraries_dir, base.join("libraries"));
        assert_eq!(config.natives_dir, base.join("natives"));
        assert_eq!(
            config.jvm_sub_arg,
            vec![
                "-Xms512M".to_string(),
                "-Xmx4G".to_string(),
                "-XX:+UseG1GC".to_string()
            ],
            "пустые пользовательские аргументы отфильтровываются"
        );
    }

    #[test]
    fn game_config_builder_replaces_only_own_fields() {
        let config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xmx1G".to_string()],
            vec!["--game".to_string()],
            vec!["a.jar".to_string()],
            "net.minecraft.client.main.Main".to_string(),
            PathBuf::from("game"),
        );

        let with_args = config.with_args(vec!["-Xmx2G".to_string()], vec!["--server".to_string()]);
        assert_eq!(with_args.jvm_args, vec!["-Xmx2G".to_string()]);
        assert_eq!(with_args.game_args, vec!["--server".to_string()]);
        assert_eq!(
            with_args.classpath,
            vec!["a.jar".to_string()],
            "with_args не должен трогать classpath"
        );
        assert_eq!(
            with_args.main_class, "net.minecraft.client.main.Main",
            "with_args не должен трогать main_class"
        );

        let config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xmx1G".to_string()],
            vec!["--game".to_string()],
            vec!["a.jar".to_string()],
            "net.minecraft.client.main.Main".to_string(),
            PathBuf::from("game"),
        );
        let with_loader = config.with_loader(vec!["b.jar".to_string()], "cpw.mods.App".to_string());
        assert_eq!(with_loader.classpath, vec!["b.jar".to_string()]);
        assert_eq!(with_loader.main_class, "cpw.mods.App");
        assert_eq!(
            with_loader.jvm_args,
            vec!["-Xmx1G".to_string()],
            "with_loader не должен трогать аргументы"
        );
    }
}
