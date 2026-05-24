use anyhow::{bail, Result};

use crate::minecraft::{dto::ModLoader, mod_loader::fabric::Fabric};

pub struct ModLoaderFactory;

impl ModLoaderFactory {
    pub fn create(loader_type: &str) -> Result<Box<dyn ModLoader>> {
        match loader_type.to_lowercase().as_str() {
            "fabric" => Ok(Box::new(Fabric)),
            _ => bail!("Неизвестный тип загрузчика модов: {}", loader_type),
        }
    }
}
