use anyhow::{Context, Result};
use serde::Deserialize;

use crate::utils::env_info::{get_arch, get_current_os};
use crate::utils::compare_versions;
use std::cmp::Ordering;

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct Platform {
    pub os: String,
    pub arch: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub platforms: Vec<Platform>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateVersionInfo {
    pub version: String,
    pub platforms: Vec<Platform>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateVersions {
    pub version: String,
    pub platforms: Vec<Platform>,
    pub versions: Vec<UpdateVersionInfo>,
}

fn arch_matches(server_arch: &str, local_arch: &str) -> bool {
    match (server_arch, local_arch) {
        ("x64" | "x86_64", "x64" | "x86_64") => true,
        (a, b) => a == b,
    }
}

pub async fn get_launcher_versions() -> Result<UpdateVersions> {
    let server_url = env!("LAUNCHER_SERVER_URL");
    let url = format!("{}/v1/launcher/update/version", server_url);

    let client = crate::utils::http::http_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .context("Не удалось подключиться к серверу обновлений")?
        .error_for_status()
        .context("Сервер вернул ошибку при получении списка версий")?;

    let mut data: UpdateVersions = resp
        .json()
        .await
        .context("Не удалось распарсить список версий")?;

    let os = get_current_os();
    let arch = get_arch();
    data.versions.retain(|entry| {
        entry
            .platforms
            .iter()
            .any(|p| p.os == os && arch_matches(&p.arch, arch))
    });

    Ok(data)
}

pub async fn check_for_update(current_version: &str) -> Result<Option<UpdateInfo>> {
    let data = get_launcher_versions().await?;

    if compare_versions(&data.version, current_version) != Ordering::Greater {
        return Ok(None);
    }

    let os = get_current_os();
    let arch = get_arch();
    let supported = data
        .platforms
        .iter()
        .any(|p| p.os == os && arch_matches(&p.arch, arch));
    if !supported {
        crate::log_info!(
            "Обновление v{} доступно, но не поддерживает platform {}:{}",
            data.version, os, arch
        );
        return Ok(None);
    }

    let sha256 = platform_sha256(&data.platforms, os, arch);
    Ok(Some(UpdateInfo {
        version: data.version,
        platforms: data.platforms,
        sha256,
    }))
}

pub fn platform_sha256(platforms: &[Platform], os: &str, arch: &str) -> Option<String> {
    platforms
        .iter()
        .find(|p| p.os == os && arch_matches(&p.arch, arch))
        .and_then(|p| p.sha256.clone())
        .filter(|h| !h.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn platform(os: &str, arch: &str, sha256: Option<&str>) -> Platform {
        Platform {
            os: os.to_string(),
            arch: arch.to_string(),
            sha256: sha256.map(String::from),
        }
    }

    #[test]
    fn sha256_resolved_for_matching_platform() {
        let platforms = vec![
            platform("windows", "x86_64", None),
            platform("linux", "x86_64", Some("abc123")),
        ];
        assert_eq!(
            platform_sha256(&platforms, "linux", "x86_64").as_deref(),
            Some("abc123")
        );
    }

    #[test]
    fn sha256_skipped_for_other_platform_or_missing() {
        let platforms = vec![
            platform("windows", "x86_64", Some("win-hash")),
            platform("linux", "aarch64", None),
        ];
        assert_eq!(platform_sha256(&platforms, "linux", "aarch64"), None);
        assert_eq!(platform_sha256(&platforms, "osx", "x86_64"), None);
    }

    #[test]
    fn sha256_empty_string_treated_as_missing() {
        let platforms = vec![platform("linux", "x86_64", Some("   "))];
        assert_eq!(platform_sha256(&platforms, "linux", "x86_64"), None);
    }
}
