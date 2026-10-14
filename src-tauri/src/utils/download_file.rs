use anyhow::{Context, Result};
use futures::StreamExt;
use quick_xml::de::from_str;
use serde::de::DeserializeOwned;
use sha1::Sha1;
use std::future::Future;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::fs;
use walkdir::WalkDir;

use super::bandwidth;
use super::blocking;
use super::hex;
use super::http::http_client;
use crate::log_info;
use crate::utils::errors::LauncherError;

static PART_SEQ: AtomicU64 = AtomicU64::new(0);

fn part_path(dest: &Path) -> PathBuf {
    let seq = PART_SEQ.fetch_add(1, Ordering::Relaxed);
    let mut name = dest.as_os_str().to_os_string();
    name.push(format!(".{}.{}.part", std::process::id(), seq));
    PathBuf::from(name)
}

pub fn cleanup_part_files(root: &Path) -> u64 {
    let mut removed = 0u64;
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|entry| entry.ok())
    {
        let is_part = entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("part"));
        if is_part && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

async fn fetch_response(url: &str) -> Result<reqwest::Response> {
    let response = http_client().get(url).send().await.map_err(|e| {
        LauncherError::Download(format!("Не удалось выполнить запрос к {url}: {e:#}"))
    })?;
    let response = response
        .error_for_status()
        .map_err(|e| LauncherError::HttpStatus {
            status: e.status().map(|s| s.as_u16()).unwrap_or(0),
            message: format!("Сервер вернул ошибку для {url}: {e:#}"),
        })?;
    Ok(response)
}

pub async fn write_atomic(dest: &Path, content: &[u8]) -> Result<()> {
    let dest = dest.to_path_buf();
    let content = content.to_vec();
    blocking(
        &format!("Не удалось записать файл {dest:?}"),
        move || write_atomic_sync(&dest, &content),
    )
    .await?
}

pub fn write_atomic_sync(dest: &Path, content: &[u8]) -> Result<()> {
    write_content_atomic(dest, content, false)
}

pub fn write_atomic_sync_private(dest: &Path, content: &[u8]) -> Result<()> {
    write_content_atomic(dest, content, true)
}

fn write_content_atomic(dest: &Path, content: &[u8], private: bool) -> Result<()> {
    let tmp = part_path(dest);
    let result = write_content(&tmp, content, private).and_then(|()| {
        std::fs::rename(&tmp, dest)
            .map_err(|e| {
                LauncherError::DiskIo(format!("Не удалось переместить {tmp:?} в {dest:?}: {e:#}"))
            })
            .map_err(Into::into)
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn write_content(path: &Path, content: &[u8], private: bool) -> Result<()> {
    if private {
        write_file_private(path, content)
    } else {
        write_file_sync(path, content)
    }
}

fn write_file_sync(path: &Path, content: &[u8]) -> Result<()> {
    let mut file = std::fs::File::create(path)
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось создать файл {path:?}: {e:#}")))?;
    file.write_all(content)
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось записать файл {path:?}: {e:#}")))?;
    file.sync_all().map_err(|e| {
        LauncherError::DiskIo(format!(
            "Не удалось синхронизировать {path:?} с диском: {e:#}"
        ))
    })?;
    Ok(())
}

#[cfg(unix)]
fn write_file_private(path: &Path, content: &[u8]) -> Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось создать файл {path:?}: {e}")))?;
    file.write_all(content)
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось записать файл {path:?}: {e}")))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось ограничить права файла {path:?}: {e}"))
    })?;
    file.sync_all().map_err(|e| {
        LauncherError::DiskIo(format!(
            "Не удалось синхронизировать {path:?} с диском: {e}"
        ))
    })?;
    Ok(())
}

#[cfg(not(unix))]
fn write_file_private(path: &Path, content: &[u8]) -> Result<()> {
    write_file_sync(path, content)
}

pub async fn read_to_string_opt(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("Не удалось прочитать {:?}", path)),
    }
}

