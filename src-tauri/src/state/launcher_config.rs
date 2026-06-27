use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SavedLogin {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AuthProjectConfig {
    pub logins: Vec<SavedLogin>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LauncherConfig {
    pub launcher_path: String,
    #[serde(flatten)]
    pub projects: HashMap<String, AuthProjectConfig>,
}

impl LauncherConfig {
    fn config_file_path() -> Result<std::path::PathBuf> {
        let launcher_name = crate::utils::env_info::get_launcher_name();
        let home = crate::utils::env_info::get_home_dir()?;
        let primary = home.join(format!(".{}", launcher_name.to_lowercase())).join("config.json");
        if primary.exists() {
            return Ok(primary);
        }
        if let Some(config_dir) = dirs::config_dir() {
            let legacy = config_dir.join(&launcher_name).join("config.json");
            if legacy.exists() {
                return Ok(legacy);
            }
        }
        Ok(primary)
    }

    pub fn load() -> Result<Option<Self>> {
        let path = Self::config_file_path()?;
        if !path.exists() {
            return Ok(None);
        }
        
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Не удалось прочитать {:?}", path))?;
        let config: LauncherConfig = serde_json::from_str(&content)
            .with_context(|| format!("Неверный формат {:?}", path))?;
        Ok(Some(config))
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_file_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        let content = serde_json::to_string_pretty(self)
            .context("Не удалось сериализовать конфиг")?;
        fs::write(&path, content)
            .with_context(|| format!("Не удалось записать {:?}", path))?;
        Ok(())
    }

    pub fn add_login(&mut self, project: &str, username: &str) {
        let project_config = self
            .projects
            .entry(project.to_string())
            .or_default();
        project_config.logins.retain(|l| l.username != username);
        project_config.logins.insert(
            0,
            SavedLogin {
                username: username.to_string(),
            },
        );
    }

    pub fn remove_login(&mut self, project: &str, username: &str) {
        if let Some(project_config) = self.projects.get_mut(project) {
            project_config.logins.retain(|l| l.username != username);
            if project_config.logins.is_empty() {
                self.projects.remove(project);
            }
        }
    }

    pub fn get_first_login(&self, project: &str) -> Option<String> {
        self.projects
            .get(project)
            .and_then(|p| p.logins.first())
            .map(|l| l.username.clone())
    }

    pub fn get_logins(&self, project: &str) -> Vec<String> {
        self.projects
            .get(project)
            .map(|p| p.logins.iter().map(|l| l.username.clone()).collect())
            .unwrap_or_default()
    }
}
