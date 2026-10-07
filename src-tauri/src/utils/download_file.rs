use anyhow::Result;
use futures::StreamExt;
use quick_xml::de::from_str;
use serde::de::DeserializeOwned;
use sha1::Sha1;
use std::future::Future;
use std::io::Read;
use std::path::{Path, PathBuf};
use tokio::fs;

use super::bandwidth;
use super::hex;
use super::http::http_client;
use crate::log_info;
use crate::utils::errors::LauncherError;

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
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
    let tmp = part_path(dest);
    fs::write(&tmp, content).await.map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось записать файл во {tmp:?}: {e:#}"))
    })?;
    tokio::fs::rename(&tmp, dest).await.map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось переместить {tmp:?} в {dest:?}: {e:#}"))
    })?;
    Ok(())
}

pub fn write_atomic_sync(dest: &Path, content: &[u8]) -> Result<()> {
    let tmp = part_path(dest);
    std::fs::write(&tmp, content).map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось записать файл во {tmp:?}: {e:#}"))
    })?;
    std::fs::rename(&tmp, dest).map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось переместить {tmp:?} в {dest:?}: {e:#}"))
    })?;
    Ok(())
}

pub async fn download_file(url: &str, dest: &Path) -> Result<()> {
    if dest.exists() {
        return Ok(());
    }

    let response = fetch_response(url).await?;
    write_stream_to_atomic(response, dest, url).await?;
    Ok(())
}

pub(crate) async fn write_stream_to_atomic(
    response: reqwest::Response,
    dest: &Path,
    url: &str,
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
        let mut stream = response.bytes_stream();
        let mut total_bytes: u64 = 0;
        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| {
                LauncherError::Download(format!("Ошибка чтения потока при скачивании {url}: {e:#}"))
            })?;
            bandwidth::acquire(chunk.len() as u64).await;
            total_bytes += chunk.len() as u64;
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .map_err(|e| {
                    LauncherError::DiskIo(format!("Ошибка записи в файл {tmp:?}: {e:#}"))
                })?;
        }
        drop(file);
        Ok::<u64, anyhow::Error>(total_bytes)
    }
    .await;

    match result {
        Ok(total_bytes) => {
            tokio::fs::rename(&tmp, dest).await.map_err(|e| {
                LauncherError::DiskIo(format!("Не удалось переместить {tmp:?} в {dest:?}: {e:#}"))
            })?;
            Ok(total_bytes)
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            Err(e)
        }
    }
}

pub async fn download_json<T: DeserializeOwned>(url: Option<&str>, dest: &Path) -> Result<T> {
    let mut attempted_refetch = false;

    loop {
        if let Some(url_json) = url {
            if !dest.exists() {
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).await.map_err(|e| {
                        LauncherError::DiskIo(format!(
                            "Не удалось создать директорию для {dest:?}: {e:#}"
                        ))
                    })?;
                }

                let response = fetch_response(url_json).await?;
                let content = response.bytes().await.map_err(|e| {
                    LauncherError::Download(format!(
                        "Не удалось прочитать ответ от {url_json}: {e:#}"
                    ))
                })?;

                write_atomic(dest, &content).await?;
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
    let xml = fetch_response(url).await?.text().await.map_err(|e| {
        LauncherError::Download(format!("Не удалось прочитать ответ от {url}: {e:#}"))
    })?;
    let xml_struct: T = from_str(&xml).map_err(|e| {
        LauncherError::ManifestParse(format!("Не удалось разобрать XML от {url}: {e:#}"))
    })?;
    Ok(xml_struct)
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
        if let Some(expected) = expected {
            let hash = file_sha1(dest).await.unwrap_or_default();
            if hash == expected {
                return Ok(false);
            }
            log_info!("[download] Файл {dest:?} отличается от ожидаемого — перекачивается");
        }
        let _ = tokio::fs::remove_file(dest).await;
    }

    fetch(dest.to_path_buf()).await?;

    if let Some(expected) = expected {
        let actual = file_sha1(dest).await.map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось вычислить хеш скачанного файла {dest:?}: {e:#}"
            ))
        })?;
        if actual != expected {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(LauncherError::HashMismatch(format!(
                "{dest:?} (ожидается {expected}, получен {actual})"
            ))
            .into());
        }
    }

    Ok(true)
}

fn hash_file_blocking<D: md5::Digest>(path: &Path) -> Result<String> {
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
mod tests {
    use super::{part_path, write_stream_to_atomic};
    use crate::test_support::LauncherDirGuard;
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
        assert!(!part_path(&dest).exists(), "part-файл должен быть удалён");
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
        assert!(!part_path(&dest).exists(), "part-файла быть не должно");
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
        assert!(!part_path(&dest).exists(), "part-файл должен быть удалён");
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
}
