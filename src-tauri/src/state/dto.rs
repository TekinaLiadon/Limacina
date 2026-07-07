use crate::minecraft::structs::ModLoader as ProjectModLoader;
use crate::state::launcher_config::LauncherConfig;
use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ModLoader {
    #[default]
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
}

#[derive(Default, Debug, Deserialize, Serialize, Clone)]
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
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone)]
pub struct SessionTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub uuid: String,
    pub username: String,
}

#[derive(Default)]
pub struct GlobalState {
    pub project_config: ProjectConfig,
    pub loader: Option<Box<dyn ProjectModLoader>>,
    pub session: Option<SessionTokens>,
    pub launcher_config: Option<LauncherConfig>,
    pub app_version: String,
}
