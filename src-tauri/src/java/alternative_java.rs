use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::fs::create_dir_all;

use crate::java::{install_java_archive, remove_stale_archive, resolve_java_version};
use crate::utils::download_file::{
    download_file_with_hooks, file_sha256, file_sha512, DownloadHooks,
};
use crate::utils::env_info::{ensure_safe_relative_path, get_arch, get_current_os, launcher_path};
use crate::utils::errors::LauncherError;
use crate::utils::step_events::{StepChannel, StepHandle};
use crate::{log_err, log_info, step_try};

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

const JAVA_ALT_DOWNLOAD_STEP: &str = "java.alt.download";
const JAVA_ALT_EXTRACT_STEP: &str = "java.alt.extract";
const PROGRESS_EMISSION_STEP: u64 = 1024 * 1024;

static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn cancel_alt_java_download() -> bool {
    let was_active = DOWNLOAD_ACTIVE.load(Ordering::Relaxed);
    CANCEL_FLAG.store(true, Ordering::Relaxed);
    was_active
}

pub async fn download_alt_java(
    distribution: &str,
    java_version: Option<&str>,
    mc_version: &str,
) -> Result<(PathBuf, String)> {
    CANCEL_FLAG.store(false, Ordering::Relaxed);
    DOWNLOAD_ACTIVE.store(true, Ordering::Relaxed);
    let result = download_alt_java_inner(distribution, java_version, mc_version).await;
    DOWNLOAD_ACTIVE.store(false, Ordering::Relaxed);
    result
}

async fn download_alt_java_inner(
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

    let exe = download_and_install_alt_java(
        &CANCEL_FLAG,
        &download_url,
        checksum,
        &java_parent,
        distribution,
        &archive_type,
    )
    .await?;
    Ok((exe, version))
}

