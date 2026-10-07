use anyhow::Result;
use serde::Serialize;
use std::future::Future;
use std::path::{Path, PathBuf};

use crate::log_err;
use crate::log_info;
use crate::utils::download_file::{download_file, file_sha1};
use crate::utils::errors::LauncherError;
use crate::utils::install_manifest::{
    load_install_manifest, merge_installed, save_install_manifest, InstallManifest,
};
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};
use crate::utils::step_events::{StepChannel, StepHandle};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HashKind {
    Sha1,
}

impl HashKind {
    pub async fn matches(&self, path: &Path, expected: &str) -> Result<bool> {
        Ok(file_sha1(path).await?.eq_ignore_ascii_case(expected))
    }
}

#[derive(Clone, Debug)]
pub enum TargetDownload {
    Url(String),
    LauncherServer { key: String },
}

#[derive(Clone, Debug)]
pub struct IntegrityTarget {
    pub rel_path: PathBuf,
    pub hash: String,
    pub hash_kind: HashKind,
    pub download: TargetDownload,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub total: u64,
    pub broken: u64,
    pub repaired: u64,
    pub missing: u64,
    pub failed: Vec<String>,
}

impl IntegrityReport {
    pub fn merge(&mut self, other: IntegrityReport) {
        self.total += other.total;
        self.broken += other.broken;
        self.repaired += other.repaired;
        self.missing += other.missing;
        self.failed.extend(other.failed);
    }
}

struct ScanOutcome {
    broken: Vec<IntegrityTarget>,
    missing: u64,
    failed: Vec<String>,
}

async fn scan_targets(
    base_path: &Path,
    step: &StepHandle,
    targets: Vec<IntegrityTarget>,
    mut expected_hash: impl FnMut(&IntegrityTarget) -> Option<String>,
) -> ScanOutcome {
    let mut broken: Vec<IntegrityTarget> = Vec::new();
    let mut missing: u64 = 0;
    let mut failed: Vec<String> = Vec::new();

    for target in targets {
        let file_path = base_path.join(&target.rel_path);
        let expected = expected_hash(&target);
        let intact = if !file_path.exists() {
            missing += 1;
            false
        } else if expected.as_deref().is_none_or(str::is_empty) {
            true
        } else {
            match target
                .hash_kind
                .matches(&file_path, expected.as_deref().unwrap_or_default())
                .await
            {
                Ok(matches) => matches,
                Err(e) => {
                    log_err!("Не удалось прочитать файл {:?}: {}", file_path, e);
                    failed.push(target.rel_path.to_string_lossy().into_owned());
                    true
                }
            }
        };

        if !intact {
            if file_path.exists() {
                let _ = tokio::fs::remove_file(&file_path).await;
            }
            broken.push(target);
        }
        step.inc();
    }

    ScanOutcome {
        broken,
        missing,
        failed,
    }
}

async fn download_targets<F, Fut>(
    base_path: &Path,
    step: &StepHandle,
    targets: Vec<IntegrityTarget>,
    download_fn: F,
) -> Vec<(IntegrityTarget, Result<(), anyhow::Error>)>
where
    F: Fn(String, PathBuf) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), anyhow::Error>> + Send + 'static,
{
    let semaphore_info: Vec<SemaphoreInfo> = targets
        .iter()
        .map(|t| SemaphoreInfo {
            url: match &t.download {
                TargetDownload::Url(url) => url.clone(),
                TargetDownload::LauncherServer { key } => key.clone(),
            },
            dest: t.rel_path.clone(),
        })
        .collect();

    let step_counter = step.clone();
    let futures = semaphore_core(
        base_path.to_path_buf(),
        semaphore_info,
        download_fn,
        Some(move |_: &str| step_counter.inc()),
    );
    let results = futures::future::join_all(futures).await;

    targets.into_iter().zip(results).collect()
}

enum DownloadCheck<'a> {
    Reverify,
    RecordHash { installed: &'a mut InstallManifest },
}

