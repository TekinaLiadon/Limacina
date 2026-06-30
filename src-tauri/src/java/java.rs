use anyhow::{bail,Result};
use std::{
    cmp::Ordering,
    fs::File,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

use crate::{
    state::dto::ProjectConfig,
    utils::{
        compare_versions, download_file::download_file, env_info::{get_arch, get_current_os, launcher_patch}
    },
};
use tokio::{
    fs::{self},
    task,
};

pub async fn install_java(config: &ProjectConfig) -> Result<PathBuf> {
    let (java_dir, archive_path) = download_archive(&config.mc_version).await?;
    working_archive(&java_dir, &archive_path).await?;
    let executable_path = find_java_executable(&java_dir)?;
    Ok(executable_path)
}

async fn download_archive(mc_version: &str) -> Result<(PathBuf, PathBuf)> {
    let java_version = get_java_version(mc_version);
    let os = get_current_os();
    let arch = match get_arch() {
        "x86_64" => "x64",
        other => other,
    };
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jre/hotspot/normal/eclipse",
        java_version, os, arch
    ); // vendor

    let base_path = launcher_patch(None)?;
    let extension = if cfg!(target_os = "windows") {
        "zip"
    } else {
        "tar.gz"
    };
    let java_path = base_path.join("java").join(java_version);
    let archive_path = java_path.join(format!("archive.{}", extension));

    download_file(&url, &archive_path).await?;
    Ok((java_path, archive_path))
}

fn get_java_version(mc_version: &str) -> String {
    if compare_versions(&mc_version, "1.20.5") == Ordering::Greater {
        return "21".to_string();
    }
    if compare_versions(&mc_version, "1.16.5") == Ordering::Greater {
        return "17".to_string();
    }

    return "8".to_string();
}

async fn working_archive(java_path: &PathBuf, archive_path: &PathBuf) -> Result<()> {
    let vendor = "eclipse";
    let java_path_extract = java_path.clone();
    let archive_path_extract = archive_path.clone();
    task::spawn_blocking(move || extract_archive(&archive_path_extract, &java_path_extract))
        .await??;

    fs::remove_file(archive_path).await?;
    rename_java_dir(&java_path, &vendor).await?;
    Ok(())
}

fn extract_archive(archive_path: &Path, target_dir: &Path) -> Result<()> {
    let file = File::open(archive_path)?;

    #[cfg(target_os = "windows")]
    {
        let mut archive = zip::ZipArchive::new(file)?;
        archive.extract(target_dir)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        use flate2::read::GzDecoder;
        use tar::Archive;

        let tar = GzDecoder::new(file);
        let mut archive = Archive::new(tar);
        archive.unpack(target_dir)?;
    }

    Ok(())
}

async fn rename_java_dir(java_path: &PathBuf, vendor: &str) -> Result<()> {
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

            if folder_name_str.starts_with("jdk") {
                fs::rename(&path, &new_path).await?;
                break;
            }
        }
    }

    Ok(())
}

fn find_java_executable(base_dir: &Path) -> Result<PathBuf> {
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
