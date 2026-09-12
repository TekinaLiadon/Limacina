pub mod alternative_java;

use anyhow::{bail,Result};
use std::{
    cmp::Ordering,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

use crate::{
    log_info,
    minecraft::manifest::{get_manifest_index, get_manifest_version, VERSION_MANIFEST_URL},
    minecraft::vanilla::{manifest::create_manifest_versions, structs::VanillaVersionsManifest},
    state::dto::ProjectConfig,
    step_try,
    utils::{
        compare_versions, download_file::download_file, env_info::{get_arch, get_current_os, launcher_path},
        step_events::StepHandle,
    },
};
use tokio::{
    fs::{self},
    task,
};

pub async fn install_java(config: &ProjectConfig) -> Result<PathBuf> {
    let java_version = resolve_java_version(&config.mc_version).await;
    let java_dir = launcher_path(None)?.join("java").join(&java_version);

    let check_step = StepHandle::start("java.check", "Проверка Java");
    if let Ok(executable_path) = find_java_executable(&java_dir) {
        log_info!("[java] Java {} уже установлена: {:?}", java_version, executable_path);
        check_step.finish(true);
        return Ok(executable_path);
    }
    check_step.finish(false);

    let download_step = StepHandle::start("java.download", "Скачивание Java");
    let archive_path = step_try!(download_step, download_archive(&java_dir, &java_version).await);
    download_step.finish(false);

    let extract_step = StepHandle::start("java.extract", "Распаковка Java");
    step_try!(extract_step, working_archive(&java_dir, &archive_path, "eclipse").await);
    extract_step.finish(false);

    let executable_path = find_java_executable(&java_dir)?;
    Ok(executable_path)
}

async fn download_archive(java_dir: &Path, java_version: &str) -> Result<PathBuf> {
    let os = get_current_os();
    let arch = match get_arch() {
        "x86_64" => "x64",
        other => other,
    };
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jre/hotspot/normal/eclipse",
        java_version, os, arch
    );

    let extension = if cfg!(target_os = "windows") {
        "zip"
    } else {
        "tar.gz"
    };
    let archive_path = java_dir.join(format!("archive.{}", extension));

    download_file(&url, &archive_path).await?;
    Ok(archive_path)
}

pub(crate) fn get_java_version(mc_version: &str) -> String {
    let base_version = mc_version.split('-').next().unwrap_or(mc_version);

    if compare_versions(base_version, "1.20.5") != Ordering::Less {
        "21".to_string()
    } else if compare_versions(base_version, "1.16.5") == Ordering::Greater {
        "17".to_string()
    } else {
        "8".to_string()
    }
}

async fn manifest_java_major(mc_version: &str) -> Option<u32> {
    let index = get_manifest_index::<VanillaVersionsManifest>("vanilla", VERSION_MANIFEST_URL, "index")
        .await
        .ok()?;
    let versions = create_manifest_versions(index.versions).ok()?;
    let manifest = get_manifest_version(mc_version, versions).await.ok()?;
    manifest.java_version.map(|j| j.major_version)
}

pub(crate) async fn resolve_java_version(mc_version: &str) -> String {
    match manifest_java_major(mc_version).await {
        Some(major) => {
            log_info!("[java] Для Minecraft {} по манифесту требуется Java {}", mc_version, major);
            major.to_string()
        }
        None => {
            let fallback = get_java_version(mc_version);
            log_info!(
                "[java] Требуемая версия Java недоступна из манифеста, для Minecraft {} выбрана Java {}",
                mc_version,
                fallback
            );
            fallback
        }
    }
}

pub(crate) async fn working_archive(java_path: &PathBuf, archive_path: &PathBuf, vendor: &str) -> Result<()> {
    let java_path_extract = java_path.clone();
    let archive_path_extract = archive_path.clone();
    task::spawn_blocking(move || extract_archive(&archive_path_extract, &java_path_extract))
        .await??;

    fs::remove_file(archive_path).await?;
    rename_java_dir(java_path, vendor).await?;
    Ok(())
}

pub(crate) fn extract_archive(archive_path: &Path, target_dir: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        crate::utils::zip::extract_zip(archive_path, target_dir)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        use flate2::read::GzDecoder;
        use std::fs::File;
        use tar::Archive;

        let file = File::open(archive_path)?;
        let tar = GzDecoder::new(file);
        let mut archive = Archive::new(tar);
        archive.unpack(target_dir)?;
    }

    Ok(())
}

pub(crate) async fn rename_java_dir(java_path: &PathBuf, vendor: &str) -> Result<()> {
    let new_path = java_path.join(vendor);
    if new_path.exists() {
        return Ok(());
    }

    let mut entries = fs::read_dir(java_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.is_dir() {
            let folder_name = entry.file_name();
            let folder_name_str = folder_name.to_string_lossy();

            if folder_name_str != vendor && !folder_name_str.starts_with("archive") {
                fs::rename(&path, &new_path).await?;
                break;
            }
        }
    }

    Ok(())
}

pub(crate) fn find_java_executable(base_dir: &Path) -> Result<PathBuf> {
    let target_name = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };

    for entry in WalkDir::new(base_dir).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() && entry.file_name() == target_name {
            if let Some(parent) = entry.path().parent() {
                if parent.file_name().and_then(|n| n.to_str()) == Some("bin") {
                    return Ok(entry.into_path());
                }
            }
        }
    }
    bail!("Не удалось найти исполняемый файл Java после распаковки");
}

#[cfg(test)]
mod tests {
    use super::get_java_version;
    use crate::minecraft::vanilla::structs::VersionDetailsManifest;

    #[test]
    fn java_version_table_covers_known_minecraft_eras() {
        assert_eq!(get_java_version("1.8.9"), "8");
        assert_eq!(get_java_version("1.12.2"), "8");
        assert_eq!(get_java_version("1.16.5"), "8");
        assert_eq!(get_java_version("1.17"), "17");
        assert_eq!(get_java_version("1.18.2"), "17");
        assert_eq!(get_java_version("1.20.4"), "17");
        assert_eq!(get_java_version("1.20.5"), "21");
        assert_eq!(get_java_version("1.21.1"), "21");
        assert_eq!(get_java_version("1.21.8"), "21");
    }

    #[test]
    fn manifest_java_version_is_parsed() {
        let manifest: VersionDetailsManifest = serde_json::from_str(
            r#"{
                "id": "26.2",
                "downloads": {"client": {"sha1": "", "size": 0, "url": ""}},
                "libraries": [],
                "assetIndex": {"id": "x", "sha1": "", "size": 0, "url": "", "totalSize": 0},
                "assets": "x",
                "mainClass": "net.minecraft.client.main.Main",
                "javaVersion": {"component": "java-runtime-epsilon", "majorVersion": 25}
            }"#,
        )
        .unwrap();

        let java_version = manifest.java_version.unwrap();
        assert_eq!(java_version.major_version, 25);
        assert_eq!(java_version.component, "java-runtime-epsilon");
    }

    #[test]
    fn manifest_without_java_version_defaults_to_none() {
        let manifest: VersionDetailsManifest = serde_json::from_str(
            r#"{
                "id": "1.0",
                "downloads": {"client": {"sha1": "", "size": 0, "url": ""}},
                "libraries": [],
                "assetIndex": {"id": "x", "sha1": "", "size": 0, "url": "", "totalSize": 0},
                "assets": "x",
                "mainClass": "net.minecraft.client.main.Main"
            }"#,
        )
        .unwrap();

        assert!(manifest.java_version.is_none());
    }
}
