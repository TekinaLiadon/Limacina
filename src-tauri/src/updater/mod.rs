pub mod version;

pub use version::{
    compare_with_current, get_launcher_versions, is_timeout_error, retain_current_platform,
    UpdateInfo, UpdateRelease,
};

use anyhow::Result;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::utils::errors::LauncherError;

pub const STARTUP_CHECK_TIMEOUT: Duration = Duration::from_secs(3);

pub fn updater_pubkey(app: &AppHandle) -> Option<String> {
    let pubkey = app
        .config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()?;
    Some(pubkey.trim().to_string()).filter(|key| !key.is_empty())
}

fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')
        && version.starts_with(|c: char| c.is_ascii_alphanumeric())
        && version.split('.').all(|segment| !segment.is_empty())
}

fn update_endpoint(server_url: &str, version: Option<&str>) -> Result<url::Url> {
    let endpoint = match version {
        Some(v) if valid_version(v) => format!("{server_url}/v1/launcher/update/{v}/latest.json"),
        Some(v) => {
            return Err(LauncherError::Update(format!("Некорректная версия: {v}")).into());
        }
        None => format!("{server_url}/v1/launcher/update/latest.json"),
    };
    let parsed: url::Url = endpoint.parse().map_err(|e| {
        LauncherError::Update(format!("Не удалось разобрать адрес обновлений: {e:#}"))
    })?;
    Ok(parsed)
}

pub fn updater_builder(
    app: &AppHandle,
    version: Option<&str>,
) -> Result<tauri_plugin_updater::UpdaterBuilder> {
    if updater_pubkey(app).is_none() {
        return Err(LauncherError::Update(
            "Обновления отключены: не задан plugins.updater.pubkey в tauri.conf.json".to_string(),
        )
        .into());
    }
    let server_url =
        crate::utils::env_info::default_server_url().ok_or(LauncherError::UpdateServerMissing)?;
    let endpoint = update_endpoint(&server_url, version)?;

    let builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| LauncherError::Update(format!("Не удалось задать адрес обновлений: {e:#}")))?;
    let builder = match crate::utils::install_id::install_id() {
        Some(id) => builder
            .header(crate::utils::install_id::LAUNCHER_ID_HEADER, id)
            .map_err(|e| {
                LauncherError::Update(format!("Не удалось задать заголовок обновлений: {e:#}"))
            })?,
        None => builder,
    };
    if version.is_some() {
        Ok(builder.version_comparator(|_, _| true))
    } else {
        Ok(builder)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_version_accepts_release_charset_only() {
        for version in ["1.2.3", "1.0.0", "1.0.0-beta1", "2.0.0+build.5"] {
            assert!(
                valid_version(version),
                "версия {version:?} должна проходить чарсет-гейт"
            );
        }
        for version in [
            "",
            "..",
            ".",
            ".1",
            "1.",
            "1..2",
            "../evil",
            "a b",
            "1.2.3/evil",
            "версия",
            "%31",
        ] {
            assert!(
                !valid_version(version),
                "версия {version:?} должна отклоняться"
            );
        }
    }

    #[test]
    fn update_endpoint_builds_auto_and_per_version_urls() {
        let auto = update_endpoint("https://mc.example.com", None).expect("auto-адрес");
        assert_eq!(
            auto.as_str(),
            "https://mc.example.com/v1/launcher/update/latest.json"
        );

        let per_version =
            update_endpoint("https://mc.example.com", Some("1.2.3")).expect("адрес версии");
        assert_eq!(
            per_version.as_str(),
            "https://mc.example.com/v1/launcher/update/1.2.3/latest.json"
        );
    }

    #[test]
    fn update_endpoint_rejects_version_with_invalid_charset() {
        let error = update_endpoint("https://mc.example.com", Some("../evil"))
            .expect_err("обход пути в версии должен отклоняться");
        assert!(
            error.to_string().contains("Некорректная версия"),
            "ошибка должна называть причину: {error}"
        );
        assert!(update_endpoint("https://mc.example.com", Some("..")).is_err());
        assert!(update_endpoint("https://mc.example.com", Some("1..2")).is_err());
        assert!(update_endpoint("https://mc.example.com", Some("a b")).is_err());
        assert!(update_endpoint("https://mc.example.com", Some("")).is_err());
    }
}
