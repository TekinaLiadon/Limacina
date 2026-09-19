pub mod version;

pub use version::{
    compare_with_current, get_launcher_versions, is_timeout_error, retain_current_platform,
    UpdateInfo, UpdateVersions,
};

use anyhow::Result;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::utils::errors::LauncherError;
use crate::{log_err, log_info};

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
    version
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')
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
    let endpoint = match version {
        Some(v) if valid_version(v) => format!("{server_url}/v1/launcher/update/{v}/latest.json"),
        Some(v) => {
            return Err(LauncherError::Update(format!("Некорректная версия: {v}")).into());
        }
        None => format!("{server_url}/v1/launcher/update/latest.json"),
    };
    let endpoint: url::Url = endpoint.parse().map_err(|e| {
        LauncherError::Update(format!("Не удалось разобрать адрес обновлений: {e:#}"))
    })?;

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

pub fn cleanup_old_binaries() {
    if let Ok(current_exe) = std::env::current_exe() {
        let old_path = old_binary_path(&current_exe);
        if old_path.exists() {
            match std::fs::remove_file(&old_path).map_err(|e| {
                LauncherError::DiskIo(format!("Не удалось удалить старый бинарник: {e:#}"))
            }) {
                Ok(()) => log_info!("Удалён старый бинарник: {:?}", old_path),
                Err(e) => log_err!("{:?}", e),
            }
        }

        let staged_path = current_exe.with_file_name(format!(
            "{}.new",
            current_exe
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        if staged_path.exists() {
            match std::fs::remove_file(&staged_path).map_err(|e| {
                LauncherError::DiskIo(format!(
                    "Не удалось удалить незавершённое обновление: {e:#}"
                ))
            }) {
                Ok(()) => log_info!(
                    "Удалён незавершённый бинарник обновления: {:?}",
                    staged_path
                ),
                Err(e) => log_err!("{:?}", e),
            }
        }

        let old_dir = current_exe.with_file_name(format!(
            "{}.app.old",
            current_exe
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.file_name())
                .unwrap_or_default()
                .to_string_lossy()
                .trim_end_matches(".app")
        ));
        if old_dir.exists() {
            match std::fs::remove_dir_all(&old_dir).map_err(|e| {
                LauncherError::DiskIo(format!("Не удалось удалить старый бандл: {e:#}"))
            }) {
                Ok(()) => log_info!("Удалён старый бандл: {:?}", old_dir),
                Err(e) => log_err!("{:?}", e),
            }
        }
    }
}

fn old_binary_path(current_exe: &std::path::Path) -> std::path::PathBuf {
    current_exe.with_file_name(format!(
        "{}.old",
        current_exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
}
