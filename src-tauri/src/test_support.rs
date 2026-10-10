use std::io::Write;
use std::path::{Path, PathBuf};

use sha1::{Digest, Sha1};

use crate::minecraft::structs::{GameConfig, LaunchConfig, LibraryMod, VersionMod};
use crate::state::dto::ProjectConfig;

pub fn loader_project(project: &str, mc_version: &str, loader_version: &str) -> ProjectConfig {
    ProjectConfig {
        project_name: project.to_string(),
        mc_version: mc_version.to_string(),
        loader_version: Some(loader_version.to_string()),
        ..ProjectConfig::default()
    }
}

pub fn loader_version_mod(id: &str, main_class: &str) -> VersionMod {
    VersionMod {
        url: String::new(),
        id: id.to_string(),
        main_class: main_class.to_string(),
        library: Vec::new(),
    }
}

pub fn loader_vanilla_config(game_root: &Path, client_jar: &str) -> GameConfig {
    GameConfig::new(
        PathBuf::from("java"),
        vec!["-Xms512M".to_string()],
        vec!["--username".to_string(), "Cordelia".to_string()],
        vec![client_jar.to_string()],
        "net.minecraft.client.main.Main".to_string(),
        game_root.to_path_buf(),
    )
}

pub fn rotation_payload(access: &str, refresh: &str) -> String {
    serde_json::json!({
        "tokens": { "access_token": access, "refresh_token": refresh },
        "profile": { "uuid": "uuid-1", "username": "Steve" }
    })
    .to_string()
}

pub async fn seed_online_project(project_name: &str, server_url: &str) {
    let config = ProjectConfig {
        project_name: project_name.to_string(),
        mc_version: "1.20.1".to_string(),
        server_url: Some(server_url.to_string()),
        online: true,
        ..ProjectConfig::default()
    };
    config
        .save_config()
        .await
        .expect("сохранение конфига проекта");
}

pub fn sha1_hex(data: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(data);
    crate::utils::hex::digest_hex(hasher.finalize())
}

pub fn library_mod(name: &str, path: &str) -> LibraryMod {
    LibraryMod {
        name: name.to_string(),
        path: path.to_string(),
        url: String::new(),
        hash: String::new(),
        size: 1,
    }
}

pub fn loader_manifest(
    id: &str,
    main_class: &str,
    inherits_from: &str,
    arguments: serde_json::Value,
    libraries: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "time": "2023-01-01T00:00:00+00:00",
        "releaseTime": "2023-01-01T00:00:00+00:00",
        "type": "release",
        "mainClass": main_class,
        "inheritsFrom": inherits_from,
        "arguments": arguments,
        "libraries": libraries
    })
}

pub fn write_loader_manifest(
    root: &Path,
    file_stem: &str,
    manifest: &serde_json::Value,
) -> PathBuf {
    let path = root.join("manifest").join(format!("{file_stem}.json"));
    std::fs::create_dir_all(path.parent().expect("родительская директория"))
        .expect("создание каталога манифеста");
    std::fs::write(&path, manifest.to_string()).expect("запись манифеста лоадера");
    path
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

pub struct ConfigFileGuard;

impl ConfigFileGuard {
    pub fn acquire(root: &Path, name: &str) -> Self {
        crate::state::launcher_config::set_config_file_path_for_tests(Some(root.join(name)));
        Self
    }
}

impl Drop for ConfigFileGuard {
    fn drop(&mut self) {
        crate::state::launcher_config::set_config_file_path_for_tests(None);
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

pub enum ServersDatContainer {
    Raw,
    Gzip,
    Zlib,
}

pub fn write_servers_dat(dir: &Path, ip: &str, container: ServersDatContainer) {
    let mut nbt = Vec::new();
    nbt.push(0x0A);
    nbt.extend_from_slice(&0u16.to_be_bytes());
    nbt.push(0x09);
    nbt.extend_from_slice(&7u16.to_be_bytes());
    nbt.extend_from_slice(b"servers");
    nbt.push(0x0A);
    nbt.extend_from_slice(&1u32.to_be_bytes());
    nbt.push(0x08);
    nbt.extend_from_slice(&2u16.to_be_bytes());
    nbt.extend_from_slice(b"ip");
    nbt.extend_from_slice(&(ip.len() as u16).to_be_bytes());
    nbt.extend_from_slice(ip.as_bytes());
    nbt.push(0x00);
    nbt.push(0x00);

    let bytes = match container {
        ServersDatContainer::Raw => nbt,
        ServersDatContainer::Gzip => {
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            encoder.write_all(&nbt).expect("gzip сжатие");
            encoder.finish().expect("завершение gzip")
        }
        ServersDatContainer::Zlib => {
            let mut encoder =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            encoder.write_all(&nbt).expect("zlib сжатие");
            encoder.finish().expect("завершение zlib")
        }
    };
    std::fs::write(dir.join("servers.dat"), bytes).expect("запись servers.dat");
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
