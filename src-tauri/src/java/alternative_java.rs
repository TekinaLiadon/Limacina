use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs::create_dir_all;

use crate::java::{install_java_archive, remove_stale_archive, resolve_java_version};
use crate::log_err;
use crate::utils::download_file::{download_file, file_sha256, file_sha512};
use crate::utils::env_info::{ensure_safe_relative_path, get_arch, get_current_os, launcher_path};
use crate::utils::errors::LauncherError;

#[derive(Serialize, Clone)]
pub struct JavaDistribution {
    pub name: String,
    #[serde(rename = "apiParameter")]
    pub api_parameter: String,
}

#[derive(Deserialize)]
struct FoojayLinks {
    pkg_download_redirect: String,
    pkg_info_uri: String,
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

#[derive(Deserialize)]
struct FoojayPackageInfo {
    checksum: Option<String>,
    checksum_type: Option<String>,
}

#[derive(Deserialize)]
struct FoojayPackageInfoResponse {
    result: Vec<FoojayPackageInfo>,
}

fn is_supported_archive_type(archive_type: &str) -> bool {
    if cfg!(target_os = "windows") {
        archive_type == "zip"
    } else {
        archive_type == "tar.gz"
    }
}

pub fn get_java_distributions_list() -> Vec<JavaDistribution> {
    vec![
        JavaDistribution {
            name: "Zulu".to_string(),
            api_parameter: "zulu".to_string(),
        },
        JavaDistribution {
            name: "Temurin".to_string(),
            api_parameter: "temurin".to_string(),
        },
        JavaDistribution {
            name: "Corretto".to_string(),
            api_parameter: "corretto".to_string(),
        },
        JavaDistribution {
            name: "Liberica".to_string(),
            api_parameter: "liberica".to_string(),
        },
        JavaDistribution {
            name: "Semeru".to_string(),
            api_parameter: "semeru".to_string(),
        },
        JavaDistribution {
            name: "SAP Machine".to_string(),
            api_parameter: "sap_machine".to_string(),
        },
        JavaDistribution {
            name: "Oracle OpenJDK".to_string(),
            api_parameter: "oracle_open_jdk".to_string(),
        },
        JavaDistribution {
            name: "OpenLogic".to_string(),
            api_parameter: "openlogic".to_string(),
        },
        JavaDistribution {
            name: "Microsoft".to_string(),
            api_parameter: "microsoft".to_string(),
        },
        JavaDistribution {
            name: "Dragonwell".to_string(),
            api_parameter: "dragonwell".to_string(),
        },
        JavaDistribution {
            name: "JetBrains".to_string(),
            api_parameter: "jetbrains".to_string(),
        },
        JavaDistribution {
            name: "Kona".to_string(),
            api_parameter: "kona".to_string(),
        },
        JavaDistribution {
            name: "GraalVM CE".to_string(),
            api_parameter: "graalvm_community".to_string(),
        },
    ]
}

async fn fetch_package(
    client: &reqwest::Client,
    distribution: &str,
    version: &str,
    arch: &str,
    os: &str,
    package_type: &str,
) -> Result<Option<(String, String, String)>> {
    let url = reqwest::Url::parse_with_params(
        "https://api.foojay.io/disco/v3.0/packages",
        &[
            ("distribution", distribution),
            ("version", version),
            ("architecture", arch),
            ("operating_system", os),
            ("package_type", package_type),
            ("release_status", "ga"),
            ("latest", "per_version"),
            ("directly_downloadable", "true"),
        ],
    )
    .map_err(|e| LauncherError::Java(format!("Не удалось собрать запрос к Foojay API: {e}")))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| LauncherError::Java(format!("Не удалось запросить пакеты у Foojay API: {e}")))?
        .error_for_status()
        .map_err(|e| LauncherError::Java(format!("Foojay API вернул ошибку: {e:#}")))?;

    let packages: FoojayPackagesResponse = response.json().await.map_err(|e| {
        LauncherError::Java(format!("Не удалось распарсить ответ Foojay API: {e:#}"))
    })?;

    let pkg = packages.result.into_iter().find_map(|p| {
        let links = p.links.as_ref()?;
        if is_supported_archive_type(&p.archive_type)
            && !links.pkg_download_redirect.is_empty()
            && !links.pkg_info_uri.is_empty()
        {
            Some((
                links.pkg_download_redirect.clone(),
                links.pkg_info_uri.clone(),
                p.archive_type.clone(),
            ))
        } else {
            None
        }
    });

    Ok(pkg)
}