async fn settle_results(
    base_path: &Path,
    results: Vec<(IntegrityTarget, Result<(), anyhow::Error>)>,
    mut failed: Vec<String>,
    mut check: DownloadCheck<'_>,
) -> (u64, Vec<String>) {
    let mut repaired: u64 = 0;

    for (target, result) in results {
        let file_path = base_path.join(&target.rel_path);
        let ok = match &mut check {
            DownloadCheck::Reverify => match result {
                Err(e) => {
                    log_err!(
                        "[integrity] Не удалось восстановить {:?}: {:?}",
                        file_path,
                        e
                    );
                    false
                }
                Ok(()) if target.hash.is_empty() => true,
                Ok(()) => match target.hash_kind.matches(&file_path, &target.hash).await {
                    Ok(true) => true,
                    Ok(false) => {
                        log_err!(
                            "[integrity] Восстановленный файл не прошёл проверку хеша: {:?}",
                            file_path
                        );
                        false
                    }
                    Err(e) => {
                        log_err!(
                            "[integrity] Не удалось проверить восстановленный файл {:?}: {}",
                            file_path,
                            e
                        );
                        false
                    }
                },
            },
            DownloadCheck::RecordHash { installed } => {
                if let Err(e) = result {
                    log_err!("Не удалось скачать {:?}: {:?}", file_path, e);
                    false
                } else {
                    match file_sha1(&file_path).await {
                        Ok(hash) => {
                            if !target.hash.is_empty() && !hash.eq_ignore_ascii_case(&target.hash) {
                                let _ = tokio::fs::remove_file(&file_path).await;
                                log_err!(
                                    "Скачанный файл не соответствует хешу {:?}: ожидается {}, получен {}",
                                    file_path,
                                    target.hash,
                                    hash
                                );
                                false
                            } else {
                                merge_installed(
                                    installed,
                                    &target.rel_path.to_string_lossy(),
                                    &hash,
                                );
                                true
                            }
                        }
                        Err(e) => {
                            log_err!("Не удалось вычислить хеш {:?}: {}", file_path, e);
                            false
                        }
                    }
                }
            }
        };

        if ok {
            repaired += 1;
        } else {
            failed.push(target.rel_path.to_string_lossy().into_owned());
        }
    }

    (repaired, failed)
}

pub async fn check_integrity<F, Fut>(
    base_path: &Path,
    targets: Vec<IntegrityTarget>,
    step_id: &'static str,
    step_label: &str,
    download_fn: F,
) -> Result<IntegrityReport>
where
    F: Fn(String, PathBuf) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), anyhow::Error>> + Send + 'static,
{
    let step = StepHandle::start_channel(StepChannel::Integrity, step_id, step_label);
    let total = targets.len() as u64;
    step.set_total(total);

    let ScanOutcome {
        broken,
        missing,
        failed,
    } = scan_targets(base_path, &step, targets, |target| {
        if target.hash.is_empty() {
            None
        } else {
            Some(target.hash.clone())
        }
    })
    .await;

    if broken.is_empty() {
        step.finish(true);
        return Ok(IntegrityReport {
            total,
            missing,
            failed,
            ..IntegrityReport::default()
        });
    }

    let broken_count = broken.len() as u64;
    step.detail("Восстановление повреждённых файлов");
    step.set_total(broken_count);

    let results = download_targets(base_path, &step, broken, download_fn).await;

    let (repaired, failed) =
        settle_results(base_path, results, failed, DownloadCheck::Reverify).await;

    if failed.is_empty() {
        step.finish(false);
    } else {
        step.fail(format!("Не удалось восстановить файлов: {}", failed.len()));
    }

    log_info!(
        "[integrity] Проверено: {}, повреждено: {}, восстановлено: {}, ошибок: {}",
        total,
        broken_count,
        repaired,
        failed.len()
    );

    Ok(IntegrityReport {
        total,
        broken: broken_count,
        repaired,
        missing,
        failed,
    })
}

