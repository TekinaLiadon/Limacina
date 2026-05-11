use std::{env, path::PathBuf};
use anyhow::{Result, Context};

pub fn launcher_patch() -> Result<PathBuf> {
    let home_dir: PathBuf = get_home_dir()?;
    let launcher_name: String =
        env::var("LAUNCHER_NAME").unwrap_or_else(|_| "Limacina".to_string());
    let base_path = home_dir.join(launcher_name);

    return Ok(base_path);
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