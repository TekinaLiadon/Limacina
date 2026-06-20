use anyhow::{Context, Result};
use std::env::consts;
use std::{env, path::PathBuf};

pub fn launcher_patch(project: Option<&str>) -> Result<PathBuf> {
    let home_dir: PathBuf = get_home_dir()?;
    let launcher_name: String =
        env::var("LAUNCHER_NAME").unwrap_or_else(|_| "Limacina".to_string());
    let base_path = home_dir.join(launcher_name);

    match project {
        Some(dir) => Ok(base_path.join("project").join(dir)),
        _ => Ok(base_path),
    }
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
    let arch = match consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        _ => "x64",
    };
    return arch;
}