pub async fn ensure_files(
    step: &StepHandle,
    base_path: &Path,
    project_name: &str,
    targets: Vec<IntegrityTarget>,
) -> Result<IntegrityReport> {
    if targets.is_empty() {
        return Ok(IntegrityReport::default());
    }

    let mut installed = load_install_manifest(project_name).await.map_err(|e| {
        LauncherError::ManifestParse(format!(
            "Не удалось загрузить манифест установленных файлов: {e:#}"
        ))
    })?;
    let total = targets.len() as u64;
    step.set_total(total);

    let ScanOutcome {
        broken,
        missing: _,
        failed,
    } = scan_targets(base_path, step, targets, |target| {
        if !target.hash.is_empty() {
            return Some(target.hash.clone());
        }
        installed
            .files
            .get(&target.rel_path.to_string_lossy().into_owned())
            .cloned()
    })
    .await;

    if broken.is_empty() {
        step.clone().finish(true);
        log_info!("[install] Все файлы на месте: {}", total);
        return Ok(IntegrityReport {
            total,
            failed,
            ..IntegrityReport::default()
        });
    }

    let broken_count = broken.len() as u64;
    step.detail(&format!("Скачивание файлов: {}", broken_count));
    step.set_total(broken_count);

    let results = download_targets(base_path, step, broken, |url, dest| async move {
        download_file(&url, &dest).await
    })
    .await;

    let (repaired, failed) = settle_results(
        base_path,
        results,
        failed,
        DownloadCheck::RecordHash {
            installed: &mut installed,
        },
    )
    .await;

    if failed.is_empty() {
        save_install_manifest(project_name, &installed)
            .await
            .map_err(|e| {
                LauncherError::DiskIo(format!(
                    "Не удалось сохранить манифест установленных файлов: {e:#}"
                ))
            })?;
        step.clone().finish(false);
    } else {
        let _ = save_install_manifest(project_name, &installed).await;
        step.clone()
            .fail(format!("Не удалось скачать файлов: {}", failed.len()));
    }

    log_info!(
        "[install] Проверено: {}, скачано: {}, ошибок: {}",
        total,
        repaired,
        failed.len()
    );

    Ok(IntegrityReport {
        total,
        broken: broken_count,
        repaired,
        missing: 0,
        failed,
    })
}

pub async fn record_installed_hash(
    project_name: &str,
    base_path: &Path,
    rel_path: &Path,
) -> Result<()> {
    let file_path = base_path.join(rel_path);
    if !file_path.exists() {
        return Err(LauncherError::DiskIo(format!("Файл не существует: {file_path:?}")).into());
    }
    let hash = file_sha1(&file_path).await?;
    let mut manifest = load_install_manifest(project_name).await.map_err(|e| {
        LauncherError::ManifestParse(format!(
            "Не удалось загрузить манифест установленных файлов: {e:#}"
        ))
    })?;
    merge_installed(&mut manifest, &rel_path.to_string_lossy(), &hash);
    save_install_manifest(project_name, &manifest)
        .await
        .map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось сохранить манифест установленных файлов: {e:#}"
            ))
        })?;
    Ok(())
}

#[cfg(test)]
mod hash_kind_tests {
    use super::HashKind::Sha1;
    use crate::test_support::{sha1_hex, LauncherDirGuard};

    #[tokio::test]
    async fn matches_is_case_insensitive() {
        let dir = LauncherDirGuard::acquire("hash_kind_case").await;
        let path = dir.project_dir("Cordelia").join("a.txt");
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, b"content").await.unwrap();

        let uppercase = sha1_hex(b"content").to_uppercase();
        assert!(
            Sha1.matches(&path, &uppercase)
                .await
                .expect("проверка хеша"),
            "uppercase-хеш из сети не должен вызывать вечную перекачку"
        );
        assert!(!Sha1
            .matches(&path, "0000000000000000000000000000000000000000")
            .await
            .expect("проверка несовпадающего хеша"));
    }
}

#[cfg(test)]
mod ensure_files_tests {
    use super::*;
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use crate::utils::install_manifest::InstallManifest;
    use mockito::Server;

