use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::legacy::hashed::{FileNameMatcher, HashedDir, HashedEntry, HashedFile};
use crate::legacy::requests::{LegacyClient, LegacySession};
use crate::legacy::update::{apply_deletions, flatten_files};
use crate::log_info;
use crate::utils::blocking;
use crate::utils::integrity::IntegrityReport;
use crate::utils::step_events::{StepChannel, StepHandle};

pub struct IntegrityDirPlan {
    pub dir_name: String,
    pub dir: PathBuf,
    pub matcher: Option<FileNameMatcher>,
    pub step_id: &'static str,
    pub step_label: &'static str,
}

pub async fn check_legacy_integrity(
    client: &LegacyClient,
    session: LegacySession<'_>,
    plans: Vec<IntegrityDirPlan>,
) -> Result<IntegrityReport> {
    let mut report = IntegrityReport::default();
    for plan in &plans {
        let step = StepHandle::start_channel(StepChannel::Integrity, plan.step_id, plan.step_label);
        match reconcile_dir(
            client,
            session,
            &plan.dir_name,
            &plan.dir,
            plan.matcher.as_ref(),
            &step,
        )
        .await
        {
            Ok(part) => {
                report.merge(part);
                step.finish(false);
            }
            Err(e) => {
                step.fail(e.to_string());
                return Err(e);
            }
        }
    }
    Ok(report)
}

async fn reconcile_dir(
    client: &LegacyClient,
    session: LegacySession<'_>,
    dir_name: &str,
    dir: &Path,
    matcher: Option<&FileNameMatcher>,
    step: &StepHandle,
) -> Result<IntegrityReport> {
    tokio::fs::create_dir_all(dir)
        .await
        .with_context(|| format!("Не удалось создать папку {}", dir.display()))?;
    step.detail("Сверка хешей локальных файлов");
    let dir_owned = dir.to_path_buf();
    let matcher_for_hash = matcher.cloned();
    let local = blocking(
        "Не удалось проанализировать файлы",
        move || HashedDir::build_local(&dir_owned, matcher_for_hash.as_ref(), true),
    )
    .await??;

    let server = client.update_list(session, dir_name).await?;
    let diff = server.dir.diff(&local, matcher);

    let mut report = IntegrityReport {
        total: count_files(&server.dir),
        missing: count_missing(&server.dir, &local),
        ..IntegrityReport::default()
    };

    let mismatch_paths = flatten_files(&diff.mismatch);
    let broken = mismatch_paths.len() + diff.extra_files.len() + diff.extra_dirs.len();
    if broken == 0 {
        log_info!(
            "[integrity] Легаси «{dir_name}»: проверено {}, всё в порядке",
            report.total
        );
        return Ok(report);
    }

    step.detail("Восстановление файлов");
    step.set_total(broken as u64);
    let mut repaired = 0u64;
    let mut failed: Vec<String> = Vec::new();

    if !diff.extra_files.is_empty() || !diff.extra_dirs.is_empty() {
        let extra_files = diff.extra_files.clone();
        let extra_dirs = diff.extra_dirs.clone();
        let dir_owned = dir.to_path_buf();
        blocking("Не удалось удалить лишние файлы", move || {
            apply_deletions(&dir_owned, &extra_files, &extra_dirs)
        })
        .await??;
        let deleted = (diff.extra_files.len() + diff.extra_dirs.len()) as u64;
        for _ in 0..deleted {
            step.inc();
        }
        repaired += deleted;
    }

    if !mismatch_paths.is_empty() {
        let step_for_progress = step.clone();
        client
            .update_files(session, dir_name, dir, &mismatch_paths, &mut |_path, done, size| {
                if done == size {
                    step_for_progress.inc();
                }
            })
            .await?;

        for path in &mismatch_paths {
            match tree_file_at(&server.dir, path) {
                Some(file) if file_matches(dir, path, file) => repaired += 1,
                _ => failed.push(path.clone()),
            }
        }
    }

    log_info!(
        "[integrity] Легаси «{dir_name}»: проверено {}, повреждено {}, восстановлено {}, ошибок {}",
        report.total,
        broken,
        repaired,
        failed.len()
    );

    report.broken = broken as u64;
    report.repaired = repaired;
    report.failed = failed;
    Ok(report)
}

