use std::path::Path;
use anyhow::{Context, Result};

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

    tokio::fs::write(dest, &content)
        .await
        .with_context(|| format!("Не удалось записать файл в {:?}", dest))?;

    Ok(())
}