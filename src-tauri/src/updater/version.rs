use anyhow::{Context, Result};
use serde::Deserialize;

use crate::utils::env_info::{get_arch, get_current_os};
use crate::utils::compare_versions;
use std::cmp::Ordering;

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct Platform {
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub platforms: Option<Vec<Platform>>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateVersionInfo {
    pub version: String,
    pub platforms: Vec<Platform>,
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
    let server_url = env!("LAUNCHER_SERVER_URL");
    let url = format!("{}/launcher/version", server_url);

    let client = crate::utils::http::http_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .context("Не удалось подключиться к серверу обновлений")?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let info: UpdateInfo = resp
        .json()
        .await
        .context("Не удалось распарсить информацию об обновлении")?;

    if compare_versions(&info.version, current_version) != Ordering::Greater {
        return Ok(None);
    }

    if let Some(ref platforms) = info.platforms {
        let os = get_current_os();
        let arch = get_arch();
        let supported = platforms
            .iter()
            .any(|p| p.os == os && arch_matches(&p.arch, arch));
        if !supported {
            crate::log_info!(
                "Обновление v{} доступно, но не поддерживает platform {}:{}",
                info.version, os, arch
            );
            return Ok(None);
        }
    }

    Ok(Some(info))
}
