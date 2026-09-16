#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::utils::tauri_err::CommandResult;

#[tauri::command]
pub async fn get_notification_icon(app: AppHandle) -> CommandResult<Option<String>> {
    Ok(resolve_notification_icon(&app))
}

#[cfg(target_os = "linux")]
fn resolve_notification_icon(app: &AppHandle) -> Option<String> {
    let names = icon_names(app);
    let candidates = notification_icon_candidates(&names, dev_icons_dir(), exe_dir());
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "linux"))]
fn resolve_notification_icon(_app: &AppHandle) -> Option<String> {
    None
}

#[cfg(target_os = "linux")]
fn icon_names(app: &AppHandle) -> Vec<String> {
    let mut names = vec![app.config().identifier.clone()];
    if let Some(product_name) = app.config().product_name.clone() {
        names.push(product_name);
    }
    names
}

#[cfg(target_os = "linux")]
fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

#[cfg(target_os = "linux")]
fn dev_icons_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons");
    dir.is_dir().then_some(dir)
}

#[cfg(target_os = "linux")]
const ICON_SIZES: [&str; 6] = ["512x512", "256x256", "128x128", "64x64", "48x48", "32x32"];

#[cfg(target_os = "linux")]
fn notification_icon_candidates(
    names: &[String],
    dev_icons: Option<PathBuf>,
    exe_dir: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = dev_icons {
        candidates.push(dir.join("32x32.png"));
        candidates.push(dir.join("128x128.png"));
    }

    if let Some(dir) = exe_dir {
        candidates.push(dir.join("icons").join("32x32.png"));
        let share = dir.join("../share/icons/hicolor");
        for name in names {
            for size in ICON_SIZES {
                candidates.push(share.join(format!("{size}/apps/{name}.png")));
            }
            candidates.push(dir.join(format!("../share/pixmaps/{name}.png")));
        }
    }

    for name in names {
        for size in ICON_SIZES {
            candidates.push(PathBuf::from(format!(
                "/usr/share/icons/hicolor/{size}/apps/{name}.png"
            )));
            candidates.push(PathBuf::from(format!("/usr/share/pixmaps/{name}.png")));
        }
    }

    candidates
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn candidates_start_with_dev_icons_and_cover_theme_layouts() {
        let candidates = notification_icon_candidates(
            &["com.tekina.limacina".to_string()],
            Some(PathBuf::from("/dev/src-tauri/icons")),
            Some(PathBuf::from("/opt/limacina/bin")),
        );
        assert_eq!(
            candidates.first().map(|p| p.to_string_lossy().into_owned()),
            Some("/dev/src-tauri/icons/32x32.png".to_string())
        );
        assert!(candidates.iter().any(|p| p.to_string_lossy()
            == "/opt/limacina/bin/../share/icons/hicolor/128x128/apps/com.tekina.limacina.png"));
        assert!(candidates.iter().any(|p| p.to_string_lossy()
            == "/usr/share/icons/hicolor/32x32/apps/com.tekina.limacina.png"));
        assert!(candidates
            .iter()
            .any(|p| p.to_string_lossy() == "/usr/share/pixmaps/com.tekina.limacina.png"));
    }

    #[test]
    fn candidates_without_dev_and_exe_fall_back_to_system_paths() {
        let candidates = notification_icon_candidates(&["Missing".to_string()], None, None);
        assert!(!candidates.is_empty());
        assert!(candidates
            .iter()
            .all(|p| p.to_string_lossy().starts_with("/usr/share/")));
    }
}
