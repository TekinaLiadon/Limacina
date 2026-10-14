use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

use anyhow::Result;
use std::fs as std_fs;
use std::io as std_io;

use crate::utils::download_file::write_atomic;
use crate::utils::errors::LauncherError;
use crate::{
    log_err, log_info,
    minecraft::vanilla::rules::is_rule_allowed,
    minecraft::vanilla::structs::{Artifact, AssetIndexContent, Library, VersionDetailsManifest},
    utils::{
        blocking,
        env_info::{ensure_safe_relative_path, get_arch_label, get_current_os},
        integrity::{HashKind, IntegrityTarget, TargetDownload},
    },
};

fn ensure_valid_sha1(hash: &str) -> Result<()> {
    if hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(());
    }
    Err(
        LauncherError::ManifestParse(format!("Некорректный SHA1 хеш ассета в манифесте: {hash}"))
            .into(),
    )
}

pub struct VanillaPhaseInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub integrity_noun: &'static str,
}

pub const PHASE_CLIENT: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.jar",
    label: "Клиент игры",
    integrity_noun: "клиентский jar",
};
pub const PHASE_LIBRARIES: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.libs",
    label: "Библиотеки игры",
    integrity_noun: "библиотеки",
};
pub const PHASE_NATIVES: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.natives",
    label: "Нативные библиотеки",
    integrity_noun: "нативные библиотеки",
};
pub const PHASE_ASSET_INDEX: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.assets.index",
    label: "Загрузка индекса ресурсов",
    integrity_noun: "индекс ассетов",
};
pub const PHASE_ASSETS: VanillaPhaseInfo = VanillaPhaseInfo {
    id: "mc.assets",
    label: "Загрузка ресурсов",
    integrity_noun: "ассеты",
};

pub struct VanillaTargetSet {
    pub client: IntegrityTarget,
    pub libraries: Vec<IntegrityTarget>,
    pub asset_index: IntegrityTarget,
}

pub fn collect_install_targets(manifest: &VersionDetailsManifest) -> Result<VanillaTargetSet> {
    Ok(VanillaTargetSet {
        client: collect_client_jar_target(manifest)?,
        libraries: collect_library_targets(manifest)?,
        asset_index: collect_asset_index_target(manifest)?,
    })
}

fn native_artifact_for_os<'a>(lib: &'a Library, current_os: &str) -> Option<&'a Artifact> {
    let natives_map = lib.natives.as_ref()?;
    let classifier_template = natives_map.get(current_os)?;
    let arch = if cfg!(target_pointer_width = "64") {
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
) -> Result<Vec<(PathBuf, Option<Vec<String>>)>> {
    let current_os = get_current_os();
    let mut natives_to_extract: Vec<(PathBuf, Option<Vec<String>>)> = Vec::new();
    let mut queued: HashSet<PathBuf> = HashSet::new();

    for lib in &manifest.libraries {
        if !is_rule_allowed(lib.rules.as_deref()) {
            continue;
        }

        if !should_download_library(&lib.name) {
            continue;
        }

        let exclude = lib.extract.as_ref().and_then(|e| e.exclude.clone());

        if is_native_jar(&lib.name) {
            if let Some(artifact) = lib
                .downloads
                .as_ref()
                .and_then(|downloads| downloads.artifact.as_ref())
            {
                if !artifact.url.is_empty() {
                    queue_native_jar(&mut natives_to_extract, &mut queued, artifact, exclude)?;
                }
            }
            continue;
        }

        if let Some(native_artifact) = native_artifact_for_os(lib, current_os) {
            queue_native_jar(
                &mut natives_to_extract,
                &mut queued,
                native_artifact,
                exclude,
            )?;
        }
    }

    Ok(natives_to_extract)
}

fn queue_native_jar(
    natives_to_extract: &mut Vec<(PathBuf, Option<Vec<String>>)>,
    queued: &mut HashSet<PathBuf>,
    artifact: &Artifact,
    exclude: Option<Vec<String>>,
) -> Result<()> {
    ensure_safe_relative_path(&artifact.path, "пути библиотеки в манифесте")?;
    let rel_path = PathBuf::from("libraries").join(&artifact.path);
    if queued.insert(rel_path.clone()) {
        natives_to_extract.push((rel_path, exclude));
    }
    Ok(())
}

pub const NATIVES_VERSION_MARKER: &str = ".mc-version";

pub async fn natives_match_version(natives_dir: &Path, mc_version: &str) -> bool {
    match tokio::fs::read_to_string(natives_dir.join(NATIVES_VERSION_MARKER)).await {
        Ok(stored) => stored.trim() == mc_version,
        Err(_) => false,
    }
}

async fn write_natives_version_marker(natives_dir: &Path, mc_version: &str) -> Result<()> {
    write_atomic(
        &natives_dir.join(NATIVES_VERSION_MARKER),
        mc_version.as_bytes(),
    )
    .await
}

