use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::{state::dto::ProjectConfig, utils::env_info::launcher_patch};

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
    pub loader_version: Option<String>,
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

pub async fn new_launch_config(
    username: &String,
    uuid: &String,
    access_token: &String,
    state_project: &ProjectConfig,
) -> Result<LaunchConfig> {
    let base_dir = launcher_patch(Some(&state_project.project_name))?;
    let mut jvm_sub_arg = Vec::<String>::new();
    jvm_sub_arg.push(state_project.min_memory.clone());
    jvm_sub_arg.push(state_project.max_memory.clone());

    //min_memory: "512M".to_string(),
    //max_memory: "4G".to_string(),
    // jvm_args.push(format!("-Xms{}", &config.min_memory));
    // jvm_args.push(format!("-Xmx{}", &config.max_memory));
    Ok(LaunchConfig {
        username: username.clone(),
        uuid: uuid.clone(),
        access_token: access_token.clone(),
        mc_version: state_project.mc_version.clone(),
        loader_version: state_project.loader_version.clone(),
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
    async fn version_current(&self, state: &ProjectConfig) -> Result<VersionMod>;
    async fn latest_version(&self, state: &ProjectConfig) -> Result<String>;
    async fn setup(&self, state: &ProjectConfig, manifest: &Vec<VersionMod>) -> Result<()>;
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig>;
}
