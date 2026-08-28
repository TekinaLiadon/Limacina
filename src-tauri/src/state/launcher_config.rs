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

fn default_theme() -> String {
    "default-dark".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LauncherConfig {
    pub launcher_path: String,

    #[serde(default = "default_true")]
    pub discord_activity: bool,
    #[serde(default = "default_true")]
    pub keep_old_configs: bool,
    #[serde(default)]
    pub download_speed_limit: Option<u64>,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default = "default_true")]
    pub system_notifications: bool,
    #[serde(default = "default_true")]
    pub debug_mode: bool,
    #[serde(default = "default_true")]
    pub start_with_system: bool,
    #[serde(default = "default_true")]
    pub close_after_launch: bool,

    #[serde(default = "default_theme")]
    pub theme: String,

    #[serde(default)]
    pub project_names: Vec<String>,

    #[serde(flatten)]
    pub projects: HashMap<String, AuthProjectConfig>,
}

fn default_true() -> bool {
    true
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            launcher_path: String::new(),
            discord_activity: true,
            keep_old_configs: true,
            download_speed_limit: None,
            auto_update: true,
            system_notifications: true,
            debug_mode: true,
            start_with_system: true,
            close_after_launch: true,
            theme: default_theme(),
            project_names: Vec::new(),
            projects: HashMap::new(),
        }
    }
}

impl LauncherConfig {
    fn config_file_path() -> Result<std::path::PathBuf> {
        let config_dir =
            dirs::config_dir().context("Не удалось определить директорию конфигурации")?;
        let launcher_name = crate::utils::env_info::get_launcher_name();
        let primary = config_dir.join(&launcher_name).join("config.json");
        if primary.exists() {
            return Ok(primary);
        }
        let fallback = config_dir
            .join(launcher_name.to_lowercase())
            .join("config.json");
        if fallback.exists() {
            return Ok(fallback);
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

        let content =
            serde_json::to_string_pretty(self).context("Не удалось сериализовать конфиг")?;
        fs::write(&path, content).with_context(|| format!("Не удалось записать {:?}", path))?;
        Ok(())
    }

    pub fn add_login(&mut self, project: &str, username: &str) {
        let project_config = self.projects.entry(project.to_string()).or_default();
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
