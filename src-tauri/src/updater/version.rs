use anyhow::Result;
use serde::Deserialize;

use crate::utils::compare_versions;
use crate::utils::env_info::{default_server_url, get_arch, get_current_os};
use crate::utils::errors::LauncherError;
use crate::utils::http::with_launcher_id;

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct UpdateRelease {
    pub version: String,
    pub platforms: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ReleasesResponse {
    releases: Vec<UpdateRelease>,
}

fn arch_matches(server_arch: &str, local_arch: &str) -> bool {
    match (server_arch, local_arch) {
        ("x64" | "x86_64", "x64" | "x86_64") => true,
        (a, b) => a == b,
    }
}

pub fn platform_key_matches(key: &str, os: &str, arch: &str) -> bool {
    let Some((key_os, key_rest)) = key.split_once('-') else {
        return false;
    };
    let key_arch = match key_rest.split_once('-') {
        Some((arch, _installer)) => arch,
        None => key_rest,
    };
    let os_matches = match (key_os, os) {
        ("darwin", "osx") => true,
        (a, b) => a == b,
    };
    os_matches && arch_matches(key_arch, arch)
}

pub async fn get_launcher_versions() -> Result<Vec<UpdateRelease>> {
    let server_url = default_server_url().ok_or(LauncherError::UpdateServerMissing)?;
    fetch_releases(&server_url).await
}

async fn fetch_releases(server_url: &str) -> Result<Vec<UpdateRelease>> {
    let url = format!("{server_url}/v1/launcher/update/releases");

    let resp = with_launcher_id(crate::utils::http::http_client().get(&url))
        .send()
        .await
        .map_err(|_| {
            LauncherError::Update("Не удалось подключиться к серверу обновлений".to_string())
        })?
        .error_for_status()
        .map_err(|e| {
            LauncherError::Update(format!(
                "Сервер вернул ошибку при получении списка версий: {}",
                e.status()
                    .map(|status| status.as_str().to_string())
                    .unwrap_or_else(|| "нет ответа".to_string())
            ))
        })?;

    let data: ReleasesResponse = resp
        .json()
        .await
        .map_err(|_| LauncherError::Update("Не удалось распарсить список версий".to_string()))?;

    Ok(data.releases)
}

pub fn retain_current_platform(releases: &mut Vec<UpdateRelease>) -> Result<()> {
    let os = get_current_os();
    let arch = get_arch()?;
    releases.retain(|release| {
        release
            .platforms
            .iter()
            .any(|key| platform_key_matches(key, os, arch))
    });
    Ok(())
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
    use mockito::Server;
    use serde_json::json;

    #[test]
    fn compare_with_current_detects_newer_remote_only() {
        assert!(compare_with_current("1.4.0", "1.3.6"));
        assert!(!compare_with_current("1.3.6", "1.3.6"));
        assert!(!compare_with_current("1.3.5", "1.3.6"));
    }

    #[test]
    fn platform_key_matches_tauri_platform_keys() {
        assert!(platform_key_matches("linux-x86_64", "linux", "x86_64"));
        assert!(platform_key_matches("windows-x86_64", "windows", "x64"));
        assert!(platform_key_matches("darwin-aarch64", "osx", "aarch64"));
        assert!(!platform_key_matches("windows-x86_64", "linux", "x86_64"));
        assert!(!platform_key_matches("linux-aarch64", "linux", "x86_64"));
        assert!(!platform_key_matches("nodash", "linux", "x86_64"));
    }

    #[test]
    fn platform_key_matches_installer_suffix_keys() {
        assert!(platform_key_matches(
            "windows-x86_64-nsis",
            "windows",
            "x64"
        ));
        assert!(platform_key_matches(
            "windows-x86_64-nsis",
            "windows",
            "x86_64"
        ));
        assert!(platform_key_matches(
            "linux-x86_64-appimage",
            "linux",
            "x86_64"
        ));
        assert!(platform_key_matches("darwin-aarch64-app", "osx", "aarch64"));
        assert!(!platform_key_matches(
            "windows-x86_64-nsis",
            "linux",
            "x86_64"
        ));
        assert!(!platform_key_matches(
            "windows-aarch64-nsis",
            "windows",
            "x64"
        ));
        assert!(!platform_key_matches(
            "linux-aarch64-nsis",
            "linux",
            "x86_64"
        ));
    }

    #[tokio::test]
    async fn fetch_releases_parses_published_releases() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/update/releases")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "releases": [
                        {
                            "version": "0.5.1",
                            "pubDate": "2026-09-20T07:58:05.877Z",
                            "platforms": ["linux-x86_64", "windows-x86_64"]
                        },
                        {
                            "version": "0.5.0",
                            "pubDate": "2026-09-19T14:04:28.336Z",
                            "platforms": ["windows-x86_64"]
                        }
                    ]
                })
                .to_string(),
            )
            .create_async()
            .await;

        let releases = fetch_releases(&server.url()).await.expect("релизы");
        assert_eq!(releases.len(), 2);
        assert_eq!(releases[0].version, "0.5.1");
        assert_eq!(
            releases[0].platforms,
            vec!["linux-x86_64", "windows-x86_64"]
        );
        assert_eq!(releases[1].version, "0.5.0");
        assert_eq!(releases[1].platforms, vec!["windows-x86_64"]);
    }

    #[tokio::test]
    async fn fetch_releases_hides_url_on_connect_error() {
        let error = fetch_releases("http://127.0.0.1:1")
            .await
            .expect_err("подключение к закрытому порту должно падать");
        let text = error.to_string();
        assert_eq!(
            text,
            "Ошибка обновления: Не удалось подключиться к серверу обновлений"
        );
        assert!(
            !text.contains("127.0.0.1"),
            "адрес сервера не должен попадать в текст ошибки: {text}"
        );
    }

    #[tokio::test]
    async fn fetch_releases_reports_http_error() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/update/releases")
            .with_status(500)
            .create_async()
            .await;

        let error = fetch_releases(&server.url())
            .await
            .expect_err("500 должен давать ошибку");
        let text = error.to_string();
        assert!(
            text.contains("Сервер вернул ошибку при получении списка версий: 500"),
            "текст должен называть статус: {text}"
        );
        assert!(
            !text.contains("127.0.0.1"),
            "адрес сервера не должен попадать в текст ошибки: {text}"
        );
    }

    #[test]
    fn retain_current_platform_keeps_only_matching_platforms() {
        let os = get_current_os();
        let arch = get_arch().expect("поддерживаемая архитектура");
        let matches_current = |key: &str| platform_key_matches(key, os, arch);
        let all_platform_keys = [
            "linux-x86_64",
            "windows-x86_64",
            "darwin-aarch64",
            "linux-aarch64",
            "windows-x86_64-nsis",
        ];
        let non_matching_key = all_platform_keys
            .iter()
            .copied()
            .find(|key| !matches_current(key))
            .expect("существует платформа, не совпадающая с текущей");

        let mut releases = vec![
            UpdateRelease {
                version: "multi".to_string(),
                platforms: all_platform_keys
                    .iter()
                    .map(|key| key.to_string())
                    .collect(),
            },
            UpdateRelease {
                version: "other".to_string(),
                platforms: vec![non_matching_key.to_string()],
            },
            UpdateRelease {
                version: "none".to_string(),
                platforms: vec![],
            },
        ];
        retain_current_platform(&mut releases).expect("фильтр платформ");

        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].version, "multi");
    }
}
