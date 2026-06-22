use anyhow::{bail, Result};

use crate::minecraft::{structs::ModLoader, mod_loader::fabric::Fabric, mod_loader::forge::Forge, mod_loader::neoforge::NeoForge};
use crate::state::dto::{ModLoader as ConfigModLoader, ProjectConfig};

pub fn create_mod_loader(loader_type: &ConfigModLoader) -> Result<Box<dyn ModLoader>> {
    match loader_type {
        ConfigModLoader::Fabric => Ok(Box::new(Fabric)),
        ConfigModLoader::Forge => Ok(Box::new(Forge)),
        ConfigModLoader::NeoForge => Ok(Box::new(NeoForge)),
        _ => bail!("Неизвестный тип загрузчика модов"),
    }
}

pub async fn resolve_latest_loader_version(config: &mut ProjectConfig) -> Result<()> {
    if config.loader_version.is_some() {
        return Ok(());
    }
    if matches!(config.mod_loader, ConfigModLoader::Vanilla) {
        return Ok(());
    }
    let loader = create_mod_loader(&config.mod_loader)?;
    let version = loader.latest_version(config).await?;
    config.loader_version = Some(version);
    Ok(())
}
