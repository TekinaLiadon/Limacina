use futures::future;
use std::path::{Path, PathBuf};
use zip::ZipArchive;
// Из jvm

use ::anyhow::{anyhow, Context, Result};
use std::fs as std_fs;
use std::io as std_io;
use tokio::fs;

use crate::{
    log_err,
    log_info,
    minecraft::vanilla::structs::{AssetIndexContent, Rule, VersionDetailsManifest},
    utils::{
        download_file::download_file,
        env_info::{get_current_os, launcher_patch},
        semaphore::{semaphore_core, SemaphoreInfo},
    },
};

pub async fn download_native(project_name: &str, manifest: &VersionDetailsManifest) -> Result<()> {
    let base_path: PathBuf = launcher_patch(Some(project_name))?;
    let natives_dir = base_path.join("natives");
    fs::create_dir_all(&natives_dir)
        .await
        .context("Ошибка создания папки natives: ")?;
    let current_os = get_current_os();

    let mut natives_to_extract: Vec<(PathBuf, Option<Vec<String>>)> = Vec::new();
    let mut semaphore_info = Vec::new();

    for lib in &manifest.libraries {
        if !check_rules(&lib.rules) {
            continue;
        }

        if !is_native_library_for_current_os(&lib.name) {
            log_info!(
                "Пропускаем библиотеку {} (не подходит для текущей ОС)",
                lib.name
            );
            continue;
        }

        // (1.19+)
        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if !artifact.url.is_empty() {
                    let result = SemaphoreInfo {
                        url: artifact.url.clone(),
                        dest: base_path.join("libraries").join(&artifact.path),
                    };
                    semaphore_info.push(result);

                    let lib_path = base_path.join("libraries").join(&artifact.path);
                    let exclude = lib.extract.as_ref().and_then(|e| e.exclude.clone());
                    natives_to_extract.push((lib_path, exclude));
                }
            }
        }
        if is_native_jar(&lib.name) {
            continue;
        }

        // (1.19-)
        if let Some(natives_map) = &lib.natives {
            if let Some(classifier_template) = natives_map.get(current_os) {
                let arch = if cfg!(target_arch = "x86_64") {
                    "64"
                } else {
                    "32"
                };
                let classifier = classifier_template.replace("${arch}", arch);

                if let Some(downloads) = &lib.downloads {
                    if let Some(classifiers) = &downloads.classifiers {
                        if let Some(native_artifact) = classifiers.get(&classifier) {
                            let result = SemaphoreInfo {
                                url: native_artifact.url.clone(),
                                dest: base_path.join("libraries").join(&native_artifact.path),
                            };
                            semaphore_info.push(result);

                            let native_jar_path =
                                base_path.join("libraries").join(&native_artifact.path);
                            let exclude = lib.extract.as_ref().and_then(|e| e.exclude.clone());
                            natives_to_extract.push((native_jar_path, exclude));
                        }
                    }
                }
            }
        }
    }

    let download_futures = semaphore_core(base_path, semaphore_info);

    let results = future::join_all(download_futures).await;
    let errors: Vec<_> = results.into_iter().filter_map(Result::err).collect();

    log_info!("Файлов не удалось скачать: {}", errors.len());

    let mut total_extracted = 0u32;
    for (jar_path, exclude_rules) in &natives_to_extract {
        match extract_natives_from_jar(jar_path, &natives_dir, exclude_rules).await {
            Ok(count) => {
                total_extracted += count;
            }
            Err(e) => log_err!("Ошибка извлечения {:?}: {:?}", jar_path, e),
        }
    }
    log_info!("Файлов скачано: {}", total_extracted);

    extract_native(natives_to_extract, natives_dir).await?;
    Ok(())
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

            if !has_os_specific_rule && rules.iter().any(|r| r.action == "allow" && r.os.is_none())
            {
                return true;
            }

            allowed
        }
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

fn get_native_suffixes_for_os() -> Vec<&'static str> {
    let os = get_current_os();

    match os {
        "windows" => vec![
            "natives-windows",
            "natives-windows-x86",
            "natives-windows-arm64",
        ],
        "osx" => vec!["natives-osx", "natives-macos", "natives-macos-arm64"],
        "linux" => vec![
            "natives-linux",
            "natives-linux-arm64",
            "natives-linux-arm32",
        ],
        _ => vec![],
    }
}

fn is_native_jar(lib_name: &str) -> bool {
    lib_name.contains("natives-")
}

