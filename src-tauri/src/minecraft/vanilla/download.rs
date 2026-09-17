use std::collections::HashSet;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

use anyhow::Result;
use std::fs as std_fs;
use std::io as std_io;

use crate::utils::errors::LauncherError;
use crate::{
    log_err, log_info,
    minecraft::vanilla::rules::is_rule_allowed,
    minecraft::vanilla::structs::{Artifact, AssetIndexContent, Library, VersionDetailsManifest},
    utils::{
        env_info::get_current_os,
        integrity::{HashKind, IntegrityTarget, TargetDownload},
    },
};

pub struct VanillaPhaseInfo {
    pub id: &'static str,
    pub label: &'static str,
}

pub const PHASE_CLIENT: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.jar",
    label: "Клиент игры",
};
pub const PHASE_LIBRARIES: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.libs",
    label: "Библиотеки игры",
};
pub const PHASE_ASSET_INDEX: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.assets.index",
    label: "Загрузка индекса ресурсов",
};
pub const PHASE_ASSETS: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.assets",
    label: "Загрузка ресурсов",
};

pub struct VanillaTargetSet {
    pub client: IntegrityTarget,
    pub libraries: Vec<IntegrityTarget>,
    pub asset_index: IntegrityTarget,
}

pub fn collect_install_targets(manifest: &VersionDetailsManifest) -> VanillaTargetSet {
    VanillaTargetSet {
        client: collect_client_jar_target(manifest),
        libraries: collect_library_targets(manifest),
        asset_index: collect_asset_index_target(manifest),
    }
}

fn native_artifact_for_os<'a>(lib: &'a Library, current_os: &str) -> Option<&'a Artifact> {
    let natives_map = lib.natives.as_ref()?;
    let classifier_template = natives_map.get(current_os)?;
    let arch = if cfg!(target_arch = "x86_64") {
        "64"
    } else {
        "32"
    };
    let classifier = classifier_template.replace("${arch}", arch);
    let classifiers = &lib.downloads.as_ref()?.classifiers.as_ref()?;
    classifiers.get(&classifier)
}

pub async fn read_asset_index(path: &Path) -> Result<AssetIndexContent> {
    let content = tokio::fs::read_to_string(path).await.map_err(|e| {
        LauncherError::ManifestParse(format!(
            "Не удалось прочитать индекс ресурсов: {path:?}: {e:#}"
        ))
    })?;
    serde_json::from_str(&content).map_err(|e| {
        LauncherError::ManifestParse(format!("Не удалось разобрать индекс ресурсов: {e:#}")).into()
    })
}

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

        if let Some(native_artifact) = native_artifact_for_os(lib, current_os) {
            natives_to_extract.push((
                PathBuf::from("libraries").join(&native_artifact.path),
                lib.extract.as_ref().and_then(|e| e.exclude.clone()),
            ));
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

    clear_natives_dir(&natives_dir).await?;
    match extract_native(natives_to_extract, natives_dir.clone()).await {
        Ok(()) => Ok(()),
        Err(e) => {
            if let Err(wipe_error) = clear_natives_dir(&natives_dir).await {
                log_err!(
                    "Не удалось очистить natives после сбоя распаковки: {:?}",
                    wipe_error
                );
            }
            Err(e)
        }
    }
}

async fn clear_natives_dir(natives_dir: &Path) -> Result<()> {
    match tokio::fs::remove_dir_all(natives_dir).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std_io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(LauncherError::DiskIo(format!(
            "Не удалось очистить папку natives {natives_dir:?}: {e:#}"
        ))
        .into()),
    }
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
        let count = extract_natives_from_jar(jar_path, &natives_dir, exclude_rules)
            .await
            .map_err(|e| {
                LauncherError::GameDownload(format!(
                    "Не удалось распаковать natives из {jar_path:?}: {e:#}"
                ))
            })?;
        total_extracted += count;
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
        return Err(
            LauncherError::GameDownload(format!("JAR файл не существует: {jar_path:?}")).into(),
        );
    }

    let jar_path_buf = jar_path.to_path_buf();
    let natives_dir_buf = natives_dir.to_path_buf();
    let exclude_rules_owned = exclude_rules.clone();

    let extracted_count = tokio::task::spawn_blocking(move || -> Result<u32> {
        std_fs::create_dir_all(&natives_dir_buf).map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось создать директорию: {natives_dir_buf:?}: {e:#}"
            ))
        })?;
        let std_file = std_fs::File::open(&jar_path_buf).map_err(|e| {
            LauncherError::DiskIo(format!("Не удалось открыть JAR: {jar_path_buf:?}: {e:#}"))
        })?;
        let mut archive = ZipArchive::new(std_file).map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось прочитать ZIP архив: {jar_path_buf:?}: {e:#}"
            ))
        })?;

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

            let mut out_file = std_fs::File::create(&out_path).map_err(|e| {
                LauncherError::DiskIo(format!("Не удалось создать файл: {out_path:?}: {e:#}"))
            })?;
            std_io::copy(&mut file, &mut out_file).map_err(|e| {
                LauncherError::DiskIo(format!("Не удалось записать файл: {out_path:?}: {e:#}"))
            })?;

            count += 1;
            log_info!("    ✓ {}", file_name);
        }

        Ok(count)
    })
    .await
    .map_err(|e| {
        LauncherError::GameProcess(format!(
            "Ошибка при выполнении синхронного потока (spawn_blocking): {e:#}"
        ))
    })??;

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

