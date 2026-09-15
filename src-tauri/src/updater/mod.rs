pub mod version;

pub use version::{
    compare_with_current, get_launcher_versions, is_timeout_error, retain_current_platform,
    UpdateInfo, UpdateVersions,
};

use anyhow::{Context, Result};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::utils::errors::LauncherError;
use crate::{log_err, log_info};

pub const STARTUP_CHECK_TIMEOUT: Duration = Duration::from_secs(3);

pub fn updater_pubkey() -> Option<String> {
    std::env::var("TAURI_UPDATER_PUBKEY")
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
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
    let pubkey = updater_pubkey().ok_or_else(|| {
        anyhow::anyhow!("Обновления отключены: не задан публичный ключ TAURI_UPDATER_PUBKEY")
    })?;
    let server_url =
        crate::utils::env_info::default_server_url().ok_or(LauncherError::UpdateServerMissing)?;
    let endpoint = match version {
        Some(v) if valid_version(v) => format!("{server_url}/v1/launcher/update/{v}/latest.json"),
        Some(v) => anyhow::bail!("Некорректная версия: {}", v),
        None => format!("{server_url}/v1/launcher/update/latest.json"),
    };
    let endpoint: url::Url = endpoint
        .parse()
        .context("Не удалось разобрать адрес обновлений")?;

    let builder = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .context("Не удалось задать адрес обновлений")?;
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
            match std::fs::remove_file(&old_path).context("Не удалось удалить старый бинарник")
            {
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
            match std::fs::remove_file(&staged_path)
                .context("Не удалось удалить незавершённое обновление")
            {
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
            match std::fs::remove_dir_all(&old_dir).context("Не удалось удалить старый бандл")
            {
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
