use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::utils::env_info::launcher_patch;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedLogin {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AuthProjectConfig {
    pub logins: Vec<SavedLogin>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AuthConfig {
    #[serde(flatten)]
    pub projects: std::collections::HashMap<String, AuthProjectConfig>,
}

fn config_path() -> Result<PathBuf> {
    let base = launcher_patch(None)?;
    Ok(base.join("auth.json"))
}

pub fn load_config() -> Result<AuthConfig> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AuthConfig::default());
    }
    
    let content = fs::read_to_string(&path)
        .with_context(|| format!("Не удалось прочитать {:?}", path))?;
    let config: AuthConfig =
        serde_json::from_str(&content).with_context(|| format!("Неверный формат {:?}", path))?;
    Ok(config)
}

pub fn save_config(config: &AuthConfig) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    
    let content =
        serde_json::to_string_pretty(config).context("Не удалось сериализовать конфиг")?;
    fs::write(&path, content)
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

pub fn add_login(project: &str, username: &str) -> Result<()> {
    let mut config = load_config()?;
    let project_config = config
        .projects
        .entry(project.to_string())
        .or_insert_with(AuthProjectConfig::default);

    project_config.logins.retain(|l| l.username != username);
    project_config
        .logins
        .insert(0, SavedLogin {
            username: username.to_string(),
        });

    save_config(&config)
}

pub fn remove_login(project: &str, username: &str) -> Result<()> {
    let mut config = load_config()?;
    if let Some(project_config) = config.projects.get_mut(project) {
        project_config.logins.retain(|l| l.username != username);
        if project_config.logins.is_empty() {
            config.projects.remove(project);
        }
        save_config(&config)?;
    }
    Ok(())
}

pub fn get_first_login(project: &str) -> Result<Option<String>> {
    let config = load_config()?;
    Ok(config
        .projects
        .get(project)
        .and_then(|p| p.logins.first())
        .map(|l| l.username.clone()))
}
