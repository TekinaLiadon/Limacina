use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

use crate::log_err;
use crate::state::dto::default_true;
use crate::utils::download_file::write_atomic_sync;
use crate::utils::errors::LauncherError;

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

static RESOLVED_LAUNCHER_PATH: OnceLock<RwLock<PathBuf>> = OnceLock::new();

fn normalize_path(raw: &str) -> PathBuf {
    PathBuf::from(raw.replace('/', std::path::MAIN_SEPARATOR_STR))
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
    #[serde(default)]
    pub auto_update: bool,
    #[serde(default = "default_true")]
    pub system_notifications: bool,
    #[serde(default)]
    pub debug_mode: bool,
    #[serde(default)]
    pub start_with_system: bool,
    #[serde(default)]
    pub close_after_launch: bool,
    #[serde(default)]
    pub minimize_to_tray: bool,

    #[serde(default = "default_theme")]
    pub theme: String,

    #[serde(default = "default_true")]
    pub animations_enabled: bool,

    #[serde(default)]
    pub project_names: Vec<String>,

    #[serde(default)]
    pub current_project: Option<String>,

    #[serde(default)]
    pub projects: HashMap<String, AuthProjectConfig>,

    #[serde(default)]
    pub install_id: Option<String>,
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            launcher_path: String::new(),
            discord_activity: true,
            keep_old_configs: true,
            download_speed_limit: None,
            auto_update: false,
            system_notifications: true,
            debug_mode: false,
            start_with_system: false,
            close_after_launch: false,
            minimize_to_tray: false,
            theme: default_theme(),
            animations_enabled: true,
            project_names: Vec::new(),
            current_project: None,
            projects: HashMap::new(),
            install_id: None,
        }
    }
}

impl LauncherConfig {
    fn config_file_path() -> Result<std::path::PathBuf> {
        let config_dir = dirs::config_dir().ok_or_else(|| {
            anyhow::Error::new(LauncherError::DiskIo(
                "Не удалось определить директорию конфигурации".to_string(),
            ))
        })?;
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

    fn fallback_path() -> PathBuf {
        crate::utils::env_info::get_home_dir()
            .map(|h| h.join(crate::utils::env_info::get_launcher_name()))
            .unwrap_or_default()
    }

    pub fn resolved_launcher_path() -> PathBuf {
        RESOLVED_LAUNCHER_PATH
            .get_or_init(|| {
                let path = Self::load()
                    .ok()
                    .flatten()
                    .filter(|c| !c.launcher_path.trim().is_empty())
                    .map(|c| normalize_path(&c.launcher_path))
                    .unwrap_or_else(Self::fallback_path);
                RwLock::new(path)
            })
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn update_resolved_path(&self) {
        if self.launcher_path.trim().is_empty() {
            return;
        }
        if let Some(cache) = RESOLVED_LAUNCHER_PATH.get() {
            if let Ok(mut guard) = cache.write() {
                *guard = normalize_path(&self.launcher_path);
            }
        }
    }

    pub fn load() -> Result<Option<Self>> {
        let path = Self::config_file_path()?;
        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&path)
            .with_context(|| format!("Не удалось прочитать {:?}", path))?;
        match serde_json::from_str::<LauncherConfig>(&content) {
            Ok(mut config) => {
                if migrate_flattened_projects(&mut config, &content)? {
                    let _ = config.save();
                }
                Ok(Some(config))
            }
            Err(e) => {
                backup_corrupt_config(&path, &anyhow::Error::from(e));
                Ok(None)
            }
        }
    }

    pub(crate) fn config_file_path_public() -> Result<PathBuf> {
        Self::config_file_path()
    }

    pub(crate) fn serialize_for_save(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(|e| {
            anyhow::Error::new(LauncherError::DiskIo(format!(
                "Не удалось сериализовать конфиг: {}",
                e
            )))
        })
    }

    pub(crate) fn write_serialized(path: &Path, content: &str) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        write_atomic_sync(path, content.as_bytes())
    }

    fn data_path_to_remember(&self) -> PathBuf {
        if self.launcher_path.trim().is_empty() {
            Self::fallback_path()
        } else {
            normalize_path(&self.launcher_path)
        }
    }

    pub(crate) fn on_saved_update_path(&self) {
        self.update_resolved_path();
        crate::utils::winreg::remember_data_path(&self.data_path_to_remember());
    }

