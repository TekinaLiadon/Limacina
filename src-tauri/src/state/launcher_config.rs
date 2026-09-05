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
    #[serde(default)]
    pub debug_mode: bool,
    #[serde(default)]
    pub start_with_system: bool,
    #[serde(default)]
    pub close_after_launch: bool,

    #[serde(default = "default_theme")]
    pub theme: String,

    #[serde(default = "default_true")]
    pub animations_enabled: bool,

    #[serde(default)]
    pub project_names: Vec<String>,


    #[serde(default)]
    pub current_project: Option<String>,

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
            debug_mode: false,
            start_with_system: false,
            close_after_launch: false,
            theme: default_theme(),
            animations_enabled: true,
            project_names: Vec::new(),
            current_project: None,
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

    pub fn has_project(&self, project: &str) -> bool {
        self.project_names.iter().any(|p| p == project)
    }


    pub fn add_project(&mut self, project: &str) {
        if !self.has_project(project) {
            self.project_names.push(project.to_string());
        }
        self.current_project = Some(project.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_project_survives_json_round_trip_with_flattened_logins() {
        let mut config = LauncherConfig {
            launcher_path: "/home/user/Limacina".to_string(),
            ..Default::default()
        };
        config.add_login("Cordelia", "player");
        config.add_project("Cordelia");
        config.add_project("Sandbox");

        let json = serde_json::to_string(&config).expect("сериализация в JSON");
        let parsed: LauncherConfig = serde_json::from_str(&json).expect("разбор JSON");

        assert_eq!(parsed.project_names, vec!["Cordelia", "Sandbox"]);
        assert_eq!(parsed.current_project.as_deref(), Some("Sandbox"));
        assert_eq!(parsed.get_logins("Cordelia"), vec!["player".to_string()]);
    }

    #[test]
    fn old_config_without_current_project_parses() {
        let json = r#"{ "launcherPath": "/home/user/Limacina", "projectNames": ["Cordelia"] }"#;
        let parsed: LauncherConfig = serde_json::from_str(json).expect("разбор старого JSON");

        assert_eq!(parsed.current_project, None);
        assert!(parsed.has_project("Cordelia"));
        assert!(parsed.auto_update);
    }

    #[test]
    fn add_project_is_idempotent() {
        let mut config = LauncherConfig::default();
        config.add_project("Cordelia");
        config.add_project("Cordelia");

        assert_eq!(config.project_names, vec!["Cordelia"]);
    }

    #[test]
    fn behavior_flags_default_to_disabled() {
        let json = r#"{ "launcherPath": "/home/user/Limacina" }"#;
        let parsed: LauncherConfig = serde_json::from_str(json).expect("разбор JSON");

        assert!(!parsed.debug_mode);
        assert!(!parsed.start_with_system);
        assert!(!parsed.close_after_launch);
        assert!(parsed.keep_old_configs);
    }
}