pub async fn extract_natives(
    base_path: &Path,
    natives_rel_paths: Vec<(PathBuf, Option<Vec<String>>)>,
    mc_version: &str,
) -> Result<()> {
    let natives_dir = base_path.join("natives");
    let natives_to_extract = natives_rel_paths
        .into_iter()
        .map(|(rel, exclude)| (base_path.join(rel), exclude))
        .collect();

    clear_natives_dir(&natives_dir).await?;
    let outcome = async {
        extract_native(natives_to_extract, natives_dir.clone()).await?;
        write_natives_version_marker(&natives_dir, mc_version).await
    }
    .await;
    match outcome {
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
    should_download_library_for(lib_name, get_current_os(), get_arch_label())
}

fn should_download_library_for(lib_name: &str, os: &str, arch: &str) -> bool {
    match maven_classifier(lib_name) {
        Some(classifier) => {
            if native_classifiers_for(os, arch).contains(&classifier) {
                return true;
            }
            if is_platform_classifier(classifier) {
                return false;
            }
            !classifier.contains("natives-")
        }
        None => !lib_name.contains("natives-"),
    }
}

fn maven_classifier(lib_name: &str) -> Option<&str> {
    lib_name.split(':').nth(3)
}

fn native_classifiers_for(os: &str, arch: &str) -> &'static [&'static str] {
    match (os, arch) {
        ("windows", "x86") => &["natives-windows-x86"],
        ("windows", "aarch64") => &["natives-windows-arm64"],
        ("windows", _) => &["natives-windows"],
        ("osx", "x86_64") => &["natives-macos", "natives-osx", "osx-x86_64"],
        ("osx", "aarch64") => &["natives-macos-arm64", "osx-aarch_64"],
        ("osx", _) => &["natives-macos", "natives-osx"],
        ("linux", "x86_64") => &["natives-linux", "linux-x86_64"],
        ("linux", "aarch64") => &["natives-linux-arm64", "linux-aarch_64"],
        ("linux", _) => &["natives-linux"],
        _ => &[],
    }
}

const PLATFORM_CLASSIFIERS: &[&str] = &[
    "natives-windows",
    "natives-windows-x86",
    "natives-windows-arm64",
    "natives-macos",
    "natives-macos-arm64",
    "natives-osx",
    "natives-linux",
    "natives-linux-arm64",
    "natives-linux-arm32",
    "linux-x86_64",
    "linux-aarch_64",
    "osx-x86_64",
    "osx-aarch_64",
];

fn is_platform_classifier(classifier: &str) -> bool {
    PLATFORM_CLASSIFIERS.contains(&classifier)
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

    let mut written_by: HashMap<String, PathBuf> = HashMap::new();
    for (jar_path, exclude_rules) in &natives_to_extract {
        let file_names = extract_natives_from_jar(jar_path, &natives_dir, exclude_rules)
            .await
            .map_err(|e| {
                LauncherError::GameDownload(format!(
                    "Не удалось распаковать natives из {jar_path:?}: {e:#}"
                ))
            })?;
        for file_name in file_names {
            if let Some(first_jar) = written_by.insert(file_name.clone(), jar_path.clone()) {
                return Err(LauncherError::GameDownload(format!(
                    "Конфликт имён natives: файл {file_name} содержится и в {first_jar:?}, и в {jar_path:?}"
                ))
                .into());
            }
        }
    }
    log_info!("Всего извлечено нативных файлов: {}", written_by.len());

    Ok(())
}

async fn extract_natives_from_jar(
    jar_path: &Path,
    natives_dir: &Path,
    exclude_rules: &Option<Vec<String>>,
) -> Result<Vec<String>> {
    log_info!("  Извлекаем natives из: {:?}", jar_path);

    if !jar_path.exists() {
        return Err(
            LauncherError::GameDownload(format!("JAR файл не существует: {jar_path:?}")).into(),
        );
    }

    let jar_path_buf = jar_path.to_path_buf();
    let natives_dir_buf = natives_dir.to_path_buf();
    let exclude_rules_owned = exclude_rules.clone();

    let extracted_names = tokio::task::spawn_blocking(move || -> Result<Vec<String>> {
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

        let mut written_names: Vec<String> = Vec::new();
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

            written_names.push(file_name.clone());
            log_info!("    {}", file_name);
        }

        Ok(written_names)
    })
    .await
    .map_err(|e| {
        LauncherError::GameProcess(format!(
            "Ошибка при выполнении синхронного потока (spawn_blocking): {e:#}"
        ))
    })??;

    Ok(extracted_names)
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

pub fn collect_client_jar_target(manifest: &VersionDetailsManifest) -> Result<IntegrityTarget> {
    ensure_safe_relative_path(&manifest.id, "id версии в манифесте")?;
    Ok(IntegrityTarget {
        rel_path: PathBuf::from(format!("{}.jar", manifest.id)),
        hash: manifest.downloads.client.sha1.clone(),
        hash_kind: HashKind::Sha1,
        download: TargetDownload::Url(manifest.downloads.client.url.clone()),
    })
}