pub async fn download_file(url: &str, dest: &Path) -> Result<()> {
    download_file_limited(url, dest, None).await
}

pub async fn download_file_limited(url: &str, dest: &Path, max_bytes: Option<u64>) -> Result<()> {
    if dest.exists() {
        return Ok(());
    }

    let response = fetch_response(url).await?;
    write_stream_to_atomic_limited(response, dest, url, max_bytes).await?;
    Ok(())
}

pub async fn sha1_matches(dest: &Path, expected: &str) -> bool {
    if dest.is_file() {
        if let Ok(hash) = file_sha1(dest).await {
            return hash.eq_ignore_ascii_case(expected);
        }
    }
    false
}

pub(crate) async fn write_stream_to_atomic(
    response: reqwest::Response,
    dest: &Path,
    url: &str,
) -> Result<u64> {
    write_stream_to_atomic_limited(response, dest, url, None).await
}

pub(crate) async fn write_stream_to_atomic_limited(
    response: reqwest::Response,
    dest: &Path,
    url: &str,
    max_bytes: Option<u64>,
) -> Result<u64> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            LauncherError::DiskIo(format!("Не удалось создать директорию для {dest:?}: {e:#}"))
        })?;
    }

    let tmp = part_path(dest);
    let result = async {
        let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| {
            LauncherError::DiskIo(format!("Не удалось создать файл во {tmp:?}: {e:#}"))
        })?;
        let total_bytes = stream_response_to_writer(response, url, max_bytes, &mut file).await?;
        file.sync_all().await.map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось синхронизировать {tmp:?} с диском: {e:#}"
            ))
        })?;
        drop(file);
        Ok::<u64, anyhow::Error>(total_bytes)
    }
    .await;

    match result {
        Ok(total_bytes) => match tokio::fs::rename(&tmp, dest).await {
            Ok(()) => Ok(total_bytes),
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                Err(LauncherError::DiskIo(format!(
                    "Не удалось переместить {tmp:?} в {dest:?}: {e:#}"
                ))
                .into())
            }
        },
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            Err(e)
        }
    }
}

async fn stream_response_to_writer<W>(
    response: reqwest::Response,
    url: &str,
    max_bytes: Option<u64>,
    writer: &mut W,
) -> Result<u64>
where
    W: tokio::io::AsyncWrite + Unpin + Send,
{
    use tokio::io::AsyncWriteExt;

    let mut stream = response.bytes_stream();
    let mut total_bytes: u64 = 0;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| {
            LauncherError::Download(format!("Ошибка чтения потока при скачивании {url}: {e:#}"))
        })?;
        bandwidth::acquire(chunk.len() as u64).await;
        total_bytes += chunk.len() as u64;
        if total_bytes > max_bytes.unwrap_or(u64::MAX) {
            return Err(LauncherError::SizeLimit(format!(
                "{url}: получено {total_bytes} байт, ожидалось не более {}",
                max_bytes.unwrap_or(u64::MAX)
            ))
            .into());
        }
        writer.write_all(&chunk).await.map_err(|e| {
            LauncherError::DiskIo(format!("Ошибка записи при скачивании {url}: {e:#}"))
        })?;
    }
    Ok(total_bytes)
}

pub async fn download_json<T: DeserializeOwned>(url: Option<&str>, dest: &Path) -> Result<T> {
    let mut attempted_refetch = false;

    loop {
        if let Some(url_json) = url {
            if !dest.exists() {
                let response = fetch_response(url_json).await?;
                write_stream_to_atomic(response, dest, url_json).await?;
            }
        }

        let outcome = match fs::read_to_string(dest).await {
            Ok(content) => match serde_json::from_str::<T>(&content) {
                Ok(json) => Ok(json),
                Err(e) => Err(LauncherError::ManifestParse(format!(
                    "Некорректный кэш манифеста {dest:?}: {e:#}"
                ))
                .into()),
            },
            Err(e) => Err(LauncherError::DiskIo(format!(
                "Не удалось прочитать кэш манифеста {dest:?}: {e:#}"
            ))
            .into()),
        };

        match outcome {
            Ok(json) => return Ok(json),
            Err(_) if url.is_some() && !attempted_refetch => {
                let _ = fs::remove_file(dest).await;
                attempted_refetch = true;
                continue;
            }
            Err(e) => return Err(e),
        }
    }
}