    #[cfg(test)]
    pub(crate) fn override_resolved_launcher_path_for_tests(path: &Path) {
        let cache = RESOLVED_LAUNCHER_PATH.get_or_init(|| RwLock::new(path.to_path_buf()));
        *cache.write().unwrap_or_else(|e| e.into_inner()) = path.to_path_buf();
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_file_path()?;
        let content = self.serialize_for_save()?;
        Self::write_serialized(&path, &content)?;
        self.on_saved_update_path();
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

    pub fn remove_project(&mut self, project: &str) {
        self.project_names.retain(|p| p != project);
        self.projects.remove(project);
        self.current_project = self.project_names.first().cloned();
    }

    /// Подставляет проект из LAUNCHER_PROJECT_NAME, если список проектов пуст.
    /// Offline-сборки и сборки без переменной остаются без дефолтного проекта.
    pub fn apply_default_project(&mut self) -> bool {
        if !self.project_names.is_empty() || crate::utils::env_info::is_offline_build() {
            return false;
        }
        let default_project = crate::utils::env_info::get_default_project_name();
        if default_project.is_empty() {
            return false;
        }
        self.project_names = vec![default_project.clone()];
        if self.current_project.is_none() {
            self.current_project = Some(default_project);
        }
        true
    }
}

fn backup_corrupt_config(path: &Path, error: &anyhow::Error) {
    let backup_path = path.with_extension("json.bak");
    log_err!(
        "{}: {:?} — {:?} ({})",
        LauncherError::ConfigCorrupt,
        path,
        backup_path,
        error
    );
    let _ = fs::rename(path, &backup_path);
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LegacyLauncherConfig {
    #[serde(flatten)]
    rest: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct LegacyAuthProjectConfig {
    logins: Vec<SavedLogin>,
}

fn migrate_flattened_projects(config: &mut LauncherConfig, content: &str) -> Result<bool> {
    let raw: LegacyLauncherConfig =
        serde_json::from_str(content).context("Неверный формат конфигурации")?;

    let mut migrated = false;
    for (key, value) in raw.rest {
        if key == "projects" {
            continue;
        }
        let Ok(project_config) = serde_json::from_value::<LegacyAuthProjectConfig>(value.clone())
        else {
            continue;
        };
        if project_config.logins.is_empty() {
            continue;
        }
        config.projects.entry(key).or_default().logins = project_config.logins;
        migrated = true;
    }
    Ok(migrated)
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
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&json).unwrap()["projects"]["Cordelia"]
                ["logins"][0]["username"],
            "player"
        );
    }

    #[test]
    fn migration_moves_flattened_logins_into_projects() {
        let legacy = r#"{
            "launcherPath": "/home/user/Limacina",
            "theme": "default-dark",
            "projectNames": ["Cordelia"],
            "Cordelia": { "logins": [{ "username": "player" }] }
        }"#;
        let mut config: LauncherConfig = serde_json::from_str(legacy).expect("разбор старого JSON");

        assert!(config.projects.is_empty());
        assert!(migrate_flattened_projects(&mut config, legacy).expect("миграция"));
        assert_eq!(config.get_logins("Cordelia"), vec!["player".to_string()]);
        assert_eq!(config.theme, "default-dark");

