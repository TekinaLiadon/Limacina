use std::io::Write;
use std::path::{Path, PathBuf};

use sha1::{Digest, Sha1};

use crate::minecraft::structs::LaunchConfig;

pub fn sha1_hex(data: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(data);
    crate::utils::hex::digest_hex(hasher.finalize())
}

pub static LAUNCHER_DIR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub struct LauncherDirGuard {
    _permit: tokio::sync::MutexGuard<'static, ()>,
    root: PathBuf,
}

impl LauncherDirGuard {
    pub async fn acquire(label: &str) -> Self {
        let permit = LAUNCHER_DIR_LOCK.lock().await;
        let root =
            std::env::temp_dir().join(format!("limacina_it_{}_{}", label, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("создание тестовой директории лаунчера");
        crate::state::launcher_config::LauncherConfig::override_resolved_launcher_path_for_tests(
            &root,
        );
        Self {
            _permit: permit,
            root,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn project_dir(&self, project: &str) -> PathBuf {
        self.root.join("project").join(project)
    }

    pub fn write_broken_install_manifest(&self, project: &str) {
        let manifest_path = self
            .root()
            .join("manifest")
            .join(format!("installed_{project}.json"));
        std::fs::create_dir_all(manifest_path.parent().expect("родительская директория")).unwrap();
        std::fs::write(&manifest_path, "{ это невалидный json").unwrap();
    }
}

impl Drop for LauncherDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "limacina_test_{}_{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("создание временной папки");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub fn test_launch_config(root: &Path) -> LaunchConfig {
    LaunchConfig {
        username: "Test".to_string(),
        uuid: "test-uuid".to_string(),
        access_token: "token".to_string(),
        mc_version: "1.18.2".to_string(),
        game_dir: root.to_path_buf(),
        assets_dir: root.join("assets"),
        libraries_dir: root.join("libraries"),
        natives_dir: root.join("natives"),
        jvm_sub_arg: Vec::new(),
        window_width: 1280,
        window_height: 720,
    }
}

fn maven_library(name: &str, path: &str, sha1: &str, size: u64, url: &str) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "downloads": {
            "artifact": {
                "path": path,
                "sha1": sha1,
                "size": size,
                "url": url
            }
        }
    })
}

pub fn logging_library() -> serde_json::Value {
    maven_library(
        "com.mojang:logging:1.0.0",
        "com/mojang/logging/1.0.0/logging-1.0.0.jar",
        "f6ca3b2eee0b80b384e8ed93d368faecb82dfb9b",
        15343,
        "https://libraries.minecraft.net/com/mojang/logging/1.0.0/logging-1.0.0.jar",
    )
}

pub fn jopt_simple_library() -> serde_json::Value {
    maven_library(
        "net.sf.jopt-simple:jopt-simple:5.0.4",
        "net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar",
        "4fdac2fbe92dfad86aa6e9301736f6b4342a3f5c",
        78146,
        "https://libraries.minecraft.net/net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar",
    )
}

pub fn gson_library() -> serde_json::Value {
    maven_library(
        "com.google.code.gson:gson:2.8.9",
        "com/google/code/gson/gson/2.8.9/gson-2.8.9.jar",
        "8a432c1d6825781e21a02db2e2c33c5fde2833b9",
        258075,
        "https://libraries.minecraft.net/com/google/code/gson/gson/2.8.9/gson-2.8.9.jar",
    )
}

pub fn gson_library_no_url() -> serde_json::Value {
    maven_library(
        "com.google.code.gson:gson:2.8.9",
        "com/google/code/gson/gson/2.8.9/gson-2.8.9.jar",
        "8a432c1d6825781e21a02db2e2c33c5fde2833b9",
        258075,
        "",
    )
}

pub fn write_test_zip(path: &Path, entries: &[(&str, &[u8])]) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("создание родительской директории архива");
    }
    let file = std::fs::File::create(path).expect("создание архива");
    let mut writer = zip::ZipWriter::new(file);
    for (name, data) in entries {
        writer
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .expect("запись entry");
        writer.write_all(data).expect("запись данных");
    }
    writer.finish().expect("завершение архива");
}