pub async fn download_xml<T: DeserializeOwned>(url: &str) -> Result<T> {
    let response = fetch_response(url).await?;
    let body = read_body_through_bucket(response, url).await?;
    let xml = String::from_utf8(body).map_err(|e| {
        LauncherError::Download(format!("Некорректная кодировка ответа от {url}: {e}"))
    })?;
    let xml_struct: T = from_str(&xml).map_err(|e| {
        LauncherError::ManifestParse(format!("Не удалось разобрать XML от {url}: {e:#}"))
    })?;
    Ok(xml_struct)
}

async fn read_body_through_bucket(response: reqwest::Response, url: &str) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    stream_response_to_writer(response, url, None, &mut body).await?;
    Ok(body)
}

pub async fn download_and_verify_with<F, Fut>(
    dest: &Path,
    expected_sha1: Option<&str>,
    precheck: bool,
    fetch: F,
) -> Result<bool>
where
    F: FnOnce(PathBuf) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let expected = expected_sha1.filter(|hash| !hash.is_empty());

    if precheck && dest.exists() {
        let intact = match expected {
            Some(hash) => sha1_matches(dest, hash).await,
            None => false,
        };
        if intact {
            return Ok(false);
        }
        log_info!("[download] Файл {dest:?} отличается от ожидаемого, перекачивается");
    }

    let staging = part_path(dest);
    let _ = tokio::fs::remove_file(&staging).await;
    fetch(staging.clone()).await?;

    if let Some(expected) = expected {
        let actual = file_sha1(&staging).await.map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось вычислить хеш скачанного файла {dest:?}: {e:#}"
            ))
        })?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(&staging).await;
            return Err(LauncherError::HashMismatch(format!(
                "{dest:?} (ожидается {expected}, получен {actual})"
            ))
            .into());
        }
    }

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            LauncherError::DiskIo(format!("Не удалось создать директорию для {dest:?}: {e:#}"))
        })?;
    }
    tokio::fs::rename(&staging, dest).await.map_err(|e| {
        LauncherError::DiskIo(format!(
            "Не удалось переместить {staging:?} в {dest:?}: {e:#}"
        ))
    })?;
    Ok(true)
}

fn hash_file_blocking<D: sha1::Digest>(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось открыть {path:?}: {e:#}")))?;
    let mut hasher = D::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| LauncherError::DiskIo(format!("Ошибка чтения файла {path:?}: {e:#}")))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hex::digest_hex(hasher.finalize()))
}

pub async fn file_sha1(path: &Path) -> Result<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || hash_file_blocking::<Sha1>(&path))
        .await
        .map_err(|e| LauncherError::Download(format!("Ошибка при вычислении SHA1: {e:#}")))?
}

#[cfg(test)]
mod download_and_verify_tests {
    use anyhow::Result;

    use super::download_and_verify_with;
    use crate::test_support::{part_files_in, sha1_hex, LauncherDirGuard};

    #[tokio::test]
    async fn failed_fetch_keeps_existing_file_with_precheck() {
        let dir = LauncherDirGuard::acquire("verify_fetch_fail").await;
        let dest = dir.root().join("mods").join("a.jar");
        tokio::fs::create_dir_all(dest.parent().unwrap())
            .await
            .unwrap();
        let good = b"working jar";
        tokio::fs::write(&dest, good).await.unwrap();

        let result: Result<bool> = download_and_verify_with(
            &dest,
            Some(&sha1_hex(b"new jar")),
            true,
            |path| async move {
                let _ = path;
                Err(anyhow::anyhow!("сеть оборвалась"))
            },
        )
        .await;

        assert!(result.is_err(), "сбой сети должен возвращать ошибку");
        assert_eq!(
            tokio::fs::read(&dest).await.unwrap(),
            good,
            "прежний рабочий файл должен остаться на месте при оборванной загрузке"
        );
        assert!(
            part_files_in(dest.parent().unwrap()).is_empty(),
            "staging-файл должен быть убран"
        );
    }

