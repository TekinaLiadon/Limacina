use anyhow::{Context, Result};
use futures::StreamExt;
use md5::Md5;
use quick_xml::de::from_str;
use serde::de::DeserializeOwned;
use sha1::Sha1;
use std::io::Read;
use std::path::{Path, PathBuf};
use tokio::fs;

use super::bandwidth;
use super::hex;
use super::http::http_client;


fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
}



pub async fn write_atomic(dest: &Path, content: &[u8]) -> Result<()> {
    let tmp = part_path(dest);
    fs::write(&tmp, content)
        .await
        .with_context(|| format!("Не удалось записать файл во {:?}", tmp))?;
    tokio::fs::rename(&tmp, dest)
        .await
        .with_context(|| format!("Не удалось переместить {:?} в {:?}", tmp, dest))?;
    Ok(())
}

pub async fn download_file(url: &str, dest: &Path) -> Result<()> {
    let client = http_client();

    if dest.exists() {
        return Ok(());
    }

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать директорию для {:?}", dest))?;
    }

    let response = client.get(url).send().await?.error_for_status()?;

    let tmp = part_path(dest);
    let result = async {
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .with_context(|| format!("Не удалось создать файл во {:?}", tmp))?;
        let mut stream = response.bytes_stream();
        while let Some(item) = stream.next().await {
            let chunk =
                item.with_context(|| format!("Ошибка чтения потока при скачивании {}", url))?;
            bandwidth::acquire(chunk.len() as u64).await;
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .with_context(|| format!("Ошибка записи в файл {:?}", tmp))?;
        }
        drop(file);
        Ok::<(), anyhow::Error>(())
    }
    .await;

    match result {
        Ok(()) => {
            tokio::fs::rename(&tmp, dest)
                .await
                .with_context(|| format!("Не удалось переместить {:?} в {:?}", tmp, dest))?;
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(e);
        }
    }

    Ok(())
}

pub async fn download_json<T: DeserializeOwned>(url: Option<&str>, dest: &Path) -> Result<T> {
    let client = http_client();

    let mut attempted_refetch = false;

    loop {
        if let Some(url_json) = url {
            if !dest.exists() {
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)
                        .await
                        .with_context(|| format!("Не удалось создать директорию для {:?}", dest))?;
                }

                let response = client.get(url_json).send().await?.error_for_status()?;
                let content = response.bytes().await?;

                write_atomic(dest, &content).await?;
            }
        }

        let file = match fs::read_to_string(dest).await {
            Ok(content) => content,
            Err(_) if url.is_some() && !attempted_refetch => {
                let _ = fs::remove_file(dest).await;
                attempted_refetch = true;
                continue;
            }
            Err(e) => {
                return Err(anyhow::Error::new(e)
                    .context(format!("Не удалось прочитать кэш манифеста {:?}", dest)));
            }
        };

        match serde_json::from_str::<T>(&file) {
            Ok(json) => return Ok(json),
            Err(_) if url.is_some() && !attempted_refetch => {
                let _ = fs::remove_file(dest).await;
                attempted_refetch = true;
                continue;
            }
            Err(e) => {
                return Err(anyhow::Error::new(e)
                    .context(format!("Некорректный кэш манифеста {:?}", dest)));
            }
        }
    }
}

pub async fn download_xml<T: DeserializeOwned>(url: &str) -> Result<T> {
    let client = http_client();
    let xml = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let xml_struct: T = from_str(&xml)?;
    Ok(xml_struct)
}


fn hash_file_blocking<D: md5::Digest>(path: &Path) -> Result<String> {
    let mut file =
        std::fs::File::open(path).with_context(|| format!("Не удалось открыть {:?}", path))?;
    let mut hasher = D::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .with_context(|| format!("Ошибка чтения файла {:?}", path))?;
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
        .context("Ошибка при вычислении SHA1")?
}

pub async fn file_md5(path: &Path) -> Result<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || hash_file_blocking::<Md5>(&path))
        .await
        .context("Ошибка при вычислении MD5")?
}
