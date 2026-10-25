use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::client;
use super::install::{install_project, sync_installed_from_scan_full, InstallContext};
use crate::log_info;
use crate::utils::download_file::write_atomic;
use crate::utils::errors::LauncherError;

pub const MODSET_FORMAT_VERSION: u32 = 1;
pub const MODSET_MAX_BYTES: usize = 1_048_576;
pub const MODSET_MAX_ENTRIES: usize = 500;
pub const MODSET_SOURCE: &str = "modrinth";

const MODSET_EXTENSION: &str = ".limmods.json";
const RESERVED_MANIFEST_FILENAME: &str = "modrinth.json";
const MODRINTH_ID_MAX_LEN: usize = 128;

pub fn ensure_modrinth_id(id: &str, label: &str) -> Result<()> {
    let valid = !id.is_empty()
        && id.len() <= MODRINTH_ID_MAX_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if valid {
        return Ok(());
    }
    bail!(LauncherError::InvalidInput(format!(
        "Некорректный идентификатор {label}: {id}"
    )))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModsetRecord {
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

#[derive(Debug, Serialize)]
struct ModsetFile {
    format_version: u32,
    mods: Vec<ModsetRecord>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModsetStatus {
    Ready,
    Skipped,
    Installed,
    AlreadyInstalled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModsetEntry {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    pub status: ModsetStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ModsetUnresolved {
    pub filename: String,
    pub reason: String,
}

pub struct ParsedModset {
    pub format_version: u32,
    pub entries: Vec<ModsetEntry>,
}

pub fn parse_modset(content: &str) -> Result<ParsedModset> {
    if content.len() > MODSET_MAX_BYTES {
        bail!(LauncherError::InvalidInput(format!(
            "Файл набора модов слишком большой: {} байт, максимум {MODSET_MAX_BYTES}",
            content.len()
        )));
    }
    let value: serde_json::Value = serde_json::from_str(content).map_err(|e| {
        LauncherError::InvalidInput(format!(
            "Файл набора модов не является корректным JSON: {e}"
        ))
    })?;
    let object = value.as_object().ok_or_else(|| {
        LauncherError::InvalidInput("Файл набора модов должен содержать JSON-объект".to_string())
    })?;
    let format_version = object.get("format_version").ok_or_else(|| {
        LauncherError::InvalidInput(
            "В файле набора модов отсутствует версия формата format_version".to_string(),
        )
    })?;
    let format_version = format_version.as_u64().ok_or_else(|| {
        LauncherError::InvalidInput(
            "Версия формата в файле набора модов должна быть целым числом".to_string(),
        )
    })?;
    if format_version != u64::from(MODSET_FORMAT_VERSION) {
        bail!(LauncherError::InvalidInput(format!(
            "Неизвестная версия формата набора модов: {format_version}, обновите лаунчер"
        )));
    }
    let mods = object.get("mods").ok_or_else(|| {
        LauncherError::InvalidInput(
            "В файле набора модов отсутствует список модов mods".to_string(),
        )
    })?;
    let mods = mods.as_array().ok_or_else(|| {
        LauncherError::InvalidInput(
            "Список mods в файле набора модов должен быть массивом".to_string(),
        )
    })?;
    if mods.len() > MODSET_MAX_ENTRIES {
        bail!(LauncherError::InvalidInput(format!(
            "Файл набора модов содержит слишком много записей: {}, максимум {MODSET_MAX_ENTRIES}",
            mods.len()
        )));
    }
    let entries = parse_entries(mods);
    Ok(ParsedModset {
        format_version: MODSET_FORMAT_VERSION,
        entries,
    })
}

pub fn serialize_modset(mods: &[ModsetRecord]) -> Result<Vec<u8>> {
    let file = ModsetFile {
        format_version: MODSET_FORMAT_VERSION,
        mods: mods.to_vec(),
    };
    serde_json::to_vec_pretty(&file).context("Не удалось сериализовать файл набора модов")
}

fn parse_entries(mods: &[serde_json::Value]) -> Vec<ModsetEntry> {
    let mut entries: Vec<ModsetEntry> = Vec::with_capacity(mods.len());
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for value in mods {
        let entry = match serde_json::from_value::<ModsetRecord>(value.clone()) {
            Ok(record) => validate_entry(record),
            Err(e) => skipped_entry(format!("Не удалось разобрать запись мода: {e}")),
        };
        match dedup_key(&entry) {
            Some(key) => {
                if let Some(&index) = index_by_key.get(&key) {
                    entries[index] = entry;
                } else {
                    index_by_key.insert(key, entries.len());
                    entries.push(entry);
                }
            }
            None => entries.push(entry),
        }
    }
    entries
}

fn validate_entry(record: ModsetRecord) -> ModsetEntry {
    let (status, message) = if record.source != MODSET_SOURCE {
        (
            ModsetStatus::Skipped,
            Some(format!("Неизвестный источник мода: \"{}\"", record.source)),
        )
    } else if record.project_id.is_none() && record.slug.is_none() {
        (
            ModsetStatus::Skipped,
            Some("В записи мода не указаны project_id и slug".to_string()),
        )
    } else if let Some(message) = invalid_id_message(&record) {
        (ModsetStatus::Skipped, Some(message))
    } else {
        (ModsetStatus::Ready, None)
    };
    entry(record, status, message)
}

fn invalid_id_message(record: &ModsetRecord) -> Option<String> {
    for (label, value) in [
        ("мода", record.project_id.as_deref()),
        ("мода", record.slug.as_deref()),
        ("версии", record.version_id.as_deref()),
    ] {
        let Some(value) = value else {
            continue;
        };
        if let Err(e) = ensure_modrinth_id(value, label) {
            return Some(e.to_string());
        }
    }
    None
}

fn dedup_key(record: &ModsetEntry) -> Option<String> {
    if let Some(id) = &record.project_id {
        return Some(id.clone());
    }
    record.slug.as_ref().map(|slug| slug.to_lowercase())
}

fn entry(record: ModsetRecord, status: ModsetStatus, message: Option<String>) -> ModsetEntry {
    ModsetEntry {
        source: record.source,
        project_id: record.project_id,
        slug: record.slug,
        version_id: record.version_id,
        version_number: record.version_number,
        title: record.title,
        filename: record.filename,
        status,
        message,
    }
}

fn skipped_entry(message: String) -> ModsetEntry {
    entry(
        ModsetRecord::default(),
        ModsetStatus::Skipped,
        Some(message),
    )
}

pub async fn export_prepare(
    ctx: &InstallContext,
) -> Result<(Vec<ModsetRecord>, Vec<ModsetUnresolved>)> {
    let (manifest, local_hashes) = sync_installed_from_scan_full(ctx).await?;

    let mut mods: Vec<ModsetRecord> = manifest
        .mods
        .values()
        .map(|record| ModsetRecord {
            source: MODSET_SOURCE.to_string(),
            project_id: Some(record.project_id.clone()),
            slug: record.slug.clone(),
            version_id: Some(record.version_id.clone()),
            version_number: Some(record.version_number.clone()),
            title: Some(record.title.clone()),
            filename: Some(record.filename.clone()),
        })
        .collect();
    mods.sort_by_key(|record| record.title.as_deref().unwrap_or_default().to_lowercase());

    let bound_hashes: HashSet<&str> = manifest
        .mods
        .values()
        .map(|record| record.sha1.as_str())
        .collect();
    let mut files: Vec<(&String, &String)> = local_hashes.iter().collect();
    files.sort();
    let mut unresolved: Vec<ModsetUnresolved> = Vec::new();
    for (filename, hash) in files {
        if bound_hashes.contains(hash.as_str()) {
            continue;
        }
        let reason = if manifest.known_hashes.iter().any(|known| known == hash) {
            "Файл дублирует уже установленный мод другой версией".to_string()
        } else {
            format!(
                "Не удалось привязать к Modrinth: мод не найден для Minecraft {} и лоадера {:?}, либо недоступна сеть",
                ctx.game_versions.join(", "),
                ctx.loaders
            )
        };
        unresolved.push(ModsetUnresolved {
            filename: filename.clone(),
            reason,
        });
    }
    Ok((mods, unresolved))
}

pub async fn export_save(path: &str, mods: &[ModsetRecord]) -> Result<()> {
    let dest = Path::new(path);
    if !dest.is_absolute() {
        bail!(LauncherError::InvalidInput(format!(
            "Путь сохранения набора модов должен быть абсолютным: {path}"
        )));
    }
    let name = dest
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            LauncherError::InvalidInput(format!(
                "Не удалось определить имя файла набора модов: {path}"
            ))
        })?;
    if name == RESERVED_MANIFEST_FILENAME {
        bail!(LauncherError::InvalidInput(
            "Имя \"modrinth.json\" зарезервировано для внутреннего манифеста лаунчера, выберите другое имя файла набора"
                .to_string(),
        ));
    }
    for record in mods {
        if record.source != MODSET_SOURCE {
            bail!(LauncherError::InvalidInput(format!(
                "Запись набора имеет неизвестный источник: \"{}\"",
                record.source
            )));
        }
        if let Some(id) = &record.project_id {
            ensure_modrinth_id(id, "мода")?;
        }
        if let Some(slug) = &record.slug {
            ensure_modrinth_id(slug, "мода")?;
        }
        if let Some(version_id) = &record.version_id {
            ensure_modrinth_id(version_id, "версии")?;
        }
    }
    let target = with_modset_extension(dest, name);
    let bytes = serialize_modset(mods)?;
    write_atomic(&target, &bytes)
        .await
        .with_context(|| format!("Не удалось сохранить файл набора модов {target:?}"))?;
    log_info!(
        "[modrinth] Набор модов сохранён: {target:?} ({} записей)",
        mods.len()
    );
    Ok(())
}

fn with_modset_extension(dest: &Path, name: &str) -> PathBuf {
    if name.to_lowercase().ends_with(MODSET_EXTENSION) {
        return dest.to_path_buf();
    }
    dest.with_file_name(format!("{name}{MODSET_EXTENSION}"))
}

pub async fn import_apply(ctx: &InstallContext, content: &str) -> Result<Vec<ModsetEntry>> {
    let parsed = parse_modset(content)?;
    let mut entries = Vec::with_capacity(parsed.entries.len());
    for entry in parsed.entries {
        if entry.status != ModsetStatus::Ready {
            entries.push(entry);
            continue;
        }
        entries.push(apply_entry(ctx, entry).await);
    }
    Ok(entries)
}

async fn apply_entry(ctx: &InstallContext, mut entry: ModsetEntry) -> ModsetEntry {
    let project_id = match (&entry.project_id, &entry.slug) {
        (Some(id), _) => id.clone(),
        (None, Some(slug)) => match client::get_project(slug).await {
            Ok(project) => project.id,
            Err(e) => {
                entry.status = ModsetStatus::Failed;
                entry.message = Some(format!(
                    "Не удалось найти мод \"{slug}\" на Modrinth: {e:#}"
                ));
                return entry;
            }
        },
        (None, None) => {
            entry.status = ModsetStatus::Skipped;
            entry.message = Some("В записи мода не указаны project_id и slug".to_string());
            return entry;
        }
    };
    match install_project(ctx, &project_id, entry.version_id.as_deref()).await {
        Ok(report) => {
            if report.installed.is_empty() {
                entry.status = ModsetStatus::AlreadyInstalled;
            } else {
                entry.status = ModsetStatus::Installed;
                if !report.skipped.is_empty() {
                    entry.message = Some(format!(
                        "Установлено {}, пропущено {}",
                        report.installed.len(),
                        report.skipped.len()
                    ));
                }
            }
        }
        Err(e) => {
            entry.status = ModsetStatus::Failed;
            entry.message = Some(format!("{e:#}"));
        }
    }
    entry
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modrinth::client::{clear_response_cache_for_tests, override_api_base_for_tests};
    use crate::modrinth::install::{load_manifest, save_manifest};
    use crate::modrinth::structs::{ManifestEntry, ModrinthManifest};
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use mockito::{Matcher, Server, ServerGuard};

    fn record(
        source: &str,
        project_id: Option<&str>,
        slug: Option<&str>,
        version_id: Option<&str>,
    ) -> ModsetRecord {
        ModsetRecord {
            source: source.to_string(),
            project_id: project_id.map(str::to_string),
            slug: slug.map(str::to_string),
            version_id: version_id.map(str::to_string),
            version_number: Some("1.0.0".to_string()),
            title: Some("Test Mod".to_string()),
            filename: Some("test-mod.jar".to_string()),
        }
    }

    fn serialized(mods: &[ModsetRecord]) -> String {
        std::str::from_utf8(&serialize_modset(mods).expect("сериализация набора"))
            .expect("utf8")
            .to_string()
    }

    #[test]
    fn serialize_then_parse_roundtrips_records() {
        let records = vec![
            record(
                MODSET_SOURCE,
                Some("AANobbMI"),
                Some("sodium"),
                Some("verA"),
            ),
            record(MODSET_SOURCE, None, Some("fabric-api"), None),
        ];
        let content = serialized(&records);

        assert!(content.contains("\"format_version\": 1"));
        assert!(!content.contains("null"), "пустые поля не сериализуются");

        let parsed = parse_modset(&content).expect("парс набора");
        assert_eq!(parsed.format_version, MODSET_FORMAT_VERSION);
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[0].source, MODSET_SOURCE);
        assert_eq!(parsed.entries[0].project_id.as_deref(), Some("AANobbMI"));
        assert_eq!(parsed.entries[0].slug.as_deref(), Some("sodium"));
        assert_eq!(parsed.entries[0].version_id.as_deref(), Some("verA"));
        assert_eq!(parsed.entries[0].filename.as_deref(), Some("test-mod.jar"));
        assert_eq!(parsed.entries[0].status, ModsetStatus::Ready);
        assert_eq!(parsed.entries[1].slug.as_deref(), Some("fabric-api"));
        assert_eq!(parsed.entries[1].status, ModsetStatus::Ready);
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let content = r#"{
            "format_version": 1,
            "future_top": {"anything": true},
            "mods": [{
                "source": "modrinth",
                "project_id": "AANobbMI",
                "future_field": 42,
                "title": "Sodium"
            }]
        }"#;
        let parsed = parse_modset(content).expect("неизвестные поля игнорируются");
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].status, ModsetStatus::Ready);
        assert_eq!(parsed.entries[0].title.as_deref(), Some("Sodium"));
    }

    #[test]
    fn duplicate_project_id_last_record_wins() {
        let records = vec![
            record(MODSET_SOURCE, Some("AAA"), None, Some("ver1")),
            record(MODSET_SOURCE, Some("AAA"), None, Some("ver2")),
        ];
        let parsed = parse_modset(&serialized(&records)).expect("парс");
        assert_eq!(parsed.entries.len(), 1, "дубликат схлопывается");
        assert_eq!(parsed.entries[0].version_id.as_deref(), Some("ver2"));
    }

    #[test]
    fn duplicate_slug_is_merged_case_insensitively() {
        let records = vec![
            record(MODSET_SOURCE, None, Some("Sodium"), Some("ver1")),
            record(MODSET_SOURCE, None, Some("sodium"), Some("ver2")),
        ];
        let parsed = parse_modset(&serialized(&records)).expect("парс");
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].version_id.as_deref(), Some("ver2"));
    }

    #[test]
    fn broken_files_are_rejected_before_any_network() {
        let oversized = format!(
            "{{\"format_version\":1,\"mods\":[],\"pad\":\"{}\"}}",
            "a".repeat(MODSET_MAX_BYTES)
        );
        let too_many: Vec<ModsetRecord> = (0..=MODSET_MAX_ENTRIES)
            .map(|i| record(MODSET_SOURCE, Some(&format!("proj{i}")), None, None))
            .collect();
        let cases: Vec<(&str, String)> = vec![
            ("не-JSON", "{ не json".to_string()),
            ("не-объект", "[1, 2, 3]".to_string()),
            ("нет format_version", r#"{"mods": []}"#.to_string()),
            (
                "нецелый format_version",
                r#"{"format_version": 1.5, "mods": []}"#.to_string(),
            ),
            (
                "неизвестная format_version",
                r#"{"format_version": 2, "mods": []}"#.to_string(),
            ),
            ("нет mods", r#"{"format_version": 1}"#.to_string()),
            (
                "mods не массив",
                r#"{"format_version": 1, "mods": {}}"#.to_string(),
            ),
            ("лимит байт", oversized),
            ("лимит записей", serialized(&too_many)),
        ];
        for (label, content) in cases {
            let error = parse_modset(&content).err().unwrap_or_else(|| {
                panic!("файл набора ({label}) должен отклоняться");
            });
            assert!(
                matches!(
                    error.downcast_ref::<LauncherError>(),
                    Some(LauncherError::InvalidInput(_))
                ),
                "({label}) ожидается InvalidInput: {error:#}"
            );
        }
    }

    #[test]
    fn unknown_format_version_names_the_version() {
        let error = parse_modset(r#"{"format_version": 7, "mods": []}"#)
            .err()
            .expect("неизвестная версия формата отклоняется");
        let message = error.to_string();
        assert!(
            message.contains("Неизвестная версия формата набора модов: 7"),
            "{message}"
        );
        assert!(message.contains("обновите лаунчер"), "{message}");
    }

    #[test]
    fn bad_records_are_skipped_not_fatal() {
        let content = r#"{
            "format_version": 1,
            "mods": [
                {"source": "curseforge", "project_id": "BBB"},
                {"source": "modrinth", "title": "без идентификаторов"},
                {"source": "modrinth", "project_id": "../evil"},
                {"source": 42},
                {"source": "modrinth", "project_id": "AAA", "title": "ок"}
            ]
        }"#;
        let parsed = parse_modset(content).expect("проблемные записи не роняют файл");
        assert_eq!(parsed.entries.len(), 5);
        assert_eq!(parsed.entries[0].status, ModsetStatus::Skipped);
        assert!(
            parsed.entries[0]
                .message
                .as_deref()
                .is_some_and(|m| m.contains("curseforge")),
            "{:?}",
            parsed.entries[0].message
        );
        assert_eq!(parsed.entries[1].status, ModsetStatus::Skipped);
        assert!(
            parsed.entries[1]
                .message
                .as_deref()
                .is_some_and(|m| m.contains("project_id")),
            "{:?}",
            parsed.entries[1].message
        );
        assert_eq!(parsed.entries[2].status, ModsetStatus::Skipped);
        assert!(
            parsed.entries[2]
                .message
                .as_deref()
                .is_some_and(|m| m.contains("идентификатор")),
            "{:?}",
            parsed.entries[2].message
        );
        assert_eq!(parsed.entries[3].status, ModsetStatus::Skipped);
        assert!(
            parsed.entries[3]
                .message
                .as_deref()
                .is_some_and(|m| m.contains("разобрать")),
            "{:?}",
            parsed.entries[3].message
        );
        assert_eq!(parsed.entries[4].status, ModsetStatus::Ready);
    }

    struct Env {
        _dir: LauncherDirGuard,
        server: ServerGuard,
        ctx: InstallContext,
    }

    impl Env {
        async fn acquire(label: &str) -> Self {
            let dir = LauncherDirGuard::acquire(label).await;
            let server = Server::new_async().await;
            override_api_base_for_tests(format!("{}/v2", server.url()));
            clear_response_cache_for_tests();
            let project_dir = dir.project_dir("Test");
            let ctx = InstallContext {
                loaders: vec!["fabric".to_string()],
                game_versions: vec!["1.21.1".to_string()],
                mods_dir: project_dir.join("mods"),
                manifest_path: project_dir.join("modrinth.json"),
            };
            Self {
                _dir: dir,
                server,
                ctx,
            }
        }

        fn version_json(
            &self,
            id: &str,
            project_id: &str,
            number: &str,
            filename: &str,
            jar: &[u8],
            deps: serde_json::Value,
        ) -> serde_json::Value {
            serde_json::json!({
                "id": id,
                "project_id": project_id,
                "name": format!("Mod {project_id}"),
                "version_number": number,
                "dependencies": deps,
                "game_versions": ["1.21.1"],
                "loaders": ["fabric"],
                "version_type": "release",
                "files": [{
                    "hashes": {"sha1": sha1_hex(jar)},
                    "url": format!("{}/cdn/{filename}", self.server.url()),
                    "filename": filename,
                    "primary": true,
                    "size": jar.len(),
                    "file_type": null
                }]
            })
        }

        async fn mock_get(&mut self, path: &str, body: serde_json::Value) {
            self.server
                .mock("GET", path)
                .match_query(Matcher::Any)
                .with_status(200)
                .with_body(body.to_string())
                .create_async()
                .await;
        }

        async fn mock_cdn(&mut self, filename: &str, jar: &[u8], hits: usize) {
            self.server
                .mock("GET", format!("/cdn/{filename}").as_str())
                .with_status(200)
                .with_body(jar)
                .expect(hits)
                .create_async()
                .await;
        }

        async fn seed_manifest(&self, mods: Vec<(&str, ManifestEntry)>, known: Vec<String>) {
            if let Some(parent) = self.ctx.manifest_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .expect("создание каталога проекта");
            }
            let manifest = ModrinthManifest {
                mods: mods
                    .into_iter()
                    .map(|(key, value)| (key.to_string(), value))
                    .collect(),
                known_hashes: known,
            };
            save_manifest(&self.ctx.manifest_path, &manifest)
                .await
                .expect("запись стартового манифеста");
        }

        async fn write_mod(&self, filename: &str, content: &[u8]) {
            tokio::fs::create_dir_all(&self.ctx.mods_dir)
                .await
                .expect("создание каталога модов");
            tokio::fs::write(self.ctx.mods_dir.join(filename), content)
                .await
                .expect("запись файла мода");
        }
    }

    fn project_json(id: &str, title: &str) -> serde_json::Value {
        serde_json::json!({"id": id, "project_type": "mod", "title": title})
    }

    fn manifest_entry(
        project: &str,
        slug: Option<&str>,
        filename: &str,
        sha1: &str,
        version_id: &str,
        version_number: &str,
    ) -> ManifestEntry {
        ManifestEntry {
            project_id: project.to_string(),
            slug: slug.map(str::to_string),
            title: format!("Mod {project}"),
            icon_url: None,
            filename: filename.to_string(),
            sha1: sha1.to_string(),
            version_id: version_id.to_string(),
            version_number: version_number.to_string(),
        }
    }

    async fn import_content(mods: serde_json::Value) -> String {
        serde_json::json!({"format_version": 1, "mods": mods}).to_string()
    }

    #[tokio::test]
    async fn import_installs_pinned_and_latest_with_dependencies() {
        let mut env = Env::acquire("modset_import_happy").await;
        let jar_a = b"mod a jar".to_vec();
        let jar_b = b"mod b jar".to_vec();
        let jar_c = b"dep c jar".to_vec();
        let version_a = env.version_json(
            "verA",
            "AAA",
            "1.0.0",
            "A-1.0.0.jar",
            &jar_a,
            serde_json::json!([]),
        );
        let version_b = env.version_json(
            "verB",
            "BBB",
            "2.0.0",
            "B.jar",
            &jar_b,
            serde_json::json!([{"version_id": null, "project_id": "CCC", "file_name": null, "dependency_type": "required"}]),
        );
        let version_c = env.version_json(
            "verC",
            "CCC",
            "0.3.0",
            "C.jar",
            &jar_c,
            serde_json::json!([]),
        );

        env.mock_get("/v2/version/verA", version_a).await;
        env.mock_get("/v2/project/b-slug", project_json("BBB", "Mod B"))
            .await;
        env.mock_get("/v2/project/BBB/version", serde_json::json!([version_b]))
            .await;
        env.mock_get("/v2/project/CCC/version", serde_json::json!([version_c]))
            .await;
        env.mock_get(
            "/v2/projects",
            serde_json::json!([
                project_json("AAA", "Mod A"),
                project_json("BBB", "Mod B"),
                project_json("CCC", "Mod C")
            ]),
        )
        .await;
        env.mock_cdn("A-1.0.0.jar", &jar_a, 1).await;
        env.mock_cdn("B.jar", &jar_b, 1).await;
        env.mock_cdn("C.jar", &jar_c, 1).await;

        let content = import_content(serde_json::json!([
            {
                "source": "modrinth",
                "project_id": "AAA",
                "version_id": "verA",
                "version_number": "1.0.0",
                "title": "Mod A",
                "filename": "A-1.0.0.jar"
            },
            {
                "source": "modrinth",
                "slug": "b-slug",
                "version_number": "2.0.0",
                "title": "Mod B",
                "filename": "B.jar"
            }
        ]))
        .await;

        let entries = import_apply(&env.ctx, &content)
            .await
            .expect("импорт набора");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].status, ModsetStatus::Installed);
        assert_eq!(entries[1].status, ModsetStatus::Installed);
        assert_eq!(
            std::fs::read(env.ctx.mods_dir.join("A-1.0.0.jar")).expect("jar A"),
            jar_a
        );
        assert_eq!(
            std::fs::read(env.ctx.mods_dir.join("B.jar")).expect("jar B"),
            jar_b
        );
        assert_eq!(
            std::fs::read(env.ctx.mods_dir.join("C.jar")).expect("jar C"),
            jar_c
        );

        let manifest = load_manifest(&env.ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(manifest.mods.len(), 3, "зависимость C тоже в манифесте");
        assert_eq!(manifest.mods.get("AAA").expect("A").version_id, "verA");
        assert_eq!(manifest.mods.get("BBB").expect("B").version_number, "2.0.0");
        assert_eq!(manifest.mods.get("CCC").expect("C").version_number, "0.3.0");
    }

    #[tokio::test]
    async fn import_second_run_reports_already_installed_without_redownloads() {
        let mut env = Env::acquire("modset_import_repeat").await;
        let jar_a = b"mod a jar".to_vec();
        let version_a = env.version_json(
            "verA",
            "AAA",
            "1.0.0",
            "A.jar",
            &jar_a,
            serde_json::json!([]),
        );
        env.mock_get("/v2/version/verA", version_a).await;
        env.mock_get(
            "/v2/projects",
            serde_json::json!([project_json("AAA", "Mod A")]),
        )
        .await;
        env.mock_cdn("A.jar", &jar_a, 1).await;

        let content = import_content(serde_json::json!([
            {"source": "modrinth", "project_id": "AAA", "version_id": "verA"}
        ]))
        .await;

        let first = import_apply(&env.ctx, &content)
            .await
            .expect("первый импорт");
        assert_eq!(first[0].status, ModsetStatus::Installed);

        let second = import_apply(&env.ctx, &content)
            .await
            .expect("повторный импорт");
        assert_eq!(second[0].status, ModsetStatus::AlreadyInstalled);
    }

    #[tokio::test]
    async fn import_continues_after_failed_records() {
        let mut env = Env::acquire("modset_import_partial").await;
        let jar_a = b"mod a jar".to_vec();
        let version_a = env.version_json(
            "verA",
            "AAA",
            "1.0.0",
            "A.jar",
            &jar_a,
            serde_json::json!([]),
        );
        env.server
            .mock("GET", "/v2/project/gone-slug")
            .match_query(Matcher::Any)
            .with_status(404)
            .create_async()
            .await;
        env.mock_get("/v2/version/verA", version_a).await;
        env.mock_get(
            "/v2/projects",
            serde_json::json!([project_json("AAA", "Mod A")]),
        )
        .await;
        env.mock_cdn("A.jar", &jar_a, 1).await;

        let content = import_content(serde_json::json!([
            {"source": "modrinth", "slug": "gone-slug"},
            {"source": "modrinth", "project_id": "AAA", "version_id": "verA"}
        ]))
        .await;

        let entries = import_apply(&env.ctx, &content)
            .await
            .expect("импорт с частичным сбоем");

        assert_eq!(entries[0].status, ModsetStatus::Failed);
        assert!(
            entries[0]
                .message
                .as_deref()
                .is_some_and(|m| m.contains("gone-slug")),
            "причина сбоя должна попасть в отчёт: {:?}",
            entries[0].message
        );
        assert_eq!(entries[1].status, ModsetStatus::Installed);
        assert!(env.ctx.mods_dir.join("A.jar").exists());
        let manifest = load_manifest(&env.ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(manifest.mods.contains_key("AAA"));
        assert_eq!(manifest.mods.len(), 1);
    }

    #[tokio::test]
    async fn import_rejects_incompatible_pin_before_download() {
        let mut env = Env::acquire("modset_import_incompatible").await;
        let mut version_old = env.version_json(
            "verOld",
            "OLD",
            "0.5.0",
            "Old.jar",
            b"old jar",
            serde_json::json!([]),
        );
        version_old["game_versions"] = serde_json::json!(["1.20.1"]);
        let jar_a = b"mod a jar".to_vec();
        let version_a = env.version_json(
            "verA",
            "AAA",
            "1.0.0",
            "A.jar",
            &jar_a,
            serde_json::json!([]),
        );

        env.mock_get("/v2/version/verOld", version_old).await;
        env.mock_get("/v2/version/verA", version_a).await;
        env.mock_get(
            "/v2/projects",
            serde_json::json!([project_json("AAA", "Mod A")]),
        )
        .await;
        env.mock_cdn("A.jar", &jar_a, 1).await;

        let content = import_content(serde_json::json!([
            {"source": "modrinth", "project_id": "OLD", "version_id": "verOld"},
            {"source": "modrinth", "project_id": "AAA", "version_id": "verA"}
        ]))
        .await;

        let entries = import_apply(&env.ctx, &content)
            .await
            .expect("импорт с несовместимым пином");

        assert_eq!(entries[0].status, ModsetStatus::Failed);
        assert!(
            entries[0]
                .message
                .as_deref()
                .is_some_and(|m| m.contains("несовместима")),
            "причина должна называть несовместимость: {:?}",
            entries[0].message
        );
        assert!(!env.ctx.mods_dir.join("Old.jar").exists());
        assert_eq!(entries[1].status, ModsetStatus::Installed);
    }

    #[tokio::test]
    async fn import_does_not_touch_network_for_skipped_records() {
        let env = Env::acquire("modset_import_skipped_no_net").await;

        let content = import_content(serde_json::json!([
            {"source": "curseforge", "project_id": "AAA"},
            {"source": "modrinth", "project_id": "../../etc/passwd"}
        ]))
        .await;

        let entries = import_apply(&env.ctx, &content)
            .await
            .expect("отбракованные записи не ломают импорт");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].status, ModsetStatus::Skipped);
        assert_eq!(entries[1].status, ModsetStatus::Skipped);
        assert!(
            !env.ctx.mods_dir.exists(),
            "скачиваний быть не должно, каталог модов даже не создаётся"
        );
    }

    #[tokio::test]
    async fn import_counts_skipped_self_and_installed_dependency() {
        let mut env = Env::acquire("modset_import_dep_counts").await;
        let jar_a = b"mod a jar".to_vec();
        let jar_c = b"dep c jar".to_vec();
        let version_a = env.version_json(
            "verA",
            "AAA",
            "1.0.0",
            "A-1.0.0.jar",
            &jar_a,
            serde_json::json!([{"version_id": null, "project_id": "CCC", "file_name": null, "dependency_type": "required"}]),
        );
        let version_c = env.version_json(
            "verC",
            "CCC",
            "0.3.0",
            "C.jar",
            &jar_c,
            serde_json::json!([]),
        );

        env.mock_get("/v2/version/verA", version_a).await;
        env.mock_get("/v2/project/CCC/version", serde_json::json!([version_c]))
            .await;
        env.mock_get(
            "/v2/projects",
            serde_json::json!([project_json("AAA", "Mod A"), project_json("CCC", "Mod C")]),
        )
        .await;
        env.mock_cdn("C.jar", &jar_c, 1).await;

        env.seed_manifest(
            vec![(
                "AAA",
                manifest_entry(
                    "AAA",
                    None,
                    "A-1.0.0.jar",
                    &sha1_hex(&jar_a),
                    "verA",
                    "1.0.0",
                ),
            )],
            Vec::new(),
        )
        .await;
        env.write_mod("A-1.0.0.jar", &jar_a).await;

        let content = import_content(serde_json::json!([
            {"source": "modrinth", "project_id": "AAA", "version_id": "verA"}
        ]))
        .await;

        let entries = import_apply(&env.ctx, &content)
            .await
            .expect("импорт с уже стоящим модом");

        assert_eq!(entries[0].status, ModsetStatus::Installed);
        assert_eq!(
            entries[0].message.as_deref(),
            Some("Установлено 1, пропущено 1"),
            "сам мод уже стоял, докачана зависимость: {:?}",
            entries[0].message
        );
        assert!(env.ctx.mods_dir.join("C.jar").exists());
    }

    #[tokio::test]
    async fn import_retries_rate_limited_download() {
        let mut env = Env::acquire("modset_import_retry_429").await;
        let jar_a = b"mod a jar".to_vec();
        let version_a = env.version_json(
            "verA",
            "AAA",
            "1.0.0",
            "A.jar",
            &jar_a,
            serde_json::json!([]),
        );
        env.mock_get("/v2/version/verA", version_a).await;
        env.mock_get(
            "/v2/projects",
            serde_json::json!([project_json("AAA", "Mod A")]),
        )
        .await;
        let throttled = env
            .server
            .mock("GET", "/cdn/A.jar")
            .with_status(429)
            .expect(1)
            .create_async()
            .await;
        env.mock_cdn("A.jar", &jar_a, 1).await;

        let content = import_content(serde_json::json!([
            {"source": "modrinth", "project_id": "AAA", "version_id": "verA"}
        ]))
        .await;

        let entries = import_apply(&env.ctx, &content)
            .await
            .expect("429 должен ретраиться, а не валить импорт");

        throttled.assert_async().await;
        assert_eq!(entries[0].status, ModsetStatus::Installed);
        assert_eq!(
            std::fs::read(env.ctx.mods_dir.join("A.jar")).expect("jar после ретрая"),
            jar_a
        );
    }

    #[tokio::test]
    async fn export_includes_bound_records_without_network() {
        let env = Env::acquire("modset_export_bound").await;
        let jar_a = b"mod a jar".to_vec();
        env.seed_manifest(
            vec![(
                "AAA",
                manifest_entry(
                    "AAA",
                    Some("a-slug"),
                    "A.jar",
                    &sha1_hex(&jar_a),
                    "verA1",
                    "1.0.0",
                ),
            )],
            Vec::new(),
        )
        .await;
        env.write_mod("A.jar", &jar_a).await;

        let (mods, unresolved) = export_prepare(&env.ctx).await.expect("подготовка экспорта");

        assert_eq!(mods.len(), 1);
        let bound = &mods[0];
        assert_eq!(bound.source, MODSET_SOURCE);
        assert_eq!(bound.project_id.as_deref(), Some("AAA"));
        assert_eq!(bound.slug.as_deref(), Some("a-slug"));
        assert_eq!(bound.version_id.as_deref(), Some("verA1"));
        assert_eq!(bound.version_number.as_deref(), Some("1.0.0"));
        assert_eq!(bound.title.as_deref(), Some("Mod AAA"));
        assert_eq!(bound.filename.as_deref(), Some("A.jar"));
        assert!(unresolved.is_empty(), "{unresolved:?}");
    }

    #[tokio::test]
    async fn export_classifies_duplicate_and_unbound_files() {
        let mut env = Env::acquire("modset_export_unresolved").await;
        let jar_a = b"mod a jar".to_vec();
        let jar_dup = b"duplicate jar".to_vec();
        let jar_x = b"unknown jar".to_vec();
        env.seed_manifest(
            vec![(
                "AAA",
                manifest_entry("AAA", None, "A.jar", &sha1_hex(&jar_a), "verA1", "1.0.0"),
            )],
            vec![sha1_hex(&jar_dup)],
        )
        .await;
        env.write_mod("A.jar", &jar_a).await;
        env.write_mod("Dup.jar", &jar_dup).await;
        env.write_mod("Unknown.jar", &jar_x).await;
        env.server
            .mock("POST", "/v2/version_files")
            .match_query(Matcher::Any)
            .with_status(500)
            .create_async()
            .await;

        let (mods, unresolved) = export_prepare(&env.ctx)
            .await
            .expect("сбой привязки не роняет экспорт");

        assert_eq!(mods.len(), 1, "в файл попадает только привязанная запись");

        assert_eq!(unresolved.len(), 2, "{unresolved:?}");
        assert_eq!(unresolved[0].filename, "Dup.jar");
        assert!(
            unresolved[0].reason.contains("дублирует"),
            "{:?}",
            unresolved[0].reason
        );
        assert_eq!(unresolved[1].filename, "Unknown.jar");
        assert!(
            unresolved[1].reason.contains("привязать"),
            "{:?}",
            unresolved[1].reason
        );
    }
}
