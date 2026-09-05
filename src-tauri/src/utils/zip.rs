use anyhow::{Context, Result};
use std::fs::{self, File};
use std::io;
use std::path::Path;
use zip::ZipArchive;

pub fn extract_zip(archive_path: &Path, target_dir: &Path) -> Result<()> {
    let file = File::open(archive_path)
        .with_context(|| format!("Не удалось открыть архив: {:?}", archive_path))?;
    let mut archive = ZipArchive::new(file)
        .with_context(|| format!("Не удалось прочитать ZIP архив: {:?}", archive_path))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let out_path = target_dir.join(relative);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .with_context(|| format!("Не удалось создать директорию: {:?}", out_path))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("Не удалось создать директорию: {:?}", parent))?;
            }
            let mut out_file = File::create(&out_path)
                .with_context(|| format!("Не удалось создать файл: {:?}", out_path))?;
            io::copy(&mut entry, &mut out_file)
                .with_context(|| format!("Не удалось записать файл: {:?}", out_path))?;
        }
    }

    Ok(())
}