pub fn collect_library_targets(manifest: &VersionDetailsManifest) -> Result<Vec<IntegrityTarget>> {
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
                    && should_download_library(&lib.name)
                    && !queued.contains(&rel_path)
                {
                    ensure_safe_relative_path(&artifact.path, "пути библиотеки в манифесте")?;
                    if artifact.sha1.is_empty() {
                        return Err(LauncherError::ManifestParse(format!(
                            "У библиотеки {} в манифесте нет SHA1 хеша",
                            lib.name
                        ))
                        .into());
                    }
                    queued.insert(rel_path.clone());
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
            let rel_path = PathBuf::from(format!("libraries/{}", native_artifact.path));
            if !queued.contains(&rel_path) {
                ensure_safe_relative_path(&native_artifact.path, "пути библиотеки в манифесте")?;
                if native_artifact.sha1.is_empty() {
                    return Err(LauncherError::ManifestParse(format!(
                        "У библиотеки {} нет SHA1 хеша у natives-артефакта",
                        lib.name
                    ))
                    .into());
                }
                queued.insert(rel_path.clone());
                targets.push(IntegrityTarget {
                    rel_path,
                    hash: native_artifact.sha1.clone(),
                    hash_kind: HashKind::Sha1,
                    download: TargetDownload::Url(native_artifact.url.clone()),
                });
            }
        }
    }

    Ok(targets)
}

pub fn collect_asset_index_target(manifest: &VersionDetailsManifest) -> Result<IntegrityTarget> {
    ensure_safe_relative_path(&manifest.asset_index.id, "id индекса ресурсов в манифесте")?;
    Ok(IntegrityTarget {
        rel_path: PathBuf::from(format!("assets/indexes/{}.json", manifest.asset_index.id)),
        hash: manifest.asset_index.sha1.clone(),
        hash_kind: HashKind::Sha1,
        download: TargetDownload::Url(manifest.asset_index.url.clone()),
    })
}

pub fn collect_asset_targets(asset_index: &AssetIndexContent) -> Result<Vec<IntegrityTarget>> {
    let mut targets = Vec::new();
    for asset in asset_index.objects.values() {
        ensure_valid_sha1(&asset.hash)?;
        let hash_prefix = &asset.hash[..2];
        targets.push(IntegrityTarget {
            rel_path: PathBuf::from(format!("assets/objects/{hash_prefix}/{}", asset.hash)),
            hash: asset.hash.clone(),
            hash_kind: HashKind::Sha1,
            download: TargetDownload::Url(format!(
                "https://resources.download.minecraft.net/{hash_prefix}/{}",
                asset.hash
            )),
        });
    }
    Ok(targets)
}