    fn url_target(rel: &str, hash: &str, url: String) -> IntegrityTarget {
        IntegrityTarget {
            rel_path: PathBuf::from(rel),
            hash: hash.to_string(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(url),
        }
    }

    const ZERO_SHA1: &str = "0000000000000000000000000000000000000000";

    async fn mock_and_ensure(
        server: &mut Server,
        mock_path: &str,
        body: &[u8],
        dir: &LauncherDirGuard,
        rel: &str,
    ) -> Result<IntegrityReport> {
        server
            .mock("GET", mock_path)
            .with_status(200)
            .with_body(body)
            .create_async()
            .await;
        let target = url_target(rel, &sha1_hex(body), format!("{}{mock_path}", server.url()));
        ensure_files(
            &StepHandle::start("install", "Тест"),
            &dir.project_dir("Cordelia"),
            "Cordelia",
            vec![target],
        )
        .await
    }

    async fn ensure_broken_target(
        dir: &LauncherDirGuard,
        rel: &str,
        url: String,
    ) -> Result<IntegrityReport> {
        let target = url_target(rel, ZERO_SHA1, url);
        ensure_files(
            &StepHandle::start("install", "Тест"),
            &dir.project_dir("Cordelia"),
            "Cordelia",
            vec![target],
        )
        .await
    }

    #[tokio::test]
    async fn downloads_missing_file_and_records_hash() {
        let dir = LauncherDirGuard::acquire("ensure_ok").await;
        let mut server = Server::new_async().await;
        let body = b"library bytes".to_vec();

        let report = mock_and_ensure(&mut server, "/libs/a.jar", &body, &dir, "libraries/a.jar")
            .await
            .expect("установка файлов");

        assert_eq!(report.repaired, 1);
        assert!(report.failed.is_empty());
        assert_eq!(
            std::fs::read(dir.project_dir("Cordelia").join("libraries/a.jar")).unwrap(),
            body
        );

        let installed = load_install_manifest("Cordelia").await.expect("манифест");
        assert_eq!(
            installed.files.get("libraries/a.jar"),
            Some(&sha1_hex(&body))
        );
    }

    #[tokio::test]
    async fn flags_and_deletes_file_with_mismatched_hash() {
        let dir = LauncherDirGuard::acquire("ensure_bad_hash").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/libs/a.jar")
            .with_status(200)
            .with_body("corrupt bytes")
            .create_async()
            .await;

        let report = ensure_broken_target(
            &dir,
            "libraries/a.jar",
            format!("{}/libs/a.jar", server.url()),
        )
        .await
        .expect("отчёт установки");

        assert_eq!(report.repaired, 0);
        assert_eq!(report.failed, vec!["libraries/a.jar"]);
        assert!(
            !dir.project_dir("Cordelia").join("libraries/a.jar").exists(),
            "битый файл должен быть удалён"
        );
    }

    #[tokio::test]
    async fn unreadable_file_is_reported_without_deletion() {
        let dir = LauncherDirGuard::acquire("ensure_unreadable").await;
        let base = dir.project_dir("Cordelia");
        let target_path = base.join("libraries/a.jar");
        std::fs::create_dir_all(&target_path).expect("создание непрочитываемого «файла»");

        let report = ensure_broken_target(
            &dir,
            "libraries/a.jar",
            "https://invalid.example.test/libs/a.jar".to_string(),
        )
        .await
        .expect("отчёт установки");

        assert_eq!(report.repaired, 0);
        assert_eq!(report.failed, vec!["libraries/a.jar".to_string()]);
        assert!(
            target_path.exists(),
            "ошибка чтения не должна приводить к удалению файла"
        );
    }

    #[tokio::test]
    async fn records_hash_when_source_has_no_hash() {
        let dir = LauncherDirGuard::acquire("ensure_no_hash").await;
        let mut server = Server::new_async().await;
        let body = b"installer bytes".to_vec();
        server
            .mock("GET", "/installer.jar")
            .with_status(200)
            .with_body(body.clone())
            .create_async()
            .await;

        let base = dir.project_dir("Cordelia");
        let target = url_target(
            "installer.jar",
            "",
            format!("{}/installer.jar", server.url()),
        );

        let report = ensure_files(
            &StepHandle::start("install", "Тест"),
            &base,
            "Cordelia",
            vec![target],
        )
        .await
        .expect("установка файла без хеша");

        assert_eq!(report.repaired, 1);
        assert!(report.failed.is_empty());

        let installed = load_install_manifest("Cordelia").await.expect("манифест");
        assert_eq!(installed.files.get("installer.jar"), Some(&sha1_hex(&body)));
    }

    #[tokio::test]
    async fn broken_manifest_does_not_block_ensure_files() {
        let dir = LauncherDirGuard::acquire("ensure_broken_manifest").await;
        dir.write_broken_install_manifest("Cordelia");
        let mut server = Server::new_async().await;
        let body = b"library bytes".to_vec();

        let report = mock_and_ensure(&mut server, "/libs/a.jar", &body, &dir, "libraries/a.jar")
            .await
            .expect("установка при битом манифесте");

        assert_eq!(report.repaired, 1);
        assert!(report.failed.is_empty());

        let installed = load_install_manifest("Cordelia").await.expect("манифест");
        assert_eq!(
            installed.files.get("libraries/a.jar"),
            Some(&sha1_hex(&body))
        );
        let raw =
            std::fs::read_to_string(dir.root().join("manifest").join("installed_Cordelia.json"))
                .expect("чтение манифеста");
        assert!(serde_json::from_str::<InstallManifest>(&raw).is_ok());
    }

    #[tokio::test]
    async fn broken_manifest_does_not_block_record_installed_hash() {
        let dir = LauncherDirGuard::acquire("record_broken_manifest").await;
        dir.write_broken_install_manifest("Cordelia");

        let base = dir.project_dir("Cordelia");
        std::fs::create_dir_all(base.join("libraries")).expect("создание директории");
        let body = b"installer bytes".to_vec();
        std::fs::write(base.join("libraries").join("installer.jar"), &body).unwrap();

        record_installed_hash("Cordelia", &base, Path::new("libraries/installer.jar"))
            .await
            .expect("запись хеша при битом манифесте");

        let installed = load_install_manifest("Cordelia").await.expect("манифест");
        assert_eq!(
            installed.files.get("libraries/installer.jar"),
            Some(&sha1_hex(&body))
        );
    }
}

#[cfg(test)]
mod check_integrity_tests {
    use super::*;
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::Arc;