async fn fetch_package_checksum(
    client: &reqwest::Client,
    pkg_info_uri: &str,
) -> Result<Option<(String, String)>> {
    let response = client.get(pkg_info_uri).send().await.map_err(|e| {
        LauncherError::Java(format!("Не удалось запросить пакет у Foojay API: {e}"))
    })?;
    let response = response
        .error_for_status()
        .map_err(|e| LauncherError::Java(format!("Foojay API вернул ошибку: {e:#}")))?;
    let info: FoojayPackageInfoResponse = response.json().await.map_err(|e| {
        LauncherError::Java(format!(
            "Не удалось распарсить сведения о пакете Foojay: {e:#}"
        ))
    })?;

    let package = info.result.into_iter().next().ok_or_else(|| {
        LauncherError::Java(format!(
            "Foojay API не вернул сведения о пакете {pkg_info_uri}"
        ))
    })?;

    let checksum = package.checksum.unwrap_or_default();
    if checksum.is_empty() {
        log_err!("[java] Foojay API не вернул контрольную сумму для {pkg_info_uri}");
        return Ok(None);
    }
    Ok(Some((checksum, package.checksum_type.unwrap_or_default())))
}

fn ensure_https_url(url: &str, what: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| LauncherError::Java(format!("Некорректный адрес {what}: {e}")))?;
    if parsed.scheme() != "https" {
        return Err(LauncherError::Java(format!(
            "Скачивание {what} допускается только по https: {url}"
        ))
        .into());
    }
    Ok(())
}

async fn verify_archive_checksum(
    archive_path: &Path,
    checksum: &str,
    checksum_type: &str,
) -> Result<()> {
    let actual = match checksum_type.to_ascii_lowercase().as_str() {
        "sha256" => file_sha256(archive_path).await?,
        "sha512" => file_sha512(archive_path).await?,
        other => {
            return Err(LauncherError::Java(format!(
                "Неподдерживаемый тип контрольной суммы Foojay: {other}"
            ))
            .into())
        }
    };
    if actual.eq_ignore_ascii_case(checksum) {
        return Ok(());
    }
    let _ = tokio::fs::remove_file(archive_path).await;
    Err(LauncherError::HashMismatch(format!(
        "{archive_path:?} (ожидается {checksum}, получен {actual})"
    ))
    .into())
}

fn ensure_distribution_supported(distribution: &str) -> Result<()> {
    if get_java_distributions_list()
        .iter()
        .any(|d| d.api_parameter == distribution)
    {
        return Ok(());
    }
    Err(LauncherError::InvalidInput(format!("Неизвестный дистрибутив Java: {distribution}")).into())
}

pub async fn download_alt_java(
    distribution: &str,
    java_version: Option<&str>,
    mc_version: &str,
) -> Result<(PathBuf, String)> {
    ensure_distribution_supported(distribution)?;

    let version = match java_version {
        Some(v) => v.to_string(),
        None => resolve_java_version(mc_version).await,
    };
    ensure_safe_relative_path(&version, "версии Java")?;

    let os = get_current_os();
    let arch = match get_arch()? {
        "x86_64" => "x64",
        other => other,
    };

    let os_foojay = match os {
        "osx" => "macos",
        other => other,
    };

    let client = crate::utils::http::http_client();

    let (download_url, pkg_info_uri, archive_type) =
        match fetch_package(client, distribution, &version, arch, os_foojay, "jre").await? {
            Some(result) => result,
            None => fetch_package(client, distribution, &version, arch, os_foojay, "jdk")
                .await?
                .ok_or_else(|| {
                    LauncherError::Java(
                        "Foojay API не вернул файлов для скачивания (ни JRE, ни JDK)".to_string(),
                    )
                })?,
        };

    ensure_https_url(&download_url, "архива Java")?;
    ensure_https_url(&pkg_info_uri, "сведений о пакете Foojay")?;
    let checksum = fetch_package_checksum(client, &pkg_info_uri).await?;

    let base_path = launcher_path(None)?;
    let java_parent = base_path.join("java").join(&version);
    let archive_path = java_parent.join(format!("archive_{}.{}", distribution, archive_type));

    create_dir_all(&java_parent)
        .await
        .with_context(|| format!("Не удалось создать папку Java {java_parent:?}"))?;

    remove_stale_archive(&archive_path).await?;
    download_file(&download_url, &archive_path).await?;

    if let Some((checksum, checksum_type)) = checksum {
        verify_archive_checksum(&archive_path, &checksum, &checksum_type).await?;
    }

    let exe = install_java_archive(&java_parent, &archive_path, distribution).await?;
    Ok((exe, version))
}

#[cfg(test)]
mod checksum_tests {
    use super::{ensure_https_url, verify_archive_checksum};
    use crate::test_support::TempDir;
    use sha2::{Digest, Sha256, Sha512};

