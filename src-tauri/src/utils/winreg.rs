use anyhow::Result;
use std::path::Path;
use std::sync::OnceLock;

use crate::log_err;

static UNINSTALL_REGISTRY_KEY: OnceLock<String> = OnceLock::new();

#[cfg(target_os = "windows")]
const DATA_PATH_VALUE: &str = "DataPath";

pub(crate) fn init_uninstall_registry_key(config: &tauri::Config) {
    if let Some(key) = uninstall_registry_key(config) {
        let _ = UNINSTALL_REGISTRY_KEY.set(key);
    }
}

fn uninstall_registry_key(config: &tauri::Config) -> Option<String> {
    let publisher = config
        .bundle
        .publisher
        .as_deref()
        .or_else(|| config.identifier.split('.').nth(1));
    let product_name = config.product_name.as_deref()?;
    Some(match publisher {
        Some(publisher) => format!("Software\\{}\\{}", publisher, product_name),
        None => format!("Software\\{}", product_name),
    })
}

pub(crate) fn remember_data_path(path: &Path) {
    if let Err(e) = try_remember_data_path(path) {
        log_err!("Не удалось сохранить путь данных для деинсталлера: {e:#}");
    }
}

#[cfg(target_os = "windows")]
fn try_remember_data_path(path: &Path) -> Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    use crate::utils::errors::LauncherError;

    let Some(key) = UNINSTALL_REGISTRY_KEY.get() else {
        return Ok(());
    };

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (subkey, _) = hkcu.create_subkey(key).map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось открыть ключ реестра {key}: {e:#}"))
    })?;
    subkey
        .set_value(DATA_PATH_VALUE, &path.to_string_lossy().to_string())
        .map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось записать путь данных в реестр {key}: {e:#}"
            ))
        })?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn try_remember_data_path(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn machine_guid() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").ok()?;
    key.get_value::<String>("MachineGuid").ok()
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub(crate) fn machine_guid() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::config::BundleConfig;
    use tauri::Config;

    fn config(identifier: &str, publisher: Option<&str>, product_name: Option<&str>) -> Config {
        Config {
            identifier: identifier.to_string(),
            product_name: product_name.map(str::to_string),
            bundle: BundleConfig {
                publisher: publisher.map(str::to_string),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn registry_key_uses_publisher_when_present() {
        let config = config("com.tekina.limacina", Some("Tekina"), Some("Limacina"));

        assert_eq!(
            uninstall_registry_key(&config).as_deref(),
            Some("Software\\Tekina\\Limacina")
        );
    }

    #[test]
    fn registry_key_falls_back_to_identifier_segment() {
        let config = config("com.tekina.limacina", None, Some("Limacina"));

        assert_eq!(
            uninstall_registry_key(&config).as_deref(),
            Some("Software\\tekina\\Limacina")
        );
    }

    #[test]
    fn registry_key_skips_product_without_product_name() {
        let config = config("com.tekina.limacina", Some("Tekina"), None);

        assert!(uninstall_registry_key(&config).is_none());
    }
}