    fn url_target(rel: &str, hash: &str, url: String) -> IntegrityTarget {
        IntegrityTarget {
            rel_path: PathBuf::from(rel),
            hash: hash.to_string(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(url),
        }
    }

    async fn write_file(base: &Path, name: &str, content: &[u8]) {
        tokio::fs::create_dir_all(base).await.unwrap();
        tokio::fs::write(base.join(name), content).await.unwrap();
    }

    #[tokio::test]
    async fn intact_files_skip_downloads() {
        let dir = LauncherDirGuard::acquire("integrity_intact").await;
        let base = dir.project_dir("Cordelia");
        write_file(&base, "a.txt", b"content a").await;
        write_file(&base, "b.txt", b"content b").await;

        let downloads = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&downloads);
        let report = check_integrity(
            &base,
            vec![
                url_target(
                    "a.txt",
                    &sha1_hex(b"content a"),
                    "http://127.0.0.1:1/a".to_string(),
                ),
                url_target(
                    "b.txt",
                    &sha1_hex(b"content b"),
                    "http://127.0.0.1:1/b".to_string(),
                ),
            ],
            "files.check",
            "Файлы сервера",
            move |_url, _dest| {
                counter.fetch_add(1, AtomicOrdering::Relaxed);
                async move { Ok(()) }
            },
        )
        .await
        .expect("проверка целостности");

        assert_eq!(report.total, 2);
        assert_eq!(report.broken, 0);
        assert_eq!(report.repaired, 0);
        assert_eq!(report.missing, 0);
        assert!(report.failed.is_empty());
        assert_eq!(
            downloads.load(AtomicOrdering::Relaxed),
            0,
            "целые файлы не должны перекачиваться"
        );
    }

