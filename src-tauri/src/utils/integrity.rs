use anyhow::Result;
use serde::Serialize;
use std::future::Future;
use std::path::{Path, PathBuf};

use crate::log_err;
use crate::log_info;
use crate::utils::download_file::{file_md5, file_sha1};
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo};
use crate::utils::step_events::{StepChannel, StepHandle};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HashKind {
    Sha1,
    Md5,
}

impl HashKind {
    async fn matches(&self, path: &Path, expected: &str) -> Result<bool> {
        let actual = match self {
            HashKind::Sha1 => file_sha1(path).await?,
            HashKind::Md5 => file_md5(path).await?,
        };
        Ok(actual == expected)
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

    let mut broken: Vec<IntegrityTarget> = Vec::new();
    let mut missing: u64 = 0;

    for target in &targets {
        let file_path = base_path.join(&target.rel_path);
        let intact = if !file_path.exists() {
            missing += 1;
            false
        } else if target.hash.is_empty() {
            true
        } else {
            match target.hash_kind.matches(&file_path, &target.hash).await {
                Ok(matches) => matches,
                Err(e) => {
                    log_err!("Не удалось прочитать файл {:?}: {}", file_path, e);
                    false
                }
            }
        };

        if !intact {
            if file_path.exists() {
                let _ = tokio::fs::remove_file(&file_path).await;
            }
            broken.push(target.clone());
        }
        step.inc();
    }

    if broken.is_empty() {
        step.finish(true);
        return Ok(IntegrityReport {
            total,
            missing,
            ..IntegrityReport::default()
        });
    }

    let broken_count = broken.len() as u64;
    step.detail("Восстановление повреждённых файлов");
    step.set_total(broken_count);

    let mut failed: Vec<String> = Vec::new();
    let repairable = broken;

    let semaphore_info: Vec<SemaphoreInfo> = repairable
        .iter()
        .map(|t| {
            let url = match &t.download {
                TargetDownload::Url(url) => url.clone(),
                TargetDownload::LauncherServer { key } => key.clone(),
            };
            SemaphoreInfo {
                url,
                dest: t.rel_path.clone(),
            }
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

    let mut repaired: u64 = 0;
    for (target, result) in repairable.into_iter().zip(results) {
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
            failed.push(target.rel_path.to_string_lossy().into_owned());
        }
    }

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