    #[tokio::test]
    async fn failed_verify_keeps_existing_file_and_removes_staging() {
        let dir = LauncherDirGuard::acquire("verify_hash_fail").await;
        let dest = dir.root().join("mods").join("a.jar");
        tokio::fs::create_dir_all(dest.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&dest, b"working jar").await.unwrap();

        let result: Result<bool> = download_and_verify_with(
            &dest,
            Some(&sha1_hex(b"expected content")),
            true,
            |path| async move {
                tokio::fs::write(&path, b"corrupted content").await?;
                Ok(())
            },
        )
        .await;

        assert!(
            result.is_err(),
            "несовпадение хеша должно возвращать ошибку"
        );
        assert_eq!(
            tokio::fs::read(&dest).await.unwrap(),
            b"working jar",
            "хеш-мисматч не должен трогать существующий файл"
        );
        assert!(part_files_in(dest.parent().unwrap()).is_empty());
    }

    #[tokio::test]
    async fn uppercase_expected_hash_skips_download_on_precheck() {
        let dir = LauncherDirGuard::acquire("verify_uppercase").await;
        let dest = dir.root().join("mods").join("a.jar");
        tokio::fs::create_dir_all(dest.parent().unwrap())
            .await
            .unwrap();
        let content = b"stable content";
        tokio::fs::write(&dest, content).await.unwrap();

        let uppercase = sha1_hex(content).to_uppercase();
        let downloaded =
            download_and_verify_with(&dest, Some(&uppercase), true, |path| async move {
                tokio::fs::write(&path, b"should not be written").await?;
                Ok(())
            })
            .await
            .expect("uppercase-хеш должен совпадать без учёта регистра");

        assert!(
            !downloaded,
            "файл с совпадающим uppercase-хешем не перекачивается"
        );
        assert_eq!(tokio::fs::read(&dest).await.unwrap(), content);
    }

