use anyhow::{Context, Result};
use serde::Deserialize;
use std::cmp::Ordering;
use std::time::Duration;

use crate::utils::compare_versions;
use crate::utils::env_info::{default_server_url, get_arch, get_current_os};

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct Platform {
    pub os: String,
    pub arch: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub platforms: Vec<Platform>,
    #[serde(default)]
    pub sha256: Option<String>,
}

pub type UpdateVersionInfo = UpdateInfo;

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
    fetch_update_versions(None).await
}

async fn fetch_update_versions(timeout: Option<Duration>) -> Result<UpdateVersions> {
    let server_url =
        default_server_url().ok_or(crate::utils::errors::LauncherError::UpdateServerMissing)?;
    let url = format!("{}/v1/launcher/update/version", server_url);

    let client = crate::utils::http::http_client();
    let mut request = client.get(&url);
    if let Some(timeout) = timeout {
        request = request.timeout(timeout);
    }
    let resp = request
        .send()
        .await
        .context("Не удалось подключиться к серверу обновлений")?
        .error_for_status()
        .context("Сервер вернул ошибку при получении списка версий")?;

    let data: UpdateVersions = resp
        .json()
        .await
        .context("Не удалось распарсить список версий")?;

    Ok(data)
}

pub fn retain_current_platform(versions: &mut UpdateVersions) {
    let os = get_current_os();
    let arch = get_arch();
    versions.versions.retain(|entry| {
        entry
            .platforms
            .iter()
            .any(|p| p.os == os && arch_matches(&p.arch, arch))
    });
}

pub async fn check_for_update(current_version: &str) -> Result<Option<UpdateInfo>> {
    let data = fetch_update_versions(None).await?;
    Ok(evaluate_update(&data, current_version))
}

pub async fn check_for_update_with_timeout(
    current_version: &str,
    timeout: Duration,
) -> Result<Option<UpdateInfo>> {
    let data = fetch_update_versions(Some(timeout)).await?;
    Ok(evaluate_update(&data, current_version))
}

fn evaluate_update(data: &UpdateVersions, current_version: &str) -> Option<UpdateInfo> {
    if compare_versions(&data.version, current_version) != Ordering::Greater {
        return None;
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
            data.version,
            os,
            arch
        );
        return None;
    }

    let sha256 = platform_sha256(&data.platforms, os, arch);
    Some(UpdateInfo {
        version: data.version.clone(),
        platforms: data.platforms.clone(),
        sha256,
    })
}

pub fn is_timeout_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<reqwest::Error>()
            .is_some_and(|e| e.is_timeout())
    })
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

    fn update_versions(version: &str, platforms: Vec<Platform>) -> UpdateVersions {
        UpdateVersions {
            version: version.to_string(),
            platforms,
            versions: Vec::new(),
        }
    }

    #[test]
    fn evaluate_no_update_for_same_or_older_version() {
        let data = update_versions("1.3.0", vec![platform("linux", "x86_64", None)]);
        assert!(evaluate_update(&data, "1.3.0").is_none());
        assert!(evaluate_update(&data, "1.3.1").is_none());
    }

    #[test]
    fn evaluate_update_for_newer_supported_platform() {
        let data = update_versions("1.4.0", vec![platform("linux", "x86_64", Some("hash"))]);
        let info = evaluate_update(&data, "1.3.0").expect("update expected");
        assert_eq!(info.version, "1.4.0");
        assert_eq!(info.sha256.as_deref(), Some("hash"));
        assert_eq!(info.platforms.len(), 1);
    }

    #[test]
    fn evaluate_skips_update_without_supported_platform() {
        let data = update_versions("1.4.0", vec![platform("windows", "x86_64", None)]);
        assert!(evaluate_update(&data, "1.3.0").is_none());
    }
}