fn count_files(dir: &HashedDir) -> u64 {
    dir.entries
        .values()
        .map(|entry| match entry {
            HashedEntry::File(_) => 1,
            HashedEntry::Dir(sub) => count_files(sub),
        })
        .sum()
}

fn count_missing(server: &HashedDir, local: &HashedDir) -> u64 {
    let mut missing = 0u64;
    for (name, entry) in &server.entries {
        let local_entry = local.entries.get(name);
        match (entry, local_entry) {
            (HashedEntry::File(_), None) => missing += 1,
            (HashedEntry::Dir(sub), Some(HashedEntry::Dir(local_sub))) => {
                missing += count_missing(sub, local_sub)
            }
            (HashedEntry::Dir(sub), _) => missing += count_files(sub),
            (HashedEntry::File(_), Some(_)) => {}
        }
    }
    missing
}

fn tree_file_at<'a>(root: &'a HashedDir, path: &str) -> Option<&'a HashedFile> {
    let segments: Vec<&str> = path.split('/').collect();
    let mut current = root;
    for (index, segment) in segments.iter().enumerate() {
        match current.entries.get(*segment)? {
            HashedEntry::File(file) if index == segments.len() - 1 => return Some(file),
            HashedEntry::Dir(sub) if index < segments.len() - 1 => current = sub,
            _ => return None,
        }
    }
    None
}