    #[tokio::test]
    async fn successful_update_replaces_content_through_staging() {
        let dir = LauncherDirGuard::acquire("verify_update_ok").await;
        let dest = dir.root().join("mods").join("a.jar");
        tokio::fs::create_dir_all(dest.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&dest, b"old jar").await.unwrap();

        let new_content = b"new jar";
        let downloaded = download_and_verify_with(
            &dest,
            Some(&sha1_hex(new_content)),
            true,
            |path| async move {
                tokio::fs::write(&path, new_content).await?;
                Ok(())
            },
        )
        .await
        .expect("обновление");

        assert!(downloaded);
        assert_eq!(tokio::fs::read(&dest).await.unwrap(), new_content);
        assert!(
            part_files_in(dest.parent().unwrap()).is_empty(),
            "staging переименовывается в dest"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{download_file_limited, write_stream_to_atomic};
    use crate::test_support::{part_files_in, LauncherDirGuard};
    use crate::utils::http::http_client;
    use mockito::Server;

    const MAX_SEND_ATTEMPTS: usize = 10;

    async fn send_until_response(url: &str) -> Result<reqwest::Response, reqwest::Error> {
        let client = http_client();
        let mut attempts_left = MAX_SEND_ATTEMPTS;
        loop {
            match client.get(url).send().await {
                Ok(response) => return Ok(response),
                Err(error) => {
                    attempts_left -= 1;
                    if attempts_left == 0 {
                        return Err(error);
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn broken_stream_deletes_part_and_keeps_dest_absent() {
        let dir = LauncherDirGuard::acquire("broken_stream").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/big-file")
            .with_status(200)
            .with_chunked_body(|writer| {
                writer.write_all(b"partial bytes")?;
                Err(std::io::Error::other("соединение оборвано"))
            })
            .create_async()
            .await;

        let dest = dir.root().join("downloads").join("big-file.bin");
        let url = format!("{}/big-file", server.url());
        let response = send_until_response(&url)
            .await
            .expect("запрос к серверу")
            .error_for_status()
            .expect("статус 200");

        let result = write_stream_to_atomic(response, &dest, &url).await;

        assert!(result.is_err(), "оборванный поток должен возвращать ошибку");
        assert!(!dest.exists(), "файл назначения не должен появиться");
        assert!(
            part_files_in(dest.parent().unwrap()).is_empty(),
            "part-файл должен быть удалён"
        );
    }

    #[tokio::test]
    async fn full_stream_writes_file_without_part_leftover() {
        let dir = LauncherDirGuard::acquire("full_stream").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/small-file")
            .with_status(200)
            .with_body("complete body")
            .create_async()
            .await;

        let dest = dir.root().join("downloads").join("small-file.bin");
        let url = format!("{}/small-file", server.url());
        let response = http_client()
            .get(&url)
            .send()
            .await
            .expect("запрос к серверу")
            .error_for_status()
            .expect("статус 200");

        let written = write_stream_to_atomic(response, &dest, &url)
            .await
            .expect("успешная загрузка");

        assert_eq!(written, "complete body".len() as u64);
        assert_eq!(
            std::fs::read(&dest).expect("файл назначения"),
            b"complete body"
        );
        assert!(
            part_files_in(dest.parent().unwrap()).is_empty(),
            "part-файла быть не должно"
        );
    }

    #[tokio::test]
    async fn oversized_stream_errors_without_dest() {
        let dir = LauncherDirGuard::acquire("size_limited").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/oversized.bin")
            .with_status(200)
            .with_body("0123456789")
            .create_async()
            .await;

        let dest = dir.root().join("downloads").join("oversized.bin");
        let url = format!("{}/oversized.bin", server.url());

        let result = download_file_limited(&url, &dest, Some(4)).await;

        assert!(result.is_err(), "поток сверх лимита должен обрываться");
        assert!(!dest.exists(), "файл назначения не должен появиться");
        assert!(
            part_files_in(dest.parent().unwrap()).is_empty(),
            "part-файл должен быть удалён"
        );
    }

    #[tokio::test]
    async fn stalled_stream_errors_by_read_timeout() {
        let dir = LauncherDirGuard::acquire("stalled_stream").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/stalled-file")
            .with_status(200)
            .with_chunked_body(|writer| {
                writer.write_all(b"partial bytes")?;
                std::thread::sleep(std::time::Duration::from_secs(2));
                Ok(())
            })
            .create_async()
            .await;

        let dest = dir.root().join("downloads").join("stalled.bin");
        let url = format!("{}/stalled-file", server.url());
        let client = crate::utils::http::base_client_builder()
            .read_timeout(std::time::Duration::from_millis(300))
            .build()
            .expect("клиент с коротким read_timeout");
        let response = client
            .get(&url)
            .send()
            .await
            .expect("запрос к серверу")
            .error_for_status()
            .expect("статус 200");

        let started = std::time::Instant::now();
        let result = write_stream_to_atomic(response, &dest, &url).await;
        let elapsed = started.elapsed();

        assert!(
            result.is_err(),
            "зависший после начала тела поток должен обрываться по read_timeout"
        );
        assert!(
            elapsed < std::time::Duration::from_secs(1),
            "ошибка должна приходить по таймауту чтения, а не после паузы сервера: {elapsed:?}"
        );
        assert!(!dest.exists(), "файл назначения не должен появиться");
        assert!(
            part_files_in(dest.parent().unwrap()).is_empty(),
            "part-файл должен быть удалён"
        );
    }
}

#[cfg(test)]
mod part_cleanup_tests {
    use super::cleanup_part_files;
    use crate::test_support::TempDir;

    #[test]
    fn cleanup_removes_only_part_files_recursively() {
        let dir = TempDir::new("part_cleanup");
        std::fs::create_dir_all(dir.0.join("mods")).unwrap();
        std::fs::create_dir_all(dir.0.join("libraries/com")).unwrap();
        let unique_part = dir.0.join("mods/a.jar.4242.7.part");
        std::fs::write(&unique_part, b"partial").unwrap();
        std::fs::write(dir.0.join("libraries/com/b.part"), b"partial").unwrap();
        std::fs::write(dir.0.join("mods/keep.jar"), b"jar").unwrap();
        std::fs::write(dir.0.join("root.txt"), b"txt").unwrap();

        let removed = cleanup_part_files(&dir.0);

        assert_eq!(
            removed, 2,
            "удаляются оба .part-файла на любой глубине, включая уникальные имена"
        );
        assert!(!unique_part.exists());
        assert!(!dir.0.join("libraries/com/b.part").exists());
        assert!(dir.0.join("mods/keep.jar").exists());
        assert!(dir.0.join("root.txt").exists());
    }

    #[test]
    fn cleanup_on_missing_root_is_noop() {
        assert_eq!(
            cleanup_part_files(&std::env::temp_dir().join("limacina-missing-part-root")),
            0
        );
    }
}

#[cfg(test)]
mod private_write_tests {
    use super::write_atomic_sync_private;
    use crate::test_support::{part_files_in, TempDir};

    #[test]
    fn private_write_replaces_existing_file_without_part_leftover() {
        let dir = TempDir::new("private_write");
        let dest = dir.0.join("secret.json");
        std::fs::write(&dest, b"old").unwrap();

        write_atomic_sync_private(&dest, b"new").expect("приватная запись");

        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
        assert!(part_files_in(dir.0.as_path()).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn private_write_sets_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("private_mode");
        let dest = dir.0.join("secret.json");

        write_atomic_sync_private(&dest, b"data").expect("приватная запись");

        let mode = std::fs::metadata(&dest).unwrap().permissions().mode();
        assert_eq!(
            mode & 0o777,
            0o600,
            "файл должен быть доступен только владельцу"
        );
    }
}

#[cfg(test)]
mod write_atomic_race_tests {
    use super::{part_path, write_atomic, write_atomic_sync};
    use crate::test_support::{part_files_in, TempDir};
    use serde_json::Value;

    #[tokio::test]
    async fn concurrent_writes_to_same_dest_keep_content_complete() {
        let dir = TempDir::new("atomic_race");
        let dest = dir.0.join("state.json");

        for round in 0..5u32 {
            let mut handles = Vec::new();
            for writer in 0..16u32 {
                let dest = dest.clone();
                handles.push(tokio::spawn(async move {
                    let payload = format!(
                        "{{\"round\": {round}, \"writer\": {writer}, \"filler\": \"{}\"}}",
                        "x".repeat(2048)
                    );
                    write_atomic(&dest, payload.as_bytes()).await
                }));
            }
            for handle in handles {
                handle
                    .await
                    .expect("задача записи")
                    .expect("параллельная атомарная запись");
            }

            let raw = std::fs::read_to_string(&dest).expect("итоговый файл");
            let parsed: Value =
                serde_json::from_str(&raw).expect("файл не должен быть torn-результатом гонки");
            assert_eq!(
                parsed["round"], round,
                "контент должен быть целиком из текущего раунда записей"
            );
        }

        assert!(
            part_files_in(dest.parent().expect("родительская директория")).is_empty(),
            "временных .part-файлов оставаться не должно"
        );
    }

    #[test]
    fn part_paths_are_unique_per_call() {
        let dest = std::path::Path::new("dir/file.jar");
        assert_ne!(
            part_path(dest),
            part_path(dest),
            "каждая запись должна получать собственное временное имя"
        );
    }

    #[tokio::test]
    async fn failed_rename_leaves_no_part_file() {
        let dir = TempDir::new("atomic_rename_fail");
        let dest = dir.0.join("state.json");
        std::fs::create_dir_all(&dest).expect("директория-заглушка на месте назначения");

        let result = write_atomic(&dest, b"payload").await;

        assert!(result.is_err(), "запись поверх директории должна падать");
        assert!(
            part_files_in(dir.0.as_path()).is_empty(),
            "неудачная запись не должна оставлять .part-файл"
        );
    }

    #[test]
    fn failed_sync_rename_leaves_no_part_file() {
        let dir = TempDir::new("atomic_sync_rename_fail");
        let dest = dir.0.join("state.json");
        std::fs::create_dir_all(&dest).expect("директория-заглушка на месте назначения");

        let result = write_atomic_sync(&dest, b"payload");

        assert!(result.is_err(), "запись поверх директории должна падать");
        assert!(
            part_files_in(dir.0.as_path()).is_empty(),
            "неудачная запись не должна оставлять .part-файл"
        );
    }
}

#[cfg(test)]
mod download_json_tests {
    use super::download_json;
    use crate::test_support::TempDir;
    use mockito::Server;
    use serde_json::Value;

    #[tokio::test]
    async fn download_json_refetches_once_after_corrupt_cache() {
        let dir = TempDir::new("json_refetch");
        let dest = dir.0.join("manifest.json");
        std::fs::write(&dest, "{ not json").expect("битый кэш манифеста");

        let mut server = Server::new_async().await;
        server
            .mock("GET", "/manifest.json")
            .with_status(200)
            .with_body(r#"{"version":1}"#)
            .create_async()
            .await;

        let parsed: Value = download_json(Some(&format!("{}/manifest.json", server.url())), &dest)
            .await
            .expect("битый кэш должен перекачаться один раз");

        assert_eq!(parsed["version"], 1);
        assert_eq!(
            std::fs::read_to_string(&dest).expect("кэш перезаписан"),
            r#"{"version":1}"#
        );
    }

    #[tokio::test]
    async fn download_json_errors_after_single_refetch_still_corrupt() {
        let dir = TempDir::new("json_refetch_fail");
        let dest = dir.0.join("manifest.json");

        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/manifest.json")
            .with_status(200)
            .with_body("still not json")
            .expect(2)
            .create_async()
            .await;

        let result: Result<Value, anyhow::Error> =
            download_json(Some(&format!("{}/manifest.json", server.url())), &dest).await;

        assert!(
            result.is_err(),
            "после одного refetch ошибка должна вернуться"
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn download_json_without_url_reports_corrupt_cache_without_refetch() {
        let dir = TempDir::new("json_no_url");
        let dest = dir.0.join("manifest.json");
        std::fs::write(&dest, "{ not json").expect("битый кэш манифеста");

        let result: Result<Value, anyhow::Error> = download_json(None, &dest).await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(&dest).expect("файл без url не должен удаляться"),
            "{ not json"
        );
    }

    #[tokio::test]
    async fn download_json_counts_bytes_toward_bandwidth_limit() {
        use std::time::{Duration, Instant};

        use crate::test_support::lock_bandwidth_tests;
        use crate::utils::bandwidth::{acquire, set_limit};

        let _guard = lock_bandwidth_tests().await;
        set_limit(Some(8192));
        acquire(8192 * 1024).await;

        let dir = TempDir::new("json_bandwidth");
        let filler = "x".repeat(1024 * 1024);
        let body = format!("{{\"filler\": \"{filler}\"}}");
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/manifest.json")
            .with_status(200)
            .with_body(body.clone())
            .create_async()
            .await;

        let start = Instant::now();
        let parsed: Value = download_json(
            Some(&format!("{}/manifest.json", server.url())),
            &dir.0.join("manifest.json"),
        )
        .await
        .expect("загрузка манифеста");
        let elapsed = start.elapsed();

        assert_eq!(
            parsed["filler"].as_str().expect("поле filler").len(),
            1024 * 1024,
            "манифест должен скачать целиком, без обрезки"
        );
        assert!(
            elapsed >= Duration::from_millis(100),
            "байты манифеста должны учитываться в лимите скорости: {elapsed:?}"
        );

        set_limit(None);
    }
}
