use crate::log_info;
use anyhow::{Context, Result};
use std::env::consts;
use std::path::{Component, PathBuf};
use std::env;

pub fn get_launcher_name() -> String {
    let raw = env::var("LAUNCHER_NAME")
        .unwrap_or_else(|_| "Limacina".to_string());
    let mut chars = raw.chars();

    match chars.next() {
        Some(first) => {
            let rest: String = chars.collect();
            first.to_uppercase().to_string() + &rest.to_lowercase()
        }
        None => String::new(),
    }
}


pub fn default_server_url() -> String {
    env!("LAUNCHER_SERVER_URL").to_string()
}



pub fn normalize_server_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        log_info!("Адрес без схемы, используется https: {}", trimmed);
        format!("https://{}", trimmed)
    }
}




fn is_drive_letter(component: &str) -> bool {
    let bytes = component.as_bytes();
    bytes.len() == 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic()
}

pub fn is_safe_relative_path(key: &str) -> bool {
    let normalized = PathBuf::from(key.replace('\\', "/"));
    if normalized.is_absolute() {
        return false;
    }
    !normalized.components().any(|c| {
        matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))
            || c.as_os_str()
                .to_str()
                .is_some_and(is_drive_letter)
    })
}

pub fn launcher_path(project: Option<&str>) -> Result<PathBuf> {
    let base_path = crate::state::launcher_config::LauncherConfig::resolved_launcher_path();

    let result = match project {
        Some(dir) => base_path.join("project").join(dir),
        _ => base_path,
    };

    Ok(result)
}

pub fn get_home_dir() -> Result<PathBuf> {
    env::home_dir().context("Не найдена домашняя директория")









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

#[cfg(test)]
mod tests {
    use super::{is_safe_relative_path, normalize_server_url};

    #[test]
    fn normalize_adds_scheme_and_strips_trailing_slash() {
        assert_eq!(normalize_server_url("mc.example.com"), "https://mc.example.com");
        assert_eq!(normalize_server_url("mc.example.com:3000/"), "https://mc.example.com:3000");
        assert_eq!(normalize_server_url("  192.168.0.10:8080  "), "https://192.168.0.10:8080");
    }

    #[test]
    fn normalize_keeps_explicit_scheme() {
        assert_eq!(normalize_server_url("https://mc.example.com/"), "https://mc.example.com");
        assert_eq!(normalize_server_url("http://mc.example.com"), "http://mc.example.com");
    }

    #[test]
    fn safe_relative_path_accepts_nested_files() {
        assert!(is_safe_relative_path("mods/industrial.jar"));
        assert!(is_safe_relative_path("config/settings.json"));
        assert!(is_safe_relative_path("authlib-injector.jar"));
    }

    #[test]
    fn safe_relative_path_rejects_traversal() {
        assert!(!is_safe_relative_path("../escape.json"));
        assert!(!is_safe_relative_path("mods/../../escape.jar"));
        assert!(!is_safe_relative_path("/absolute/path.jar"));
        assert!(!is_safe_relative_path("C:/windows/evil.dll"));
        assert!(!is_safe_relative_path(r"mods\..\..\evil.jar"));
    }
}
