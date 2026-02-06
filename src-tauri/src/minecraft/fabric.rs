use anyhow::{bail, Context, Result};
use futures::future;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::sync::Semaphore;
use std::sync::Arc;
use std::env;

const MAX_CONCURRENT_DOWNLOADS: usize = 20;

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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricProfile {
    pub id: String,
    pub time: String,
    pub release_time: String,
    #[serde(rename = "type")]
    pub profile_type: String,
    pub main_class: String,
    pub java_version: Option<JavaVersion>,
    pub arguments: Option<Arguments>,
    pub minimum_launcher_version: Option<i32>,
    pub inherits_from: Option<String>,
    pub asset_index: Option<AssetIndexFabric>,
    pub assets: Option<String>,
    pub downloads: Option<DownloadsFabric>,
    pub libraries: Vec<LibraryFabric>,
    pub logging: Option<Logging>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LibraryFabric {
    pub name: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<i64>,
    pub md5: Option<String>,
    pub sha256: Option<String>,
    pub sha512: Option<String>,

    pub extract: Option<Extract>,
    pub natives: Option<std::collections::HashMap<String, String>>,
    pub rules: Option<Vec<Rule>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JavaVersion {
    pub component: String,
    pub major_version: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Arguments {
    pub game: Vec<String>,
    pub jvm: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Rule {
    pub action: String,
    pub os: Option<RuleOs>,
    pub features: std::collections::HashMap<String, bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuleOs {
    pub name: Option<String>,
    pub version: Option<String>,
    pub arch: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssetIndexFabric {
    pub id: String,
    pub sha1: String,
    pub size: i64,
    pub url: String,
    pub total_size: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DownloadsFabric {
    pub client: DownloadLink,
    pub server: DownloadLink,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DownloadLink {
    pub sha1: String,
    pub size: i64,
    pub url: String,
}


#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LibDownloadsFabric {
    pub artifact: Option<ArtifactFabric>,
    pub classifiers: Option<std::collections::HashMap<String, ArtifactFabric>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ArtifactFabric {
    pub path: String,
    pub url: String,
    pub sha1: String,
    pub size: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Extract {
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Logging {
    pub client: Option<LoggingEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingEntry {
    pub argument: String,
    pub file: LoggingFile,
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingFile {
    pub id: String,
    pub sha1: String,
    pub size: i64,
    pub url: String,
}

async fn download_file(client: &reqwest::Client, url: &str, dest: &Path) -> Result<()> { // TODO
    if dest.exists() {
              println!("Файл уже существует: {:?}", dest);
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

async fn download_fabric_libraries(
    client: &reqwest::Client,
    json_path: &Path,
    libraries_dir: &Path,
) -> Result<()> {
    let json_data = tokio::fs::read_to_string(json_path).await?;
        let profile: FabricProfile = serde_json::from_str(&json_data)?;

        println!("Скачивание библиотек Fabric...");

        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
        let mut download_futures = Vec::new();

        for lib in profile.libraries {
            if lib.url.is_empty() {
                println!("Пропуск библиотеки без URL: {}", lib.name);
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

            let mut local_path = PathBuf::from(libraries_dir);
            local_path.push(&group_path);
            local_path.push(artifact_id);
            local_path.push(version);
            local_path.push(&file_name);

            let download_url = format!(
                "{}{}/{}/{}/{}",
                lib.url, group_path, artifact_id, version, file_name
            );

            let client = client.clone();
            let sem = semaphore.clone();
            let lib_name = lib.name.clone();

            download_futures.push(async move {
                let _permit = sem.acquire_owned().await.expect("semaphore closed");

                println!("Скачивание {}", lib_name);
                match download_file(&client, &download_url, &local_path).await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        eprintln!("Ошибка скачивания {}: {:?}", lib_name, e);
                        Err(e)
                    }
                }
            });
        }

        let results = future::join_all(download_futures).await;
        let errors: Vec<_> = results.into_iter().filter_map(Result::err).collect();

        if errors.is_empty() {
            println!("Все библиотеки Fabric успешно скачаны!");
            Ok(())
        } else {
            anyhow::bail!("Не удалось скачать {} библиотек.", errors.len())
        }
}

#[tauri::command]
pub async fn get_fabric(mc_version: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);

    println!("Получение версий Fabric для Minecraft {}...", mc_version);

    let home_dir: PathBuf = env::home_dir().ok_or("Home directory not found")?;
        let launcher_name: String = env::var("LAUNCHER_NAME")
            .unwrap_or_else(|_| "default_launcher".to_string());
    let base_path = home_dir.join(launcher_name);


   let response_text = client
       .get(&url)
       .send()
       .await
       .map_err(|e| format!("Сетевая ошибка при получении версий Fabric: {}", e))?
       .error_for_status()
       .map_err(|e| format!("Ошибка от API Fabric: {}", e))?
       .text()
       .await
       .map_err(|e| format!("Ошибка получения текста ответа: {}", e))?;

   //println!("Полученный JSON: {}", response_text);

   let raw_data: Vec<serde_json::Value> = serde_json::from_str(&response_text)
       .map_err(|e| format!("Ошибка парсинга JSON: {}", e))?;

   let mut loaders = vec![];
   for val in raw_data {
       match serde_json::from_value::<LoaderVersion>(val) {
           Ok(v) => loaders.push(v),
           Err(e) => eprintln!("Пропущена невалидная версия loader: {}", e),
       }
   }

   if loaders.is_empty() {
       return Err("Нет доступных версий загрузчика для этой версии Minecraft".into());
   }


    let latest_loader = loaders.get(0).ok_or_else(|| {
        format!("Нет доступных версий загрузчика для Minecraft {}", mc_version)
    })?;

    let loader_ver = &latest_loader.loader.version;
    let version_id = format!("fabric-loader-{}-{}", loader_ver, mc_version);
    println!("Выбрана версия загрузчика: {}", loader_ver);

    let version_dir = base_path.join("fabric").join(&version_id);

    let json_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        mc_version, loader_ver
    );
    let jar_url = format!(
        "https://maven.fabricmc.net/net/fabricmc/fabric-loader/{}/fabric-loader-{}.jar",
        loader_ver, loader_ver
    );

    tokio::fs::create_dir_all(&version_dir)
        .await
        .map_err(|e| format!("Ошибка создания директории {}: {}", version_dir.display(), e))?;

    let json_dest = version_dir.join(format!("{}.json", version_id));
    println!("Скачиваем: {}", json_url);
    download_file(&client, &json_url, &json_dest)
        .await
        .map_err(|e| format!("Не удалось скачать JSON профиль: {}", e))?;

    let jar_dest = version_dir.join(format!("{}.jar", version_id));
    println!("Скачиваем: {}", jar_url);
    download_file(&client, &jar_url, &jar_dest)
        .await
        .map_err(|e| format!("Не удалось скачать JAR файл загрузчика: {}", e))?;

    println!("Fabric Loader успешно скачан!");

    let libraries_path = base_path.join("libraries");
    println!("Fabric: {}", json_dest.display());
    download_fabric_libraries(&client, &json_dest, &libraries_path)
        .await.map_err(|e| format!("Не удалось скачать библиотеки: {}", e))?;

    Ok(format!("Fabric {} для Minecraft {} успешно установлен!", loader_ver, mc_version))
}