use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs::{create_dir_all, read_dir, remove_file, rename};
use tokio::task::spawn_blocking;

use crate::java::java::{extract_archive, find_java_executable, get_java_version};
use crate::utils::download_file::download_file;
use crate::utils::env_info::{get_arch, get_current_os, launcher_patch};

#[derive(Serialize, Clone)]
pub struct JavaDistribution {
    pub name: String,
    #[serde(rename = "apiParameter")]
    pub api_parameter: String,
}

#[derive(Deserialize)]
struct FoojayLinks {
    pkg_download_redirect: String,
}

#[derive(Deserialize)]
struct FoojayPackageResult {
    archive_type: String,
    links: Option<FoojayLinks>,
}

#[derive(Deserialize)]
struct FoojayPackagesResponse {
    result: Vec<FoojayPackageResult>,
}

const SUPPORTED_ARCHIVE_TYPES: &[&str] = &["tar.gz", "zip"];

pub fn get_java_distributions_list() -> Vec<JavaDistribution> {
    vec![
        JavaDistribution { name: "Zulu".to_string(), api_parameter: "zulu".to_string() },
        JavaDistribution { name: "Temurin".to_string(), api_parameter: "temurin".to_string() },
        JavaDistribution { name: "Corretto".to_string(), api_parameter: "corretto".to_string() },
        JavaDistribution { name: "Liberica".to_string(), api_parameter: "liberica".to_string() },
        JavaDistribution { name: "Semeru".to_string(), api_parameter: "semeru".to_string() },
        JavaDistribution { name: "SAP Machine".to_string(), api_parameter: "sap_machine".to_string() },
        JavaDistribution { name: "Oracle OpenJDK".to_string(), api_parameter: "oracle_open_jdk".to_string() },
        JavaDistribution { name: "OpenLogic".to_string(), api_parameter: "openlogic".to_string() },
        JavaDistribution { name: "Microsoft".to_string(), api_parameter: "microsoft".to_string() },
        JavaDistribution { name: "Dragonwell".to_string(), api_parameter: "dragonwell".to_string() },
        JavaDistribution { name: "JetBrains".to_string(), api_parameter: "jetbrains".to_string() },
        JavaDistribution { name: "Kona".to_string(), api_parameter: "kona".to_string() },
        JavaDistribution { name: "GraalVM CE".to_string(), api_parameter: "graalvm_community".to_string() },
    ]
}

async fn fetch_package(
    client: &reqwest::Client,
    distribution: &str,
    version: &str,
    arch: &str,
    os: &str,
    package_type: &str,
) -> Result<Option<(String, String)>> {
    let url = format!(
        "https://api.foojay.io/disco/v3.0/packages?distribution={}&version={}&architecture={}&operating_system={}&package_type={}&release_status=ga&latest=per_version&directly_downloadable=true",
        distribution, version, arch, os, package_type
    );

    let response = client
        .get(&url)
        .send()
        .await
        .context("Не удалось запросить пакеты у Foojay API")?
        .error_for_status()
        .context("Foojay API вернул ошибку")?;

    let packages: FoojayPackagesResponse = response
        .json()
        .await
        .context("Не удалось распарсить ответ Foojay API")?;

    let pkg = packages
        .result
        .into_iter()
        .find(|p| {
            SUPPORTED_ARCHIVE_TYPES.contains(&p.archive_type.as_str())
                && p.links
                    .as_ref()
                    .map_or(false, |l| !l.pkg_download_redirect.is_empty())
        });

    Ok(pkg.map(|p| (p.links.unwrap().pkg_download_redirect, p.archive_type)))
}

async fn collect_dirs(path: &PathBuf) -> Result<Vec<String>> {
    let mut dirs = Vec::new();
    let mut entries = read_dir(path).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await.map_or(false, |t| t.is_dir()) {
            dirs.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    Ok(dirs)
}

pub async fn download_alt_java(
    distribution: &str,
    java_version: Option<&str>,
    mc_version: &str,
) -> Result<PathBuf> {
    let version = java_version.unwrap_or_else(|| {
        let v = get_java_version(mc_version);
        Box::leak(v.into_boxed_str())
    });

    let os = get_current_os();
    let arch = match get_arch() {
        "x86_64" => "x64",
        other => other,
    };

    let os_foojay = match os {
        "osx" => "macos",
        other => other,
    };

    let client = reqwest::Client::new();

    let (download_url, archive_type) = match fetch_package(&client, distribution, version, arch, os_foojay, "jre").await? {
        Some(result) => result,
        None => {
            fetch_package(&client, distribution, version, arch, os_foojay, "jdk")
                .await?
                .ok_or_else(|| anyhow::anyhow!("Foojay API не вернул файлов для скачивания (ни JRE, ни JDK)"))?
        }
    };

    let base_path = launcher_patch(None)?;
    let java_parent = base_path.join("java").join(version);
    let java_path = java_parent.join(distribution);
    let archive_path = java_parent.join(format!("archive_{}.{}", distribution, archive_type));

    create_dir_all(&java_parent).await?;

    let existing_dirs: Vec<String> = collect_dirs(&java_parent).await?;

    download_file(&download_url, &archive_path).await?;

    let java_parent_clone = java_parent.clone();
    let archive_clone = archive_path.clone();
    spawn_blocking(move || extract_archive(&archive_clone, &java_parent_clone))
        .await??;

    remove_file(&archive_path).await?;

    let new_dirs: Vec<String> = collect_dirs(&java_parent)
        .await?
        .into_iter()
        .filter(|d| !existing_dirs.contains(d))
        .collect();

    let to = java_parent.join(distribution);
    if !to.exists() {
        if let Some(extracted_dir) = new_dirs.into_iter().next() {
            let from = java_parent.join(&extracted_dir);
            if from != to {
                rename(&from, &to).await?;
            }
        }
    }

    let exe = find_java_executable(&java_path)?;
    Ok(exe)
}
