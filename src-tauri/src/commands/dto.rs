use anyhow::{bail, Result};

use crate::minecraft::{dto::ModLoader, mod_loader::fabric::Fabric, mod_loader::forge::Forge};
use crate::state::dto::ModLoader as ConfigModLoader;

pub fn create_mod_loader(loader_type: &ConfigModLoader) -> Result<Box<dyn ModLoader>> {
    match loader_type {
        ConfigModLoader::Fabric => Ok(Box::new(Fabric)),
        ConfigModLoader::Forge => Ok(Box::new(Forge)),
        _ => bail!("Неизвестный тип загрузчика модов"),
    }
}
