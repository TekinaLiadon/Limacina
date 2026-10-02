use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::legacy::hashed::{FileNameMatcher, HashedDir};
use crate::legacy::requests::{
    choose_profile_record, LegacyClient, LegacyProfileRecord, LegacySession,
};
use crate::legacy::types::PlayerProfile;
use crate::log_info;
use crate::state::dto::LegacyProfile;
use crate::utils::blocking;
use crate::utils::download_file::write_atomic;
use crate::utils::env_info::{jvm_dir_suffix, launcher_path};
use crate::utils::step_events::StepHandle;

const ASSET_MATCHER_PATTERNS: [&str; 2] = ["indexes", "objects"];

pub struct LegacyPaths {
    pub legacy_dir: PathBuf,
}

impl LegacyPaths {
    pub fn new(project_name: &str) -> Result<Self> {
        Ok(Self {
            legacy_dir: launcher_path(Some(project_name))?.join("legacy"),
        })
    }

    pub fn updates_dir(&self) -> PathBuf {
        self.legacy_dir.join("updates")
    }

    pub fn jvm_dir_name(&self, profile: &LegacyProfile) -> String {
        format!("{}{}", profile.jvm_version, jvm_dir_suffix())
    }

    pub fn jvm_dir(&self, profile: &LegacyProfile) -> PathBuf {
        self.updates_dir().join(self.jvm_dir_name(profile))
    }

    pub fn java_executable(&self, profile: &LegacyProfile) -> PathBuf {
        if cfg!(target_os = "windows") {
            self.jvm_dir(profile).join("bin").join("java.exe")
        } else {
            self.jvm_dir(profile).join("bin").join("java")
        }
    }

    pub fn asset_dir(&self, profile: &LegacyProfile) -> PathBuf {
        self.updates_dir().join(&profile.asset_dir)
    }

    pub fn client_dir(&self, profile: &LegacyProfile) -> PathBuf {
        self.updates_dir().join(&profile.dir_name)
    }

    pub fn launcher_jar(&self) -> PathBuf {
        self.legacy_dir.join("launcher.jar")
    }

    pub fn launcher_jar_sign(&self) -> PathBuf {
        self.legacy_dir.join("launcher.jar.sign")
    }

    pub fn auth_cache(&self) -> PathBuf {
        self.legacy_dir.join("profile.json")
    }

    pub fn profile_signed(&self) -> PathBuf {
        self.legacy_dir.join("profile-signed.bin")
    }

    pub fn hdirs_dir(&self) -> PathBuf {
        self.legacy_dir.join("hdirs")
    }

    pub fn hdir_blob(&self, name: &str) -> PathBuf {
        self.hdirs_dir().join(format!("{name}.bin"))
    }

    pub fn client_params(&self) -> PathBuf {
        self.legacy_dir.join("client-params.bin")
    }

    pub async fn ensure_dirs(&self) -> Result<()> {
        tokio::fs::create_dir_all(&self.legacy_dir)
            .await
            .map_err(|e| {
                anyhow::Error::new(e).context(format!(
                    "Не удалось создать папку {}",
                    self.legacy_dir.display()
                ))
            })?;
        Ok(())
    }
}

