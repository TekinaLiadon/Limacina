use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct State {
    pub project_info: ProjectConfig,
}

#[derive(Default, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ModLoader {
    #[default]
    Vanilla,
    Fabric,
    Forge,
}

#[derive(Default, Debug, Deserialize, Serialize, Clone)]
pub struct ProjectConfig {
    pub project_name: String,
    pub mc_version: Option<String>,
    pub mod_loader: Option<ModLoader>,
    pub loader_version: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub jvm_args: Option<Vec<String>>,
    pub game_args: Option<Vec<String>>,
    pub classpath: Option<Vec<String>>,
    pub game_dir: Option<String>,
    pub assets_dir: Option<String>,
    pub libraries_dir: Option<String>,
    pub natives_dir: Option<String>,
    pub main_class: Option<String>,
}
