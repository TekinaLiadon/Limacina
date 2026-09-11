pub mod version;

pub use version::{
    check_for_update, get_launcher_versions, platform_sha256, UpdateInfo, UpdateVersions,
};

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};


use crate::utils::env_info::{get_arch, get_current_os};
use crate::utils::zip::extract_zip;
use crate::{log_err, log_info};

pub async fn download_update(version: &str) -> Result<PathBuf> {
    if !version
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')
    {
        anyhow::bail!("Некорректная версия: {}", version);
    }

    let server_url = env!("LAUNCHER_SERVER_URL");
    let os = get_current_os();
    let arch = get_arch();
    let url = format!("{}/v1/launcher/update/{}/{}/download", server_url, os, arch);

    let temp_dir = std::env::temp_dir();
    let archive_name = format!("limacina_update_{}.zip", version);
    let archive_path = temp_dir.join(&archive_name);

    log_info!("Скачивание обновления v{}", version);

    let client = crate::utils::http::http_client();
    let resp = client
        .get(&url)
        .query(&[("version", version)])
        .send()
        .await
        .context("Не удалось подключиться для скачивания обновления")?
        .error_for_status()
        .context("Сервер вернул ошибку при скачивании обновления")?;

    let bytes = resp
        .bytes()
        .await
        .context("Не удалось прочитать данные обновления")?;

    if let Some(expected) = expected_archive_sha256(version).await? {
        verify_sha256(&bytes, &expected).await?;
    }

    crate::utils::download_file::write_atomic(&archive_path, &bytes).await?;

    log_info!("Обновление скачано: {:?}", archive_path);
    Ok(archive_path)
}

async fn expected_archive_sha256(version: &str) -> Result<Option<String>> {
    let versions = get_launcher_versions().await?;
    let os = get_current_os();
    let arch = get_arch();
    Ok(versions
        .versions
        .iter()
        .find(|v| v.version == version)
        .and_then(|v| platform_sha256(&v.platforms, os, arch)))
}

async fn verify_sha256(bytes: &[u8], expected: &str) -> Result<()> {
    let expected = expected.trim().to_string();
    let bytes = bytes.to_vec();
    let hash = tokio::task::spawn_blocking(move || {
        use sha2::Digest;
        crate::utils::hex::digest_hex(sha2::Sha256::digest(&bytes))
    })
    .await
    .context("Ошибка при вычислении SHA-256")?;

    if !hash.eq_ignore_ascii_case(&expected) {
        anyhow::bail!(
            "SHA-256 архива обновления не совпадает: ожидается {}, получен {}",
            expected,
            hash
        );
    }
    Ok(())
}

pub fn apply_update(archive_path: &Path) -> Result<()> {
    let current_exe =
        std::env::current_exe().context("Не удалось получить путь текущего бинарника")?;

    log_info!("Текущий бинарник: {:?}", current_exe);

    let temp_extract_dir = std::env::temp_dir().join("limacina_update_extract");
    if temp_extract_dir.exists() {
        std::fs::remove_dir_all(&temp_extract_dir)
            .context("Не удалось очистить директорию извлечения")?;
    }
    std::fs::create_dir_all(&temp_extract_dir)
        .context("Не удалось создать директорию для извлечения")?;
    extract_zip(archive_path, &temp_extract_dir).context("Не удалось извлечь архив обновления")?;

    let new_binary = find_binary_in_dir(&temp_extract_dir)?;
    log_info!("Новый бинарник: {:?}", new_binary);

    let exe_dir = current_exe
        .parent()
        .context("Не удалось определить директорию бинарника")?;
    let staged_path = exe_dir.join(format!(
        "{}.new",
        current_exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ));

    let old_path = old_binary_path(&current_exe);

    if old_path.exists() {
        std::fs::remove_file(&old_path).context("Не удалось удалить старый бинарник")?;
    }

    let prepare_result = (|| -> Result<()> {
        std::fs::copy(&new_binary, &staged_path)
            .context("Не удалось подготовить новый бинарник")?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(&staged_path, perms)
                .context("Не удалось установить права на бинарник")?;
        }

        Ok(())
    })();

    if let Err(e) = prepare_result {
        log_err!("Подготовка обновления не удалась: {}", e);
        let _ = std::fs::remove_file(&staged_path);
        let _ = std::fs::remove_dir_all(&temp_extract_dir);
        return Err(e);
    }

    std::fs::rename(&current_exe, &old_path)
        .context("Не удалось переименовать текущий бинарник")?;

    match std::fs::rename(&staged_path, &current_exe) {
        Ok(()) => {
            log_info!("Обновление применено, перезапуск...");
        }
        Err(e) => {
            log_err!("Не удалось перенести новый бинарник ({}), откат", e);
            if current_exe.exists() {
                let _ = std::fs::remove_file(&current_exe);
            }
            if let Err(rollback_err) = std::fs::rename(&old_path, &current_exe) {
                log_err!(
                    "Критическая ошибка отката: не удалось вернуть исходный бинарник ({:?})",
                    rollback_err
                );
            }
            let _ = std::fs::remove_file(&staged_path);
            let _ = std::fs::remove_dir_all(&temp_extract_dir);
            return Err(anyhow::Error::new(e)
                .context("Не удалось применить обновление: перенос бинарника не удался"));
        }
    }

    if temp_extract_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_extract_dir);
    }
    let _ = std::fs::remove_file(archive_path);

    Ok(())
}

fn old_binary_path(current_exe: &Path) -> PathBuf {
    current_exe.with_file_name(format!(
        "{}.old",
        current_exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ))
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
        let old_path = old_binary_path(&current_exe);
        if old_path.exists() {
            match std::fs::remove_file(&old_path).context("Не удалось удалить старый бинарник")
            {
                Ok(()) => log_info!("Удалён старый бинарник: {:?}", old_path),
                Err(e) => log_err!("{:?}", e),
            }
        }

        let staged_path = current_exe.with_file_name(format!(
            "{}.new",
            current_exe
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        if staged_path.exists() {
            match std::fs::remove_file(&staged_path).context("Не удалось удалить незавершённое обновление")
            {
                Ok(()) => log_info!("Удалён незавершённый бинарник обновления: {:?}", staged_path),
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