pub async fn ensure_launcher_jar(
    client: &LegacyClient,
    paths: &LegacyPaths,
) -> Result<(PathBuf, Vec<u8>, LegacyProfileRecord)> {
    paths.ensure_dirs().await?;
    let (sign, records) = client.fetch_profiles().await?;
    let chosen = choose_profile_record(records)?;
    let jar = paths.launcher_jar();
    let sign_path = paths.launcher_jar_sign();
    let stored_sign = tokio::fs::read_to_string(&sign_path)
        .await
        .unwrap_or_default();
    let sign_hex = hex_encode(&sign);
    if !jar.exists() || stored_sign.trim() != sign_hex {
        log_info!("[legacy] Обновление launcher.jar по подписи сервера");
        let (_, binary) = client.fetch_launcher_jar().await?;
        write_atomic(&jar, &binary).await?;
        write_atomic(&sign_path, sign_hex.as_bytes()).await?;
    }
    write_atomic(&paths.profile_signed(), &chosen.signed).await?;
    Ok((jar, sign, chosen))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub async fn store_auth_cache(paths: &LegacyPaths, profile: &PlayerProfile) -> Result<()> {
    paths.ensure_dirs().await?;
    let payload = serde_json::json!({
        "uuid": profile.uuid,
        "username": profile.username,
        "skin": profile.skin.as_ref().map(|t| serde_json::json!({
            "url": t.url,
            "digest": hex_encode(&t.digest),
        })),
        "cloak": profile.cloak.as_ref().map(|t| serde_json::json!({
            "url": t.url,
            "digest": hex_encode(&t.digest),
        })),
    });
    write_atomic(
        &paths.auth_cache(),
        serde_json::to_string(&payload)?.as_bytes(),
    )
    .await
}

pub fn load_auth_cache(paths: &LegacyPaths) -> Option<PlayerProfile> {
    let content = std::fs::read_to_string(paths.auth_cache()).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    Some(PlayerProfile {
        uuid: value.get("uuid")?.as_str()?.to_string(),
        username: value.get("username")?.as_str()?.to_string(),
        skin: parse_cached_texture(value.get("skin")),
        cloak: parse_cached_texture(value.get("cloak")),
    })
}

fn parse_cached_texture(
    value: Option<&serde_json::Value>,
) -> Option<crate::legacy::types::LegacyTextures> {
    let value = value?;
    let url = value.get("url")?.as_str()?.to_string();
    let digest_hex = value.get("digest")?.as_str()?;
    let digest = decode_hex_32(digest_hex)?;
    Some(crate::legacy::types::LegacyTextures { url, digest })
}

fn decode_hex_32(input: &str) -> Option<[u8; 32]> {
    if input.len() != 64 {
        return None;
    }
    let mut digest = [0u8; 32];
    for (index, byte) in digest.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&input[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(digest)
}

pub fn asset_matcher(profile: &LegacyProfile) -> Option<FileNameMatcher> {
    if crate::utils::compare_versions(&profile.version, "1.7.3") != std::cmp::Ordering::Less {
        let verify: Vec<String> = ASSET_MATCHER_PATTERNS
            .iter()
            .map(|pattern| (*pattern).to_string())
            .collect();
        FileNameMatcher::new(&[], &verify, &[])
            .map(|matcher| matcher.verify_only())
            .ok()
    } else {
        None
    }
}

pub fn client_matcher(profile: &LegacyProfile) -> Result<FileNameMatcher> {
    FileNameMatcher::new(
        &profile.update,
        &profile.update_verify,
        &profile.update_exclusions,
    )
}

pub async fn sync_update_dir(
    client: &LegacyClient,
    session: LegacySession<'_>,
    dir_name: &str,
    dir: &Path,
    matcher: Option<FileNameMatcher>,
    digest_mode: bool,
    step: &StepHandle,
) -> Result<Vec<u8>> {
    tokio::fs::create_dir_all(dir)
        .await
        .with_context(|| format!("Не удалось создать папку {}", dir.display()))?;
    step.detail("Хеширование локальных файлов");
    let dir_owned = dir.to_path_buf();
    let matcher_for_hash = matcher.clone();
    let local = blocking(
        "Не удалось проанализировать файлы обновления",
        move || HashedDir::build_local(&dir_owned, matcher_for_hash.as_ref(), digest_mode),
    )
    .await??;

    let server = client.update_list(session, dir_name).await?;
    let diff = server.dir.diff(&local, matcher.as_ref());

    if !diff.extra_files.is_empty() || !diff.extra_dirs.is_empty() {
        step.detail("Удаление лишних файлов");
        let dir_owned = dir.to_path_buf();
        let extra_files = diff.extra_files.clone();
        let extra_dirs = diff.extra_dirs.clone();
        blocking(
            "Не удалось удалить лишние файлы обновления",
            move || apply_deletions(&dir_owned, &extra_files, &extra_dirs),
        )
        .await??;
    }

    let mut files = flatten_files(&diff.mismatch);
    files.sort_by_key(|path| download_priority(path));
    let total = diff.total_size();
    step.set_total(total);

    let mut offsets = Vec::with_capacity(files.len());
    let mut offset = 0u64;
    for path in &files {
        offsets.push(offset);
        offset += mismatch_file_size(&diff.mismatch, path).unwrap_or(0);
    }

    let files_for_progress = files.clone();
    client
        .update_files(session, dir_name, dir, &files, &mut |path, done, _| {
            let index = files_for_progress.iter().position(|item| item == path);
            if let Some(index) = index {
                step.progress(offsets[index] + done, total);
            }
        })
        .await?;
    step.progress(total, total);
    Ok(server.signed)
}

fn apply_deletions(base: &Path, extra_files: &[String], extra_dirs: &[String]) -> Result<()> {
    for path in extra_files {
        let full = base.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        match std::fs::remove_file(&full) {
            Ok(()) => log_info!("[legacy] Удалён лишний файл: {path}"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(anyhow::Error::new(e).context(format!("Не удалось удалить {path}")))
            }
        }
    }
    for path in extra_dirs {
        let full = base.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        match std::fs::remove_dir_all(&full) {
            Ok(()) => log_info!("[legacy] Удалена лишняя папка: {path}"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(anyhow::Error::new(e).context(format!("Не удалось удалить {path}")))
            }
        }
    }
    Ok(())
}

fn flatten_files(dir: &HashedDir) -> Vec<String> {
    let mut files = Vec::new();
    flatten_dir(dir, String::new(), &mut files);
    files
}

fn flatten_dir(dir: &HashedDir, prefix: String, files: &mut Vec<String>) {
    for (name, entry) in &dir.entries {
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        match entry {
            crate::legacy::hashed::HashedEntry::File(_) => files.push(path),
            crate::legacy::hashed::HashedEntry::Dir(sub) => flatten_dir(sub, path, files),
        }
    }
}

fn mismatch_file_size(dir: &HashedDir, path: &str) -> Option<u64> {
    let mut current = dir;
    let segments: Vec<&str> = path.split('/').collect();
    for (index, segment) in segments.iter().enumerate() {
        match current.entries.get(*segment)? {
            crate::legacy::hashed::HashedEntry::File(file) => {
                if index == segments.len() - 1 {
                    return Some(file.size);
                }
                return None;
            }
            crate::legacy::hashed::HashedEntry::Dir(sub) => current = sub,
        }
    }
    None
}

fn download_priority(path: &str) -> u8 {
    let lower = path.to_ascii_lowercase();
    if lower == "minecraft.jar"
        || lower == "forge.jar"
        || lower.starts_with("libraries/")
        || lower.starts_with("natives/")
    {
        0
    } else if lower.starts_with("mods/")
        || lower.starts_with("openloader/")
        || lower.starts_with("resources/")
    {
        1
    } else {
        2
    }
}

pub async fn sync_all(
    client: &LegacyClient,
    session: LegacySession<'_>,
    profile: &LegacyProfile,
    paths: &LegacyPaths,
) -> Result<()> {
    let fast = profile.update_fast_check;

    let step_jvm = StepHandle::start("legacy.jvm", "Обновление файлов JVM");
    let dir_name = paths.jvm_dir_name(profile);
    let dir = paths.jvm_dir(profile);
    let jvm_signed = sync_update_dir(client, session, &dir_name, &dir, None, fast, &step_jvm)
        .await
        .with_context(|| format!("Не удалось обновить файлы JVM «{dir_name}»"))?;
    step_jvm.finish(false);

    let step_assets = StepHandle::start("legacy.assets", "Обновление файлов ресурсов");
    let dir = paths.asset_dir(profile);
    let asset_signed = sync_update_dir(
        client,
        session,
        &profile.asset_dir,
        &dir,
        asset_matcher(profile),
        fast,
        &step_assets,
    )
    .await
    .with_context(|| format!("Не удалось обновить ресурсы «{}»", profile.asset_dir))?;
    step_assets.finish(false);

    let step_client = StepHandle::start("legacy.client", "Обновление файлов клиента");
    let dir = paths.client_dir(profile);
    let matcher = client_matcher(profile)?;
    let client_signed = sync_update_dir(
        client,
        session,
        &profile.dir_name,
        &dir,
        Some(matcher),
        fast,
        &step_client,
    )
    .await
    .with_context(|| format!("Не удалось обновить клиент «{}»", profile.dir_name))?;
    step_client.finish(false);

    write_hdir_blobs(paths, &jvm_signed, &asset_signed, &client_signed).await?;
    Ok(())
}

pub async fn refresh_hdir_blobs(
    client: &LegacyClient,
    session: LegacySession<'_>,
    profile: &LegacyProfile,
    paths: &LegacyPaths,
) -> Result<()> {
    let jvm = client
        .update_list(session, &paths.jvm_dir_name(profile))
        .await?;
    let assets = client.update_list(session, &profile.asset_dir).await?;
    let client_tree = client.update_list(session, &profile.dir_name).await?;
    write_hdir_blobs(paths, &jvm.signed, &assets.signed, &client_tree.signed).await
}

async fn write_hdir_blobs(
    paths: &LegacyPaths,
    jvm_signed: &[u8],
    asset_signed: &[u8],
    client_signed: &[u8],
) -> Result<()> {
    tokio::fs::create_dir_all(&paths.hdirs_dir())
        .await
        .with_context(|| format!("Не удалось создать папку {}", paths.hdirs_dir().display()))?;
    for (name, blob) in [
        ("jvm", jvm_signed),
        ("asset", asset_signed),
        ("client", client_signed),
    ] {
        write_atomic(&paths.hdir_blob(name), blob).await?;
    }
    Ok(())
}

pub async fn read_hdir_blobs(paths: &LegacyPaths) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    let read = async |name: &str| -> Result<Vec<u8>> {
        tokio::fs::read(paths.hdir_blob(name))
            .await
            .with_context(|| format!("Не удалось прочитать подписанное дерево «{name}»"))
    };
    let jvm = read("jvm").await?;
    let asset = read("asset").await?;
    let client = read("client").await?;
    Ok((jvm, asset, client))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legacy::hashed::{HashedEntry, HashedFile};

    fn file(size: u64) -> HashedEntry {
        HashedEntry::File(HashedFile { size, digest: None })
    }

    fn tree(entries: Vec<(&str, HashedEntry)>) -> HashedDir {
        HashedDir {
            entries: entries
                .into_iter()
                .map(|(name, entry)| (name.to_string(), entry))
                .collect(),
        }
    }

    #[test]
    fn flatten_files_walks_tree_in_order() {
        let dir = tree(vec![
            ("servers.dat", file(1)),
            (
                "mods",
                HashedEntry::Dir(tree(vec![("a.jar", file(2)), ("b.jar", file(3))])),
            ),
            ("minecraft.jar", file(4)),
        ]);
        assert_eq!(
            flatten_files(&dir),
            vec![
                "minecraft.jar".to_string(),
                "mods/a.jar".to_string(),
                "mods/b.jar".to_string(),
                "servers.dat".to_string(),
            ],
            "обход идёт в отсортированном порядке дерева"
        );
    }

    #[test]
    fn download_order_puts_minecraft_files_first() {
        let dir = tree(vec![
            ("servers.dat", file(1)),
            ("mods", HashedEntry::Dir(tree(vec![("a.jar", file(2))]))),
            ("minecraft.jar", file(4)),
            (
                "libraries",
                HashedEntry::Dir(tree(vec![("cpw/x.jar", file(5))])),
            ),
            ("forge.jar", file(6)),
            (
                "resources",
                HashedEntry::Dir(tree(vec![("pack.zip", file(7))])),
            ),
            ("config.json", file(8)),
        ]);
        let mut files = flatten_files(&dir);
        files.sort_by_key(|path| download_priority(path));
        assert_eq!(
            files,
            vec![
                "forge.jar".to_string(),
                "libraries/cpw/x.jar".to_string(),
                "minecraft.jar".to_string(),
                "mods/a.jar".to_string(),
                "resources/pack.zip".to_string(),
                "config.json".to_string(),
                "servers.dat".to_string(),
            ],
            "внутри групп сохраняется порядок дерева"
        );
    }

    #[test]
    fn download_priority_ignores_case() {
        assert_eq!(download_priority("MINECRAFT.JAR"), 0);
        assert_eq!(download_priority("Mods/Thing.jar"), 1);
        assert_eq!(download_priority("Servers.dat"), 2);
    }

    #[test]
    fn mismatch_file_size_resolves_nested_paths() {
        let dir = tree(vec![(
            "mods",
            HashedEntry::Dir(tree(vec![("a.jar", file(11))])),
        )]);
        assert_eq!(mismatch_file_size(&dir, "mods/a.jar"), Some(11));
        assert_eq!(mismatch_file_size(&dir, "mods/missing.jar"), None);
        assert_eq!(mismatch_file_size(&dir, "other.jar"), None);
    }

    #[test]
    fn apply_deletions_removes_files_and_dirs_tolerantly() {
        let root =
            std::env::temp_dir().join(format!("limacina_legacy_delete_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("mods")).expect("корень");
        std::fs::write(root.join("mods/old.jar"), b"x").expect("файл");
        std::fs::write(root.join("keep.txt"), b"y").expect("файл");

        apply_deletions(
            &root,
            &["keep.txt".to_string()],
            &["mods".to_string(), "already-gone".to_string()],
        )
        .expect("удаление");

        assert!(!root.join("keep.txt").exists());
        assert!(!root.join("mods").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn auth_cache_round_trip_with_textures() {
        let root =
            std::env::temp_dir().join(format!("limacina_legacy_cache_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("корень");
        let paths = LegacyPaths {
            legacy_dir: root.clone(),
        };

        assert!(load_auth_cache(&paths).is_none(), "кэш отсутствует");

        let profile = PlayerProfile {
            uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5".to_string(),
            username: "TechSherl".to_string(),
            skin: Some(crate::legacy::types::LegacyTextures {
                url: "https://example.com/skin.png".to_string(),
                digest: [9u8; 32],
            }),
            cloak: None,
        };
        store_auth_cache(&paths, &profile)
            .await
            .expect("запись кэша");
        let loaded = load_auth_cache(&paths).expect("кэш читается");
        assert_eq!(loaded, profile);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn legacy_paths_follow_project_layout() {
        let paths = LegacyPaths::new("TestProj").expect("пути проекта");
        let profile = LegacyProfile {
            version: "1.16.5".to_string(),
            asset_index: "1.16.5".to_string(),
            dir_name: "Client".to_string(),
            asset_dir: "asset1.16.5".to_string(),
            sort_index: 0,
            server_address: "s.example.com".to_string(),
            server_port: 25545,
            jvm_version: "graalvm-11".to_string(),
            update_fast_check: true,
            update: vec![],
            update_verify: vec![],
            update_exclusions: vec![],
            main_class: "Main".to_string(),
            class_path: vec![],
            jvm_args: vec![],
            client_args: vec![],
        };

        let base = launcher_path(Some("TestProj")).expect("путь проекта");
        assert_eq!(paths.legacy_dir, base.join("legacy"));
        assert_eq!(paths.updates_dir(), base.join("legacy/updates"));
        assert_eq!(paths.launcher_jar(), base.join("legacy/launcher.jar"));
        assert_eq!(
            paths.client_dir(&profile),
            base.join("legacy/updates/Client")
        );
        assert_eq!(
            paths.asset_dir(&profile),
            base.join("legacy/updates/asset1.16.5")
        );
        let jvm = paths.jvm_dir(&profile);
        assert!(jvm.ends_with("graalvm-11-win64"), "jvm dir: {jvm:?}");
        let java = paths.java_executable(&profile);
        assert!(java.starts_with(jvm.join("bin")));
    }

    #[test]
    fn asset_matcher_only_for_modern_versions() {
        let base = LegacyProfile {
            version: "1.16.5".to_string(),
            asset_index: String::new(),
            dir_name: String::new(),
            asset_dir: String::new(),
            sort_index: 0,
            server_address: String::new(),
            server_port: 0,
            jvm_version: String::new(),
            update_fast_check: true,
            update: vec![],
            update_verify: vec![],
            update_exclusions: vec![],
            main_class: String::new(),
            class_path: vec![],
            jvm_args: vec![],
            client_args: vec![],
        };

        let matcher = asset_matcher(&base).expect("матчер для 1.16.5");
        let segments = vec!["indexes".to_string(), "objects".to_string()];
        assert!(matcher.should_verify(&segments));

        let mut old = base.clone();
        old.version = "1.6.4".to_string();
        assert!(
            asset_matcher(&old).is_none(),
            "для старых версий матчера нет"
        );
    }
}
