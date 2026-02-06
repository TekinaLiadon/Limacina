use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::env;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use tokio::sync::Semaphore;
use std::sync::Arc;
use futures::future::join_all;
use zip::ZipArchive;

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
    natives: Option<HashMap<String, String>>,
    rules: Option<Vec<Rule>>,
    extract: Option<ExtractRules>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ExtractRules {
    exclude: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Rule {
    action: String,
    os: Option<OsRule>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OsRule {
    name: Option<String>,
    arch: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct LibDownloads {
    artifact: Option<Artifact>,
    classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
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

fn get_current_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn get_native_suffixes_for_os() -> Vec<&'static str> {
    let os = get_current_os();

    match os {
        "windows" => vec!["natives-windows", "natives-windows-x86", "natives-windows-arm64"],
        "osx" => vec!["natives-osx", "natives-macos", "natives-macos-arm64"],
        "linux" => vec!["natives-linux", "natives-linux-arm64", "natives-linux-arm32"],
        _ => vec![],
    }
}

fn is_native_library_for_current_os(lib_name: &str) -> bool {
    let suffixes = get_native_suffixes_for_os();

    for suffix in &suffixes {
        if lib_name.contains(suffix) {
            return true;
        }
    }

    let other_os_markers = match get_current_os() {
        "windows" => vec!["natives-linux", "natives-osx", "natives-macos"],
        "osx" => vec!["natives-linux", "natives-windows"],
        "linux" => vec!["natives-windows", "natives-osx", "natives-macos"],
        _ => vec![],
    };

    for marker in other_os_markers {
        if lib_name.contains(marker) {
            return false;
        }
    }

    !lib_name.contains("natives-")
}

fn is_native_jar(lib_name: &str) -> bool {
    lib_name.contains("natives-")
}

fn check_rules(rules: &Option<Vec<Rule>>) -> bool {
    match rules {
        None => true,
        Some(rules) => {
            let current_os = get_current_os();
            let mut allowed = false;
            let mut has_os_specific_rule = false;

            for rule in rules {
                let os_matches = match &rule.os {
                    None => true,
                    Some(os_rule) => {
                        has_os_specific_rule = true;
                        match &os_rule.name {
                            None => true,
                            Some(name) => name == current_os,
                        }
                    }
                };

                if os_matches {
                    allowed = rule.action == "allow";
                }
            }

            if !has_os_specific_rule && rules.iter().any(|r| r.action == "allow" && r.os.is_none()) {
                return true;
            }

            allowed
        }
    }
}

fn should_exclude(file_name: &str, exclude_rules: &Option<Vec<String>>) -> bool {
    if let Some(excludes) = exclude_rules {
        for exclude in excludes {
            if file_name.starts_with(exclude.trim_end_matches('/')) {
                return true;
            }
        }
    }
    false
}

fn extract_natives_from_jar(jar_path: &Path, natives_dir: &Path, exclude_rules: &Option<Vec<String>>) -> Result<u32> {
    println!("  Извлекаем natives из: {:?}", jar_path);

    if !jar_path.exists() {
        return Err(anyhow!("JAR файл не существует: {:?}", jar_path));
    }

    let file = fs::File::open(jar_path)
        .with_context(|| format!("Не удалось открыть JAR: {:?}", jar_path))?;

    let mut archive = ZipArchive::new(file)
        .with_context(|| format!("Не удалось прочитать ZIP архив: {:?}", jar_path))?;

    fs::create_dir_all(natives_dir)
        .with_context(|| format!("Не удалось создать директорию: {:?}", natives_dir))?;

    let mut extracted_count = 0u32;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();

        if name.ends_with('/') {
            continue;
        }

        if should_exclude(&name, exclude_rules) {
            continue;
        }

        if name.starts_with("META-INF") {
            continue;
        }

        let is_native = name.ends_with(".dll")
            || name.ends_with(".so")
            || name.ends_with(".dylib")
            || name.ends_with(".jnilib");

        if !is_native {
            continue;
        }

        let file_name = Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| name.clone());

        let out_path = natives_dir.join(&file_name);

        let mut contents = Vec::new();
        file.read_to_end(&mut contents)?;

        let mut out_file = fs::File::create(&out_path)
            .with_context(|| format!("Не удалось создать файл: {:?}", out_path))?;
        out_file.write_all(&contents)
            .with_context(|| format!("Не удалось записать файл: {:?}", out_path))?;

        extracted_count += 1;
        println!("    ✓ {}", file_name);
    }

    Ok(extracted_count)
}

async fn get_version_manifest() -> Result<VersionsIndexManifest> {
    let url = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
    let resp = reqwest::get(url).await?;
    let manifest = resp.json::<VersionsIndexManifest>().await?;
    Ok(manifest)
}

async fn download_file(url: &str, path: &Path) -> Result<()> {
    if path.exists() {
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
    println!("Downloading version {}", version);
    let version_url = manifest.versions.iter()
        .find(|v| v.id == version)
        .map(|v| v.url.clone());

    match version_url {
        Some(url) => {
            println!("Downloading version {}", url);
            let result = download_files(&url).await;
            Ok("Download complete".to_string())
        }
        None => Err("Err".to_string()),
    }
}

async fn download_files(manifest_url: &str) -> Result<String, String> {
    println!("Получение манифеста версии...");
    let resp = reqwest::get(manifest_url).await.map_err(|e| format!("Ошибка HTTP запроса: {}", e))?;
    let manifest: VersionDetailsManifest = resp.json().await
        .map_err(|e| format!("Ошибка при разборе манифеста: {}", e))?;

    let home_dir: PathBuf = env::home_dir().ok_or("Не удалось получить домашнюю директорию".to_string())?;
    let launcher_name: String = env::var("LAUNCHER_NAME")
        .unwrap_or_else(|_| "default_launcher".to_string());
    let base_path: PathBuf = home_dir.join(&launcher_name);

    let client_jar_path = base_path.join("versions").join(&manifest.id).join(format!("{}.jar", manifest.id));
    println!("Скачиваем основной JAR-файл: {}", manifest.downloads.client.url);

    if let Err(e) = download_file(&manifest.downloads.client.url, &client_jar_path).await {
        println!("Ошибка при скачивании JAR-файла клиента: {:?}", e);
        return Err(e.to_string());
    }

    let natives_dir = base_path.join("natives").join(&manifest.id);
    fs::create_dir_all(&natives_dir).map_err(|e| format!("Ошибка создания папки natives: {}", e))?;

    println!("\nСкачиваем библиотеки...");
    println!("Текущая ОС: {}", get_current_os());

    let mut natives_to_extract: Vec<(PathBuf, Option<Vec<String>>)> = Vec::new();

    for lib in &manifest.libraries {
        if !check_rules(&lib.rules) {
            continue;
        }

        if !is_native_library_for_current_os(&lib.name) {
            println!("Пропускаем библиотеку {} (не подходит для текущей ОС)", lib.name);
            continue;
        }

        // (1.19+) natives
        if is_native_jar(&lib.name) {
            if let Some(artifact) = &lib.downloads.artifact {
                if !artifact.url.is_empty() {
                    let lib_path = base_path.join("libraries").join(&artifact.path);
                    println!("Скачиваем нативную библиотеку: {}", lib.name);

                    if let Err(e) = download_file(&artifact.url, &lib_path).await {
                        println!("  Ошибка при скачивании: {:?}", e);
                    } else {
                        let exclude = lib.extract.as_ref().and_then(|e| e.exclude.clone());
                        natives_to_extract.push((lib_path, exclude));
                    }
                }
            }
            continue;
        }

        // (1.19-) natives

        if let Some(artifact) = &lib.downloads.artifact {
            if !artifact.url.is_empty() {
                let lib_path = base_path.join("libraries").join(&artifact.path);
                println!("Скачиваем библиотеку: {}", lib.name);

                if let Err(e) = download_file(&artifact.url, &lib_path).await {
                    println!("  Ошибка при скачивании: {:?}", e);
                }
            }
        }

        // (1.19-)
        if let Some(natives_map) = &lib.natives {
            let current_os = get_current_os();

            if let Some(classifier_template) = natives_map.get(current_os) {
                let arch = if cfg!(target_arch = "x86_64") { "64" } else { "32" };
                let classifier = classifier_template.replace("${arch}", arch);

                if let Some(classifiers) = &lib.downloads.classifiers {
                    if let Some(native_artifact) = classifiers.get(&classifier) {
                        let native_jar_path = base_path.join("libraries").join(&native_artifact.path);
                        println!("Скачиваем natives через classifier: {} ({})", lib.name, classifier);

                        if let Err(e) = download_file(&native_artifact.url, &native_jar_path).await {
                            println!("  Ошибка при скачивании: {:?}", e);
                        } else {
                            let exclude = lib.extract.as_ref().and_then(|e| e.exclude.clone());
                            natives_to_extract.push((native_jar_path, exclude));
                        }
                    }
                }
            }
        }
    }

    println!("\n=== Извлечение natives ===");
    println!("Всего JAR файлов для извлечения: {}", natives_to_extract.len());

    let mut total_extracted = 0u32;
    for (jar_path, exclude_rules) in &natives_to_extract {
        match extract_natives_from_jar(jar_path, &natives_dir, exclude_rules) {
            Ok(count) => {
                total_extracted += count;
            }
            Err(e) => println!("  Ошибка извлечения {:?}: {:?}", jar_path, e),
        }
    }
    println!("Всего извлечено нативных файлов: {}", total_extracted);

    println!("\n=== Содержимое папки natives ===");
    match fs::read_dir(&natives_dir) {
        Ok(entries) => {
            let files: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            if files.is_empty() {
                println!("Папка natives пуста!");
            } else {
                println!("Файлов: {}", files.len());
                for entry in &files {
                    println!("  {:?}", entry.file_name());
                }
            }
        }
        Err(e) => println!("Ошибка чтения папки natives: {:?}", e),
    }

    println!("\nСкачиваем индекс ресурсов...");
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
                Ok(_) => Ok(()),
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

    println!("\nВсе файлы Minecraft успешно скачаны!");
    Ok("Ok".to_string())
}