fn file_matches(dir: &Path, path: &str, file: &HashedFile) -> bool {
    let full = dir.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let metadata = match std::fs::metadata(&full) {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return false,
    };
    if metadata.len() != file.size {
        return false;
    }
    match file.digest {
        None => true,
        Some(expected) => crate::legacy::hashed::md5_of_file(&full)
            .map(|digest| digest == expected)
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::check_legacy_integrity;
    use super::IntegrityDirPlan;
    use crate::legacy::crypto::{generate_test_key, sign_sha256_with_rsa_raw};
    use crate::legacy::hashed::{md5_of_file, HashedDir, HashedEntry, HashedFile};
    use crate::legacy::protocol::HWriter;
    use crate::legacy::requests::LegacySession;
    use crate::test_support::LauncherDirGuard;
    use crate::utils::integrity::IntegrityReport;
    use md5::Digest;
    use std::path::PathBuf;

    fn file_entry(size: u64, digest: Option<[u8; 16]>) -> HashedEntry {
        HashedEntry::File(HashedFile { size, digest })
    }

    fn tree_bytes(dir: &HashedDir) -> Vec<u8> {
        fn write_dir(writer: &mut HWriter, dir: &HashedDir) {
            writer.write_varint(dir.entries.len() as u32);
            for (name, entry) in &dir.entries {
                writer.write_string(name);
                match entry {
                    HashedEntry::Dir(sub) => {
                        writer.write_varint(crate::legacy::hashed::DIR_ENTRY);
                        write_dir(writer, sub);
                    }
                    HashedEntry::File(file) => {
                        writer.write_varint(crate::legacy::hashed::FILE_ENTRY);
                        writer.write_varlong(file.size);
                        writer.write_bool(file.digest.is_some());
                        if let Some(digest) = &file.digest {
                            writer.write_fixed(digest);
                        }
                    }
                }
            }
        }
        let mut writer = HWriter::new();
        write_dir(&mut writer, dir);
        writer.into_inner()
    }

    #[tokio::test]
    async fn reconciles_broken_missing_and_extra_files() {
        let mut server = mockito::Server::new_async().await;
        let key = generate_test_key(2048).expect("тестовый ключ");
        let client = crate::legacy::requests::LegacyClient::with_test_key(
            &server.url(),
            rsa::RsaPublicKey::from(&key),
        );

        let dir = LauncherDirGuard::acquire("legacy_integrity").await;
        let base = dir.project_dir("Cordelia");

        std::fs::create_dir_all(base.join("mods")).unwrap();
        std::fs::write(base.join("mods/ok.jar"), b"good").unwrap();
        std::fs::write(base.join("mods/same.bin"), b"WRONG___").unwrap();
        std::fs::write(base.join("mods/extra.jar"), b"extra").unwrap();
        std::fs::create_dir_all(base.join("old")).unwrap();

        let ok_digest = md5_of_file(&base.join("mods/ok.jar")).unwrap();
        let expected_digest = md5::Md5::digest(b"expected");

        let server_tree = HashedDir {
            entries: [("mods".to_string(), HashedEntry::Dir(HashedDir {
                entries: [
                    ("gone.dat".to_string(), file_entry(3, None)),
                    ("ok.jar".to_string(), file_entry(4, Some(ok_digest))),
                    (
                        "same.bin".to_string(),
                        file_entry(8, Some(expected_digest.into())),
                    ),
                ]
                .into_iter()
                .collect(),
            }))]
            .into_iter()
            .collect(),
        };
        let tree_data = tree_bytes(&server_tree);
        let signature = sign_sha256_with_rsa_raw(&key, &tree_data).expect("подпись дерева");

        let mut list_body = HWriter::new();
        list_body.write_string("");
        list_body.write_prefixed(&tree_data);
        list_body.write_fixed(&signature);
        server
            .mock("POST", "/api/update/list")
            .with_status(200)
            .with_body(list_body.into_inner())
            .create_async()
            .await;

        let mut files_body = HWriter::new();
        files_body.write_string("");
        files_body.write_u8(0xFF);
        files_body.write_long(3);
        files_body.write_fixed(b"abc");
        files_body.write_u8(0xFF);
        files_body.write_long(8);
        files_body.write_fixed(b"expected");

        let mut expected_request = HWriter::new();
        expected_request.write_string("user");
        expected_request.write_string("token");
        expected_request.write_string("ClientDir");
        expected_request.write_varint(2);
        expected_request.write_string("mods/gone.dat");
        expected_request.write_string("mods/same.bin");

        server
            .mock("POST", "/api/update/files")
            .match_body(expected_request.into_inner())
            .with_status(200)
            .with_body(files_body.into_inner())
            .create_async()
            .await;

        let plans = vec![IntegrityDirPlan {
            dir_name: "ClientDir".to_string(),
            dir: PathBuf::from(&base),
            matcher: None,
            step_id: "legacy.client",
            step_label: "Файлы клиента",
        }];

        let report: IntegrityReport = check_legacy_integrity(
            &client,
            LegacySession {
                username: "user",
                access_token: "token",
            },
            plans,
        )
        .await
        .expect("проверка целостности");

        assert_eq!(report.total, 3, "три файла в дереве сервера");
        assert_eq!(report.missing, 1, "gone.dat отсутствовал локально");
        assert_eq!(report.broken, 4, "2 несовпадения + 1 лишний файл + 1 лишняя папка");
        assert_eq!(report.repaired, 4, "2 скачаны + 2 лишних удалены");
        assert!(report.failed.is_empty(), "ошибок восстановления нет");

        assert_eq!(std::fs::read(base.join("mods/same.bin")).unwrap(), b"expected");
        assert_eq!(std::fs::read(base.join("mods/gone.dat")).unwrap(), b"abc");
        assert!(
            !base.join("mods/extra.jar").exists(),
            "лишний файл должен быть удалён"
        );
        assert!(
            !base.join("old").exists(),
            "лишняя пустая папка должна быть удалена"
        );
        assert!(base.join("mods/ok.jar").exists(), "целый файл не трогаем");
    }
}