pub fn collect_client_jar_target(manifest: &VersionDetailsManifest) -> IntegrityTarget {
    IntegrityTarget {
        rel_path: PathBuf::from(format!("{}.jar", manifest.id)),
        hash: manifest.downloads.client.sha1.clone(),
        hash_kind: HashKind::Sha1,
        download: TargetDownload::Url(manifest.downloads.client.url.clone()),
    }
}

pub fn collect_library_targets(manifest: &VersionDetailsManifest) -> Vec<IntegrityTarget> {
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

        if let Some(native_artifact) = native_artifact_for_os(lib, current_os) {
            if !native_artifact.sha1.is_empty() {
                let rel_path = PathBuf::from(format!("libraries/{}", native_artifact.path));
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

    targets
}

pub fn collect_asset_index_target(manifest: &VersionDetailsManifest) -> IntegrityTarget {
    IntegrityTarget {
        rel_path: PathBuf::from(format!("assets/indexes/{}.json", manifest.asset_index.id)),
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
            rel_path: PathBuf::from(format!("assets/objects/{}/{}", hash_prefix, asset.hash)),
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
    use super::{collect_library_targets, extract_natives, get_current_os};
    use crate::minecraft::vanilla::structs::VersionDetailsManifest;
    use crate::test_support::LauncherDirGuard;
    use crate::utils::integrity::{HashKind, TargetDownload};
    use std::fs as std_fs;
    use std::io::Write;
    use std::path::PathBuf;

    fn make_jar(path: &std::path::Path, entries: &[(&str, &[u8])]) {
        if let Some(parent) = path.parent() {
            std_fs::create_dir_all(parent).unwrap();
        }
        let file = std_fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (name, data) in entries {
            writer
                .start_file(name.to_string(), zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }

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

    #[tokio::test]
    async fn extract_natives_unpacks_native_files_from_jars() {
        let dir = LauncherDirGuard::acquire("natives_extract").await;
        let base = dir.project_dir("Cordelia");

        make_jar(
            &base.join("libraries/lwjgl/lwjgl-natives.jar"),
            &[
                ("org/lwjgl/lwjgl.dll", b"win dll bytes".as_slice()),
                ("liblwjgl.so", b"so bytes".as_slice()),
                ("META-INF/MANIFEST.MF", b"manifest".as_slice()),
                ("README.txt", b"not native".as_slice()),
            ],
        );
        make_jar(
            &base.join("libraries/t2s/t2s-natives.jar"),
            &[("libt2s.dylib", b"dylib bytes".as_slice())],
        );

        extract_natives(
            &base,
            vec![
                (PathBuf::from("libraries/lwjgl/lwjgl-natives.jar"), None),
                (
                    PathBuf::from("libraries/t2s/t2s-natives.jar"),
                    Some(vec!["META-INF/".to_string()]),
                ),
            ],
        )
        .await
        .expect("распаковка natives");

        let natives = base.join("natives");
        assert_eq!(
            std_fs::read(natives.join("lwjgl.dll")).unwrap(),
            b"win dll bytes"
        );
        assert_eq!(
            std_fs::read(natives.join("liblwjgl.so")).unwrap(),
            b"so bytes"
        );
        assert_eq!(
            std_fs::read(natives.join("libt2s.dylib")).unwrap(),
            b"dylib bytes"
        );
        assert!(!natives.join("README.txt").exists());
        assert!(!natives.join("MANIFEST.MF").exists());
    }

    #[tokio::test]
    async fn extract_natives_failure_wipes_dir_and_retry_recovers() {
        let dir = LauncherDirGuard::acquire("natives_fail_retry").await;
        let base = dir.project_dir("Cordelia");

        make_jar(
            &base.join("libraries/good.jar"),
            &[("libgood.so", b"good".as_slice())],
        );
        std_fs::create_dir_all(base.join("natives")).unwrap();
        std_fs::write(base.join("natives/stale.dll"), b"stale").unwrap();

        let result = extract_natives(
            &base,
            vec![
                (PathBuf::from("libraries/good.jar"), None),
                (PathBuf::from("libraries/missing.jar"), None),
            ],
        )
        .await;

        assert!(result.is_err(), "недоступный jar должен ронять распаковку");
        let natives_clean = std_fs::read_dir(base.join("natives"))
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(true);
        assert!(
            natives_clean,
            "после сбоя папка natives должна быть пуста для чистой повторной попытки"
        );

        extract_natives(&base, vec![(PathBuf::from("libraries/good.jar"), None)])
            .await
            .expect("повторная распаковка после сбоя");

        assert_eq!(
            std_fs::read(base.join("natives/libgood.so")).unwrap(),
            b"good"
        );
    }
}
