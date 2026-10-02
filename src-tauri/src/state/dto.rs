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

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProfile {
    pub version: String,
    pub asset_index: String,
    pub dir_name: String,
    pub asset_dir: String,
    pub sort_index: u32,
    pub server_address: String,
    pub server_port: u16,
    pub jvm_version: String,
    pub update_fast_check: bool,
    pub update: Vec<String>,
    pub update_verify: Vec<String>,
    pub update_exclusions: Vec<String>,
    pub main_class: String,
    pub class_path: Vec<String>,
    pub jvm_args: Vec<String>,
    pub client_args: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub project_name: String,
    pub mc_version: String,
    pub mod_loader: ModLoader,
    pub loader_version: Option<String>,
    pub java_path: Option<String>,
    #[serde(default)]
    pub java_version: Option<u32>,
    pub jvm_args: Vec<String>,
    pub min_memory: String,
    pub max_memory: String,
    #[serde(default = "default_true")]
    pub online: bool,
    #[serde(default)]
    pub initialized: bool,

    #[serde(default)]
    pub server_url: Option<String>,

    #[serde(default)]
    pub auto_join_server: bool,

    #[serde(default)]
    pub legacy: bool,
    #[serde(default)]
    pub legacy_profile: Option<LegacyProfile>,
}

pub(crate) fn default_true() -> bool {
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
            java_version: None,
            jvm_args: Vec::new(),
            min_memory: "-Xms512M".to_string(),
            max_memory: "-Xmx4G".to_string(),
            online: true,
            initialized: false,
            server_url: None,
            auto_join_server: false,
            legacy: false,
            legacy_profile: None,
        }
    }
}

impl ProjectConfig {
    pub fn resolved_server_url(&self) -> Option<String> {
        match self.server_url.as_deref() {
            Some(url) if !url.trim().is_empty() => Some(normalize_server_url(url)),
            _ => default_server_url(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionTokens {
    pub access_token: String,
    pub uuid: String,
    pub username: String,
    pub project_name: String,
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
            java_version: Some(21),
            jvm_args: vec!["-XX:+UseG1GC".to_string()],
            server_url: Some("http://mc.example.com:3000".to_string()),
            ..ProjectConfig::default()
        };

        let toml_string = toml::to_string_pretty(&config).expect("сериализация в TOML");
        let parsed: ProjectConfig = toml::from_str(&toml_string).expect("разбор TOML");

        assert_eq!(parsed.project_name, "Cordelia");
        assert_eq!(parsed.mod_loader, ModLoader::NeoForge);
        assert_eq!(parsed.java_version, Some(21));
        assert_eq!(parsed.jvm_args, vec!["-XX:+UseG1GC".to_string()]);
        assert_eq!(
            parsed.server_url.as_deref(),
            Some("http://mc.example.com:3000")
        );
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
    fn project_config_toml_round_trip_with_auto_join_server() {
        let config = ProjectConfig {
            project_name: "Cordelia".to_string(),
            mc_version: "1.21.1".to_string(),
            auto_join_server: true,
            ..ProjectConfig::default()
        };

        let toml_string = toml::to_string_pretty(&config).expect("сериализация в TOML");
        assert!(toml_string.contains("autoJoinServer = true"));
        let parsed: ProjectConfig = toml::from_str(&toml_string).expect("разбор TOML");
        assert!(parsed.auto_join_server);
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
        assert_eq!(parsed.java_version, None);
        assert_eq!(parsed.server_url, None);
        assert!(!parsed.legacy);
        assert_eq!(parsed.legacy_profile, None);
    }

    #[test]
    fn legacy_project_config_toml_round_trip() {
        let config = ProjectConfig {
            project_name: "StargazerPrologue".to_string(),
            mc_version: "1.16.5".to_string(),
            server_url: Some("https://launcher.ariadna.su".to_string()),
            legacy: true,
            legacy_profile: Some(LegacyProfile {
                version: "1.16.5".to_string(),
                asset_index: "1.16.5".to_string(),
                dir_name: "StargazerPrologue".to_string(),
                asset_dir: "asset1.16.5".to_string(),
                sort_index: 0,
                server_address: "nonames.su".to_string(),
                server_port: 25545,
                jvm_version: "graalvm-11".to_string(),
                update_fast_check: true,
                update: vec!["servers\\.dat".to_string()],
                update_verify: vec!["libraries".to_string()],
                update_exclusions: vec!["openloader/.cache".to_string()],
                main_class: "cpw.mods.modlauncher.Launcher".to_string(),
                class_path: vec!["forge.jar".to_string(), "minecraft.jar".to_string()],
                jvm_args: vec!["-XX:+UseG1GC".to_string()],
                client_args: vec!["--launchTarget".to_string(), "fmlclient".to_string()],
            }),
            ..ProjectConfig::default()
        };

        let toml_string = toml::to_string_pretty(&config).expect("сериализация в TOML");
        let parsed: ProjectConfig = toml::from_str(&toml_string).expect("разбор TOML");

        assert!(parsed.legacy);
        let profile = parsed.legacy_profile.expect("легаси-профиль");
        assert_eq!(profile.dir_name, "StargazerPrologue");
        assert_eq!(profile.server_port, 25545);
        assert_eq!(profile.class_path.len(), 2);
        assert!(toml_string.contains("legacy = true"));
    }

    #[test]
    fn resolved_server_url_prefers_project_value() {
        let config = ProjectConfig {
            server_url: Some("mc.example.com:3000/".to_string()),
            ..ProjectConfig::default()
        };
        assert_eq!(
            config.resolved_server_url().as_deref(),
            Some("https://mc.example.com:3000")
        );

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
