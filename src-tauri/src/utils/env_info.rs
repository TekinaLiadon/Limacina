use crate::{log_info, log_err};
use anyhow::{Context, Result};
use std::env::consts;
use std::{env, path::PathBuf};

pub fn get_launcher_name() -> String {
    let raw = env::var("LAUNCHER_NAME")
        .unwrap_or_else(|_| "Limacina".to_string());
    let mut chars = raw.chars();
    let name = match chars.next() {
        Some(first) => {
            let rest: String = chars.collect();
            first.to_uppercase().to_string() + &rest.to_lowercase()
        }
        None => String::new(),
    };
    name
}

pub fn launcher_patch(project: Option<&str>) -> Result<PathBuf> {
    let base_path = match crate::state::launcher_config::LauncherConfig::load() {
        Ok(Some(lc)) => {
            PathBuf::from(lc.launcher_path.replace('/', std::path::MAIN_SEPARATOR_STR))
        }
        Ok(None) => {
            log_info!("launcher_patch: конфиг не найден, fallback на home_dir");
            get_home_dir()
                .map(|h| h.join(get_launcher_name()))
                .unwrap_or_default()
        }
        Err(e) => {
            log_err!("launcher_patch: ошибка чтения конфига: {}, fallback", e);
            get_home_dir()
                .map(|h| h.join(get_launcher_name()))
                .unwrap_or_default()
        }
    };

    let result = match project {
        Some(dir) => base_path.join("project").join(dir),
        _ => base_path,
    };

    Ok(result)
}

pub fn get_home_dir() -> Result<PathBuf> {
    Ok(env::home_dir().context("Не найдена домашняя директория")?)

    // #[cfg(target_os = "windows")]
    // {
    //     std::env::var("USERPROFILE").ok().map(PathBuf::from)
    // }
    // #[cfg(not(target_os = "windows"))]
    // {
    //     std::env::var("HOME").ok().map(PathBuf::from)
    // }
}

pub fn get_current_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

pub fn get_arch() -> &'static str {
    match consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        _ => "x86_64",
    }
}