    #[tokio::test]
    async fn broken_and_missing_files_are_restored() {
        let dir = LauncherDirGuard::acquire("integrity_repair").await;
        let base = dir.project_dir("Cordelia");
        write_file(&base, "a.txt", b"corrupted").await;
        write_file(&base, "c.txt", b"good c").await;

        let report = check_integrity(
            &base,
            vec![
                url_target(
                    "a.txt",
                    &sha1_hex(b"good a"),
                    "http://127.0.0.1:1/a".to_string(),
                ),
                url_target(
                    "b.txt",
                    &sha1_hex(b"good b"),
                    "http://127.0.0.1:1/b".to_string(),
                ),
                url_target(
                    "c.txt",
                    &sha1_hex(b"good c"),
                    "http://127.0.0.1:1/c".to_string(),
                ),
            ],
            "files.check",
            "Файлы сервера",
            move |url, dest| {
                let body: Vec<u8> = match url.as_str() {
                    "http://127.0.0.1:1/a" => b"good a".to_vec(),
                    "http://127.0.0.1:1/b" => b"good b".to_vec(),
                    other => panic!("неожиданный адрес загрузки: {other}"),
                };
                async move {
                    if let Some(parent) = dest.parent() {
                        tokio::fs::create_dir_all(parent).await.unwrap();
                    }
                    tokio::fs::write(&dest, body).await.unwrap();
                    Ok(())
                }
            },
        )
        .await
        .expect("проверка целостности");

        assert_eq!(report.total, 3);
        assert_eq!(report.broken, 2, "битый и отсутствующий файлы ломаются");
        assert_eq!(report.missing, 1);
        assert_eq!(report.repaired, 2);
        assert!(report.failed.is_empty());

        assert_eq!(
            tokio::fs::read(base.join("a.txt")).await.unwrap(),
            b"good a"
        );
        assert_eq!(
            tokio::fs::read(base.join("b.txt")).await.unwrap(),
            b"good b"
        );
    }

    #[tokio::test]
    async fn failed_downloads_are_reported_in_failed_list() {
        let dir = LauncherDirGuard::acquire("integrity_failed").await;
        let base = dir.project_dir("Cordelia");
        write_file(&base, "a.txt", b"corrupted").await;

        let report = check_integrity(
            &base,
            vec![url_target(
                "a.txt",
                &sha1_hex(b"good a"),
                "http://127.0.0.1:1/a".to_string(),
            )],
            "files.check",
            "Файлы сервера",
            |_url, _dest| async move { Err(anyhow::anyhow!("сервер недоступен")) },
        )
        .await
        .expect("сбой восстановления не должен ронять отчёт");

        assert_eq!(report.broken, 1);
        assert_eq!(report.repaired, 0);
        assert_eq!(report.failed, vec!["a.txt".to_string()]);
        assert!(
            !base.join("a.txt").exists(),
            "битый файл удаляется до попытки восстановления"
        );
    }

    #[tokio::test]
    async fn restored_file_with_wrong_hash_is_reported_failed() {
        let dir = LauncherDirGuard::acquire("integrity_bad_restore").await;
        let base = dir.project_dir("Cordelia");
        write_file(&base, "a.txt", b"corrupted").await;

        let report = check_integrity(
            &base,
            vec![url_target(
                "a.txt",
                &sha1_hex(b"good a"),
                "http://127.0.0.1:1/a".to_string(),
            )],
            "files.check",
            "Файлы сервера",
            move |_url, dest| async move {
                tokio::fs::write(&dest, b"still wrong").await.unwrap();
                Ok(())
            },
        )
        .await
        .expect("плохое восстановление не должно ронять отчёт");

        assert_eq!(report.broken, 1);
        assert_eq!(report.repaired, 0);
        assert_eq!(report.failed, vec!["a.txt".to_string()]);
    }
}
