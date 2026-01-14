use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::env;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tokio::sync::Semaphore;
use std::sync::Arc;
use futures::future::join_all;

const MAX_CONCURRENT_DOWNLOADS: usize = 20;

#[derive(Debug, Deserialize, Serialize)]
struct VersionsIndexManifest {
    latest: Latest,
    versions: Vec<VersionInfo>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Latest {
    release: String,
    snapshot: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct VersionInfo {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    url: String,
    time: String,
    #[serde(rename = "releaseTime")]
    release_time: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct VersionDetailsManifest {
    id: String,
    downloads: Downloads,
    libraries: Vec<Library>,
    #[serde(rename = "assetIndex")]
    asset_index: AssetIndex,
    assets: String,
    #[serde(rename = "mainClass")]
    main_class: String,
    #[serde(rename = "minecraftArguments")]
    minecraft_arguments: Option<String>,
    arguments: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Downloads {
    client: DownloadInfo,
    server: Option<DownloadInfo>,
    #[serde(rename = "client_mappings")]
    client_mappings: Option<DownloadInfo>,
    #[serde(rename = "server_mappings")]
    server_mappings: Option<DownloadInfo>,
}

#[derive(Debug, Deserialize, Serialize)]
struct DownloadInfo {
    sha1: String,
    size: u64,
    url: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct Library {
    name: String,
    downloads: LibDownloads,
}

#[derive(Debug, Deserialize, Serialize)]
struct LibDownloads {
    artifact: Option<Artifact>,
    classifiers: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Artifact {
    path: String,
    sha1: String,
    size: u64,
    url: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct AssetIndex {
    id: String,
    sha1: String,
    size: u64,
    url: String,
    #[serde(rename = "totalSize")]
    total_size: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct AssetIndexContent {
    objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize, Serialize)]
struct AssetObject {
    hash: String,
    size: u64,
}

async fn get_version_manifest() -> Result<VersionsIndexManifest> {
     let url = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
     let resp = reqwest::get(url).await?;
     let manifest = resp.json::<VersionsIndexManifest>().await?;
     Ok(manifest)
}

 async fn download_file(url: &str, path: &Path) -> Result<()> {
     if path.exists() {
              println!("Файл уже существует: {:?}", path);
              return Ok(());
     }
     if let Some(parent) = path.parent() {
         fs::create_dir_all(parent)?;
     }

     let response = reqwest::get(url).await?;

     if !response.status().is_success() {
         return Err(anyhow!("Неправильный ответ: {}", response.status()));
     }

     let content = response.bytes().await?;
     let mut file = fs::File::create(path)?;
     let mut content_cursor = Cursor::new(content);

     std::io::copy(&mut content_cursor, &mut file)?;

     Ok(())
 }

 #[tauri::command]
 pub async fn download_minecraft_version(version: &str) -> Result<String, String> {
     let manifest = get_version_manifest().await.map_err(|e| format!("Ошибка получения манифеста: {}", e))?;

     let version_url = manifest.versions.iter()
         .find(|v| v.id == version)
         .map(|v| v.url.clone());

     match version_url {
         Some(url) => {
             println!("Downloading version {}", url);
             download_files(&url).await
         }
         None => Err("Err".to_string()),
     }
 }

 async fn download_files(manifest_url: &str) -> Result<String, String> {
     println!("Получение манифеста версии...");
     let resp = reqwest::get(manifest_url).await.map_err(|e| format!("Ошибка HTTP запроса: {}", e))?;;
     let manifest: VersionDetailsManifest = resp.json().await
         .map_err(|e| format!("Ошибка при разборе манифеста: {}", e))?;

     let home_dir: PathBuf = env::home_dir().ok_or("Не удалось получить домашнюю директорию".to_string())?;
     let launcher_name: String = env::var("LAUNCHER_NAME")
         .unwrap_or_else(|_| "default_launcher".to_string());
     let base_path: PathBuf = home_dir.join(&launcher_name); // TODO

     let client_jar_path = base_path.join("versions").join(&manifest.id).join(format!("{}.jar", manifest.id));
     println!("Скачиваем основной JAR-файл: {}", manifest.downloads.client.url);

     if let Err(e) = download_file(&manifest.downloads.client.url, &client_jar_path).await {
         println!("Ошибка при скачивании JAR-файла клиента: {:?}", e);
         return Err(e.to_string());
     }

     println!("Скачиваем библиотеки...");
     for lib in &manifest.libraries {
         if let Some(artifact) = &lib.downloads.artifact {
             if !artifact.url.is_empty() {
                 let lib_path = base_path.join("libraries").join(&artifact.path);
                 println!("Скачиваем библиотеку: {}", lib.name);

                 if let Err(e) = download_file(&artifact.url, &lib_path).await {
                     println!("Ошибка при скачивании библиотеки {}: {:?}", lib.name, e);
                 }
             }
         }
     }

     println!("Скачиваем индекс ресурсов...");
     let asset_index_path = base_path.join("assets").join("indexes").join(format!("{}.json", manifest.asset_index.id));

     download_file(&manifest.asset_index.url, &asset_index_path)
             .await
             .map_err(|e| format!("Ошибка при скачивании индекса ресурсов: {:?}", e))?;

         let asset_index_file = fs::read_to_string(&asset_index_path)
             .map_err(|e| format!("Ошибка при чтении индекса ресурсов: {}", e))?;

         let asset_index: AssetIndexContent = serde_json::from_str(&asset_index_file)
             .map_err(|e| format!("Ошибка при разборе индекса ресурсов: {}", e))?;

     println!("Скачиваем ресурсы...");
         let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
         let base_path = Arc::new(base_path);
         let mut download_tasks = Vec::new();

         for (asset_path_key, asset) in asset_index.objects {
             let hash_prefix = asset.hash[..2].to_string();
             let asset_hash = asset.hash.clone();
             let asset_url = format!("https://resources.download.minecraft.net/{}/{}", hash_prefix, asset_hash);
             let asset_file_path = base_path.join("assets").join("objects").join(&hash_prefix).join(&asset_hash);

             let semaphore = Arc::clone(&semaphore);
             let asset_path_key = asset_path_key.clone();

             let task = tokio::spawn(async move {
                 let _permit = semaphore.acquire().await.unwrap();

                 match download_file(&asset_url, &asset_file_path).await {
                     Ok(_) => {
                         println!("Загружен ресурс: {}", asset_path_key);
                         Ok(())
                     }
                     Err(e) => {
                         eprintln!("Ошибка при скачивании ресурса {}: {:?}", asset_path_key, e);
                         Err(e)
                     }
                 }
             });

             download_tasks.push(task);
         }

         println!("Всего ресурсов для загрузки: {}", download_tasks.len());

         let results = join_all(download_tasks).await;

         let mut successful = 0;
         let mut failed = 0;

         for result in results {
             match result {
                 Ok(Ok(())) => successful += 1,
                 _ => failed += 1,
            }
         }
         println!("Загрузка ресурсов завершена. Успешно: {}, Ошибок: {}", successful, failed);

         println!("Все файлы Minecraft успешно скачаны!");
         Ok("Ok".to_string())
 }