pub async fn preflight_asset_disk_space(
    base_path: &Path,
    asset_index: &AssetIndexContent,
) -> Result<()> {
    let mut needed: u64 = 0;
    for asset in asset_index.objects.values() {
        let Some(hash_prefix) = asset.hash.get(..2) else {
            continue;
        };
        let rel_path = PathBuf::from(format!("assets/objects/{hash_prefix}/{}", asset.hash));
        let present = tokio::fs::try_exists(base_path.join(&rel_path))
            .await
            .unwrap_or(false);
        if !present {
            needed += asset.size;
        }
    }
    if needed == 0 {
        return Ok(());
    }
    let probe_path = base_path.to_path_buf();
    let available = blocking(
        "Не удалось определить свободное место на диске",
        move || crate::utils::disk_space::available_bytes(&probe_path),
    )
    .await
    .ok()
    .flatten();
    let Some(available) = available else {
        log_info!(
            "[preflight] Не удалось определить диск для {:?}, проверка свободного места пропущена",
            base_path
        );
        return Ok(());
    };
    if available < needed {
        return Err(LauncherError::DiskIo(format!(
            "Недостаточно свободного места на диске: для ресурсов игры требуется ещё {}, доступно {}",
            crate::utils::disk_space::format_bytes(needed),
            crate::utils::disk_space::format_bytes(available)
        ))
        .into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        collect_asset_index_target, collect_asset_targets, collect_client_jar_target,
        collect_library_targets, collect_natives_to_extract, extract_natives,
        natives_match_version, preflight_asset_disk_space, should_download_library_for,
        AssetIndexContent,
    };
    use crate::utils::env_info::{get_arch_label, get_current_os};
    #[tokio::test]
    async fn preflight_passes_when_assets_already_present() {
        let dir = LauncherDirGuard::acquire("preflight_present").await;
        let base = dir.project_dir("Cordelia");
        let index: AssetIndexContent = serde_json::from_value(serde_json::json!({
            "objects": { "a.png": { "hash": "abcdef1234567890abcdef1234567890abcdef12", "size": 1024 } }
        }))
        .unwrap();
        std_fs::create_dir_all(base.join("assets/objects/ab")).unwrap();
        std_fs::write(
            base.join("assets/objects/ab/abcdef1234567890abcdef1234567890abcdef12"),
            b"x",
        )
        .unwrap();

        preflight_asset_disk_space(&base, &index)
            .await
            .expect("все ассеты на месте — проверка свободного места проходит");
    }

    #[tokio::test]
    async fn preflight_errors_when_not_enough_space() {
        let dir = LauncherDirGuard::acquire("preflight_tight").await;
        let base = dir.project_dir("Cordelia");
        let index: AssetIndexContent = serde_json::from_value(serde_json::json!({
            "objects": { "a.png": { "hash": "abcdef1234567890abcdef1234567890abcdef12", "size": u64::MAX } }
        }))
        .unwrap();

        let error = preflight_asset_disk_space(&base, &index)
            .await
            .expect_err("непомерный размер ассетов должен выявлять нехватку места");

        assert!(
            error.to_string().contains("Недостаточно свободного места"),
            "ошибка должна сообщать о нехватке места: {error}"
        );
    }

    #[test]
    fn asset_targets_reject_short_hashes() {
        let index: AssetIndexContent = serde_json::from_value(serde_json::json!({
            "objects": { "a.png": { "hash": "x", "size": 1 } }
        }))
        .unwrap();

        let result = collect_asset_targets(&index);

        assert!(
            result.is_err(),
            "хеш короче двух символов не должен паниковать, а давать ошибку"
        );
    }

    #[test]
    fn asset_targets_reject_non_hex_hashes() {
        let index: AssetIndexContent = serde_json::from_value(serde_json::json!({
            "objects": { "a.png": { "hash": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "size": 1 } }
        }))
        .unwrap();

        let result = collect_asset_targets(&index);

        assert!(
            result.is_err(),
            "не-hex хеш ассета должен давать русскую ошибку, а не путь с мусором"
        );
    }

    #[test]
    fn asset_targets_map_hash_prefixes() {
        let index: AssetIndexContent = serde_json::from_value(serde_json::json!({
            "objects": { "a.png": { "hash": "abcdef1234567890abcdef1234567890abcdef12", "size": 1 } }
        }))
        .unwrap();

        let targets = collect_asset_targets(&index).expect("валидные ассеты");

        assert_eq!(targets.len(), 1);
        assert_eq!(
            targets[0].rel_path,
            PathBuf::from("assets/objects/ab/abcdef1234567890abcdef1234567890abcdef12")
        );
    }

    use crate::minecraft::vanilla::structs::VersionDetailsManifest;
    use crate::test_support::{
        gson_library, jopt_simple_library, logging_library, write_test_zip, LauncherDirGuard,
    };
    use crate::utils::integrity::{HashKind, TargetDownload};
    use serde_json::json;
    use std::collections::HashSet;
    use std::fs as std_fs;
    use std::path::PathBuf;

    fn manifest_1_18_2() -> serde_json::Value {
        let lwjgl = serde_json::json!({
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
        });
        let lwjgl_natives = serde_json::json!({
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
        });
        let text2speech = serde_json::json!({
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
        });
        serde_json::json!({
            "id": "1.18.2",
            "downloads": {
                "client": {
                    "sha1": "2e9a3e3107cca00d6bc9c97bf7d149cae163ef21",
                    "size": 20259661,
                    "url": "https://piston-data.mojang.com/v1/objects/2e9a3e3107cca00d6bc9c97bf7d149cae163ef21/client.jar"
                }
            },
            "libraries": [
                logging_library(),
                jopt_simple_library(),
                gson_library(),
                lwjgl,
                lwjgl_natives,
                text2speech
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
        })
    }

    #[test]
    fn collect_library_targets_includes_regular_libraries() {
        let manifest: VersionDetailsManifest = serde_json::from_value(manifest_1_18_2()).unwrap();
        let targets = collect_library_targets(&manifest).expect("таргеты библиотек");
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

    #[test]
    fn library_targets_error_on_url_without_sha1() {
        let mut value = manifest_1_18_2();
        value["libraries"][2]["downloads"]["artifact"]["sha1"] = json!("");
        let manifest: VersionDetailsManifest = serde_json::from_value(value).unwrap();

        let error = collect_library_targets(&manifest)
            .expect_err("библиотека с url, но без SHA1 должна давать явную ошибку");

        assert!(
            error.to_string().contains("SHA1"),
            "ошибка должна называть отсутствующий хеш: {error}"
        );
    }

    #[test]
    fn library_targets_error_on_native_classifier_without_sha1() {
        if get_current_os() == "osx" {
            return;
        }
        let suffix = if get_current_os() == "windows" {
            "natives-windows"
        } else {
            "natives-linux"
        };
        let mut value = manifest_1_18_2();
        value["libraries"][5]["downloads"]["classifiers"][suffix]["sha1"] = json!("");
        let manifest: VersionDetailsManifest = serde_json::from_value(value).unwrap();

        let error = collect_library_targets(&manifest)
            .expect_err("natives-классификатор без SHA1 должен давать явную ошибку");

        assert!(
            error.to_string().contains("SHA1"),
            "ошибка должна называть отсутствующий хеш: {error}"
        );
    }

    #[test]
    fn library_targets_reject_traversal_artifact_path() {
        let mut value = manifest_1_18_2();
        value["libraries"][5]["downloads"]["artifact"]["path"] = json!("../evil/text2speech.jar");
        let manifest: VersionDetailsManifest = serde_json::from_value(value).unwrap();

        let error = collect_library_targets(&manifest)
            .expect_err("путь библиотеки с обходом каталога должен отклоняться");

        assert!(
            error.to_string().contains("пути библиотеки"),
            "ошибка должна называть проблему пути: {error}"
        );
    }

    #[test]
    fn client_jar_target_rejects_traversal_manifest_id() {
        let mut value = manifest_1_18_2();
        value["id"] = json!("../../evil");
        let manifest: VersionDetailsManifest = serde_json::from_value(value).unwrap();

        let error = collect_client_jar_target(&manifest)
            .expect_err("id версии с обходом пути должен отклоняться");

        assert!(
            error.to_string().contains("id версии"),
            "ошибка должна называть проблему id: {error}"
        );
    }

    #[test]
    fn asset_index_target_rejects_traversal_id() {
        let mut value = manifest_1_18_2();
        value["assetIndex"]["id"] = json!("../../../evil");
        let manifest: VersionDetailsManifest = serde_json::from_value(value).unwrap();

        let error = collect_asset_index_target(&manifest)
            .expect_err("id индекса ресурсов с обходом пути должен отклоняться");

        assert!(
            error.to_string().contains("индекса ресурсов"),
            "ошибка должна называть проблему id индекса: {error}"
        );
    }

    #[test]
    fn natives_to_extract_includes_only_native_jars_without_duplicates() {
        let manifest: VersionDetailsManifest = serde_json::from_value(manifest_1_18_2()).unwrap();

        let natives = collect_natives_to_extract(&manifest).expect("список natives");

        let rel_paths: Vec<String> = natives
            .iter()
            .map(|(rel, _)| rel.to_string_lossy().into_owned())
            .collect();
        let unique: HashSet<&String> = rel_paths.iter().collect();
        assert_eq!(
            unique.len(),
            rel_paths.len(),
            "дубликаты путей недопустимы: {rel_paths:?}"
        );

        if get_current_os() == "osx" {
            assert!(
                rel_paths.is_empty(),
                "на osx ни один артефакт не распаковывается: natives map без osx-ключа не даёт распаковку main jar: {rel_paths:?}"
            );
            return;
        }

        let suffix = if get_current_os() == "windows" {
            "natives-windows"
        } else {
            "natives-linux"
        };
        let natives_classifier =
            format!("libraries/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-{suffix}.jar");
        let text2speech_classifier =
            format!("libraries/com/mojang/text2speech/1.12.4/text2speech-1.12.4-{suffix}.jar");

        assert!(
            rel_paths.contains(&natives_classifier),
            "natives-классификатор lwjgl должен распаковываться: {rel_paths:?}"
        );
        assert!(
            rel_paths.contains(&text2speech_classifier),
            "natives-классификатор text2speech должен распаковываться: {rel_paths:?}"
        );
        for main in [
            "libraries/org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar",
            "libraries/com/mojang/text2speech/1.12.4/text2speech-1.12.4.jar",
            "libraries/com/mojang/logging/1.0.0/logging-1.0.0.jar",
            "libraries/net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar",
            "libraries/com/google/code/gson/gson/2.8.9/gson-2.8.9.jar",
        ] {
            assert!(
                !rel_paths.contains(&main.to_string()),
                "main-артефакт без natives в имени не должен распаковываться: {main}"
            );
        }
        assert_eq!(
            rel_paths
                .iter()
                .filter(|p| p.as_str() == natives_classifier)
                .count(),
            1,
            "пара lwjgl-записей с одинаковым путём распаковывается один раз"
        );
    }

    #[test]
    fn natives_to_extract_rejects_traversal_path() {
        let os = get_current_os();
        let mut value = manifest_1_18_2();
        value["libraries"][5]["natives"][os] = json!(format!("natives-{os}"));
        value["libraries"][5]["downloads"]["classifiers"][format!("natives-{os}")]["path"] =
            json!("../evil/natives.jar");
        let manifest: VersionDetailsManifest = serde_json::from_value(value).unwrap();

        let error = collect_natives_to_extract(&manifest)
            .expect_err("natives-путь с обходом каталога должен отклоняться");

        assert!(
            error.to_string().contains("пути библиотеки"),
            "ошибка должна называть проблему пути: {error}"
        );
    }

    #[tokio::test]
    async fn extract_natives_unpacks_native_files_from_jars() {
        let dir = LauncherDirGuard::acquire("natives_extract").await;
        let base = dir.project_dir("Cordelia");

        write_test_zip(
            &base.join("libraries/lwjgl/lwjgl-natives.jar"),
            &[
                ("org/lwjgl/lwjgl.dll", b"win dll bytes".as_slice()),
                ("liblwjgl.so", b"so bytes".as_slice()),
                ("META-INF/MANIFEST.MF", b"manifest".as_slice()),
                ("README.txt", b"not native".as_slice()),
            ],
        );
        write_test_zip(
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
            "1.18.2",
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
    async fn natives_reextracted_when_project_version_changes() {
        let dir = LauncherDirGuard::acquire("natives_version_change").await;
        let base = dir.project_dir("Cordelia");

        write_test_zip(
            &base.join("libraries/lwjgl-3.2.2-natives.jar"),
            &[("liblwjgl.so", b"lwjgl 3.2.2".as_slice())],
        );
        extract_natives(
            &base,
            vec![(PathBuf::from("libraries/lwjgl-3.2.2-natives.jar"), None)],
            "1.18.2",
        )
        .await
        .expect("распаковка natives 1.18.2");

        assert_eq!(
            std_fs::read(base.join("natives/liblwjgl.so")).unwrap(),
            b"lwjgl 3.2.2"
        );
        assert!(natives_match_version(&base.join("natives"), "1.18.2").await);
        assert!(!natives_match_version(&base.join("natives"), "1.20.1").await);

        write_test_zip(
            &base.join("libraries/lwjgl-3.3.3-natives.jar"),
            &[("liblwjgl.so", b"lwjgl 3.3.3".as_slice())],
        );
        extract_natives(
            &base,
            vec![(PathBuf::from("libraries/lwjgl-3.3.3-natives.jar"), None)],
            "1.20.1",
        )
        .await
        .expect("пере-распаковка natives 1.20.1");

        assert_eq!(
            std_fs::read(base.join("natives/liblwjgl.so")).unwrap(),
            b"lwjgl 3.3.3"
        );
        assert!(!base.join("natives/README.txt").exists());
        assert!(natives_match_version(&base.join("natives"), "1.20.1").await);
        assert!(!natives_match_version(&base.join("natives"), "1.18.2").await);
    }

    #[tokio::test]
    async fn natives_match_version_false_for_legacy_install_without_marker() {
        let dir = LauncherDirGuard::acquire("natives_legacy_marker").await;
        let base = dir.project_dir("Cordelia");

        std_fs::create_dir_all(base.join("natives")).unwrap();
        std_fs::write(base.join("natives/liblwjgl.so"), b"old").unwrap();

        assert!(!natives_match_version(&base.join("natives"), "1.18.2").await);
    }

    #[tokio::test]
    async fn extract_natives_failure_wipes_dir_and_retry_recovers() {
        let dir = LauncherDirGuard::acquire("natives_fail_retry").await;
        let base = dir.project_dir("Cordelia");

        write_test_zip(
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
            "1.18.2",
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

        extract_natives(
            &base,
            vec![(PathBuf::from("libraries/good.jar"), None)],
            "1.18.2",
        )
        .await
        .expect("повторная распаковка после сбоя");

        assert_eq!(
            std_fs::read(base.join("natives/libgood.so")).unwrap(),
            b"good"
        );
    }

    #[test]
    fn library_selection_matrix_matches_arch() {
        let cases: Vec<(&str, &str, &str, bool)> = vec![
            (
                "windows",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-windows",
                true,
            ),
            (
                "windows",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-windows-x86",
                false,
            ),
            (
                "windows",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-windows-arm64",
                false,
            ),
            (
                "windows",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-linux",
                false,
            ),
            (
                "windows",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-macos",
                false,
            ),
            (
                "windows",
                "x86_64",
                "io.netty:netty:4.1.82:linux-x86_64",
                false,
            ),
            (
                "windows",
                "x86_64",
                "io.netty:netty:4.2.16:osx-x86_64",
                false,
            ),
            (
                "windows",
                "x86",
                "org.lwjgl:lwjgl:3.3.1:natives-windows-x86",
                true,
            ),
            (
                "windows",
                "x86",
                "org.lwjgl:lwjgl:3.3.1:natives-windows",
                false,
            ),
            (
                "windows",
                "aarch64",
                "org.lwjgl:lwjgl:3.3.1:natives-windows-arm64",
                true,
            ),
            (
                "windows",
                "aarch64",
                "org.lwjgl:lwjgl:3.3.1:natives-windows",
                false,
            ),
            (
                "linux",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-linux",
                true,
            ),
            (
                "linux",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-windows",
                false,
            ),
            (
                "linux",
                "x86_64",
                "io.netty:netty:4.1.82:linux-x86_64",
                true,
            ),
            (
                "linux",
                "x86_64",
                "io.netty:netty:4.1.82:linux-aarch_64",
                false,
            ),
            (
                "linux",
                "aarch64",
                "org.lwjgl:lwjgl:3.3.1:natives-linux",
                false,
            ),
            (
                "linux",
                "aarch64",
                "org.lwjgl:lwjgl:3.3.1:natives-linux-arm64",
                true,
            ),
            (
                "linux",
                "aarch64",
                "io.netty:netty:4.1.82:linux-aarch_64",
                true,
            ),
            ("osx", "x86_64", "org.lwjgl:lwjgl:3.3.1:natives-macos", true),
            (
                "osx",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-macos-arm64",
                false,
            ),
            ("osx", "x86_64", "io.netty:netty:4.2.16:osx-x86_64", true),
            (
                "osx",
                "aarch64",
                "org.lwjgl:lwjgl:3.3.1:natives-macos-arm64",
                true,
            ),
            (
                "osx",
                "aarch64",
                "org.lwjgl:lwjgl:3.3.1:natives-macos",
                false,
            ),
            ("osx", "aarch64", "io.netty:netty:4.2.16:osx-aarch_64", true),
            ("osx", "aarch64", "io.netty:netty:4.2.16:osx-x86_64", false),
            ("windows", "x86_64", "org.lwjgl:lwjgl:3.2.2", true),
            ("linux", "x86_64", "com.mojang:text2speech:1.12.4", true),
            (
                "windows",
                "x86_64",
                "org.lwjgl:lwjgl:3.3.1:natives-freebsd",
                false,
            ),
            ("linux", "x86_64", "org.lwjgl:lwjgl:3.3.1:javadoc", true),
        ];
        for (os, arch, name, expected) in cases {
            assert_eq!(
                should_download_library_for(name, os, arch),
                expected,
                "{name} на {os}/{arch}"
            );
        }
    }

    fn new_scheme_lwjgl(classifier: &str, os_rule: &str) -> serde_json::Value {
        json!({
            "name": format!("org.lwjgl:lwjgl:3.3.1:{classifier}"),
            "downloads": {
                "artifact": {
                    "path": format!("org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-{classifier}.jar"),
                    "sha1": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "size": 1000,
                    "url": format!("https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-{classifier}.jar")
                }
            },
            "rules": [{ "action": "allow", "os": { "name": os_rule } }]
        })
    }

    fn netty_epoll(classifier: &str) -> serde_json::Value {
        json!({
            "name": format!("io.netty:netty-transport-native-epoll:4.1.82.Final:{classifier}"),
            "downloads": {
                "artifact": {
                    "path": format!("io/netty/netty-transport-native-epoll/4.1.82.Final/netty-transport-native-epoll-4.1.82.Final-{classifier}.jar"),
                    "sha1": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "size": 1000,
                    "url": format!("https://libraries.minecraft.net/io/netty/netty-transport-native-epoll/4.1.82.Final/netty-transport-native-epoll-4.1.82.Final-{classifier}.jar")
                }
            },
            "rules": [{ "action": "allow", "os": { "name": "linux" } }]
        })
    }

    fn manifest_1_20_1_new_scheme() -> serde_json::Value {
        json!({
            "id": "1.20.1",
            "downloads": {
                "client": {
                    "sha1": "2e9a3e3107cca00d6bc9c97bf7d149cae163ef21",
                    "size": 1,
                    "url": "https://example.invalid/client.jar"
                }
            },
            "libraries": [
                json!({
                    "name": "org.lwjgl:lwjgl:3.3.1",
                    "downloads": {
                        "artifact": {
                            "path": "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar",
                            "sha1": "cccccccccccccccccccccccccccccccccccccccc",
                            "size": 1000,
                            "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar"
                        }
                    }
                }),
                new_scheme_lwjgl("natives-windows", "windows"),
                new_scheme_lwjgl("natives-windows-arm64", "windows"),
                new_scheme_lwjgl("natives-windows-x86", "windows"),
                new_scheme_lwjgl("natives-linux", "linux"),
                new_scheme_lwjgl("natives-macos", "osx"),
                new_scheme_lwjgl("natives-macos-arm64", "osx"),
                netty_epoll("linux-x86_64"),
                netty_epoll("linux-aarch_64")
            ],
            "assetIndex": {
                "id": "5",
                "sha1": "d31a2e85ae149dd1b1a7070b22cb8887892fda6c",
                "size": 1,
                "url": "https://example.invalid/5.json",
                "totalSize": 1
            },
            "assets": "5",
            "mainClass": "net.minecraft.client.main.Main"
        })
    }

    #[test]
    fn new_scheme_manifest_downloads_and_extracts_only_matching_arch() {
        let manifest: VersionDetailsManifest =
            serde_json::from_value(manifest_1_20_1_new_scheme()).unwrap();

        let expected_lwjgl = match (get_current_os(), get_arch_label()) {
            ("windows", "x86") => "natives-windows-x86",
            ("windows", "aarch64") => "natives-windows-arm64",
            ("windows", _) => "natives-windows",
            ("osx", "aarch64") => "natives-macos-arm64",
            ("osx", _) => "natives-macos",
            ("linux", _) => "natives-linux",
            other => panic!("неожиданная платформа тестового хоста: {other:?}"),
        };
        let expected_netty = match (get_current_os(), get_arch_label()) {
            ("linux", "x86_64") => Some("linux-x86_64"),
            ("linux", "aarch64") => Some("linux-aarch_64"),
            _ => None,
        };

        let targets = collect_library_targets(&manifest).expect("таргеты библиотек");
        let rel_paths: Vec<&str> = targets
            .iter()
            .map(|t| t.rel_path.to_str().unwrap())
            .collect();

        let lwjgl_variants: Vec<&str> = rel_paths
            .iter()
            .filter(|p| p.contains("lwjgl-3.3.1-natives-"))
            .copied()
            .collect();
        assert_eq!(
            lwjgl_variants.len(),
            1,
            "должен выбираться ровно один вариант natives под текущую платформу: {rel_paths:?}"
        );
        assert!(
            lwjgl_variants[0].contains(expected_lwjgl),
            "выбран неверный вариант: {lwjgl_variants:?}, ожидался {expected_lwjgl}"
        );
        assert!(
            rel_paths
                .iter()
                .any(|p| p.ends_with("org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar")),
            "основной jar lwjgl должен загружаться: {rel_paths:?}"
        );

        let netty_variants: Vec<&str> = rel_paths
            .iter()
            .filter(|p| p.contains("netty-transport-native-epoll"))
            .copied()
            .collect();
        match expected_netty {
            Some(classifier) => {
                assert_eq!(
                    netty_variants.len(),
                    1,
                    "на linux нужен только совпадающий по архитектуре netty: {netty_variants:?}"
                );
                assert!(netty_variants[0].contains(classifier));
            }
            None => assert!(
                netty_variants.is_empty(),
                "вне linux netty-epoll не загружается: {netty_variants:?}"
            ),
        }

        let natives = collect_natives_to_extract(&manifest).expect("список natives");
        let natives_paths: Vec<&str> = natives
            .iter()
            .map(|(rel, _)| rel.to_str().unwrap())
            .collect();
        assert_eq!(
            natives_paths.len(),
            1,
            "распаковывается только совпадающий по архитектуре jar: {natives_paths:?}"
        );
        assert!(natives_paths[0].contains(expected_lwjgl));
    }

    #[tokio::test]
    async fn extract_natives_flattens_arch_subdir_layout() {
        let dir = LauncherDirGuard::acquire("natives_subdir_layout").await;
        let base = dir.project_dir("Cordelia");

        write_test_zip(
            &base.join("libraries/lwjgl/lwjgl-natives.jar"),
            &[("linux/x64/org/lwjgl/liblwjgl.so", b"x64 so".as_slice())],
        );

        extract_natives(
            &base,
            vec![(PathBuf::from("libraries/lwjgl/lwjgl-natives.jar"), None)],
            "1.20.1",
        )
        .await
        .expect("распаковка jar с арх-подпапками новой схемы");

        assert_eq!(
            std_fs::read(base.join("natives/liblwjgl.so")).unwrap(),
            b"x64 so"
        );
    }

    #[tokio::test]
    async fn extract_natives_errors_on_name_collision_instead_of_silent_overwrite() {
        let dir = LauncherDirGuard::acquire("natives_name_collision").await;
        let base = dir.project_dir("Cordelia");

        write_test_zip(
            &base.join("libraries/lwjgl/lwjgl-natives-windows.jar"),
            &[("windows/x64/org/lwjgl/lwjgl.dll", b"x64 dll".as_slice())],
        );
        write_test_zip(
            &base.join("libraries/lwjgl/lwjgl-natives-windows-x86.jar"),
            &[("windows/x86/org/lwjgl/lwjgl.dll", b"x86 dll".as_slice())],
        );

        let error = extract_natives(
            &base,
            vec![
                (
                    PathBuf::from("libraries/lwjgl/lwjgl-natives-windows.jar"),
                    None,
                ),
                (
                    PathBuf::from("libraries/lwjgl/lwjgl-natives-windows-x86.jar"),
                    None,
                ),
            ],
            "1.20.1",
        )
        .await
        .expect_err("коллизия lwjgl.dll из разных вариантов должна давать явную ошибку");

        assert!(
            error.to_string().contains("Конфликт имён natives"),
            "ошибка должна называть конфликт: {error}"
        );
        let natives_clean = std_fs::read_dir(base.join("natives"))
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(true);
        assert!(
            natives_clean,
            "после сбоя папка natives должна быть пуста для чистой повторной попытки"
        );
    }
}
