use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

use super::version::UpdateInfo;
use crate::utils::env_info::{get_arch, get_current_os};
use crate::{log_err, log_info};

pub async fn download_update(info: &UpdateInfo) -> Result<PathBuf> {
    let server_url = env!("LAUNCHER_SERVER_URL");
    let os = get_current_os();
    let arch = get_arch();
    let url = format!("{}/launcher/{}/{}/download", server_url, os, arch);

    let temp_dir = std::env::temp_dir();
    let archive_name = format!("limacina_update_{}.zip", info.version);
    let archive_path = temp_dir.join(&archive_name);

    log_info!("Скачивание обновления v{}", info.version);

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .context("Не удалось подключиться для скачивания обновления")?
        .error_for_status()
        .context("Сервер вернул ошибку при скачивании обновления")?;

    let bytes = resp
        .bytes()
        .await
        .context("Не удалось прочитать данные обновления")?;

    tokio::fs::write(&archive_path, &bytes)
        .await
        .context("Не удалось записать архив обновления")?;

    log_info!("Обновление скачано: {:?}", archive_path);
    Ok(archive_path)
}

pub fn apply_update(archive_path: &Path) -> Result<()> {
    let current_exe =
        std::env::current_exe().context("Не удалось получить путь текущего бинарника")?;

    log_info!("Текущий бинарник: {:?}", current_exe);

    let file = std::fs::File::open(archive_path).context("Не удалось открыть архив обновления")?;
    let mut archive = ZipArchive::new(file).context("Не удалось прочитать ZIP архив")?;

    let temp_extract_dir = std::env::temp_dir().join("limacina_update_extract");
    if temp_extract_dir.exists() {
        std::fs::remove_dir_all(&temp_extract_dir)
            .context("Не удалось очистить директорию извлечения")?;
    }
    std::fs::create_dir_all(&temp_extract_dir)
        .context("Не удалось создать директорию для извлечения")?;
    archive
        .extract(&temp_extract_dir)
        .context("Не удалось извлечь архив обновления")?;

    let new_binary = find_binary_in_dir(&temp_extract_dir)?;
    log_info!("Новый бинарник: {:?}", new_binary);

    let old_path = current_exe.with_file_name(format!(
        "{}.old",
        current_exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ));

    if old_path.exists() {
        std::fs::remove_file(&old_path).context("Не удалось удалить старый бинарник")?;
    }

    std::fs::rename(&current_exe, &old_path)
        .context("Не удалось переименовать текущий бинарник")?;
    std::fs::copy(&new_binary, &current_exe).context("Не удалось скопировать новый бинарник")?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&current_exe, perms)
            .context("Не удалось установить права на бинарник")?;
    }

    if temp_extract_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_extract_dir);
    }
    let _ = std::fs::remove_file(archive_path);

    log_info!("Обновление применено, перезапуск...");
    Ok(())
}

fn find_binary_in_dir(dir: &Path) -> Result<PathBuf> {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .context("Не удалось прочитать директорию извлечения")?
        .filter_map(|e| e.ok())
        .collect();

    for entry in &entries {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();

        if name.starts_with('.') {
            continue;
        }

        if cfg!(target_os = "windows") {
            if name.ends_with(".exe") {
                return Ok(path);
            }
        } else if cfg!(target_os = "macos") {
            if name.ends_with(".app") {
                let macos_dir = path.join("Contents").join("MacOS");
                if macos_dir.exists() {
                    let binaries: Vec<_> = std::fs::read_dir(&macos_dir)
                        .into_iter()
                        .flatten()
                        .filter_map(|e| e.ok())
                        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                        .collect();
                    if let Some(binary) = binaries.first() {
                        return Ok(binary.path());
                    }
                }
                return Ok(path);
            }
        } else {
            let metadata = std::fs::metadata(&path).ok();
            if metadata.map(|m| m.is_file()).unwrap_or(false) {
                return Ok(path);
            }
        }
    }

    anyhow::bail!("Не удалось найти бинарник в архиве обновления")
}

pub fn cleanup_old_binaries() {
    if let Ok(current_exe) = std::env::current_exe() {
        let old_path = current_exe.with_file_name(format!(
            "{}.old",
            current_exe
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        if old_path.exists() {
            match std::fs::remove_file(&old_path).context("Не удалось удалить старый бинарник")
            {
                Ok(()) => log_info!("Удалён старый бинарник: {:?}", old_path),
                Err(e) => log_err!("{:?}", e),
            }
        }

        let old_dir = current_exe.with_file_name(format!(
            "{}.app.old",
            current_exe
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.file_name())
                .unwrap_or_default()
                .to_string_lossy()
                .trim_end_matches(".app")
        ));
        if old_dir.exists() {
            match std::fs::remove_dir_all(&old_dir).context("Не удалось удалить старый бандл")
            {
                Ok(()) => log_info!("Удалён старый бандл: {:?}", old_dir),
                Err(e) => log_err!("{:?}", e),
            }
        }
    }
}