async fn download_and_install_alt_java(
    cancel: &AtomicBool,
    download_url: &str,
    checksum: Option<(String, String)>,
    java_parent: &Path,
    distribution: &str,
    archive_type: &str,
) -> Result<PathBuf> {
    let archive_path = java_parent.join(format!("archive_{distribution}.{archive_type}"));

    create_dir_all(java_parent)
        .await
        .with_context(|| format!("Не удалось создать папку Java {java_parent:?}"))?;
    remove_stale_archive(&archive_path).await?;

    log_info!("[java] Скачивание альтернативной Java {distribution}: {download_url}");
    let download_step =
        StepHandle::start_channel(StepChannel::Java, JAVA_ALT_DOWNLOAD_STEP, "Скачивание Java");
    let total_emitted = AtomicBool::new(false);
    let last_emitted = AtomicU64::new(0);
    let progress_step = download_step.clone();
    let emit_progress = move |downloaded: u64, total: u64| {
        let first = !total_emitted.swap(true, Ordering::Relaxed);
        if first {
            progress_step.set_total(total);
        }
        let reached_total = total > 0 && downloaded >= total;
        if !first
            && !reached_total
            && downloaded.saturating_sub(last_emitted.load(Ordering::Relaxed))
                < PROGRESS_EMISSION_STEP
        {
            return;
        }
        last_emitted.store(downloaded, Ordering::Relaxed);
        progress_step.set_current(downloaded);
    };
    let hooks = DownloadHooks {
        cancel: Some(cancel),
        on_progress: Some(&emit_progress),
    };

    let download_result = download_file_with_hooks(download_url, &archive_path, hooks).await;
    if let Err(error) = download_result {
        if cancel.load(Ordering::Relaxed) {
            log_info!("[java] Скачивание отменено пользователем");
        } else {
            log_err!("[java] Не удалось скачать архив Java с {download_url}: {error:#}");
        }
        download_step.fail(error.to_string());
        return Err(error);
    }

    if let Some((checksum, checksum_type)) = checksum {
        let checksum_result =
            verify_archive_checksum(&archive_path, &checksum, &checksum_type).await;
        if let Err(error) = checksum_result {
            log_err!("[java] Ошибка проверки контрольной суммы Java: {error:#}");
            download_step.fail(error.to_string());
            return Err(error);
        }
    }

    if cancel.load(Ordering::Relaxed) {
        let _ = tokio::fs::remove_file(&archive_path).await;
        log_info!("[java] Скачивание отменено пользователем");
        download_step.fail("Загрузка отменена");
        return Err(anyhow!("Загрузка отменена"));
    }

    download_step.finish(false);

    let extract_step =
        StepHandle::start_channel(StepChannel::Java, JAVA_ALT_EXTRACT_STEP, "Распаковка Java");
    let exe = step_try!(
        extract_step,
        install_java_archive(java_parent, &archive_path, distribution).await
    );
    extract_step.finish(false);
    log_info!(
        "[java] Альтернативная Java {distribution} установлена: {:?}",
        exe
    );
    Ok(exe)
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

#[cfg(test)]
mod download_steps_tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use mockito::Server;

    use super::{
        cancel_alt_java_download, download_and_install_alt_java, CANCEL_FLAG, DOWNLOAD_ACTIVE,
    };
    use crate::test_support::{part_files_in, TempDir};
    use crate::utils::step_events::test_capture::{
        assert_single_terminal, captured_terminals, CaptureGuard, TerminalExpectation,
    };
    use crate::utils::step_events::StepChannel;

    const JAVA_ALT_DOWNLOAD_STEP: &str = super::JAVA_ALT_DOWNLOAD_STEP;
    const JAVA_ALT_EXTRACT_STEP: &str = super::JAVA_ALT_EXTRACT_STEP;

    fn test_archive_type() -> &'static str {
        if cfg!(target_os = "windows") {
            "zip"
        } else {
            "tar.gz"
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn test_archive_bytes() -> Vec<u8> {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;
        use tar::{Builder, Header};

        let buffer = std::io::Cursor::new(Vec::new());
        let mut builder = Builder::new(buffer);

        let mut dir_header = Header::new_gnu();
        dir_header.set_size(0);
        dir_header.set_entry_type(tar::EntryType::Directory);
        dir_header.set_mode(0o755);
        dir_header.set_cksum();
        builder
            .append_data(&mut dir_header, "jdk-21-test", std::io::empty())
            .expect("добавление директории в tar");

        let mut bin_header = Header::new_gnu();
        bin_header.set_size(0);
        bin_header.set_entry_type(tar::EntryType::Directory);
        bin_header.set_mode(0o755);
        bin_header.set_cksum();
        builder
            .append_data(&mut bin_header, "jdk-21-test/bin", std::io::empty())
            .expect("добавление директории bin в tar");

        let mut header = Header::new_gnu();
        header.set_size(3);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, "jdk-21-test/bin/java", &b"elf"[..])
            .expect("добавление записи в tar");

        let tar_bytes = builder.into_inner().expect("сборка tar").into_inner();
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&tar_bytes).expect("сжатие tar");
        gz.finish().expect("завершение gz")
    }

    #[cfg(target_os = "windows")]
    fn test_archive_bytes() -> Vec<u8> {
        let dir = TempDir::new("alt_java_zip_src");
        let path = dir.0.join("jdk.zip");
        crate::test_support::write_test_zip(
            &path,
            &[
                ("jdk-21-test/bin/java", b"exe"),
                ("jdk-21-test/release", b"JAVA_HOME"),
            ],
        );
        std::fs::read(&path).expect("чтение тестового zip")
    }

    #[tokio::test]
    async fn cancel_before_start_aborts_download_without_part_or_extract() {
        let dir = TempDir::new("alt_java_cancel");
        let java_parent = dir.0.join("21");
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/jdk.bin")
            .with_status(200)
            .with_body("archive-bytes")
            .create_async()
            .await;

        let cancel = AtomicBool::new(true);
        let _capture = CaptureGuard::new();

        let result = download_and_install_alt_java(
            &cancel,
            &format!("{}/jdk.bin", server.url()),
            None,
            &java_parent,
            "zulu",
            test_archive_type(),
        )
        .await;

        let error = result.expect_err("отменённая загрузка должна возвращать ошибку");
        assert!(
            error.to_string().contains("Загрузка отменена"),
            "ошибка должна сообщать об отмене: {error}"
        );
        assert!(
            part_files_in(&java_parent).is_empty(),
            "part-файл должен быть удалён после отмены"
        );
        assert!(
            !java_parent.join("zulu").exists(),
            "папка дистрибутива не должна появляться при отмене"
        );
        assert!(
            !java_parent
                .join(format!("archive_zulu.{}", test_archive_type()))
                .exists(),
            "архив не должен оставаться при отмене"
        );
        assert_single_terminal(
            JAVA_ALT_DOWNLOAD_STEP,
            Some(StepChannel::Java),
            TerminalExpectation::Failed,
        );
        assert!(
            captured_terminals(JAVA_ALT_EXTRACT_STEP, Some(StepChannel::Java)).is_empty(),
            "шаг распаковки не должен начинаться при отмене скачивания"
        );
    }

    #[tokio::test]
    async fn download_error_emits_single_failed_terminal() {
        let dir = TempDir::new("alt_java_dl_err");
        let java_parent = dir.0.join("21");
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/jdk.bin")
            .with_status(200)
            .with_chunked_body(|writer| {
                writer.write_all(b"partial archive bytes")?;
                Err(std::io::Error::other("соединение оборвано"))
            })
            .create_async()
            .await;

        let cancel = AtomicBool::new(false);
        let _capture = CaptureGuard::new();

        let result = download_and_install_alt_java(
            &cancel,
            &format!("{}/jdk.bin", server.url()),
            None,
            &java_parent,
            "zulu",
            test_archive_type(),
        )
        .await;

        assert!(result.is_err(), "обрыв потока должен возвращать ошибку");
        assert!(
            !java_parent
                .join(format!("archive_zulu.{}", test_archive_type()))
                .exists(),
            "архив не должен оставаться после ошибки"
        );
        assert!(
            part_files_in(&java_parent).is_empty(),
            "part-файл должен быть удалён после ошибки"
        );
        assert!(
            !java_parent.join("zulu").exists(),
            "папка дистрибутива не должна появляться после ошибки"
        );
        assert_single_terminal(
            JAVA_ALT_DOWNLOAD_STEP,
            Some(StepChannel::Java),
            TerminalExpectation::Failed,
        );
    }

    #[tokio::test]
    async fn checksum_mismatch_emits_single_failed_terminal_and_removes_archive() {
        let dir = TempDir::new("alt_java_checksum_err");
        let java_parent = dir.0.join("21");
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/jdk.bin")
            .with_status(200)
            .with_body("archive-bytes")
            .create_async()
            .await;

        let cancel = AtomicBool::new(false);
        let _capture = CaptureGuard::new();

        let result = download_and_install_alt_java(
            &cancel,
            &format!("{}/jdk.bin", server.url()),
            Some(("deadbeef".to_string(), "sha256".to_string())),
            &java_parent,
            "zulu",
            test_archive_type(),
        )
        .await;

        assert!(result.is_err(), "несовпадение контрольной суммы — ошибка");
        assert!(
            !java_parent
                .join(format!("archive_zulu.{}", test_archive_type()))
                .exists(),
            "архив с битой контрольной суммой удаляется"
        );
        assert_single_terminal(
            JAVA_ALT_DOWNLOAD_STEP,
            Some(StepChannel::Java),
            TerminalExpectation::Failed,
        );
    }

    #[tokio::test]
    async fn cancelled_then_reset_download_installs_fully() {
        let dir = TempDir::new("alt_java_reset");
        let java_parent = dir.0.join("21");
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/jdk.bin")
            .with_status(200)
            .with_body(test_archive_bytes())
            .expect(2)
            .create_async()
            .await;

        let cancel = AtomicBool::new(true);
        let first_capture = CaptureGuard::new();
        let first = download_and_install_alt_java(
            &cancel,
            &format!("{}/jdk.bin", server.url()),
            None,
            &java_parent,
            "zulu",
            test_archive_type(),
        )
        .await;
        assert!(
            first.is_err(),
            "первая попытка с выставленным флагом отменяется"
        );
        assert_single_terminal(
            JAVA_ALT_DOWNLOAD_STEP,
            Some(StepChannel::Java),
            TerminalExpectation::Failed,
        );
        drop(first_capture);

        cancel.store(false, Ordering::Relaxed);
        let second_capture = CaptureGuard::new();
        let second = download_and_install_alt_java(
            &cancel,
            &format!("{}/jdk.bin", server.url()),
            None,
            &java_parent,
            "zulu",
            test_archive_type(),
        )
        .await;
        let exe = second.expect("повторная загрузка после сброса флага проходит");

        assert_eq!(
            exe,
            java_parent.join("zulu").join("bin").join("java"),
            "Java устанавливается в папку дистрибутива"
        );
        assert!(
            !java_parent
                .join(format!("archive_zulu.{}", test_archive_type()))
                .exists(),
            "архив удаляется после установки"
        );
        assert!(
            !java_parent.join("staging_zulu").exists(),
            "staging-папка удаляется после установки"
        );
        assert_single_terminal(
            JAVA_ALT_DOWNLOAD_STEP,
            Some(StepChannel::Java),
            TerminalExpectation::Finished { skipped: false },
        );
        assert_single_terminal(
            JAVA_ALT_EXTRACT_STEP,
            Some(StepChannel::Java),
            TerminalExpectation::Finished { skipped: false },
        );
        drop(second_capture);
    }

    #[test]
    fn cancel_reports_active_download_and_sets_flag() {
        CANCEL_FLAG.store(false, Ordering::Relaxed);
        DOWNLOAD_ACTIVE.store(true, Ordering::Relaxed);

        assert!(
            cancel_alt_java_download(),
            "при активной загрузке команда возвращает true"
        );
        assert!(
            CANCEL_FLAG.load(Ordering::Relaxed),
            "флаг отмены выставляется"
        );

        DOWNLOAD_ACTIVE.store(false, Ordering::Relaxed);
        CANCEL_FLAG.store(false, Ordering::Relaxed);

        assert!(
            !cancel_alt_java_download(),
            "без активной загрузки команда возвращает false"
        );
        assert!(
            CANCEL_FLAG.load(Ordering::Relaxed),
            "флаг выставляется и без активной загрузки — сброс произойдёт на старте следующей загрузки"
        );

        CANCEL_FLAG.store(false, Ordering::Relaxed);
    }
}
