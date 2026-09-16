use std::path::PathBuf;

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::{state::dto::ProjectConfig, utils::env_info::launcher_path};

#[derive(Debug, Deserialize, Serialize)]
pub struct Versions {
    pub url: String,
    pub id: String,
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
    pub window_width: u32,
    pub window_height: u32,
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

pub async fn new_launch_config(
    username: &str,
    uuid: &str,
    access_token: &str,
    state_project: &ProjectConfig,
) -> Result<LaunchConfig> {
    let base_dir = launcher_path(Some(&state_project.project_name))
        .context("Не удалось определить путь к файлам проекта")?;
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
        window_width: 1280,
        window_height: 720,
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
    ) -> Result<VersionMod>;
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
