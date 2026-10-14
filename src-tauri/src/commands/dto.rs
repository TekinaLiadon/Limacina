use anyhow::Result;

use crate::minecraft::{
    mod_loader::{fabric::Fabric, forge, neoforge},
    structs::ModLoader,
};
use crate::state::dto::ModLoader as ConfigModLoader;
use crate::utils::errors::LauncherError;

pub fn create_mod_loader(loader_type: &ConfigModLoader) -> Result<Box<dyn ModLoader>> {
    match loader_type {
        ConfigModLoader::Vanilla => Err(LauncherError::InvalidInput(
            "Для Vanilla не требуется загрузчик модов — установка и запуск идут без него"
                .to_string(),
        )
        .into()),
        ConfigModLoader::Fabric => Ok(Box::new(Fabric)),
        ConfigModLoader::Forge => Ok(Box::new(forge::LOADER)),
        ConfigModLoader::NeoForge => Ok(Box::new(neoforge::LOADER)),
    }
}

#[cfg(test)]
mod tests {
    use super::create_mod_loader;
    use crate::state::dto::ModLoader;
    use crate::utils::errors::LauncherError;

    #[test]
    fn vanilla_is_rejected_with_typed_error() {
        let error = create_mod_loader(&ModLoader::Vanilla)
            .err()
            .expect("Vanilla не должен создавать загрузчик модов");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается типизированный InvalidInput, а не internal: {error}"
        );
        assert!(
            error.to_string().contains("Vanilla"),
            "ошибка должна называть загрузчик: {error}"
        );
    }

    #[test]
    fn loader_variants_create_loaders() {
        create_mod_loader(&ModLoader::Fabric).expect("Fabric");
        create_mod_loader(&ModLoader::Forge).expect("Forge");
        create_mod_loader(&ModLoader::NeoForge).expect("NeoForge");
    }
}
