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
    !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')
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

fn cleanup_path(path: &std::path::Path, description: &str, is_dir: bool) {
    if !path.exists() {
        return;
    }
    let remove = |path: &std::path::Path| {
        if is_dir {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        }
    };
    match remove(path)
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось удалить {description}: {e:#}")))
    {
        Ok(()) => log_info!("Удалён(а) {description}: {:?}", path),
        Err(e) => log_err!("{:?}", e),
    }
}

pub fn cleanup_old_binaries() {
    if let Ok(current_exe) = std::env::current_exe() {
        cleanup_old_binaries_at(&current_exe);
    }
}

fn cleanup_old_binaries_at(current_exe: &std::path::Path) {
    cleanup_path(
        &binary_with_suffix(current_exe, "old"),
        "старый бинарник",
        false,
    );
    cleanup_path(
        &binary_with_suffix(current_exe, "new"),
        "незавершённый бинарник обновления",
        false,
    );
    if let Some(old_bundle) = old_bundle_path(current_exe) {
        cleanup_path(&old_bundle, "старый бандл", true);
    }
}

fn binary_with_suffix(current_exe: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    current_exe.with_file_name(format!(
        "{}.{suffix}",
        current_exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
}

fn old_bundle_path(current_exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let bundle_dir = current_exe.parent()?.parent()?.parent()?;
    let bundle_name = bundle_dir.file_name()?.to_string_lossy();
    if !bundle_name.ends_with(".app") {
        return None;
    }
    Some(bundle_dir.with_file_name(format!("{}.app.old", bundle_name.trim_end_matches(".app"))))
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
        for version in ["", "../evil", "a b", "1.2.3/evil", "версия", "%31"] {
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
        assert!(update_endpoint("https://mc.example.com", Some("a b")).is_err());
        assert!(update_endpoint("https://mc.example.com", Some("")).is_err());
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("создание временной папки");
        dir
    }

    #[test]
    fn bundle_backup_is_sibling_of_bundle_on_macos_layout() {
        let exe = std::path::Path::new("/Applications/Limacina.app/Contents/MacOS/limacina");

        assert_eq!(
            old_bundle_path(exe),
            Some(std::path::PathBuf::from("/Applications/Limacina.app.old"))
        );
        assert_eq!(
            binary_with_suffix(exe, "old"),
            std::path::PathBuf::from("/Applications/Limacina.app/Contents/MacOS/limacina.old")
        );
        assert_eq!(
            binary_with_suffix(exe, "new"),
            std::path::PathBuf::from("/Applications/Limacina.app/Contents/MacOS/limacina.new")
        );
    }

    #[test]
    fn bundle_backup_is_none_on_windows_layout() {
        let exe =
            std::path::Path::new("C:/Users/user/AppData/Local/Programs/Limacina/limacina.exe");

        assert_eq!(old_bundle_path(exe), None);
        assert_eq!(
            binary_with_suffix(exe, "old"),
            std::path::PathBuf::from(
                "C:/Users/user/AppData/Local/Programs/Limacina/limacina.exe.old"
            )
        );
        assert_eq!(
            binary_with_suffix(exe, "new"),
            std::path::PathBuf::from(
                "C:/Users/user/AppData/Local/Programs/Limacina/limacina.exe.new"
            )
        );
    }

    #[test]
    fn bundle_backup_is_none_on_linux_layout() {
        let exe = std::path::Path::new("/home/user/.local/share/Limacina/limacina");

        assert_eq!(old_bundle_path(exe), None);
        assert_eq!(
            binary_with_suffix(exe, "old"),
            std::path::PathBuf::from("/home/user/.local/share/Limacina/limacina.old")
        );
        assert_eq!(
            binary_with_suffix(exe, "new"),
            std::path::PathBuf::from("/home/user/.local/share/Limacina/limacina.new")
        );
    }

    #[test]
    fn bundle_backup_is_none_when_chain_is_short_or_not_a_bundle() {
        assert_eq!(
            old_bundle_path(std::path::Path::new("/Applications/Limacina.app/limacina")),
            None
        );
        assert_eq!(
            old_bundle_path(std::path::Path::new(
                "/Applications/Limacina/Contents/MacOS/limacina"
            )),
            None
        );
    }

    #[test]
    fn removes_app_old_bundle_on_macos_layout() {
        let root = temp_dir("limacina_cleanup_macos_bundle");
        let app = root.join("Limacina.app");
        let exe = app.join("Contents").join("MacOS").join("limacina");
        std::fs::create_dir_all(exe.parent().expect("папка бинарника")).expect("создание бандла");
        std::fs::write(&exe, b"current").expect("запись бинарника");
        let old_bundle = root.join("Limacina.app.old");
        std::fs::create_dir_all(old_bundle.join("Contents").join("MacOS"))
            .expect("создание бэкап-бандла");

        cleanup_old_binaries_at(&exe);

        assert!(!old_bundle.exists());
        assert!(app.exists());
        assert!(exe.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removes_old_and_new_binaries_on_flat_layout() {
        let root = temp_dir("limacina_cleanup_flat_binaries");
        let exe = root.join("limacina.exe");
        std::fs::write(&exe, b"current").expect("запись бинарника");
        std::fs::write(root.join("limacina.exe.old"), b"old").expect("запись .old");
        std::fs::write(root.join("limacina.exe.new"), b"new").expect("запись .new");
        let foreign_dir = root.join("Programs.app.old");
        std::fs::create_dir_all(&foreign_dir).expect("создание посторонней папки");

        cleanup_old_binaries_at(&exe);

        assert!(!root.join("limacina.exe.old").exists());
        assert!(!root.join("limacina.exe.new").exists());
        assert!(exe.exists());
        assert!(foreign_dir.exists());

        let _ = std::fs::remove_dir_all(&root);
    }
}
