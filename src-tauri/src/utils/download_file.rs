use anyhow::{Context, Result};
use quick_xml::de::from_str;
use serde::{de::DeserializeOwned};
use std::path::Path;
use tokio::fs;

use crate::log_info;

pub async fn download_file(url: &str, dest: &Path) -> Result<()> {
    let client = reqwest::Client::new();
    // TODO
    if dest.exists() {
        log_info!("Файл уже существует: {:?}", dest);
        return Ok(());
    }

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Не удалось создать директорию для {:?}", dest))?;
        // fs::create_dir_all(parent)?;
    }

    let response = client.get(url).send().await?.error_for_status()?;
    let content = response.bytes().await?;

    fs::write(dest, &content)
        .await
        .with_context(|| format!("Не удалось записать файл в {:?}", dest))?;

    Ok(())
}

pub async fn download_json<T: DeserializeOwned>(url: Option<&str>, dest: &Path) -> Result<T> {
    let client = reqwest::Client::new();

    if let Some(url_json) = url {
        if !dest.exists() {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .await
                    .with_context(|| format!("Не удалось создать директорию для {:?}", dest))?;
            }

            let response = client.get(url_json).send().await?.error_for_status()?;
            let content = response.bytes().await?;

            fs::write(dest, &content)
                .await
                .with_context(|| format!("Не удалось записать файл в {:?}", dest))?;
        }
    }

    let file = fs::read_to_string(&dest).await?;
    let json: T = serde_json::from_str(&file)?;
    Ok(json)
}

pub async fn download_xml<T: DeserializeOwned>(url: &str) -> Result<T> {
    let client = reqwest::Client::new();
    let xml = client.get(url).send().await?.error_for_status()?.text().await?;
    let xml_struct: T = from_str(&xml)?;
    Ok(xml_struct)
}
