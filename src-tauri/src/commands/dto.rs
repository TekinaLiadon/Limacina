use anyhow::{bail, Result};

use crate::minecraft::{
    mod_loader::fabric::Fabric, mod_loader::forge::Forge, mod_loader::neoforge::NeoForge,
    structs::ModLoader,
};
use crate::state::dto::ModLoader as ConfigModLoader;

pub fn create_mod_loader(loader_type: &ConfigModLoader) -> Result<Box<dyn ModLoader>> {
    match loader_type {
        ConfigModLoader::Fabric => Ok(Box::new(Fabric)),
        ConfigModLoader::Forge => Ok(Box::new(Forge)),
        ConfigModLoader::NeoForge => Ok(Box::new(NeoForge)),
        _ => bail!("Неизвестный тип загрузчика модов"),
    }
}
