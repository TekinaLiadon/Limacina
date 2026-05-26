use anyhow::{bail, Result};

use crate::minecraft::{dto::ModLoader, mod_loader::fabric::Fabric};

pub fn create_mod_loader(loader_type: &str) -> Result<Box<dyn ModLoader>> {
    match loader_type.to_lowercase().as_str() {
        "fabric" => Ok(Box::new(Fabric)),
        _ => bail!("Неизвестный тип загрузчика модов: {}", loader_type),
    }
}
