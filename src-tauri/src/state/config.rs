use crate::{state::dto::ProjectConfig, utils::env_info::launcher_patch};
use ::anyhow::Result;
use tokio::fs::{read_to_string, write};
use toml::{from_str, to_string_pretty};

impl ProjectConfig {
    pub async fn save_config(&self) -> Result<()> {
        let toml_string = to_string_pretty(self)?;
        write(format!("{}.toml", self.project_name), toml_string).await?;
        Ok(())
    }
    pub async fn update_config(&mut self, new: ProjectConfig) -> Result<()> {
        self.mc_version = new.mc_version;
        self.mod_loader = new.mod_loader;
        self.loader_version = new.loader_version;
        if let Some(v) = new.username {
            self.username = Some(v);
        }
        if let Some(v) = new.jvm_args {
            self.jvm_args = Some(v);
        }
        if let Some(v) = new.game_dir {
            self.game_dir = Some(v);
        }
        if let Some(v) = new.assets_dir {
            self.assets_dir = Some(v);
        }
        if let Some(v) = new.libraries_dir {
            self.libraries_dir = Some(v);
        }
        if let Some(v) = new.natives_dir {
            self.natives_dir = Some(v);
        }
        self.save_config().await?;
        Ok(())
    }
}

pub async fn load_config(project_name: &str) -> Result<ProjectConfig> {
    let content = read_to_string(format!("{}.toml", project_name)).await?;
    let config: ProjectConfig = from_str(&content)?;
    Ok(config)
}

pub async fn save_config(new_config: ProjectConfig) -> Result<ProjectConfig> {
    let base_path = launcher_patch(Some(&new_config.project_name))?;
    let toml_path = base_path.join(format!("{}.toml", &new_config.project_name));

    if !toml_path.exists() {
        new_config.save_config().await?;
        return Ok(new_config);
    }

    let mut config: ProjectConfig = load_config(&new_config.project_name).await?;
    config.update_config(new_config).await?;
    Ok(config)
}
