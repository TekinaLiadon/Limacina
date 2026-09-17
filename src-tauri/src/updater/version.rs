use anyhow::Result;
use serde::Deserialize;

use crate::utils::compare_versions;
use crate::utils::env_info::{default_server_url, get_arch, get_current_os};
use crate::utils::errors::LauncherError;
use crate::utils::http::with_launcher_id;

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
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateVersionEntry {
    pub version: String,
    #[serde(default)]
    pub platforms: Vec<Platform>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateVersions {
    pub version: String,
    pub platforms: Vec<Platform>,
    pub versions: Vec<UpdateVersionEntry>,
}

fn arch_matches(server_arch: &str, local_arch: &str) -> bool {
    match (server_arch, local_arch) {
        ("x64" | "x86_64", "x64" | "x86_64") => true,
        (a, b) => a == b,
    }
}

pub async fn get_launcher_versions() -> Result<UpdateVersions> {
    let server_url =
        default_server_url().ok_or(crate::utils::errors::LauncherError::UpdateServerMissing)?;
    let url = format!("{server_url}/v1/launcher/update/version");

    let resp = with_launcher_id(crate::utils::http::http_client().get(&url))
        .send()
        .await
        .map_err(|e| {
            LauncherError::Update(format!(
                "Не удалось подключиться к серверу обновлений: {e:#}"
            ))
        })?
        .error_for_status()
        .map_err(|e| {
            LauncherError::Update(format!(
                "Сервер вернул ошибку при получении списка версий: {e:#}"
            ))
        })?;

    let data: UpdateVersions = resp.json().await.map_err(|e| {
        LauncherError::Update(format!("Не удалось распарсить список версий: {e:#}"))
    })?;

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

pub fn is_timeout_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<reqwest::Error>()
            .is_some_and(|e| e.is_timeout())
    })
}

pub fn compare_with_current(remote: &str, current: &str) -> bool {
    compare_versions(remote, current) == std::cmp::Ordering::Greater
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_with_current_detects_newer_remote_only() {
        assert!(compare_with_current("1.4.0", "1.3.6"));
        assert!(!compare_with_current("1.3.6", "1.3.6"));
        assert!(!compare_with_current("1.3.5", "1.3.6"));
    }
}
