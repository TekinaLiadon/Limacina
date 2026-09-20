use anyhow::Result;
use serde::Serialize;
use std::future::Future;
use std::path::{Path, PathBuf};

use crate::log_err;
use crate::log_info;
use crate::utils::download_file::{download_file, file_sha1};
use crate::utils::errors::LauncherError;
use crate::utils::install_manifest::{
    load_install_manifest, merge_installed, save_install_manifest,
};
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};
use crate::utils::step_events::{StepChannel, StepHandle};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HashKind {
    Sha1,
}

impl HashKind {
    pub async fn matches(&self, path: &Path, expected: &str) -> Result<bool> {
        Ok(file_sha1(path).await? == expected)
    }
}

#[derive(Clone)]
pub enum TargetDownload {
    Url(String),
    LauncherServer { key: String },
}

#[derive(Clone)]
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

    let mut repaired: u64 = 0;
    let mut failed_files: Vec<String> = failed;
    for (target, result) in results {
        let file_path = base_path.join(&target.rel_path);
        let ok = match result {
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
        };
        if ok {
            repaired += 1;
        } else {
            failed_files.push(target.rel_path.to_string_lossy().into_owned());
        }
    }

    let failed = failed_files;

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

    let mut repaired: u64 = 0;
    let mut failed_files: Vec<String> = failed;

    for (target, result) in results {
        let file_path = base_path.join(&target.rel_path);
        let ok = match result {
            Err(e) => {
                log_err!("Не удалось скачать {:?}: {:?}", file_path, e);
                false
            }
            Ok(()) => true,
        };

        if ok {
            let actual = file_sha1(&file_path).await;
            match actual {
                Ok(hash) => {
                    if !target.hash.is_empty() && hash != target.hash {
                        let _ = tokio::fs::remove_file(&file_path).await;
                        log_err!(
                            "Скачанный файл не соответствует хешу {:?}: ожидается {}, получен {}",
                            file_path,
                            target.hash,
                            hash
                        );
                        failed_files.push(target.rel_path.to_string_lossy().into_owned());
                    } else {
                        merge_installed(&mut installed, &target.rel_path.to_string_lossy(), &hash);
                        repaired += 1;
                    }
                }
                Err(e) => {
                    log_err!("Не удалось вычислить хеш {:?}: {}", file_path, e);
                    failed_files.push(target.rel_path.to_string_lossy().into_owned());
                }
            }
        } else {
            failed_files.push(target.rel_path.to_string_lossy().into_owned());
        }
    }

    let failed = failed_files;

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

    #[tokio::test]
    async fn downloads_missing_file_and_records_hash() {
        let dir = LauncherDirGuard::acquire("ensure_ok").await;
        let mut server = Server::new_async().await;
        let body = b"library bytes".to_vec();
        server
            .mock("GET", "/libs/a.jar")
            .with_status(200)
            .with_body(body.clone())
            .create_async()
            .await;

        let base = dir.project_dir("Cordelia");
        let target = url_target(
            "libraries/a.jar",
            &sha1_hex(&body),
            format!("{}/libs/a.jar", server.url()),
        );

        let report = ensure_files(
            &StepHandle::start("install", "Тест"),
            &base,
            "Cordelia",
            vec![target],
        )
        .await
        .expect("установка файлов");

        assert_eq!(report.repaired, 1);
        assert!(report.failed.is_empty());
        assert_eq!(std::fs::read(base.join("libraries/a.jar")).unwrap(), body);

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

        let base = dir.project_dir("Cordelia");
        let target = url_target(
            "libraries/a.jar",
            "0000000000000000000000000000000000000000",
            format!("{}/libs/a.jar", server.url()),
        );

        let report = ensure_files(
            &StepHandle::start("install", "Тест"),
            &base,
            "Cordelia",
            vec![target],
        )
        .await
        .expect("отчёт установки");

        assert_eq!(report.repaired, 0);
        assert_eq!(report.failed, vec!["libraries/a.jar"]);
        assert!(
            !base.join("libraries/a.jar").exists(),
            "битый файл должен быть удалён"
        );
    }

    #[tokio::test]
    async fn unreadable_file_is_reported_without_deletion() {
        let dir = LauncherDirGuard::acquire("ensure_unreadable").await;
        let base = dir.project_dir("Cordelia");
        let target_path = base.join("libraries/a.jar");
        std::fs::create_dir_all(&target_path).expect("создание непрочитываемого «файла»");

        let target = url_target(
            "libraries/a.jar",
            "0000000000000000000000000000000000000000",
            "https://invalid.example.test/libs/a.jar".to_string(),
        );

        let report = ensure_files(
            &StepHandle::start("install", "Тест"),
            &base,
            "Cordelia",
            vec![target],
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
        server
            .mock("GET", "/libs/a.jar")
            .with_status(200)
            .with_body(body.clone())
            .create_async()
            .await;

        let base = dir.project_dir("Cordelia");
        let target = url_target(
            "libraries/a.jar",
            &sha1_hex(&body),
            format!("{}/libs/a.jar", server.url()),
        );

        let report = ensure_files(
            &StepHandle::start("install", "Тест"),
            &base,
            "Cordelia",
            vec![target],
        )
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
