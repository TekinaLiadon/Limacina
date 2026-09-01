use crate::{state::dto::ProjectConfig, utils::env_info::launcher_patch};
use anyhow::Result;
use tokio::fs::{create_dir_all, read_to_string, write};
use toml::{from_str, to_string_pretty};

impl ProjectConfig {
    pub async fn save_config(&self) -> Result<()> {
        let toml_string = to_string_pretty(self)?;
        let path = launcher_patch(Some("config"))?;
        create_dir_all(&path).await?;
        write(
            path.join(format!("{}.toml", self.project_name)),
            toml_string,
        )
        .await?;
        Ok(())
    }
}

pub async fn load_config(project_name: &str) -> Result<ProjectConfig> {
    let path = launcher_patch(Some("config"))?;
    let content = read_to_string(path.join(format!("{}.toml", project_name))).await?;
    let config: ProjectConfig = from_str(&content)?;
    Ok(config)
}


pub async fn load_config_or_default(project_name: &str) -> ProjectConfig {
    load_config(project_name)
        .await
        .unwrap_or_else(|_| ProjectConfig {
            project_name: project_name.to_string(),
            ..ProjectConfig::default()
        })
}
