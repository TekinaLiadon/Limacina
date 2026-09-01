use crate::{
    log_info,
    utils::{download_file::download_file, env_info::launcher_patch},
};
use anyhow::{Context, Result};

pub async fn download_jar(
    project_name: &str,
    version: &str,
    url: &str,
    sha1: Option<&str>,
) -> Result<()> {
    let client_jar_path = launcher_patch(Some(project_name))?.join(format!("{}.jar", version));

    log_info!("Скачиваем основной JAR-файл: {}", url);
    download_file(url, &client_jar_path)
        .await
        .context("Не удалось скачать клиент: ")?;

    if let Some(expected) = sha1 {
        crate::utils::download_file::verify_sha1(&client_jar_path, expected).await?;
    }
    Ok(())
}
