use anyhow::Result;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn find_java(java_path: Option<String>) -> Result<PathBuf> {
    if let Some(java_path_str) = java_path {
        let path = PathBuf::from(&java_path_str);
        return Ok(path);
    }

    if let Ok(java_home) = env::var("JAVA_HOME") {
        let java_bin = if cfg!(target_os = "windows") {
            "java.exe"
        } else {
            "java"
        };
        let java_path = PathBuf::from(java_home).join("bin").join(java_bin);
        if java_path.exists() {
            return Ok(java_path);
        }
    }

    #[cfg(not(target_os = "windows"))]
    if let Ok(output) = Command::new("which").arg("java").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    #[cfg(target_os = "windows")]
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

    anyhow::bail!("Java не найдена в системе — установите её в настройках лаунчера или выберите папку с Java вручную")
}

pub fn repair_java_path(path: &Path) -> Option<PathBuf> {
    let position = path
        .components()
        .position(|c| c.as_os_str().to_str() == Some("java"))?;
    let tail: PathBuf = path.components().skip(position).collect();
    if tail.as_path() == Path::new("java") {
        return None;
    }
    let candidate =
        crate::state::launcher_config::LauncherConfig::resolved_launcher_path().join(tail);
    candidate.is_file().then_some(candidate)
}

#[cfg(test)]
mod tests {
    use super::repair_java_path;
    use crate::test_support::LauncherDirGuard;
    use std::path::{Path, PathBuf};

    #[tokio::test]
    async fn repair_java_path_replaces_stale_launcher_root() {
        let guard = LauncherDirGuard::acquire("java_repair").await;
        let java = guard
            .root()
            .join("java")
            .join("21")
            .join("eclipse")
            .join("bin")
            .join("java");
        std::fs::create_dir_all(java.parent().expect("папка java")).expect("создание папки java");
        std::fs::write(&java, b"").expect("создание файла java");

        let stale = PathBuf::from("/home/old-launcher/java/21/eclipse/bin/java");
        assert_eq!(repair_java_path(&stale), Some(java));
    }

    #[tokio::test]
    async fn repair_java_path_without_candidate_returns_none() {
        let _guard = LauncherDirGuard::acquire("java_repair_no_candidate").await;

        let stale = PathBuf::from("/home/old-launcher/java/21/eclipse/bin/java");
        assert_eq!(repair_java_path(&stale), None);
    }

    #[tokio::test]
    async fn repair_java_path_without_java_tail_returns_none() {
        let _guard = LauncherDirGuard::acquire("java_repair_no_tail").await;

        assert_eq!(repair_java_path(Path::new("/usr/bin/java")), None);
        assert_eq!(repair_java_path(Path::new("/opt/jdk/bin/javaw")), None);
    }
}
