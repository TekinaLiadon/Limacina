use crate::{state::dto::ProjectConfig, utils::env_info::launcher_path};
use anyhow::{Context, Result};
use tokio::fs::{create_dir_all, read_to_string, write};
use toml::{from_str, to_string_pretty};

impl ProjectConfig {
    pub async fn save_config(&self) -> Result<()> {
        let toml_string = to_string_pretty(self)?;
        let path = launcher_path(Some("config"))?;
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
    let path = launcher_path(Some("config"))?;
    let file_path = path.join(format!("{}.toml", project_name));
    let content = read_to_string(&file_path).await?;
    let config: ProjectConfig = from_str(&content)
        .with_context(|| format!("Повреждён конфиг профиля {:?}", file_path))?;
    Ok(config)
}

pub async fn load_config_or_default(project_name: &str) -> Result<ProjectConfig> {
    match load_config(project_name).await {
        Ok(config) => Ok(config),
        Err(e) if is_missing_config(&e) => Ok(ProjectConfig {
            project_name: project_name.to_string(),
            ..ProjectConfig::default()
        }),
        Err(e) => Err(e),
    }
}

fn is_missing_config(e: &anyhow::Error) -> bool {
    e.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound)
    })
}
