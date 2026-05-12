use anyhow::{bail, Context, Result};
use futures::future;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::{
    log_info,
    minecraft::fabric::fabric::FabricProfile,
    utils::semaphore::{semaphore_core, SemaphoreInfo},
};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoaderVersion {
    pub loader: ComponentVersion,
    //pub maven: String,
    //pub installer: ComponentVersion,
    //pub build: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ComponentVersion {
    pub version: String,
    pub stable: bool,
}

pub async fn download_fabric_libraries(json_path: &Path, libraries_dir: &Path) -> Result<()> {
    let json_data = tokio::fs::read_to_string(json_path)
        .await
        .with_context(|| format!("Не удалось прочитать json по {:?}", &json_path))?;
    let profile: FabricProfile = serde_json::from_str(&json_data)
        .with_context(|| format!("Не удалось прочитать json {:?}", &json_data))?;

    log_info!("Скачивание библиотек Fabric...");

    let mut semaphore_info = Vec::new();
    let base_path = PathBuf::from(libraries_dir);

    for lib in profile.libraries {
        if lib.url.is_empty() {
            log_info!("Пропуск библиотеки без URL: {}", lib.name);
            continue;
        }

        let parts: Vec<&str> = lib.name.split(':').collect();
        if parts.len() != 3 {
            eprintln!("Ошибка: некорректное имя библиотеки: {}", lib.name);
            continue;
        }

        let group_id = parts[0];
        let artifact_id = parts[1];
        let version = parts[2];

        let group_path = group_id.replace('.', "/");
        let file_name = format!("{}-{}.jar", artifact_id, version);

        let mut local_path = PathBuf::new();
        local_path = local_path
            .join(&group_path)
            .join(artifact_id)
            .join(version)
            .join(&file_name);

        let download_url = format!(
            "{}{}/{}/{}/{}",
            lib.url, group_path, artifact_id, version, file_name
        );

        let result = SemaphoreInfo {
            url: download_url,
            dest: local_path,
        };

        semaphore_info.push(result);
    }

    let download_futures = semaphore_core(base_path, semaphore_info);

    let results = future::join_all(download_futures).await;
    let errors: Vec<_> = results.into_iter().filter_map(Result::err).collect();

    if errors.is_empty() {
        log_info!("Все библиотеки Fabric успешно скачаны!");
        Ok(())
    } else {
        anyhow::bail!("Не удалось скачать {} библиотек.", errors.len())
    }
}

pub async fn get_fabric_version(mc_version: &String) -> Result<String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}",
        mc_version
    );

    log_info!("Получение версий Fabric для Minecraft {}...", mc_version);

    let response_text = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Сетевая ошибка при получении версий: {:?}", &url))?
        .error_for_status()
        .context("API Fabric вернул ошибку статуса")?
        .text()
        .await
        .context("Ошибка получения текста ответа API Fabric")?;

    let raw_data: Vec<serde_json::Value> =
        serde_json::from_str(&response_text).context("Ошибка парсинга JSON ответа API Fabric")?;

    let mut loaders = vec![];
    for val in raw_data {
        match serde_json::from_value::<LoaderVersion>(val) {
            Ok(v) => loaders.push(v),
            Err(e) => eprintln!("Пропущена невалидная версия loader: {}", e),
        }
    }

    if loaders.is_empty() {
        bail!("Нет доступных версий загрузчика для этой версии Minecraft");
    }

    let latest_loader = loaders
        .get(0)
        .context("Нет доступных версий загрузчика для Minecraft")?;
    Ok(latest_loader.loader.version.clone())
}
