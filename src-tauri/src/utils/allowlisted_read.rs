use anyhow::{Context, Result};
use std::path::Path;

use crate::utils::errors::LauncherError;

pub struct AllowlistedRead {
    extension: &'static str,
    max_bytes: u64,
    unit_bytes: u64,
    unit_label: &'static str,
    what: &'static str,
}

impl AllowlistedRead {
    pub const fn new(
        extension: &'static str,
        max_bytes: u64,
        unit_bytes: u64,
        unit_label: &'static str,
        what: &'static str,
    ) -> Self {
        Self {
            extension,
            max_bytes,
            unit_bytes,
            unit_label,
            what,
        }
    }

    pub fn matches_extension(&self, path: &str) -> bool {
        has_extension(path, self.extension)
    }

    pub async fn read(&self, path: &str) -> Result<Vec<u8>> {
        if !self.matches_extension(path) {
            return Err(LauncherError::InvalidInput(format!(
                "Открывать можно только файлы с расширением .{}",
                self.extension
            ))
            .into());
        }
        let metadata = LauncherError::classify(
            tokio::fs::metadata(path)
                .await
                .with_context(|| self.read_error(path)),
            LauncherError::DiskIo,
        )?;
        if !metadata.is_file() {
            return Err(LauncherError::InvalidInput(format!(
                "Выбранный путь не является файлом: {:?}",
                path
            ))
            .into());
        }
        self.ensure_size(metadata.len())?;
        let bytes = tokio::fs::read(path)
            .await
            .with_context(|| self.read_error(path))?;
        self.ensure_size(bytes.len() as u64)?;
        Ok(bytes)
    }

    fn ensure_size(&self, len: u64) -> Result<()> {
        if len <= self.max_bytes {
            return Ok(());
        }
        Err(LauncherError::InvalidInput(format!(
            "Файл {} слишком большой: {} {}, максимум {} {}",
            self.what,
            len / self.unit_bytes,
            self.unit_label,
            self.max_bytes / self.unit_bytes,
            self.unit_label
        ))
        .into())
    }

    fn read_error(&self, path: &str) -> String {
        format!("Не удалось прочитать файл {} {:?}", self.what, path)
    }
}

pub fn has_extension(path: &str, extension: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
}

#[cfg(test)]
mod tests {
    use super::{has_extension, AllowlistedRead};

    const SKIN_READ: AllowlistedRead = AllowlistedRead::new("png", 256 * 1024, 1024, "КБ", "скина");

    fn temp_file(tag: &str, name: &str) -> std::path::PathBuf {
        let dir = crate::test_support::TempDir::new(tag);
        let path = dir.0.join(name);
        std::mem::forget(dir);
        path
    }

    #[test]
    fn extension_check_is_case_insensitive() {
        assert!(has_extension("C:/models/skin.PNG", "png"));
        assert!(has_extension("skin.png", "png"));
        assert!(!has_extension("skin.pngx", "png"));
        assert!(!has_extension("png", "png"));
        assert!(!has_extension("skin.cpmproject", "png"));
    }

    #[tokio::test]
    async fn wrong_extension_is_rejected_before_disk_access() {
        let path = temp_file("allowlist_ext", "model.txt");
        std::fs::write(&path, b"data").unwrap();

        let error = SKIN_READ
            .read(&path.to_string_lossy())
            .await
            .expect_err("не совпадающее расширение должно отклоняться");

        assert!(
            error.to_string().contains(".png"),
            "ошибка должна называть расширение: {error}"
        );
        assert!(
            matches!(
                error.downcast_ref::<crate::utils::errors::LauncherError>(),
                Some(crate::utils::errors::LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error}"
        );
    }

    #[tokio::test]
    async fn missing_file_is_disk_io_error() {
        let path = temp_file("allowlist_missing", "gone.png");

        let error = SKIN_READ
            .read(&path.to_string_lossy())
            .await
            .expect_err("отсутствующий файл должен давать ошибку");

        assert!(
            error
                .to_string()
                .contains("Не удалось прочитать файл скина"),
            "ошибка должна объяснять причину: {error}"
        );
    }

    #[tokio::test]
    async fn directory_with_matching_extension_is_rejected() {
        let path = temp_file("allowlist_dir", "folder.png");
        std::fs::create_dir(&path).unwrap();

        let error = SKIN_READ
            .read(&path.to_string_lossy())
            .await
            .expect_err("папка не должна читаться как файл");

        assert!(
            error.to_string().contains("не является файлом"),
            "ошибка должна называть причину: {error}"
        );
    }

    #[tokio::test]
    async fn oversized_file_is_rejected_by_metadata() {
        let path = temp_file("allowlist_oversize", "big.png");
        std::fs::write(&path, vec![0u8; 256 * 1024 + 1]).unwrap();

        let error = SKIN_READ
            .read(&path.to_string_lossy())
            .await
            .expect_err("файл больше лимита должен отклоняться");

        assert!(
            error.to_string().contains("Файл скина слишком большой"),
            "ошибка должна называть лимит: {error}"
        );
        assert!(
            error.to_string().contains("КБ"),
            "лимит указывается в КБ: {error}"
        );
    }

    #[test]
    fn grown_file_is_rejected_after_read() {
        let error = SKIN_READ
            .ensure_size(256 * 1024 + 1)
            .expect_err("рост файла после metadata не должен пропускаться");

        assert!(
            error.to_string().contains("слишком большой"),
            "повторная проверка длины должна отклонять превышение: {error}"
        );
        assert!(SKIN_READ.ensure_size(256 * 1024).is_ok());
    }

    #[tokio::test]
    async fn small_file_with_matching_extension_is_read() {
        let path = temp_file("allowlist_ok", "skin.PNG");
        std::fs::write(&path, b"png-bytes").unwrap();

        let bytes = SKIN_READ
            .read(&path.to_string_lossy())
            .await
            .expect("файл в лимите с нужным расширением читается");

        assert_eq!(bytes, b"png-bytes");
    }
}
