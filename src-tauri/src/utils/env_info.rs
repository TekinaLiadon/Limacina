use crate::log_info;
use crate::utils::errors::LauncherError;
use anyhow::Result;
use std::env;
use std::env::consts;
use std::path::{Component, PathBuf};

pub fn get_launcher_name() -> String {
    let raw = env::var("LAUNCHER_NAME").unwrap_or_else(|_| "Limacina".to_string());
    let mut chars = raw.chars();

    match chars.next() {
        Some(first) => {
            let rest: String = chars.collect();
            first.to_uppercase().to_string() + &rest.to_lowercase()
        }
        None => String::new(),
    }
}

pub fn get_default_project_name() -> String {
    env::var("LAUNCHER_PROJECT_NAME")
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub fn default_server_url() -> Option<String> {
    option_env!("LAUNCHER_SERVER_URL")
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
}

pub fn is_offline_build() -> bool {
    default_server_url().is_none()
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
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) || c.as_os_str().to_str().is_some_and(is_drive_letter)
    })
}

pub fn ensure_safe_relative_path(value: &str, what: &str) -> Result<()> {
    if is_safe_relative_path(value) {
        return Ok(());
    }
    Err(LauncherError::InvalidInput(format!("Некорректное значение {what}: {value}")).into())
}

pub fn canonicalize_parent_path(raw: &str) -> Result<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(LauncherError::InvalidInput(
            "Не указана папка для установки лаунчера".to_string(),
        )
        .into());
    }
    let path = PathBuf::from(trimmed.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !path.is_absolute() {
        return Err(LauncherError::InvalidInput(format!(
            "Путь к папке лаунчера должен быть абсолютным: {trimmed}"
        ))
        .into());
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(LauncherError::InvalidInput(format!(
            "Путь к папке лаунчера не должен содержать «..»: {trimmed}"
        ))
        .into());
    }
    let (existing, missing) = split_existing_ancestor(path);
    if existing.as_os_str().is_empty() {
        return Ok(missing
            .iter()
            .rev()
            .fold(existing, |acc, part| acc.join(part)));
    }
    let canonical = std::fs::canonicalize(&existing).map_err(|e| {
        LauncherError::DiskIo(format!(
            "Не удалось определить папку лаунчера {:?}: {}",
            existing, e
        ))
    })?;
    Ok(missing
        .iter()
        .rev()
        .fold(strip_verbatim_prefix(canonical), |acc, part| acc.join(part)))
}

fn split_existing_ancestor(path: PathBuf) -> (PathBuf, Vec<std::ffi::OsString>) {
    let mut existing = path;
    let mut missing = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(std::ffi::OsString::from) else {
            break;
        };
        let Some(parent) = existing.parent().map(PathBuf::from) else {
            break;
        };
        if parent == existing {
            break;
        }
        missing.push(name);
        existing = parent;
    }
    (existing, missing)
}

#[cfg(target_os = "windows")]
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{stripped}"))
    } else if let Some(stripped) = text.strip_prefix(r"\\?\") {
        PathBuf::from(stripped.to_string())
    } else {
        path
    }
}

#[cfg(not(target_os = "windows"))]
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    path
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
    env::home_dir()
        .ok_or(LauncherError::DiskIo("Не найдена домашняя директория".to_string()).into())
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
    use super::{
        canonicalize_parent_path, ensure_safe_relative_path, is_safe_relative_path,
        normalize_server_url,
    };

    #[test]
    fn ensure_safe_relative_path_rejects_traversal_and_accepts_plain() {
        let error = ensure_safe_relative_path("../evil", "версии игры")
            .expect_err("обход пути должен быть отклонён");
        assert!(
            error
                .to_string()
                .contains("Некорректное значение версии игры"),
            "ошибка должна называть проверяемое значение: {error}"
        );
        assert!(ensure_safe_relative_path("..\\evil", "версия игры").is_err());
        assert!(ensure_safe_relative_path("1.20.1", "версии игры").is_ok());
    }

    #[test]
    fn normalize_adds_scheme_and_strips_trailing_slash() {
        assert_eq!(
            normalize_server_url("mc.example.com"),
            "https://mc.example.com"
        );
        assert_eq!(
            normalize_server_url("mc.example.com:3000/"),
            "https://mc.example.com:3000"
        );
        assert_eq!(
            normalize_server_url("  192.168.0.10:8080  "),
            "https://192.168.0.10:8080"
        );
    }

    #[test]
    fn normalize_keeps_explicit_scheme() {
        assert_eq!(
            normalize_server_url("https://mc.example.com/"),
            "https://mc.example.com"
        );
        assert_eq!(
            normalize_server_url("http://mc.example.com"),
            "http://mc.example.com"
        );
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

    #[test]
    fn parent_path_rejects_empty_input() {
        let error = canonicalize_parent_path("   ").expect_err("пустой путь должен отклоняться");
        assert!(
            error.to_string().contains("Не указана папка"),
            "ошибка должна объяснять причину: {error}"
        );
    }

    #[test]
    fn parent_path_rejects_relative_input() {
        let error = canonicalize_parent_path("Games/Limacina")
            .expect_err("относительный путь должен отклоняться");
        assert!(
            error.to_string().contains("должен быть абсолютным"),
            "ошибка должна объяснять причину: {error}"
        );
    }

    #[test]
    fn parent_path_rejects_parent_dir_components() {
        for raw in [
            "/tmp/limacina_test/../etc",
            "/tmp/limacina_test/sub/../../../root",
            "/../etc",
        ] {
            let error = canonicalize_parent_path(raw).expect_err("обход «..» должен отклоняться");
            assert!(
                error.to_string().contains("«..»"),
                "ошибка должна называть проблему для {raw}: {error}"
            );
        }
    }

    #[test]
    fn parent_path_keeps_missing_tail_without_creating_it() {
        let base = std::env::temp_dir();
        let target = base.join("limacina_parent_missing_tail");

        let canonical = canonicalize_parent_path(&target.to_string_lossy())
            .expect("несуществующий хвост допустим");

        assert_eq!(canonical, target);
        assert!(!target.exists(), "папка не должна создаваться при проверке");
    }

    #[cfg(unix)]
    #[test]
    fn parent_path_resolves_symlink_prefix() {
        let dir = crate::test_support::TempDir::new("parent_symlink");
        let link = std::env::temp_dir().join(format!(
            "limacina_parent_link_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        std::os::unix::fs::symlink(&dir.0, &link).expect("символическая ссылка");

        let canonical = canonicalize_parent_path(&link.to_string_lossy())
            .expect("ссылка должна разворачиваться в реальный путь");

        let _ = std::fs::remove_file(&link);
        assert_eq!(canonical, dir.0, "симлинк резолвится в целевой каталог");
    }

    #[test]
    fn parent_path_normalizes_forward_slashes() {
        if cfg!(windows) {
            assert_eq!(
                canonicalize_parent_path("C:/Games").expect("смешанные разделители"),
                std::path::PathBuf::from("C:\\Games")
            );
        } else {
            let base = std::env::temp_dir();
            assert_eq!(
                canonicalize_parent_path(base.join("x/y").to_string_lossy().as_ref())
                    .expect("смешанные разделители"),
                base.join("x/y")
            );
        }
    }
}