async fn extract_native(
    natives_to_extract: Vec<(PathBuf, Option<Vec<String>>)>,
    natives_dir: PathBuf,
) -> Result<()> {
    log_info!("\n=== Извлечение natives ===");
    log_info!(
        "Всего JAR файлов для извлечения: {}",
        natives_to_extract.len()
    );

    let mut total_extracted = 0u32;
    for (jar_path, exclude_rules) in &natives_to_extract {
        match extract_natives_from_jar(jar_path, &natives_dir, exclude_rules).await {
            Ok(count) => {
                total_extracted += count;
            }
            Err(e) => log_err!("Ошибка извлечения {:?}: {:?}", jar_path, e),
        }
    }
    log_info!("Всего извлечено нативных файлов: {}", total_extracted);

    Ok(())
}

async fn extract_natives_from_jar(
    jar_path: &Path,
    natives_dir: &Path,
    exclude_rules: &Option<Vec<String>>,
) -> Result<u32> {
    log_info!("  Извлекаем natives из: {:?}", jar_path);

    if !jar_path.exists() {
        return Err(anyhow!("JAR файл не существует: {:?}", jar_path));
    }

    let jar_path_buf = jar_path.to_path_buf();
    let natives_dir_buf = natives_dir.to_path_buf();
    let exclude_rules_owned = exclude_rules.clone();

    let extracted_count = tokio::task::spawn_blocking(move || -> Result<u32> {
        std_fs::create_dir_all(&natives_dir_buf)
            .with_context(|| format!("Не удалось создать директорию: {:?}", natives_dir_buf))?;
        let std_file = std_fs::File::open(&jar_path_buf)
            .with_context(|| format!("Не удалось открыть JAR: {:?}", jar_path_buf))?;
        let mut archive = ZipArchive::new(std_file)
            .with_context(|| format!("Не удалось прочитать ZIP архив: {:?}", jar_path_buf))?;

        let mut count = 0u32;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = file.name().to_string();

            if name.ends_with('/') {
                continue;
            }

            if should_exclude(&name, &exclude_rules_owned) {
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
            let out_path = natives_dir_buf.join(&file_name);

            let mut out_file = std_fs::File::create(&out_path)
                .with_context(|| format!("Не удалось создать файл: {:?}", out_path))?;
            std_io::copy(&mut file, &mut out_file)
                .with_context(|| format!("Не удалось записать файл: {:?}", out_path))?;

            count += 1;
            log_info!("    ✓ {}", file_name);
        }

        Ok(count)
    })
    .await
    .context("Ошибка при выполнении синхронного потока (spawn_blocking)")??;

    Ok(extracted_count)
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

pub async fn donwload_index_lib(
    project_name: &str,
    manifest: &VersionDetailsManifest,
) -> Result<AssetIndexContent> {
    let base_path: PathBuf = launcher_patch(Some(project_name))?;
    log_info!("\nСкачиваем индекс ресурсов...");
    let asset_index_path = base_path
        .join("assets")
        .join("indexes")
        .join(format!("{}.json", manifest.asset_index.id));

    download_file(&manifest.asset_index.url, &asset_index_path).await?;

    let asset_index_file = fs::read_to_string(&asset_index_path)
        .await
        .context("Ошибка при чтении индекса ресурсов: ")?;

    let asset_index: AssetIndexContent =
        serde_json::from_str(&asset_index_file).context("Ошибка при разборе индекса ресурсов: ")?;

    Ok(asset_index)
}

pub async fn download_assets(project_name: &str, asset_index: AssetIndexContent) -> Result<()> {
    let base_path: PathBuf = launcher_patch(Some(project_name))?;
    let mut semaphore_info = Vec::new();

    for (_, asset) in asset_index.objects {
        let hash_prefix = asset.hash[..2].to_string();
        let asset_hash = asset.hash.clone();
        let asset_url = format!(
            "https://resources.download.minecraft.net/{}/{}",
            hash_prefix, asset_hash
        );
        let asset_file_path = base_path
            .join("assets")
            .join("objects")
            .join(&hash_prefix)
            .join(&asset_hash);

        if asset_file_path.exists() {
            continue;
        }

        let result = SemaphoreInfo {
            url: asset_url,
            dest: asset_file_path,
        };
        semaphore_info.push(result);
    }

    log_info!("Ассетов к скачиванию: {}", semaphore_info.len());
    if semaphore_info.is_empty() {
        log_info!("Все ассеты уже скачаны");
        return Ok(());
    }

    let download_futures = semaphore_core(base_path, semaphore_info);
    let results = future::join_all(download_futures).await;

    let mut successful = 0;
    let mut failed = 0;
    for result in results {
        match result {
            Ok(()) => successful += 1,
            _ => failed += 1,
        }
    }

    log_info!(
        "Загрузка ресурсов завершена. Успешно: {}, Ошибок: {}",
        successful,
        failed
    );
    Ok(())
}
