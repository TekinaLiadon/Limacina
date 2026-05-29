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
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub project_name: String,
    pub mc_version: String,
    pub mod_loader: ModLoader,
    pub loader_version: Option<String>,
    pub jvm_args: Vec<String>,
    pub min_memory: String,
    pub max_memory: String,
}
