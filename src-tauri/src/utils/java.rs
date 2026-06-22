use anyhow::Result;
use std::process::Command;
use std::{env, path::PathBuf};

pub fn find_java(java_path: Option<String>) -> Result<PathBuf> {
    if let Some(java_path_str) = java_path {
        let path = PathBuf::from(&java_path_str);
        return Ok(path);
    }

    if let Ok(java_home) = env::var("JAVA_HOME") {
        let java_bin = if cfg!(windows) { "java.exe" } else { "java" };
        let java_path = PathBuf::from(java_home).join("bin").join(java_bin);
        if java_path.exists() {
            return Ok(java_path);
        }
    }

    #[cfg(unix)]
    if let Ok(output) = Command::new("which").arg("java").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    #[cfg(windows)]
    if let Ok(output) = Command::new("where").arg("java").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    Ok(PathBuf::from("java"))
}