        let json = serde_json::to_string(&config).expect("сериализация в JSON");
        let mut reparsed: LauncherConfig = serde_json::from_str(&json).expect("повторный разбор");
        assert_eq!(reparsed.get_logins("Cordelia"), vec!["player".to_string()]);
        assert!(!migrate_flattened_projects(&mut reparsed, &json).expect("повторная миграция"));
        assert_eq!(reparsed.get_logins("Cordelia"), vec!["player".to_string()]);
    }

    #[test]
    fn migration_skips_non_project_keys() {
        let legacy = r#"{
            "launcherPath": "/home/user/Limacina",
            "theme": "default-dark",
            "currentProject": "Cordelia",
            "projectNames": ["Cordelia"]
        }"#;
        let mut config: LauncherConfig = serde_json::from_str(legacy).expect("разбор старого JSON");

        assert!(!migrate_flattened_projects(&mut config, legacy).expect("миграция"));
        assert!(config.projects.is_empty());
        assert_eq!(config.theme, "default-dark");
    }

    #[test]
    fn old_config_without_current_project_parses() {
        let json = r#"{ "launcherPath": "/home/user/Limacina", "projectNames": ["Cordelia"] }"#;
        let parsed: LauncherConfig = serde_json::from_str(json).expect("разбор старого JSON");

        assert_eq!(parsed.current_project, None);
        assert!(parsed.has_project("Cordelia"));
        assert!(!parsed.auto_update);
    }

    #[test]
    fn old_config_without_install_id_parses_as_none() {
        let json = r#"{ "launcherPath": "/home/user/Limacina", "projectNames": ["Cordelia"] }"#;
        let parsed: LauncherConfig = serde_json::from_str(json).expect("разбор старого JSON");

        assert_eq!(parsed.install_id, None);
    }

    #[test]
    fn install_id_round_trips_as_camel_case_key() {
        let mut config = LauncherConfig {
            launcher_path: "/home/user/Limacina".to_string(),
            ..Default::default()
        };
        config.install_id = Some("v1-0123456789abcdef0123456789abcdef".to_string());

        let json = serde_json::to_string(&config).expect("сериализация в JSON");
        let raw = serde_json::from_str::<serde_json::Value>(&json).unwrap();
        assert_eq!(
            raw["installId"].as_str(),
            Some("v1-0123456789abcdef0123456789abcdef")
        );

        let parsed: LauncherConfig = serde_json::from_str(&json).expect("повторный разбор");
        assert_eq!(
            parsed.install_id.as_deref(),
            Some("v1-0123456789abcdef0123456789abcdef")
        );
    }

    #[test]
    fn add_project_is_idempotent() {
        let mut config = LauncherConfig::default();
        config.add_project("Cordelia");
        config.add_project("Cordelia");

        assert_eq!(config.project_names, vec!["Cordelia"]);
    }

    #[test]
    fn remove_project_switches_current_and_drops_logins() {
        let mut config = LauncherConfig::default();
        config.add_project("Cordelia");
        config.add_login("Cordelia", "player");
        config.add_project("Sandbox");
        config.add_login("Sandbox", "builder");

        config.remove_project("Sandbox");

        assert_eq!(config.project_names, vec!["Cordelia"]);
        assert_eq!(config.current_project.as_deref(), Some("Cordelia"));
        assert!(config.get_logins("Sandbox").is_empty());
        assert_eq!(config.get_logins("Cordelia"), vec!["player".to_string()]);
    }

    #[test]
    fn remove_last_project_clears_current() {
        let mut config = LauncherConfig::default();
        config.add_project("Cordelia");
        config.add_login("Cordelia", "player");

        config.remove_project("Cordelia");

        assert!(config.project_names.is_empty());
        assert_eq!(config.current_project, None);
        assert!(config.get_logins("Cordelia").is_empty());
    }

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn backup_corrupt_config_moves_broken_file_aside() {
        let root = std::env::temp_dir().join(format!(
            "limacina_launcher_config_corrupt_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("создание временной директории");
        let _guard = TempDirGuard(root.clone());

        let path = root.join("config.json");
        fs::write(&path, "not valid json").expect("запись битого конфига");

        backup_corrupt_config(&path, &anyhow::Error::msg("ошибка разбора"));

        assert!(!path.exists(), "битый конфиг должен быть убран с пути");
        assert!(
            root.join("config.json.bak").exists(),
            "битый конфиг должен быть сохранён в бэкап"
        );
    }

    struct ProjectNameEnvGuard {
        original: Option<String>,
    }

    impl ProjectNameEnvGuard {
        fn acquire() -> Self {
            let original = std::env::var("LAUNCHER_PROJECT_NAME").ok();
            std::env::remove_var("LAUNCHER_PROJECT_NAME");
            Self { original }
        }
    }

    impl Drop for ProjectNameEnvGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(value) => std::env::set_var("LAUNCHER_PROJECT_NAME", value),
                None => std::env::remove_var("LAUNCHER_PROJECT_NAME"),
            }
        }
    }

    #[test]
    fn apply_default_project_follows_env_and_existing_state() {
        let _guard = ProjectNameEnvGuard::acquire();

        let mut config = LauncherConfig::default();
        assert!(!config.apply_default_project());
        assert!(config.project_names.is_empty());

        std::env::set_var("LAUNCHER_PROJECT_NAME", "Avelmor");
        assert!(config.apply_default_project());
        assert_eq!(config.project_names, vec!["Avelmor"]);
        assert_eq!(config.current_project.as_deref(), Some("Avelmor"));

        assert!(!config.apply_default_project(), "повторный вызов без эффекта");
        assert_eq!(config.project_names.len(), 1);

        let mut kept = LauncherConfig::default();
        kept.add_project("Her");
        kept.current_project = None;
        assert!(!kept.apply_default_project());
        assert_eq!(kept.project_names, vec!["Her"]);
        assert!(kept.current_project.is_none());
    }

    #[test]
    fn behavior_flags_default_to_disabled() {
        let json = r#"{ "launcherPath": "/home/user/Limacina" }"#;
        let parsed: LauncherConfig = serde_json::from_str(json).expect("разбор JSON");

        assert!(!parsed.debug_mode);
        assert!(!parsed.start_with_system);
        assert!(!parsed.close_after_launch);
        assert!(!parsed.minimize_to_tray);
        assert!(parsed.keep_old_configs);
    }
}