    fn sha256_hex(data: &[u8]) -> String {
        crate::utils::hex::digest_hex(Sha256::digest(data))
    }

    fn sha512_hex(data: &[u8]) -> String {
        crate::utils::hex::digest_hex(Sha512::digest(data))
    }

    #[tokio::test]
    async fn matching_sha256_keeps_archive() {
        let dir = TempDir::new("foo_sha256_ok");
        let archive = dir.0.join("jdk.tar.gz");
        let content = b"jdk archive";
        std::fs::write(&archive, content).expect("запись архива");

        verify_archive_checksum(&archive, &sha256_hex(content).to_uppercase(), "sha256")
            .await
            .expect("совпадающая контрольная сумма");

        assert!(
            archive.exists(),
            "проверенный архив остаётся для распаковки"
        );
    }

    #[tokio::test]
    async fn matching_sha512_keeps_archive() {
        let dir = TempDir::new("foo_sha512_ok");
        let archive = dir.0.join("jdk.tar.gz");
        let content = b"jdk archive";
        std::fs::write(&archive, content).expect("запись архива");

        verify_archive_checksum(&archive, &sha512_hex(content), "sha512")
            .await
            .expect("совпадающая контрольная сумма sha512");
    }

    #[tokio::test]
    async fn mismatched_checksum_removes_archive() {
        let dir = TempDir::new("foo_sha256_bad");
        let archive = dir.0.join("jdk.tar.gz");
        std::fs::write(&archive, b"corrupted archive").expect("запись архива");

        let result =
            verify_archive_checksum(&archive, &sha256_hex(b"expected archive"), "sha256").await;

        assert!(result.is_err(), "несовпадение контрольной суммы — ошибка");
        assert!(
            !archive.exists(),
            "архив с битой контрольной суммой удаляется"
        );
    }

    #[tokio::test]
    async fn unsupported_checksum_type_is_rejected() {
        let dir = TempDir::new("foo_checksum_type");
        let archive = dir.0.join("jdk.tar.gz");
        std::fs::write(&archive, b"jdk archive").expect("запись архива");

        let result = verify_archive_checksum(&archive, "deadbeef", "md5").await;

        assert!(
            result.is_err(),
            "неизвестный тип суммы не должен пропускаться"
        );
    }

    #[test]
    fn only_https_download_urls_are_allowed() {
        assert!(ensure_https_url(
            "https://api.foojay.io/disco/v3.0/ids/x/redirect",
            "архива Java"
        )
        .is_ok());
        assert!(ensure_https_url("http://example.com/jdk.tar.gz", "архива Java").is_err());
        assert!(ensure_https_url("ftp://example.com/jdk.tar.gz", "архива Java").is_err());
        assert!(ensure_https_url("not a url", "архива Java").is_err());
    }
}

#[cfg(test)]
mod validation_tests {
    use super::{ensure_distribution_supported, is_supported_archive_type};
    use crate::utils::env_info::ensure_safe_relative_path;

    #[test]
    fn archive_filter_matches_platform_extraction() {
        assert_eq!(
            is_supported_archive_type("zip"),
            cfg!(target_os = "windows"),
            "zip распаковывается только на Windows"
        );
        assert_eq!(
            is_supported_archive_type("tar.gz"),
            !cfg!(target_os = "windows"),
            "tar.gz распаковывается только вне Windows"
        );
        assert!(!is_supported_archive_type("tar.xz"));
        assert!(!is_supported_archive_type(""));
    }

    #[test]
    fn traversal_distribution_is_rejected() {
        let error = ensure_distribution_supported("../evil")
            .expect_err("дистрибутив с обходом пути должен быть отклонён");
        assert!(
            error.to_string().contains("Неизвестный дистрибутив"),
            "ошибка должна объяснять проблему: {error}"
        );
    }

    #[test]
    fn whitelisted_distribution_is_accepted() {
        assert!(ensure_distribution_supported("zulu").is_ok());
        assert!(ensure_distribution_supported("temurin").is_ok());
        assert!(ensure_distribution_supported("graalvm_community").is_ok());
    }

    #[test]
    fn traversal_java_version_is_rejected() {
        let error = ensure_safe_relative_path("../../evil", "версии Java")
            .expect_err("версия с обходом пути должна быть отклонена");
        assert!(
            error
                .to_string()
                .contains("Некорректное значение версии Java"),
            "ошибка должна объяснять проблему: {error}"
        );
        assert!(ensure_safe_relative_path("..\\evil", "версии Java").is_err());
    }

    #[test]
    fn normal_java_version_is_accepted() {
        assert!(ensure_safe_relative_path("21", "версии Java").is_ok());
        assert!(ensure_safe_relative_path("17.0.9+9", "версии Java").is_ok());
    }
}
