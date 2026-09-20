use anyhow::Result;
use std::fs::{self, File};
use std::io;
use std::path::Path;
use zip::ZipArchive;

use crate::utils::errors::LauncherError;

pub const MAX_EXTRACT_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn extract_zip_with_limit(
    archive_path: &Path,
    target_dir: &Path,
    max_total_bytes: u64,
) -> Result<()> {
    let file = File::open(archive_path).map_err(|e| {
        LauncherError::Java(format!("Не удалось открыть архив {archive_path:?}: {e:#}"))
    })?;
    let mut archive = ZipArchive::new(file).map_err(|e| {
        LauncherError::Java(format!(
            "Не удалось прочитать ZIP архив {archive_path:?}: {e:#}"
        ))
    })?;

    let mut total_bytes: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| {
            LauncherError::Java(format!(
                "Не удалось прочитать запись архива {archive_path:?}: {e:#}"
            ))
        })?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        total_bytes += entry.size();
        if total_bytes > max_total_bytes {
            return Err(LauncherError::Java(format!(
                "Суммарный размер записей архива превышает лимит {max_total_bytes} байт"
            ))
            .into());
        }
        let out_path = target_dir.join(relative);

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| {
                LauncherError::Java(format!("Не удалось создать директорию {out_path:?}: {e:#}"))
            })?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    LauncherError::Java(format!("Не удалось создать директорию {parent:?}: {e:#}"))
                })?;
            }
            let mut out_file = File::create(&out_path).map_err(|e| {
                LauncherError::Java(format!("Не удалось создать файл {out_path:?}: {e:#}"))
            })?;
            io::copy(&mut entry, &mut out_file).map_err(|e| {
                LauncherError::Java(format!("Не удалось записать файл {out_path:?}: {e:#}"))
            })?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extract_zip_with_limit, MAX_EXTRACT_TOTAL_BYTES};
    use crate::test_support::{write_test_zip, TempDir};

    #[test]
    fn extract_writes_entries_within_limit() {
        let dir = TempDir::new("ok");
        let archive_path = dir.0.join("archive.zip");
        write_test_zip(
            &archive_path,
            &[("a.txt", b"alpha"), ("nested/b.txt", b"beta")],
        );
        let target = dir.0.join("out");

        extract_zip_with_limit(&archive_path, &target, MAX_EXTRACT_TOTAL_BYTES)
            .expect("распаковка в лимите");

        assert_eq!(
            std::fs::read(target.join("a.txt")).expect("чтение a.txt"),
            b"alpha"
        );
        assert_eq!(
            std::fs::read(target.join("nested").join("b.txt")).expect("чтение b.txt"),
            b"beta"
        );
    }

    #[test]
    fn extract_stops_when_total_size_exceeds_limit() {
        let dir = TempDir::new("limit");
        let archive_path = dir.0.join("archive.zip");
        write_test_zip(&archive_path, &[("big.bin", &[0u8; 1024])]);
        let target = dir.0.join("out");

        let result = extract_zip_with_limit(&archive_path, &target, 16);
        assert!(result.is_err(), "превышение лимита должно дать ошибку");
        assert!(
            !target.join("big.bin").exists(),
            "запись не должна попасть в цель"
        );
    }
}
