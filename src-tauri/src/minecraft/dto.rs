use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::utils::env_info::launcher_patch;

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

#[derive(Debug, Deserialize, Serialize)]
pub struct GameConfig {
    pub java_path: PathBuf,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
    pub classpath: String,
    pub main_class: String,
    pub game_dir: PathBuf,
}

pub async fn new_launch_config(
    username: String,
    uuid: String,
    access_token: String,
    mc_version: String,
) -> Result<LaunchConfig> {
    let base_dir = launcher_patch()?;

    Ok(LaunchConfig {
        username,
        uuid,
        access_token,
        mc_version: mc_version.clone(),
        loader_version: mc_version.clone(),
        game_dir: base_dir.clone(),
        assets_dir: base_dir.join("assets").join(&mc_version),
        libraries_dir: base_dir.join("libraries").join(&mc_version),
        natives_dir: base_dir.join("natives").join(&mc_version),
        min_memory: "512M".to_string(),
        max_memory: "4G".to_string(),
        window_width: 1280,
        window_height: 720,
    })
}

#[async_trait]
pub trait ModLoader {
    async fn versions(&self) -> Result<Vec<Versions>>;
    async fn setup(&self, version: &str, index: Vec<Versions>) -> Result<()>;
    async fn config(&self, config: &LaunchConfig) -> Result<GameConfig>;
}
