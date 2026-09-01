use crate::state::launcher_config::LauncherConfig;
use crate::utils::env_info::{default_server_url, normalize_server_url};
use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModLoader {
    #[default]
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub project_name: String,
    pub mc_version: String,
    pub mod_loader: ModLoader,
    pub loader_version: Option<String>,
    pub java_path: Option<String>,
    pub jvm_args: Vec<String>,
    pub min_memory: String,
    pub max_memory: String,
    #[serde(default = "default_true")]
    pub online: bool,
    #[serde(default)]
    pub initialized: bool,

    #[serde(default)]
    pub server_url: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            project_name: String::new(),
            mc_version: String::new(),
            mod_loader: ModLoader::Vanilla,
            loader_version: None,
            java_path: None,
            jvm_args: Vec::new(),
            min_memory: "-Xms512M".to_string(),
            max_memory: "-Xmx4G".to_string(),
            online: true,
            initialized: false,
            server_url: None,
        }
    }
}

impl ProjectConfig {

    pub fn resolved_server_url(&self) -> String {
        match self.server_url.as_deref() {
            Some(url) if !url.trim().is_empty() => normalize_server_url(url),
            _ => default_server_url(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionTokens {
    pub access_token: String,
    pub uuid: String,
    pub username: String,
}

#[derive(Default)]
pub struct GlobalState {
    pub project_config: ProjectConfig,
    pub session: Option<SessionTokens>,
    pub launcher_config: Option<LauncherConfig>,
    pub app_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_config_toml_round_trip_with_server_url() {
        let config = ProjectConfig {
            project_name: "Cordelia".to_string(),
            mc_version: "1.21.1".to_string(),
            mod_loader: ModLoader::NeoForge,
            loader_version: Some("21.1.234".to_string()),
            jvm_args: vec!["-XX:+UseG1GC".to_string()],
            server_url: Some("http://mc.example.com:3000".to_string()),
            ..ProjectConfig::default()
        };

        let toml_string = toml::to_string_pretty(&config).expect("сериализация в TOML");
        let parsed: ProjectConfig = toml::from_str(&toml_string).expect("разбор TOML");

        assert_eq!(parsed.project_name, "Cordelia");
        assert_eq!(parsed.mod_loader, ModLoader::NeoForge);
        assert_eq!(parsed.jvm_args, vec!["-XX:+UseG1GC".to_string()]);
        assert_eq!(parsed.server_url.as_deref(), Some("http://mc.example.com:3000"));
        assert!(parsed.online);
    }

    #[test]
    fn offline_project_config_toml_round_trip() {
        let config = ProjectConfig {
            project_name: "Sandbox".to_string(),
            mc_version: "1.20.4".to_string(),
            mod_loader: ModLoader::Fabric,
            loader_version: Some("0.16.9".to_string()),
            online: false,
            ..ProjectConfig::default()
        };

        let toml_string = toml::to_string_pretty(&config).expect("сериализация в TOML");
        let parsed: ProjectConfig = toml::from_str(&toml_string).expect("разбор TOML");

        assert!(!parsed.online);
        assert_eq!(parsed.server_url, None);
        assert_eq!(parsed.mod_loader, ModLoader::Fabric);
    }

    #[test]
    fn old_config_without_new_fields_stays_online() {
        let toml_string = r#"
projectName = "Cordelia"
mcVersion = "1.21.1"
modLoader = "neoforge"
jvmArgs = []
minMemory = "-Xms512M"
maxMemory = "-Xmx4G"
"#;

        let parsed: ProjectConfig = toml::from_str(toml_string).expect("разбор старого TOML");
        assert!(parsed.online);
        assert!(!parsed.initialized);
        assert_eq!(parsed.server_url, None);
    }

    #[test]
    fn resolved_server_url_prefers_project_value() {
        let config = ProjectConfig {
            server_url: Some("mc.example.com:3000/".to_string()),
            ..ProjectConfig::default()
        };
        assert_eq!(config.resolved_server_url(), "https://mc.example.com:3000");

        let empty = ProjectConfig {
            server_url: Some("   ".to_string()),
            ..ProjectConfig::default()
        };
        assert_eq!(empty.resolved_server_url(), default_server_url());
        assert_eq!(
            ProjectConfig::default().resolved_server_url(),
            default_server_url()
        );
    }
}
