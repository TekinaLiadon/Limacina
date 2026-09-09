use std::path::{Path, PathBuf};
use zip::ZipArchive;


use anyhow::{anyhow, Context, Result};
use std::fs as std_fs;
use std::io as std_io;

use crate::{
    log_err,
    log_info,
    minecraft::vanilla::rules::is_rule_allowed,
    minecraft::vanilla::structs::{AssetIndexContent, VersionDetailsManifest},
    utils::{
        env_info::get_current_os,
        integrity::{HashKind, IntegrityTarget, TargetDownload},
    },
};

pub fn collect_natives_to_extract(
    manifest: &VersionDetailsManifest,
) -> Vec<(PathBuf, Option<Vec<String>>)> {
    let current_os = get_current_os();
    let mut natives_to_extract: Vec<(PathBuf, Option<Vec<String>>)> = Vec::new();

    for lib in &manifest.libraries {
        if !is_rule_allowed(lib.rules.as_deref()) {
            continue;
        }

        if !is_native_library_for_current_os(&lib.name) {
            continue;
        }

        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if !artifact.url.is_empty() {
                    natives_to_extract.push((
                        PathBuf::from("libraries").join(&artifact.path),
                        lib.extract.as_ref().and_then(|e| e.exclude.clone()),
                    ));
                }
            }
        }
        if is_native_jar(&lib.name) {
            continue;
        }

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
                            natives_to_extract.push((
                                PathBuf::from("libraries").join(&native_artifact.path),
                                lib.extract.as_ref().and_then(|e| e.exclude.clone()),
                            ));
                        }
                    }
                }
            }
        }
    }

    natives_to_extract
}

pub async fn extract_natives(
    base_path: &Path,
    natives_rel_paths: Vec<(PathBuf, Option<Vec<String>>)>,
) -> Result<()> {
    let natives_dir = base_path.join("natives");
    let natives_to_extract = natives_rel_paths
        .into_iter()
        .map(|(rel, exclude)| (base_path.join(rel), exclude))
        .collect();
    extract_native(natives_to_extract, natives_dir).await
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

pub fn collect_client_jar_target(
    manifest: &VersionDetailsManifest,
) -> IntegrityTarget {
    IntegrityTarget {
        rel_path: PathBuf::from(format!("{}.jar", manifest.id)),
        hash: manifest.downloads.client.sha1.clone(),
        hash_kind: HashKind::Sha1,
        download: TargetDownload::Url(manifest.downloads.client.url.clone()),
    }
}

pub fn collect_library_targets(
    manifest: &VersionDetailsManifest,
) -> Vec<IntegrityTarget> {
    let current_os = get_current_os();
    let mut targets = Vec::new();

    for lib in &manifest.libraries {
        if !is_rule_allowed(lib.rules.as_deref()) {
            continue;
        }

        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                if !artifact.url.is_empty() && !artifact.sha1.is_empty()
                    && !is_native_library_for_current_os(&lib.name) {
                        targets.push(IntegrityTarget {
                            rel_path: PathBuf::from(format!("libraries/{}", artifact.path)),
                            hash: artifact.sha1.clone(),
                            hash_kind: HashKind::Sha1,
                            download: TargetDownload::Url(artifact.url.clone()),
                        });
                    }
            }
        }

        if let Some(natives_map) = &lib.natives {
            if let Some(classifier_template) = natives_map.get(current_os) {
                let arch = if cfg!(target_arch = "x86_64") { "64" } else { "32" };
                let classifier = classifier_template.replace("${arch}", arch);
                if let Some(downloads) = &lib.downloads {
                    if let Some(classifiers) = &downloads.classifiers {
                        if let Some(native_artifact) = classifiers.get(&classifier) {
                            if !native_artifact.sha1.is_empty() {
                                targets.push(IntegrityTarget {
                                    rel_path: PathBuf::from(format!(
                                        "libraries/{}",
                                        native_artifact.path
                                    )),
                                    hash: native_artifact.sha1.clone(),
                                    hash_kind: HashKind::Sha1,
                                    download: TargetDownload::Url(native_artifact.url.clone()),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    targets
}

pub fn collect_asset_index_target(manifest: &VersionDetailsManifest) -> IntegrityTarget {
    IntegrityTarget {
        rel_path: PathBuf::from(format!(
            "assets/indexes/{}.json",
            manifest.asset_index.id
        )),
        hash: manifest.asset_index.sha1.clone(),
        hash_kind: HashKind::Sha1,
        download: TargetDownload::Url(manifest.asset_index.url.clone()),
    }
}

pub fn collect_asset_targets(asset_index: &AssetIndexContent) -> Vec<IntegrityTarget> {
    let mut targets = Vec::new();
    for asset in asset_index.objects.values() {
        let hash_prefix = asset.hash[..2].to_string();
        targets.push(IntegrityTarget {
            rel_path: PathBuf::from(format!(
                "assets/objects/{}/{}",
                hash_prefix, asset.hash
            )),
            hash: asset.hash.clone(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(format!(
                "https://resources.download.minecraft.net/{}/{}",
                hash_prefix, asset.hash
            )),
        });
    }
    targets
}
