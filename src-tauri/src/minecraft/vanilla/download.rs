use std::collections::HashSet;
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

        if !should_download_library(&lib.name) {
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

fn should_download_library(lib_name: &str) -> bool {
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
    let mut queued: HashSet<PathBuf> = HashSet::new();

    for lib in &manifest.libraries {
        if !is_rule_allowed(lib.rules.as_deref()) {
            continue;
        }

        if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                let rel_path = PathBuf::from(format!("libraries/{}", artifact.path));
                if !artifact.url.is_empty()
                    && !artifact.sha1.is_empty()
                    && should_download_library(&lib.name)
                    && queued.insert(rel_path.clone())
                {
                    targets.push(IntegrityTarget {
                        rel_path,
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
                                let rel_path = PathBuf::from(format!(
                                    "libraries/{}",
                                    native_artifact.path
                                ));
                                if queued.insert(rel_path.clone()) {
                                    targets.push(IntegrityTarget {
                                        rel_path,
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

#[cfg(test)]
mod tests {
    use super::{collect_library_targets, get_current_os};
    use crate::minecraft::vanilla::structs::VersionDetailsManifest;
    use crate::utils::integrity::{HashKind, TargetDownload};

    const MANIFEST_1_18_2: &str = r#"{
        "id": "1.18.2",
        "downloads": {
            "client": {
                "sha1": "2e9a3e3107cca00d6bc9c97bf7d149cae163ef21",
                "size": 20259661,
                "url": "https://piston-data.mojang.com/v1/objects/2e9a3e3107cca00d6bc9c97bf7d149cae163ef21/client.jar"
            }
        },
        "libraries": [
            {
                "name": "com.mojang:logging:1.0.0",
                "downloads": {
                    "artifact": {
                        "path": "com/mojang/logging/1.0.0/logging-1.0.0.jar",
                        "sha1": "f6ca3b2eee0b80b384e8ed93d368faecb82dfb9b",
                        "size": 15343,
                        "url": "https://libraries.minecraft.net/com/mojang/logging/1.0.0/logging-1.0.0.jar"
                    }
                }
            },
            {
                "name": "net.sf.jopt-simple:jopt-simple:5.0.4",
                "downloads": {
                    "artifact": {
                        "path": "net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar",
                        "sha1": "4fdac2fbe92dfad86aa6e9301736f6b4342a3f5c",
                        "size": 78146,
                        "url": "https://libraries.minecraft.net/net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar"
                    }
                }
            },
            {
                "name": "com.google.code.gson:gson:2.8.9",
                "downloads": {
                    "artifact": {
                        "path": "com/google/code/gson/gson/2.8.9/gson-2.8.9.jar",
                        "sha1": "8a432c1d6825781e21a02db2e2c33c5fde2833b9",
                        "size": 258075,
                        "url": "https://libraries.minecraft.net/com/google/code/gson/gson/2.8.9/gson-2.8.9.jar"
                    }
                }
            },
            {
                "name": "org.lwjgl:lwjgl:3.2.2",
                "downloads": {
                    "artifact": {
                        "path": "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar",
                        "sha1": "8ad6294407e15780b43e84929c40e4c5e997972e",
                        "size": 321900,
                        "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar"
                    }
                },
                "rules": [
                    { "action": "allow" },
                    { "action": "disallow", "os": { "name": "osx" } }
                ]
            },
            {
                "name": "org.lwjgl:lwjgl:3.2.2",
                "downloads": {
                    "artifact": {
                        "path": "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar",
                        "sha1": "8ad6294407e15780b43e84929c40e4c5e997972e",
                        "size": 321900,
                        "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar"
                    },
                    "classifiers": {
                        "natives-linux": {
                            "path": "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-linux.jar",
                            "sha1": "ae7976827ca2a3741f6b9a843a89bacd637af350",
                            "size": 124776,
                            "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-linux.jar"
                        },
                        "natives-windows": {
                            "path": "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-windows.jar",
                            "sha1": "05359f3aa50d36352815fc662ea73e1c00d22170",
                            "size": 279593,
                            "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-windows.jar"
                        }
                    }
                },
                "natives": {
                    "linux": "natives-linux",
                    "windows": "natives-windows"
                },
                "rules": [
                    { "action": "allow" },
                    { "action": "disallow", "os": { "name": "osx" } }
                ]
            },
            {
                "name": "com.mojang:text2speech:1.12.4",
                "downloads": {
                    "artifact": {
                        "path": "com/mojang/text2speech/1.12.4/text2speech-1.12.4.jar",
                        "sha1": "1f618f522dbdd93218c270bcfd8f8dd84be31717",
                        "size": 12874,
                        "url": "https://libraries.minecraft.net/com/mojang/text2speech/1.12.4/text2speech-1.12.4.jar"
                    },
                    "classifiers": {
                        "natives-linux": {
                            "path": "com/mojang/text2speech/1.12.4/text2speech-1.12.4-natives-linux.jar",
                            "sha1": "9571b1360a268311d7fa625614186965914f0215",
                            "size": 7833,
                            "url": "https://libraries.minecraft.net/com/mojang/text2speech/1.12.4/text2speech-1.12.4-natives-linux.jar"
                        },
                        "natives-windows": {
                            "path": "com/mojang/text2speech/1.12.4/text2speech-1.12.4-natives-windows.jar",
                            "sha1": "7e37c535186a058d730ec03491182fae2efb57be",
                            "size": 81379,
                            "url": "https://libraries.minecraft.net/com/mojang/text2speech/1.12.4/text2speech-1.12.4-natives-windows.jar"
                        }
                    }
                },
                "extract": { "exclude": ["META-INF/"] },
                "natives": {
                    "linux": "natives-linux",
                    "windows": "natives-windows"
                }
            }
        ],
        "assetIndex": {
            "id": "1.18",
            "sha1": "d31a2e85ae149dd1b1a7070b22cb8887892fda6c",
            "size": 348724,
            "url": "https://piston-meta.mojang.com/v1/packages/d31a2e85ae149dd1b1a7070b22cb8887892fda6c/1.18.json",
            "totalSize": 468892705
        },
        "assets": "1.18",
        "mainClass": "net.minecraft.client.main.Main"
    }"#;

    #[test]
    fn collect_library_targets_includes_regular_libraries() {
        let manifest: VersionDetailsManifest = serde_json::from_str(MANIFEST_1_18_2).unwrap();
        let targets = collect_library_targets(&manifest);
        let rel_paths: Vec<String> = targets
            .iter()
            .map(|t| t.rel_path.to_string_lossy().into_owned())
            .collect();

        for rel in [
            "libraries/com/mojang/logging/1.0.0/logging-1.0.0.jar",
            "libraries/net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar",
            "libraries/com/google/code/gson/gson/2.8.9/gson-2.8.9.jar",
            "libraries/com/mojang/text2speech/1.12.4/text2speech-1.12.4.jar",
        ] {
            assert!(
                rel_paths.contains(&rel.to_string()),
                "нет таргета {}: {:?}",
                rel,
                rel_paths
            );
        }

        let jopt = targets
            .iter()
            .find(|t| {
                t.rel_path.as_os_str()
                    == "libraries/net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar"
            })
            .unwrap();
        assert_eq!(jopt.hash, "4fdac2fbe92dfad86aa6e9301736f6b4342a3f5c");
        assert!(matches!(jopt.hash_kind, HashKind::Sha1));
        assert!(matches!(
            &jopt.download,
            TargetDownload::Url(url)
                if url.as_str() == "https://libraries.minecraft.net/net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar"
        ));

        let lwjgl_jar = "libraries/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar";
        match get_current_os() {
            "osx" => {
                assert!(!rel_paths.iter().any(|p| p.contains("org/lwjgl")));
                assert_eq!(rel_paths.len(), 4);
            }
            os => {
                let suffix = if os == "windows" {
                    "natives-windows"
                } else {
                    "natives-linux"
                };
                assert_eq!(
                    rel_paths.iter().filter(|p| p.as_str() == lwjgl_jar).count(),
                    1,
                    "lwjgl задублирован: {:?}",
                    rel_paths
                );
                assert!(rel_paths.contains(&format!(
                    "libraries/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-{suffix}.jar"
                )));
                assert!(rel_paths.contains(&format!(
                    "libraries/com/mojang/text2speech/1.12.4/text2speech-1.12.4-{suffix}.jar"
                )));
                assert_eq!(rel_paths.len(), 7);
            }
        }
    }
}
