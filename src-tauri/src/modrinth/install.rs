use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, Semaphore};

use crate::utils::errors::LauncherError;
use anyhow::{bail, Context, Result};

use super::client;
use super::structs::{ManifestEntry, ModrinthFile, ModrinthManifest, ModrinthVersion};
use crate::log_err;
use crate::log_info;
use crate::utils::backup_corrupt_file;
use crate::utils::download_file::{
    download_and_verify_with, download_file_limited, file_sha1, sha1_matches, write_atomic,
};
use crate::utils::env_info::is_safe_relative_path;
use crate::utils::semaphore::{semaphore_core, SemaphoreInfo, MAX_CONCURRENT_DOWNLOADS};

static MANIFEST_WRITE_LOCK: Mutex<()> = Mutex::const_new(());

static INSTALL_SEQ: AtomicU64 = AtomicU64::new(0);

const MAX_MOD_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

fn mod_download_limit(declared: u64) -> u64 {
    if declared == 0 {
        MAX_MOD_DOWNLOAD_BYTES
    } else {
        declared.min(MAX_MOD_DOWNLOAD_BYTES)
    }
}

fn ensure_safe_mod_url(url: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(url).map_err(|e| {
        LauncherError::Modrinth(format!("Некорректный URL файла мода {url:?}: {e}"))
    })?;
    if !parsed.username().is_empty() {
        bail!("URL файла мода не должен содержать учётные данные: {url}");
    }
    let https = parsed.scheme() == "https";
    let loopback = parsed
        .host_str()
        .is_some_and(|host| matches!(host, "127.0.0.1" | "::1" | "localhost"));
    if !(https || cfg!(test) && loopback) {
        bail!("URL файла мода должен использовать https: {url}");
    }
    Ok(())
}

pub struct InstallContext {
    pub loaders: Vec<String>,
    pub game_versions: Vec<String>,
    pub mods_dir: PathBuf,
    pub manifest_path: PathBuf,
}

#[derive(Debug)]
pub struct InstallReport {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
}

pub async fn load_manifest(path: &Path) -> Result<ModrinthManifest> {
    let content = match tokio::fs::read_to_string(path).await {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ModrinthManifest::default())
        }
        Err(e) => {
            return Err(e).with_context(|| format!("Не удалось прочитать манифест модов {path:?}"))
        }
    };
    match serde_json::from_str(&content) {
        Ok(manifest) => Ok(manifest),
        Err(e) => {
            let error =
                anyhow::Error::new(e).context(format!("Некорректный манифест модов {path:?}"));
            backup_corrupt_file(path, "json.bak", &error)?;
            Ok(ModrinthManifest::default())
        }
    }
}

pub async fn save_manifest(path: &Path, manifest: &ModrinthManifest) -> Result<()> {
    let content = serde_json::to_vec_pretty(manifest).map_err(|e| {
        LauncherError::Modrinth(format!("Не удалось сериализовать манифест модов: {e:#}"))
    })?;
    write_atomic(path, &content).await.map_err(|e| {
        LauncherError::Modrinth(format!(
            "Не удалось сохранить манифест модов {path:?}: {e:#}"
        ))
        .into()
    })
}

pub async fn install_project(
    ctx: &InstallContext,
    project_id: &str,
    version_id: Option<&str>,
) -> Result<InstallReport> {
    let mut visited: HashSet<String> = HashSet::new();
    let mut resolved: Vec<ModrinthVersion> = Vec::new();

    log_info!(
        "[modrinth] Установка мода {}: version_id={:?}, loaders={:?}, game_versions={:?}",
        project_id,
        version_id,
        ctx.loaders,
        ctx.game_versions
    );
    let installed_manifest = load_manifest(&ctx.manifest_path).await?;
    resolve_project(
        ctx,
        project_id,
        version_id,
        &mut visited,
        &mut resolved,
        &installed_manifest,
    )
    .await?;

    tokio::fs::create_dir_all(&ctx.mods_dir)
        .await
        .map_err(|e| {
            LauncherError::Modrinth(format!(
                "Не удалось создать директорию модов {:?}: {e:#}",
                ctx.mods_dir
            ))
        })?;

    let mut report = InstallReport {
        installed: Vec::new(),
        skipped: Vec::new(),
    };
    let mut installed_entries: Vec<ManifestEntry> = Vec::new();
    let mut pending: Vec<PendingModFile> = Vec::new();

    let project_ids: Vec<String> = resolved
        .iter()
        .map(|version| version.project_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let display_info = fetch_project_display_info(&project_ids).await;

    for version in &resolved {
        let file = primary_file(version)?;
        let sha1 = file.hashes.get("sha1").cloned().ok_or_else(|| {
            LauncherError::Modrinth(format!(
                "Файл версии {} без SHA1-хеша",
                version.version_number
            ))
        })?;

        if !is_safe_relative_path(&file.filename) {
            return Err(LauncherError::InvalidModFilename(file.filename.clone()).into());
        }

        let (title, icon_url, slug) = display_info
            .get(&version.project_id)
            .cloned()
            .unwrap_or_else(|| (version.name.clone(), None, None));

        let entry = ManifestEntry {
            project_id: version.project_id.clone(),
            slug,
            title,
            icon_url,
            filename: file.filename.clone(),
            sha1,
            version_id: version.id.clone(),
            version_number: version.version_number.clone(),
        };
        let dest = ctx.mods_dir.join(&entry.filename);

        if sha1_matches(&dest, &entry.sha1).await {
            log_info!(
                "[modrinth] Уже установлен: {} ({})",
                entry.filename,
                entry.version_number
            );
            report.skipped.push(entry.filename.clone());
        } else {
            ensure_safe_mod_url(&file.url)?;
            pending.push(PendingModFile {
                entry: entry.clone(),
                url: file.url.clone(),
                max_bytes: mod_download_limit(file.size),
            });
        }
        installed_entries.push(entry);
    }

    let install_seq = INSTALL_SEQ.fetch_add(1, Ordering::Relaxed);
    let staged = download_mod_files(ctx, &pending, install_seq).await?;

    if let Err(error) = commit_install(ctx, &installed_entries, &staged).await {
        remove_staged_files(&staged).await;
        return Err(error);
    }

    for file in &staged {
        log_info!(
            "[modrinth] Установлен: {} ({})",
            file.entry.filename,
            file.entry.version_number
        );
        report.installed.push(file.entry.filename.clone());
    }
    Ok(report)
}

struct StagedModFile {
    entry: ManifestEntry,
    staged: PathBuf,
}

async fn commit_install(
    ctx: &InstallContext,
    entries: &[ManifestEntry],
    staged: &[StagedModFile],
) -> Result<()> {
    let _write_guard = MANIFEST_WRITE_LOCK.lock().await;
    let mut manifest = load_manifest(&ctx.manifest_path).await?;

    let mut displaced: Vec<String> = Vec::new();
    for entry in entries {
        if let Some(previous) = manifest.mods.get(&entry.project_id) {
            if previous.filename != entry.filename {
                displaced.push(previous.filename.clone());
            }
        }
    }
    displaced.sort();
    displaced.dedup();

    let previous_entries: HashMap<String, Option<ManifestEntry>> = entries
        .iter()
        .map(|entry| {
            (
                entry.project_id.clone(),
                manifest.mods.get(&entry.project_id).cloned(),
            )
        })
        .collect();

    for entry in entries {
        manifest
            .mods
            .insert(entry.project_id.clone(), entry.clone());
    }
    save_manifest(&ctx.manifest_path, &manifest).await?;

    for (index, file) in staged.iter().enumerate() {
        let dest = ctx.mods_dir.join(&file.entry.filename);
        if let Err(e) = tokio::fs::rename(&file.staged, &dest).await {
            let error = LauncherError::Modrinth(format!(
                "Не удалось переместить скачанный мод {:?} в {dest:?}: {e:#}",
                file.staged
            ));
            log_info!(
                "[modrinth] Записи манифеста с несостоявшимся перемещением откатываются к состоянию до установки"
            );
            rollback_manifest_entries(&mut manifest, &previous_entries, &staged[index..]);
            if let Err(save_error) = save_manifest(&ctx.manifest_path, &manifest).await {
                log_err!(
                    "[modrinth] Не удалось откатить манифест модов после сбоя перемещения: {save_error:#}"
                );
            }
            return Err(error.into());
        }
    }

    for filename in &displaced {
        remove_mod_file_if_untracked(&ctx.mods_dir, &manifest, filename).await;
    }
    Ok(())
}

fn rollback_manifest_entries(
    manifest: &mut ModrinthManifest,
    previous: &HashMap<String, Option<ManifestEntry>>,
    failed: &[StagedModFile],
) {
    for file in failed {
        match previous.get(&file.entry.project_id) {
            Some(Some(entry)) => {
                manifest
                    .mods
                    .insert(file.entry.project_id.clone(), entry.clone());
            }
            _ => {
                manifest.mods.remove(&file.entry.project_id);
            }
        }
    }
}

struct PendingModFile {
    entry: ManifestEntry,
    url: String,
    max_bytes: u64,
}

async fn download_mod_files(
    ctx: &InstallContext,
    pending: &[PendingModFile],
    install_seq: u64,
) -> Result<Vec<StagedModFile>> {
    if pending.is_empty() {
        return Ok(Vec::new());
    }

    let staged: Vec<StagedModFile> = pending
        .iter()
        .enumerate()
        .map(|(index, file)| StagedModFile {
            entry: file.entry.clone(),
            staged: ctx.mods_dir.join(staged_mod_filename(
                &file.entry.filename,
                install_seq,
                index,
            )),
        })
        .collect();

    let mut file_data: HashMap<PathBuf, (String, u64)> = HashMap::new();
    let mut list: Vec<SemaphoreInfo> = Vec::new();
    for (file, staged_file) in pending.iter().zip(&staged) {
        file_data.insert(
            staged_file.staged.clone(),
            (file.entry.sha1.clone(), file.max_bytes),
        );
        list.push(SemaphoreInfo {
            url: file.url.clone(),
            dest: staged_file
                .staged
                .file_name()
                .map(PathBuf::from)
                .ok_or_else(|| {
                    LauncherError::Modrinth(format!(
                        "Некорректное staging-имя для файла мода {}",
                        file.entry.filename
                    ))
                })?,
        });
    }
    let file_data = Arc::new(file_data);

    let futures = semaphore_core(
        ctx.mods_dir.clone(),
        list,
        move |url, dest| {
            let file_data = Arc::clone(&file_data);
            async move {
                let (expected, max_bytes) = file_data.get(&dest).cloned().ok_or_else(|| {
                    LauncherError::Modrinth(format!("Нет данных проверки для файла мода {dest:?}"))
                })?;
                download_and_verify_with(
                    &dest,
                    Some(expected.as_str()),
                    false,
                    move |path| async move {
                        download_file_limited(&url, &path, Some(max_bytes)).await
                    },
                )
                .await
                .map(|_| ())
            }
        },
        None::<fn(&str)>,
    );
    let results = futures::future::join_all(futures).await;

    let mut first_error: Option<anyhow::Error> = None;
    for (file, result) in pending.iter().zip(results) {
        if let Err(e) = result {
            log_err!(
                "[modrinth] Файл мода {} не скачан: {:?}",
                file.entry.filename,
                e
            );
            if first_error.is_none() {
                first_error = Some(e);
            }
        }
    }

    if let Some(error) = first_error {
        remove_staged_files(&staged).await;
        return Err(error);
    }
    Ok(staged)
}

fn staged_mod_filename(filename: &str, install_seq: u64, index: usize) -> String {
    format!(
        "{filename}.{}.{}.{}.part",
        std::process::id(),
        install_seq,
        index
    )
}

async fn remove_staged_files(staged: &[StagedModFile]) {
    for file in staged {
        match tokio::fs::remove_file(&file.staged).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log_err!(
                "[modrinth] Не удалось удалить временный файл мода {:?}: {e}",
                file.staged
            ),
        }
    }
}

#[derive(Debug, Clone)]
struct DependencyRef {
    project_id: Option<String>,
    version_id: Option<String>,
}

async fn resolve_project(
    ctx: &InstallContext,
    project_id: &str,
    pinned_version_id: Option<&str>,
    visited: &mut HashSet<String>,
    resolved: &mut Vec<ModrinthVersion>,
    installed: &ModrinthManifest,
) -> Result<()> {
    let version = match pinned_version_id {
        Some(version_id) => resolve_pinned_version(ctx, project_id, version_id).await?,
        None => resolve_latest_version(ctx, project_id).await?,
    };
    log_info!(
        "[modrinth] Выбрана версия {} ({}) для проекта {}",
        version.version_number,
        version.id,
        project_id
    );
    ensure_no_incompatible_dependencies(&version, installed).await?;
    visited.insert(project_id.to_string());
    resolved.push(version.clone());

    let mut wave: Vec<DependencyRef> = required_dependencies(&version);
    while !wave.is_empty() {
        wave = resolve_dependency_wave(ctx, wave, visited, resolved, installed).await?;
    }
    Ok(())
}

fn required_dependencies(version: &ModrinthVersion) -> Vec<DependencyRef> {
    version
        .dependencies
        .iter()
        .filter(|dependency| dependency.dependency_type == "required")
        .filter(|dependency| dependency.project_id.is_some() || dependency.version_id.is_some())
        .map(|dependency| DependencyRef {
            project_id: dependency.project_id.clone(),
            version_id: dependency.version_id.clone(),
        })
        .collect()
}

async fn ensure_no_incompatible_dependencies(
    version: &ModrinthVersion,
    installed: &ModrinthManifest,
) -> Result<()> {
    for dependency in &version.dependencies {
        if dependency.dependency_type != "incompatible" {
            continue;
        }
        let Some(project_id) = dependency.project_id.as_deref() else {
            log_info!(
                "[modrinth] Зависимость типа incompatible версии {} без project_id не может быть проверена",
                version.version_number
            );
            continue;
        };
        let Some(entry) = installed.mods.get(project_id) else {
            continue;
        };
        return Err(LauncherError::Modrinth(format!(
            "Мод {} несовместим с установленным {} {}: установка отменена",
            version.version_number, entry.title, entry.version_number
        ))
        .into());
    }
    Ok(())
}

async fn resolve_dependency_wave(
    ctx: &InstallContext,
    wave: Vec<DependencyRef>,
    visited: &mut HashSet<String>,
    resolved: &mut Vec<ModrinthVersion>,
    installed: &ModrinthManifest,
) -> Result<Vec<DependencyRef>> {
    let mut planned: Vec<DependencyRef> = Vec::new();
    let mut planned_ids: HashSet<String> = HashSet::new();
    for dependency in wave {
        let Some(project_id) = dependency.project_id.as_ref() else {
            planned.push(dependency);
            continue;
        };
        if !planned_ids.insert(project_id.clone()) {
            continue;
        }
        if visited.contains(project_id) {
            continue;
        }
        planned.push(dependency);
    }
    if planned.is_empty() {
        return Ok(Vec::new());
    }

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let futures = planned.into_iter().map(|dependency| {
        let semaphore = Arc::clone(&semaphore);
        async move {
            let _permit = semaphore.acquire_owned().await.map_err(|_| {
                LauncherError::Modrinth("Семафор резолва зависимостей закрыт".to_string())
            })?;
            resolve_dependency(ctx, &dependency, installed).await
        }
    });
    let results = futures::future::join_all(futures).await;

    let mut next_wave: Vec<DependencyRef> = Vec::new();
    for result in results {
        let version = result?;
        if !visited.insert(version.project_id.clone()) {
            continue;
        }
        ensure_no_incompatible_dependencies(&version, installed).await?;
        log_info!(
            "[modrinth] Зависимость {}: версия {} ({})",
            version.project_id,
            version.version_number,
            version.id
        );
        resolved.push(version.clone());
        next_wave.extend(required_dependencies(&version));
    }
    Ok(next_wave)
}

async fn resolve_dependency(
    ctx: &InstallContext,
    dependency: &DependencyRef,
    installed: &ModrinthManifest,
) -> Result<ModrinthVersion> {
    let Some(version_id) = &dependency.version_id else {
        return resolve_unpinned_dependency(ctx, dependency, installed).await;
    };

    let version = client::get_version(version_id).await.map_err(|e| {
        LauncherError::Modrinth(format!(
            "Не удалось получить версию {version_id} зависимости мода: {e:#}"
        ))
    })?;
    if let Some(project_id) = &dependency.project_id {
        if version.project_id != *project_id {
            return Err(LauncherError::Modrinth(format!(
                "Версия {version_id} зависимости принадлежит моду {}, а не {project_id}",
                version.project_id
            ))
            .into());
        }
    }
    if let Err(error) = ensure_version_compatible(ctx, &version) {
        log_info!(
            "[modrinth] Закреплённая версия {version_id} зависимости {} несовместима с профилем, выбирается свежий релиз: {error:#}",
            version.project_id
        );
        return resolve_latest_version(ctx, &version.project_id).await;
    }
    Ok(version)
}

async fn resolve_unpinned_dependency(
    ctx: &InstallContext,
    dependency: &DependencyRef,
    installed: &ModrinthManifest,
) -> Result<ModrinthVersion> {
    let project_id = dependency.project_id.as_deref().ok_or_else(|| {
        LauncherError::Modrinth("Зависимость мода без project_id и version_id".to_string())
    })?;
    let Some(entry) = installed.mods.get(project_id) else {
        log_info!("[modrinth] Зависимость {project_id}: не установлена, ставится свежий релиз");
        return resolve_latest_version(ctx, project_id).await;
    };
    let installed_version = match client::get_version(&entry.version_id).await {
        Ok(version) if version.project_id == *project_id => version,
        Ok(version) => {
            log_info!(
                "[modrinth] Зависимость {project_id}: версия {} из манифеста принадлежит моду {}, ставится свежий релиз",
                entry.version_id,
                version.project_id
            );
            return resolve_latest_version(ctx, project_id).await;
        }
        Err(e) => {
            log_info!(
                "[modrinth] Зависимость {project_id}: установленная версия {} недоступна ({e:#}), ставится свежий релиз",
                entry.version_id
            );
            return resolve_latest_version(ctx, project_id).await;
        }
    };
    if let Err(error) = ensure_version_compatible(ctx, &installed_version) {
        log_info!(
            "[modrinth] Зависимость {project_id}: установленная версия {} несовместима с профилем ({error:#}), ставится свежий релиз",
            entry.version_number
        );
        return resolve_latest_version(ctx, project_id).await;
    }
    log_info!(
        "[modrinth] Зависимость {project_id}: оставлена установленная версия {} ({})",
        entry.version_number,
        entry.version_id
    );
    Ok(installed_version)
}

async fn resolve_latest_version(ctx: &InstallContext, project_id: &str) -> Result<ModrinthVersion> {
    let versions = client::get_project_versions(project_id, &ctx.loaders, &ctx.game_versions)
        .await
        .map_err(|e| {
            LauncherError::Modrinth(format!(
                "Не удалось получить версии мода {project_id}: {e:#}"
            ))
        })?;
    let version = pick_version(&versions).ok_or_else(|| {
        LauncherError::Modrinth(format!(
            "Для Minecraft {} и лоадера {:?} не найдено совместимых версий мода {}",
            ctx.game_versions.join(", "),
            ctx.loaders,
            project_id
        ))
    })?;
    Ok(version.clone())
}

async fn resolve_pinned_version(
    ctx: &InstallContext,
    project_id: &str,
    version_id: &str,
) -> Result<ModrinthVersion> {
    let version = client::get_version(version_id).await.map_err(|e| {
        LauncherError::Modrinth(format!(
            "Не удалось получить версию {version_id} мода {project_id}: {e:#}"
        ))
    })?;
    if version.project_id != project_id {
        return Err(LauncherError::Modrinth(format!(
            "Версия {version_id} принадлежит моду {}, а не {project_id}",
            version.project_id
        ))
        .into());
    }
    ensure_version_compatible(ctx, &version)?;
    Ok(version)
}

fn ensure_version_compatible(ctx: &InstallContext, version: &ModrinthVersion) -> Result<()> {
    let game_version_ok = ctx
        .game_versions
        .iter()
        .any(|gv| version.game_versions.contains(gv));
    let loader_ok = ctx.loaders.iter().any(|l| version.loaders.contains(l));
    if game_version_ok && loader_ok {
        return Ok(());
    }
    Err(LauncherError::Modrinth(format!(
        "Версия {} мода {} несовместима с Minecraft {} или лоадером {:?}",
        version.version_number,
        version.project_id,
        ctx.game_versions.join(", "),
        ctx.loaders
    ))
    .into())
}

type ProjectDisplayInfo = HashMap<String, (String, Option<String>, Option<String>)>;

async fn fetch_project_display_info(project_ids: &[String]) -> ProjectDisplayInfo {
    if project_ids.is_empty() {
        return HashMap::new();
    }
    match client::get_projects(project_ids).await {
        Ok(list) => list
            .into_iter()
            .map(|project| {
                (
                    project.id.clone(),
                    (
                        project.title.clone(),
                        project.icon_url.clone(),
                        project.slug,
                    ),
                )
            })
            .collect(),
        Err(e) => {
            log_err!(
                "[modrinth] Не удалось получить информацию проектов ({:?}): {}, будут использованы имена версий",
                project_ids,
                e
            );
            HashMap::new()
        }
    }
}

pub fn pick_version(versions: &[ModrinthVersion]) -> Option<&ModrinthVersion> {
    versions
        .iter()
        .filter(|v| v.version_type == "release")
        .max_by(|a, b| compare_version_recency(a, b))
        .or_else(|| versions.iter().max_by(|a, b| compare_version_recency(a, b)))
}

fn compare_version_recency(a: &ModrinthVersion, b: &ModrinthVersion) -> std::cmp::Ordering {
    a.date_published
        .cmp(&b.date_published)
        .then_with(|| a.id.cmp(&b.id))
}

fn primary_file(version: &ModrinthVersion) -> Result<&ModrinthFile> {
    version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| {
            LauncherError::Modrinth(format!("Версия {} без файлов", version.version_number)).into()
        })
}

async fn remove_mod_file_if_untracked(
    mods_dir: &Path,
    manifest: &ModrinthManifest,
    filename: &str,
) {
    if manifest
        .mods
        .values()
        .any(|entry| entry.filename == filename)
    {
        log_info!(
            "[modrinth] Файл {} остаётся: он используется другим модулем",
            filename
        );
        return;
    }
    if !is_safe_relative_path(filename) {
        log_err!(
            "[modrinth] Имя удаляемого файла мода небезопасно, удаление пропущено: {}",
            filename
        );
        return;
    }

    let dest = mods_dir.join(filename);
    if !dest.exists() {
        return;
    }
    match tokio::fs::remove_file(&dest).await {
        Ok(()) => log_info!("[modrinth] Удалён файл мода: {}", filename),
        Err(e) => log_err!("[modrinth] Не удалось удалить файл мода {dest:?}: {e}"),
    }
}

pub async fn uninstall_project(ctx: &InstallContext, project_id: &str) -> Result<()> {
    let _write_guard = MANIFEST_WRITE_LOCK.lock().await;
    let mut manifest = load_manifest(&ctx.manifest_path).await?;
    let entry = manifest.mods.remove(project_id).ok_or_else(|| {
        LauncherError::Modrinth(format!("Мод {project_id} не установлен через Modrinth"))
    })?;

    if !is_safe_relative_path(&entry.filename) {
        return Err(LauncherError::InvalidModFilename(entry.filename.clone()).into());
    }

    save_manifest(&ctx.manifest_path, &manifest).await?;
    remove_mod_file_if_untracked(&ctx.mods_dir, &manifest, &entry.filename).await;
    log_info!(
        "[modrinth] Удалён мод: {} ({})",
        entry.title,
        entry.version_number
    );
    Ok(())
}

#[derive(Debug)]
pub struct UpdateCheck {
    pub project_id: String,
    pub current_version: String,
    pub available_version: Option<String>,
}

pub async fn check_updates(ctx: &InstallContext) -> Result<Vec<UpdateCheck>> {
    let manifest = load_manifest(&ctx.manifest_path).await?;
    if manifest.mods.is_empty() {
        return Ok(Vec::new());
    }

    let entries: Vec<&ManifestEntry> = manifest.mods.values().collect();
    let hashes: Vec<String> = entries.iter().map(|entry| entry.sha1.clone()).collect();
    let latest = client::get_version_updates_from_hashes(&hashes, &ctx.loaders, &ctx.game_versions)
        .await
        .map_err(|e| {
            LauncherError::Modrinth(format!("Не удалось проверить обновления модов: {e:#}"))
        })?;

    let mut result = Vec::new();
    for entry in entries {
        let Some(version) = latest.get(&entry.sha1) else {
            log_info!(
                "[modrinth] Файл {} не распознан Modrinth, обновления для него недоступны",
                entry.filename
            );
            result.push(UpdateCheck {
                project_id: entry.project_id.clone(),
                current_version: entry.version_number.clone(),
                available_version: None,
            });
            continue;
        };
        let available = (version.id != entry.version_id && version.version_type == "release")
            .then(|| version.version_number.clone());
        result.push(UpdateCheck {
            project_id: entry.project_id.clone(),
            current_version: entry.version_number.clone(),
            available_version: available,
        });
    }
    Ok(result)
}

async fn collect_installed_hashes(mods_dir: &Path) -> Result<HashMap<String, String>> {
    let mut local_hashes: HashMap<String, String> = HashMap::new();

    let mut entries = match tokio::fs::read_dir(mods_dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(local_hashes),
        Err(e) => {
            return Err(e).with_context(|| format!("Не удалось прочитать папку модов {mods_dir:?}"))
        }
    };

    loop {
        let entry = entries
            .next_entry()
            .await
            .with_context(|| format!("Не удалось прочитать запись в папке модов {mods_dir:?}"))?;
        let Some(entry) = entry else {
            break;
        };

        if !entry
            .file_type()
            .await
            .map(|t| t.is_file())
            .unwrap_or(false)
        {
            continue;
        }
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "part") {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        match file_sha1(&path).await {
            Ok(hash) => {
                local_hashes.insert(filename, hash);
            }
            Err(e) => {
                log_err!("[modrinth] Не удалось вычислить хеш {:?}: {}", path, e);
            }
        }
    }

    Ok(local_hashes)
}

pub async fn sync_installed_from_scan(ctx: &InstallContext) -> Result<ModrinthManifest> {
    sync_installed_from_scan_full(ctx)
        .await
        .map(|(manifest, _)| manifest)
}

pub async fn sync_installed_from_scan_full(
    ctx: &InstallContext,
) -> Result<(ModrinthManifest, HashMap<String, String>)> {
    let _write_guard = MANIFEST_WRITE_LOCK.lock().await;
    let local_hashes = collect_installed_hashes(&ctx.mods_dir).await?;
    sync_locked(ctx, local_hashes).await
}

#[cfg(test)]
pub async fn sync_installed_from_hashes(
    ctx: &InstallContext,
    local_hashes: HashMap<String, String>,
) -> Result<ModrinthManifest> {
    let _write_guard = MANIFEST_WRITE_LOCK.lock().await;
    sync_locked(ctx, local_hashes)
        .await
        .map(|(manifest, _)| manifest)
}

async fn sync_locked(
    ctx: &InstallContext,
    local_hashes: HashMap<String, String>,
) -> Result<(ModrinthManifest, HashMap<String, String>)> {
    let mut manifest = load_manifest(&ctx.manifest_path).await?;
    let mut changed = false;

    manifest.mods.retain(|_, entry| {
        let present = local_hashes.values().any(|h| *h == entry.sha1);
        if !present {
            if local_hashes.contains_key(&entry.filename) {
                log_err!(
                    "[modrinth] Содержимое файла {} отличается от манифеста ({}), запись удаляется",
                    entry.filename,
                    entry.version_number
                );
            } else {
                log_info!(
                    "[modrinth] Файл манифеста отсутствует в mods: {} ({})",
                    entry.filename,
                    entry.version_number
                );
            }
            changed = true;
        }
        present
    });

    let foreign_hashes: Vec<String> = local_hashes
        .values()
        .filter(|h| !manifest.mods.values().any(|e| &e.sha1 == *h))
        .filter(|h| !manifest.known_hashes.iter().any(|known| known == *h))
        .cloned()
        .collect();

    if !foreign_hashes.is_empty() {
        match client::get_versions_from_hashes(&foreign_hashes, &ctx.loaders, &ctx.game_versions)
            .await
        {
            Ok(found) => {
                let missing_projects: Vec<String> = found
                    .values()
                    .map(|v| v.project_id.clone())
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .filter(|id| !manifest.mods.contains_key(id))
                    .collect();
                let projects = fetch_project_display_info(&missing_projects).await;
                let hash_to_filename: HashMap<&str, &str> = local_hashes
                    .iter()
                    .map(|(filename, hash)| (hash.as_str(), filename.as_str()))
                    .collect();

                for (hash, version) in &found {
                    let Some(filename) = hash_to_filename.get(hash.as_str()) else {
                        continue;
                    };
                    let project_id = version.project_id.clone();
                    if manifest.mods.contains_key(&project_id) {
                        if !manifest.known_hashes.iter().any(|known| known == hash) {
                            manifest.known_hashes.push(hash.clone());
                            changed = true;
                        }
                        continue;
                    }
                    let (title, icon_url, _) = projects
                        .get(&project_id)
                        .cloned()
                        .unwrap_or_else(|| (version.name.clone(), None, None));
                    log_info!(
                        "[modrinth] Обнаружен мод Modrinth по хешу: {} ({})",
                        filename,
                        version.version_number
                    );
                    changed = true;
                    manifest.mods.insert(
                        project_id.clone(),
                        ManifestEntry {
                            project_id,
                            slug: None,
                            title,
                            icon_url,
                            filename: (*filename).to_string(),
                            sha1: hash.clone(),
                            version_id: version.id.clone(),
                            version_number: version.version_number.clone(),
                        },
                    );
                }
            }
            Err(e) => {
                log_err!("[modrinth] Не удалось определить моды по хешам: {}", e);
            }
        }
    }

    let known_before = manifest.known_hashes.len();
    manifest
        .known_hashes
        .retain(|known| local_hashes.values().any(|h| h == known));
    if manifest.known_hashes.len() != known_before {
        changed = true;
    }

    if changed {
        save_manifest(&ctx.manifest_path, &manifest).await?;
    }
    Ok((manifest, local_hashes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modrinth::client::{clear_response_cache_for_tests, override_api_base_for_tests};
    use crate::test_support::{part_files_in, sha1_hex, LauncherDirGuard};
    use mockito::{Matcher, Mock, Server, ServerGuard};
    use serde_json::json;

    struct ModrinthEnv {
        dir: LauncherDirGuard,
        server: ServerGuard,
    }

    impl ModrinthEnv {
        async fn acquire(label: &str) -> Self {
            let dir = LauncherDirGuard::acquire(label).await;
            let server = Server::new_async().await;
            override_api_base_for_tests(format!("{}/v2", server.url()));
            clear_response_cache_for_tests();
            Self { dir, server }
        }

        fn project_dir(&self) -> PathBuf {
            self.dir.project_dir("Test")
        }

        fn install_ctx(&self) -> InstallContext {
            let project_dir = self.project_dir();
            InstallContext {
                loaders: vec!["fabric".to_string()],
                game_versions: vec!["1.21.1".to_string()],
                mods_dir: project_dir.join("mods"),
                manifest_path: project_dir.join("modrinth.json"),
            }
        }
    }

    fn version_json(
        id: &str,
        project_id: &str,
        version_number: &str,
        url: String,
        sha1: String,
        size: u64,
        deps: serde_json::Value,
    ) -> serde_json::Value {
        json!({
            "id": id,
            "project_id": project_id,
            "name": format!("Mod {}", project_id),
            "version_number": version_number,
            "dependencies": deps,
            "game_versions": ["1.21.1"],
            "loaders": ["fabric"],
            "version_type": "release",
            "files": [{
                "hashes": {"sha1": sha1},
                "url": url,
                "filename": format!("{}.jar", project_id),
                "primary": true,
                "size": size,
                "file_type": null
            }]
        })
    }

    fn project_json(id: &str, title: &str) -> serde_json::Value {
        json!({"id": id, "project_type": "mod", "title": title})
    }

    async fn mock_version_list(env: &mut ModrinthEnv, version: serde_json::Value) {
        mock_project_versions(env, "A", &[version]).await;
        mock_projects_list(env, &[("A", "Mod A")]).await;
    }

    async fn mock_project_versions(
        env: &mut ModrinthEnv,
        project_id: &str,
        versions: &[serde_json::Value],
    ) -> Mock {
        env.server
            .mock("GET", format!("/v2/project/{project_id}/version").as_str())
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!(versions).to_string())
            .create_async()
            .await
    }

    async fn mock_projects_list(env: &mut ModrinthEnv, projects: &[(&str, &str)]) -> Mock {
        env.server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(
                json!(projects
                    .iter()
                    .map(|(id, title)| project_json(id, title))
                    .collect::<Vec<_>>())
                .to_string(),
            )
            .create_async()
            .await
    }

    async fn mock_single_version(
        env: &mut ModrinthEnv,
        version_id: &str,
        version: &serde_json::Value,
    ) -> Mock {
        env.server
            .mock("GET", format!("/v2/version/{version_id}").as_str())
            .with_status(200)
            .with_body(version.to_string())
            .create_async()
            .await
    }

    async fn mock_cdn_jar(env: &mut ModrinthEnv, path: &str, body: &[u8]) -> Mock {
        env.server
            .mock("GET", path)
            .with_status(200)
            .with_body(body)
            .create_async()
            .await
    }

    async fn mock_pinned_dependency_env(
        env: &mut ModrinthEnv,
        version_a: serde_json::Value,
        pinned_id: &str,
        pinned_version: &serde_json::Value,
        jar_b2: &[u8],
        jar_a: &[u8],
    ) {
        let version_b2 = with_filename(
            jar_version(env, "verB2", "B", "2.0.0", "b-2.0.0.jar", jar_b2, json!([])),
            "B-2.0.0.jar",
        );
        mock_project_versions(env, "A", &[version_a]).await;
        mock_single_version(env, pinned_id, pinned_version).await;
        mock_project_versions(env, "B", &[version_b2]).await;
        mock_projects_list(env, &[("A", "Mod A"), ("B", "Mod B")]).await;
        mock_cdn_jar(env, "/cdn/a.jar", jar_a).await;
    }

    async fn install_first_version(
        env: &mut ModrinthEnv,
        version: serde_json::Value,
        jar: &[u8],
    ) -> InstallContext {
        mock_version_env(env, version, jar).await;
        let ctx = env.install_ctx();
        install_project(&ctx, "A", None)
            .await
            .expect("первая установка мода");
        ctx
    }

    fn jar_version(
        env: &ModrinthEnv,
        id: &str,
        project_id: &str,
        version_number: &str,
        jar_name: &str,
        jar: &[u8],
        deps: serde_json::Value,
    ) -> serde_json::Value {
        version_json(
            id,
            project_id,
            version_number,
            format!("{}/cdn/{jar_name}", env.server.url()),
            sha1_hex(jar),
            jar.len() as u64,
            deps,
        )
    }

    fn with_filename(version: serde_json::Value, filename: &str) -> serde_json::Value {
        let mut version = version;
        version["files"][0]["filename"] = json!(filename);
        version
    }

    fn required_dep(project_id: &str, version_id: Option<&str>) -> serde_json::Value {
        json!([{
            "version_id": version_id,
            "project_id": project_id,
            "file_name": null,
            "dependency_type": "required"
        }])
    }

    async fn mock_install_env(
        env: &mut ModrinthEnv,
        version: serde_json::Value,
        jar_body: &[u8],
        cdn_expect: usize,
    ) {
        let url = version["files"][0]["url"].as_str().unwrap().to_string();
        let path = url
            .strip_prefix(env.server.url().as_str())
            .unwrap()
            .to_string();
        mock_version_list(env, version).await;
        env.server
            .mock("GET", path.as_str())
            .with_status(200)
            .with_body(jar_body)
            .expect(cdn_expect)
            .create_async()
            .await;
    }

    fn parsed_version(value: serde_json::Value) -> ModrinthVersion {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn pick_version_prefers_release_over_beta() {
        let beta = parsed_version(
            json!({"id": "beta", "project_id": "A", "version_number": "0.9", "version_type": "beta", "dependencies": [], "files": []}),
        );
        let release = parsed_version(
            json!({"id": "release", "project_id": "A", "version_number": "1.0", "version_type": "release", "dependencies": [], "files": []}),
        );
        assert_eq!(pick_version(&[beta, release]).unwrap().id, "release");
    }

    #[test]
    fn pick_version_picks_newest_release_regardless_of_response_order() {
        let release_old = parsed_version(json!({
            "id": "verOld", "project_id": "A", "version_number": "1.0.0",
            "version_type": "release", "dependencies": [], "files": [],
            "date_published": "2023-06-01T00:00:00Z"
        }));
        let release_new = parsed_version(json!({
            "id": "verNew", "project_id": "A", "version_number": "2.0.0",
            "version_type": "release", "dependencies": [], "files": [],
            "date_published": "2025-06-01T00:00:00Z"
        }));
        let beta_newer = parsed_version(json!({
            "id": "verBeta", "project_id": "A", "version_number": "2.1.0-beta",
            "version_type": "beta", "dependencies": [], "files": [],
            "date_published": "2025-12-01T00:00:00Z"
        }));

        assert_eq!(
            pick_version(&[release_old.clone(), release_new.clone(), beta_newer.clone()])
                .unwrap()
                .id,
            "verNew",
            "свежий релиз выбирается по date_published, более новая beta не выигрывает"
        );
        assert_eq!(
            pick_version(&[beta_newer.clone(), release_new.clone(), release_old.clone()])
                .unwrap()
                .id,
            "verNew",
            "порядок ответа API не влияет на выбор"
        );

        let no_date = parsed_version(json!({
            "id": "verNoDate", "project_id": "A", "version_number": "3.0.0",
            "version_type": "release", "dependencies": [], "files": []
        }));
        assert_eq!(
            pick_version(&[release_new.clone(), no_date]).unwrap().id,
            "verNew",
            "версия без date_published не должна выигрывать у датированной"
        );

        let beta_a = parsed_version(json!({
            "id": "verBetaA", "project_id": "A", "version_number": "0.9.0",
            "version_type": "beta", "dependencies": [], "files": [],
            "date_published": "2024-01-01T00:00:00Z"
        }));
        let beta_b = parsed_version(json!({
            "id": "verBetaB", "project_id": "A", "version_number": "0.9.1",
            "version_type": "alpha", "dependencies": [], "files": [],
            "date_published": "2024-01-01T00:00:00Z"
        }));
        assert_eq!(
            pick_version(&[beta_b.clone(), beta_a.clone()]).unwrap().id,
            pick_version(&[beta_a, beta_b]).unwrap().id,
            "при равных датах выбор должен быть стабильным независимо от порядка"
        );
    }

    #[tokio::test]
    async fn install_project_downloads_required_dependencies() {
        let mut env = ModrinthEnv::acquire("modrinth_install_deps").await;

        let jar_a = b"mod a jar".to_vec();
        let jar_b = b"mod b jar".to_vec();

        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            required_dep("B", None),
        );
        let version_b = jar_version(&env, "verB", "B", "0.2.0", "b.jar", &jar_b, json!([]));

        let va_mock = env
            .server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;
        let projects_mock = env
            .server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([project_json("A", "Mod A"), project_json("B", "Mod B")]).to_string())
            .expect(1)
            .create_async()
            .await;
        let vb_mock = env
            .server
            .mock("GET", "/v2/project/B/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_b]).to_string())
            .create_async()
            .await;
        let jar_a_mock = env
            .server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(jar_a.clone())
            .create_async()
            .await;
        let jar_b_mock = env
            .server
            .mock("GET", "/cdn/b.jar")
            .with_status(200)
            .with_body(jar_b.clone())
            .create_async()
            .await;

        let ctx = env.install_ctx();

        let report = install_project(&ctx, "A", None)
            .await
            .expect("установка мода");

        assert_eq!(report.installed.len(), 2);
        assert_eq!(std::fs::read(ctx.mods_dir.join("A.jar")).unwrap(), jar_a);
        assert_eq!(std::fs::read(ctx.mods_dir.join("B.jar")).unwrap(), jar_b);

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(manifest.mods.len(), 2);
        assert_eq!(manifest.mods.get("A").unwrap().title, "Mod A");
        assert_eq!(manifest.mods.get("B").unwrap().version_number, "0.2.0");

        va_mock.assert_async().await;
        projects_mock.assert_async().await;
        vb_mock.assert_async().await;
        jar_a_mock.assert_async().await;
        jar_b_mock.assert_async().await;
    }

    #[tokio::test]
    async fn install_uses_pinned_dependency_version() {
        let mut env = ModrinthEnv::acquire("modrinth_dep_pinned").await;

        let jar_a = b"mod a jar".to_vec();
        let jar_b1 = b"mod b v1".to_vec();
        let jar_b2 = b"mod b v2".to_vec();
        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            required_dep("B", Some("verB1")),
        );
        let version_b1 = with_filename(
            jar_version(
                &env,
                "verB1",
                "B",
                "1.0.0",
                "b-1.0.0.jar",
                &jar_b1,
                json!([]),
            ),
            "B-1.0.0.jar",
        );

        mock_pinned_dependency_env(&mut env, version_a, "verB1", &version_b1, &jar_b2, &jar_a)
            .await;
        mock_cdn_jar(&mut env, "/cdn/b-1.0.0.jar", &jar_b1).await;

        let ctx = env.install_ctx();
        install_project(&ctx, "A", None)
            .await
            .expect("установка с закреплённой зависимостью");

        assert_eq!(
            std::fs::read(ctx.mods_dir.join("B-1.0.0.jar")).expect("jar закреплённой зависимости"),
            jar_b1,
            "dependency.version_id должен ставиться вместо свежего релиза"
        );
        assert!(
            !ctx.mods_dir.join("B-2.0.0.jar").exists(),
            "свежий релиз не должен подменять закреплённую версию зависимости"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("B").expect("запись B").version_number,
            "1.0.0"
        );
    }

    #[tokio::test]
    async fn install_falls_back_to_latest_when_pinned_dependency_incompatible() {
        let mut env = ModrinthEnv::acquire("modrinth_dep_pinned_fallback").await;

        let jar_b2 = b"mod b v2".to_vec();
        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            b"mod a jar",
            required_dep("B", Some("verBOld")),
        );
        let mut version_b_old = version_json(
            "verBOld",
            "B",
            "0.9.0",
            format!("{}/cdn/b-0.9.0.jar", env.server.url()),
            sha1_hex(b"mod b old"),
            10,
            json!([]),
        );
        version_b_old["game_versions"] = json!(["1.20.1"]);
        version_b_old["files"][0]["filename"] = json!("B-0.9.0.jar");

        mock_pinned_dependency_env(
            &mut env,
            version_a,
            "verBOld",
            &version_b_old,
            &jar_b2,
            b"mod a jar",
        )
        .await;
        mock_cdn_jar(&mut env, "/cdn/b-2.0.0.jar", &jar_b2).await;

        let ctx = env.install_ctx();
        install_project(&ctx, "A", None)
            .await
            .expect("несовместимый пин зависимости заменяется свежим релизом");

        assert_eq!(
            std::fs::read(ctx.mods_dir.join("B-2.0.0.jar")).expect("jar свежего релиза"),
            jar_b2,
            "фолбэк должен выбрать свежий совместимый релиз"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("B").expect("запись B").version_number,
            "2.0.0"
        );
    }

    #[tokio::test]
    async fn unpinned_dependency_keeps_installed_compatible_version() {
        let mut env = ModrinthEnv::acquire("modrinth_dep_unpinned_keep").await;

        let jar_a = b"mod a jar".to_vec();
        let jar_b1 = b"mod b v1".to_vec();
        let jar_b2 = b"mod b v2".to_vec();

        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            required_dep("B", None),
        );
        let version_b1 = with_filename(
            jar_version(
                &env,
                "verB1",
                "B",
                "1.0.0",
                "b-1.0.0.jar",
                &jar_b1,
                json!([]),
            ),
            "B-1.0.0.jar",
        );
        let version_b2 = with_filename(
            jar_version(
                &env,
                "verB2",
                "B",
                "2.0.0",
                "b-2.0.0.jar",
                &jar_b2,
                json!([]),
            ),
            "B-2.0.0.jar",
        );

        mock_project_versions(&mut env, "A", &[version_a]).await;
        mock_single_version(&mut env, "verB1", &version_b1).await;
        mock_project_versions(&mut env, "B", &[version_b2]).await;
        mock_projects_list(&mut env, &[("A", "Mod A"), ("B", "Mod B")]).await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", &jar_a).await;
        mock_cdn_jar(&mut env, "/cdn/b-2.0.0.jar", &jar_b2).await;

        let ctx = seed_installed_dependency(&env, "B-1.0.0.jar", "verB1", "1.0.0", &jar_b1).await;

        let report = install_project(&ctx, "A", None)
            .await
            .expect("установка мода с неприпинённой зависимостью");

        assert_eq!(
            report.installed,
            vec!["A.jar".to_string()],
            "зависимость не должна перекачиваться при сохранённой версии"
        );
        assert_eq!(
            report.skipped,
            vec!["B-1.0.0.jar".to_string()],
            "установленная совместимая зависимость пропускается по sha1"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("B-1.0.0.jar")).expect("jar зависимости"),
            jar_b1,
            "неприпинённая зависимость не должна заменять установленную совместимую версию"
        );
        assert!(
            !ctx.mods_dir.join("B-2.0.0.jar").exists(),
            "свежий релиз зависимости не должен ставиться поверх совместимой"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        let entry = manifest.mods.get("B").expect("запись B");
        assert_eq!(entry.version_id, "verB1");
        assert_eq!(entry.version_number, "1.0.0");
        assert_eq!(entry.filename, "B-1.0.0.jar");
        assert_eq!(entry.sha1, sha1_hex(&jar_b1));
    }

    #[tokio::test]
    async fn unpinned_dependency_replaces_incompatible_installed_version() {
        let mut env = ModrinthEnv::acquire("modrinth_dep_unpinned_incompatible").await;

        let jar_a = b"mod a jar".to_vec();
        let jar_b_old = b"mod b old".to_vec();
        let jar_b2 = b"mod b v2".to_vec();

        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            required_dep("B", None),
        );
        let mut version_b_old = version_json(
            "verBOld",
            "B",
            "0.9.0",
            format!("{}/cdn/b-0.9.0.jar", env.server.url()),
            sha1_hex(&jar_b_old),
            jar_b_old.len() as u64,
            json!([]),
        );
        version_b_old["game_versions"] = json!(["1.20.1"]);
        version_b_old["files"][0]["filename"] = json!("B-0.9.0.jar");
        let version_b2 = with_filename(
            jar_version(
                &env,
                "verB2",
                "B",
                "2.0.0",
                "b-2.0.0.jar",
                &jar_b2,
                json!([]),
            ),
            "B-2.0.0.jar",
        );

        mock_project_versions(&mut env, "A", &[version_a]).await;
        mock_single_version(&mut env, "verBOld", &version_b_old).await;
        mock_project_versions(&mut env, "B", &[version_b2]).await;
        mock_projects_list(&mut env, &[("A", "Mod A"), ("B", "Mod B")]).await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", &jar_a).await;
        mock_cdn_jar(&mut env, "/cdn/b-2.0.0.jar", &jar_b2).await;

        let ctx =
            seed_installed_dependency(&env, "B-0.9.0.jar", "verBOld", "0.9.0", &jar_b_old).await;

        install_project(&ctx, "A", None)
            .await
            .expect("несовместимая установленная зависимость заменяется свежим релизом");

        assert_eq!(
            std::fs::read(ctx.mods_dir.join("B-2.0.0.jar")).expect("jar свежего релиза"),
            jar_b2
        );
        assert!(
            !ctx.mods_dir.join("B-0.9.0.jar").exists(),
            "несовместимая версия зависимости вытесняется"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("B").expect("запись B").version_number,
            "2.0.0"
        );
    }

    #[tokio::test]
    async fn install_blocked_by_incompatible_dependency() {
        let mut env = ModrinthEnv::acquire("modrinth_install_incompatible").await;

        let jar_a = b"mod a jar".to_vec();
        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            json!([{
                "version_id": null,
                "project_id": "B",
                "file_name": null,
                "dependency_type": "incompatible"
            }]),
        );
        mock_version_list(&mut env, version_a).await;

        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("B", manifest_entry("B", "hash-b", "verB1", "2.0.0"))],
        )
        .await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();

        let error = install_project(&ctx, "A", None)
            .await
            .expect_err("конфликт с установленным модом должен блокировать установку");

        let message = error.to_string();
        assert!(
            message.contains("несовместим") && message.contains("Mod B"),
            "ошибка должна называть конфликт: {message}"
        );
        assert!(
            mods_dir_file_names(&ctx).is_empty(),
            "при конфликте ничего не должно скачиваться"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(
            manifest.mods.contains_key("B"),
            "манифест не должен меняться при блокировке"
        );
    }

    #[tokio::test]
    async fn optional_dependencies_are_not_installed() {
        let mut env = ModrinthEnv::acquire("modrinth_dep_optional_ignored").await;

        let jar_a = b"mod a jar".to_vec();
        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            json!([{
                "version_id": null,
                "project_id": "B",
                "file_name": null,
                "dependency_type": "optional"
            }]),
        );
        mock_version_list(&mut env, version_a).await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", &jar_a).await;

        let ctx = env.install_ctx();
        let report = install_project(&ctx, "A", None)
            .await
            .expect("установка мода с optional-зависимостью");

        assert_eq!(report.installed, vec!["A.jar".to_string()]);
        assert_eq!(mods_dir_file_names(&ctx), vec!["A.jar".to_string()]);
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(manifest.mods.contains_key("A"));
        assert!(
            !manifest.mods.contains_key("B"),
            "optional-зависимость не должна ставиться автоматически"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn install_resolves_independent_dependencies_in_parallel() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let mut env = ModrinthEnv::acquire("modrinth_dep_fanout").await;

        let deps = ["B", "C", "D", "E"];
        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(b"mod a jar"),
            b"mod a jar".len() as u64,
            json!(deps
                .iter()
                .map(|dep| json!({
                    "version_id": null,
                    "project_id": dep,
                    "file_name": null,
                    "dependency_type": "required"
                }))
                .collect::<Vec<_>>()),
        );

        env.server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        for dep in deps {
            let jar = format!("mod {dep} jar");
            let version = version_json(
                &format!("ver{dep}"),
                dep,
                "1.0.0",
                format!("{}/cdn/{dep}.jar", env.server.url()),
                sha1_hex(jar.as_bytes()),
                jar.len() as u64,
                json!([]),
            );
            let active = Arc::clone(&active);
            let max_active = Arc::clone(&max_active);
            let body = json!([version]).to_string();
            env.server
                .mock("GET", format!("/v2/project/{dep}/version").as_str())
                .match_query(Matcher::Any)
                .with_chunked_body(move |writer| {
                    let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    writer.write_all(body.as_bytes())?;
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                })
                .create_async()
                .await;
            env.server
                .mock("GET", format!("/cdn/{dep}.jar").as_str())
                .with_status(200)
                .with_body(jar.as_bytes())
                .create_async()
                .await;
        }
        env.server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(
                json!(["A", "B", "C", "D", "E"]
                    .iter()
                    .map(|id| project_json(id, &format!("Mod {id}")))
                    .collect::<Vec<_>>())
                .to_string(),
            )
            .create_async()
            .await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", b"mod a jar").await;

        let ctx = env.install_ctx();
        install_project(&ctx, "A", None)
            .await
            .expect("установка с параллельным резолвом зависимостей");

        let observed = max_active.load(Ordering::SeqCst);
        assert!(
            observed >= 2,
            "независимые зависимости должны резолвиться с ограниченным fan-out: одновременно было {observed}"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.len(),
            5,
            "все зависимости должны быть установлены"
        );
    }

    #[tokio::test]
    async fn install_rejects_non_https_mod_url() {
        let mut env = ModrinthEnv::acquire("modrinth_mod_url_https").await;

        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            "http://cdn.example.com/evil/a.jar".to_string(),
            sha1_hex(b"mod a jar"),
            b"mod a jar".len() as u64,
            json!([]),
        );
        mock_version_list(&mut env, version_a).await;

        let ctx = env.install_ctx();
        let error = install_project(&ctx, "A", None)
            .await
            .expect_err("URL файла мода без https должен отклоняться");

        assert!(
            error.to_string().contains("https"),
            "ошибка должна называть требование https: {error:#}"
        );
        assert!(
            mods_dir_file_names(&ctx).is_empty(),
            "скачивание по незащищённому URL не должно начинаться"
        );
    }

    #[test]
    fn mod_download_limit_treats_zero_declared_size_as_hard_cap() {
        assert_eq!(
            mod_download_limit(0),
            MAX_MOD_DOWNLOAD_BYTES,
            "недоверенный size == 0 не должен отключать границу размера"
        );
        assert_eq!(
            mod_download_limit(MAX_MOD_DOWNLOAD_BYTES + 1),
            MAX_MOD_DOWNLOAD_BYTES,
            "завышенный declared size не должен поднимать потолок"
        );
        assert_eq!(mod_download_limit(123), 123);
    }

    #[test]
    fn mod_url_checks_allow_https_and_test_loopback_only() {
        assert!(ensure_safe_mod_url("https://cdn.modrinth.com/data/A/versions/1/a.jar").is_ok());
        assert!(
            ensure_safe_mod_url("http://127.0.0.1:8080/a.jar").is_ok(),
            "loopback http разрешён только в тестовой сборке для mockito"
        );
        assert!(
            ensure_safe_mod_url("http://cdn.example.com/a.jar").is_err(),
            "внешний http должен отклоняться"
        );
        assert!(ensure_safe_mod_url("ftp://cdn.example.com/a.jar").is_err());
        assert!(
            ensure_safe_mod_url("https://user:pass@cdn.example.com/a.jar").is_err(),
            "учётные данные в URL файла мода должны отклоняться"
        );
        assert!(ensure_safe_mod_url("not a url").is_err());
    }

    #[tokio::test]
    async fn install_falls_back_to_version_name_when_projects_fail() {
        let mut env = ModrinthEnv::acquire("modrinth_install_projects_fail").await;

        let version_a = jar_version(&env, "verA", "A", "1.0.0", "a.jar", b"mod a jar", json!([]));
        mock_project_versions(&mut env, "A", &[version_a]).await;
        env.server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(429)
            .with_header("Retry-After", "0")
            .create_async()
            .await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", b"mod a jar").await;

        let ctx = env.install_ctx();
        install_project(&ctx, "A", None)
            .await
            .expect("сбой данных проекта не должен ронять установку");

        let entry = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .get("A")
            .expect("запись A")
            .clone();
        assert_eq!(
            entry.title, "Mod A",
            "без данных проекта используется имя версии, а не пустая строка"
        );
    }

    #[tokio::test]
    async fn install_rejects_corrupted_download() {
        let mut env = ModrinthEnv::acquire("modrinth_install_corrupt").await;

        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(b"expected content"),
            b"expected content".len() as u64,
            json!([]),
        );
        mock_install_env(&mut env, version_a, b"corrupted content", 1).await;

        let ctx = env.install_ctx();

        let result = install_project(&ctx, "A", None).await;
        assert!(result.is_err());
        assert!(!ctx.mods_dir.join("A.jar").exists());
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    #[tokio::test]
    async fn install_rejects_unsafe_filename() {
        let mut env = ModrinthEnv::acquire("modrinth_install_unsafe_filename").await;

        let mut version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(b"mod a jar"),
            b"mod a jar".len() as u64,
            json!([]),
        );
        version_a["files"][0]["filename"] = json!("../evil.jar");

        env.server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;

        let ctx = env.install_ctx();

        let result = install_project(&ctx, "A", None).await;
        assert!(result.is_err(), "мод с traversal-именем должен отклоняться");

        assert!(!ctx.mods_dir.join("evil.jar").exists());
        assert!(!env.project_dir().join("evil.jar").exists());
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    #[tokio::test]
    async fn install_skips_existing_identical_file() {
        let mut env = ModrinthEnv::acquire("modrinth_install_skip").await;

        let jar_a = b"already installed".to_vec();
        let version_a = jar_version(&env, "verA", "A", "1.0.0", "a.jar", &jar_a, json!([]));
        mock_install_env(&mut env, version_a, &jar_a, 0).await;

        let ctx = env.install_ctx();
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), &jar_a)
            .await
            .unwrap();

        let report = install_project(&ctx, "A", None)
            .await
            .expect("установка мода");

        assert!(report.installed.is_empty());
        assert_eq!(report.skipped, vec!["A.jar".to_string()]);
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .contains_key("A"));
    }

    #[tokio::test]
    async fn load_manifest_defaults_on_missing_file() {
        let dir = LauncherDirGuard::acquire("modrinth_manifest_missing").await;
        let path = dir.project_dir("Test").join("modrinth.json");

        let manifest = load_manifest(&path)
            .await
            .expect("отсутствующий манифест — это пустой манифест");
        assert!(manifest.mods.is_empty());
    }

    #[tokio::test]
    async fn load_manifest_propagates_io_errors() {
        let dir = LauncherDirGuard::acquire("modrinth_manifest_io").await;
        let project_dir = dir.project_dir("Test");
        tokio::fs::create_dir_all(&project_dir).await.unwrap();
        let manifest_path = project_dir.join("modrinth.json");
        tokio::fs::create_dir(&manifest_path).await.unwrap();

        assert!(
            load_manifest(&manifest_path).await.is_err(),
            "ошибка чтения (не NotFound) должна прокидываться"
        );
    }

    #[tokio::test]
    async fn load_manifest_defaults_on_corrupt_json() {
        let dir = LauncherDirGuard::acquire("modrinth_manifest_corrupt").await;
        let path = dir.project_dir("Test").join("modrinth.json");
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, "{ not json").await.unwrap();

        let manifest = load_manifest(&path)
            .await
            .expect("битый json — пустой манифест после бэкапа");
        assert!(manifest.mods.is_empty());

        let backup = path.with_extension("json.bak");
        assert!(
            backup.exists(),
            "битый манифест должен уводиться в .bak перед сбросом"
        );
        assert_eq!(
            std::fs::read_to_string(&backup).expect("содержимое бэкапа"),
            "{ not json",
            "в бэкапе сохраняется исходное содержимое"
        );
    }

    async fn mock_version_env(env: &mut ModrinthEnv, version: serde_json::Value, jar: &[u8]) {
        mock_install_env(env, version, jar, 1).await;
    }

    async fn seed_installed_dependency(
        env: &ModrinthEnv,
        filename: &str,
        version_id: &str,
        version_number: &str,
        jar: &[u8],
    ) -> InstallContext {
        let ctx = env.install_ctx();
        let mut entry_b = manifest_entry("B", &sha1_hex(jar), version_id, version_number);
        entry_b.filename = filename.to_string();
        seed_mod_manifest(&ctx, vec![("B", entry_b)]).await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join(filename), jar)
            .await
            .unwrap();
        ctx
    }

    async fn updates_by_project(ctx: &InstallContext) -> HashMap<String, Option<String>> {
        let updates = check_updates(ctx).await.expect("проверка обновлений");
        updates
            .into_iter()
            .map(|update| (update.project_id, update.available_version))
            .collect()
    }

    fn named_jar_version(
        env: &ModrinthEnv,
        id: &str,
        version_number: &str,
        jar: &[u8],
    ) -> serde_json::Value {
        with_filename(
            jar_version(
                env,
                id,
                "A",
                version_number,
                &format!("a-{version_number}.jar"),
                jar,
                json!([]),
            ),
            &format!("A-{version_number}.jar"),
        )
    }

    async fn mock_pinned_version(env: &mut ModrinthEnv, version: serde_json::Value, jar: &[u8]) {
        let version_path = format!("/v2/version/{}", version["id"].as_str().unwrap());
        env.server
            .mock("GET", version_path.as_str())
            .with_status(200)
            .with_body(version.to_string())
            .create_async()
            .await;
        let url = version["files"][0]["url"].as_str().unwrap().to_string();
        let path = url
            .strip_prefix(env.server.url().as_str())
            .unwrap()
            .to_string();
        env.server
            .mock("GET", path.as_str())
            .with_status(200)
            .with_body(jar)
            .create_async()
            .await;
    }

    async fn setup_installed_version_update(
        env: &mut ModrinthEnv,
        v2_filename: Option<&str>,
    ) -> (InstallContext, Vec<u8>, Vec<u8>) {
        let jar_v1 = b"mod a v1".to_vec();
        let jar_v2 = b"mod a v2".to_vec();
        let version_v1 = jar_version(env, "ver1", "A", "1.0.0", "a-1.0.0.jar", &jar_v1, json!([]));
        let version_v2 = jar_version(env, "ver2", "A", "2.0.0", "a-2.0.0.jar", &jar_v2, json!([]));
        let version_v2 = match v2_filename {
            Some(name) => with_filename(version_v2, name),
            None => version_v2,
        };

        let ctx = install_first_version(env, version_v1, &jar_v1).await;

        clear_response_cache_for_tests();
        mock_version_env(env, version_v2, &jar_v2).await;
        (ctx, jar_v1, jar_v2)
    }

    fn mods_dir_file_names(ctx: &InstallContext) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&ctx.mods_dir)
            .expect("чтение каталога mods")
            .map(|entry| {
                entry
                    .expect("запись каталога mods")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        names.sort();
        names
    }

    #[tokio::test]
    async fn install_update_replaces_previous_jar_file() {
        let mut env = ModrinthEnv::acquire("modrinth_install_update_replace").await;
        let (ctx, _jar_v1, jar_v2) =
            setup_installed_version_update(&mut env, Some("A-2.0.0.jar")).await;
        assert_eq!(mods_dir_file_names(&ctx), vec!["A.jar".to_string()]);

        install_project(&ctx, "A", None)
            .await
            .expect("обновление мода до v2");

        assert_eq!(
            mods_dir_file_names(&ctx),
            vec!["A-2.0.0.jar".to_string()],
            "в mods/ должен остаться только jar новой версии"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A-2.0.0.jar")).expect("jar v2"),
            jar_v2
        );

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        let entry = manifest.mods.get("A").expect("запись проекта A");
        assert_eq!(entry.filename, "A-2.0.0.jar");
        assert_eq!(entry.version_number, "2.0.0");
        assert_eq!(manifest.mods.len(), 1);
    }

    #[tokio::test]
    async fn install_update_same_filename_overwrites_content() {
        let mut env = ModrinthEnv::acquire("modrinth_install_update_same_name").await;
        let (ctx, jar_v1, jar_v2) = setup_installed_version_update(&mut env, None).await;
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("jar v1"),
            jar_v1
        );

        install_project(&ctx, "A", None)
            .await
            .expect("обновление мода до v2");

        assert_eq!(
            mods_dir_file_names(&ctx),
            vec!["A.jar".to_string()],
            "обновление с тем же именем файла не должно дублировать jar"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("jar v2"),
            jar_v2
        );

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("A").expect("запись A").version_number,
            "2.0.0"
        );
    }

    #[tokio::test]
    async fn install_pinned_version_installs_exactly_it() {
        let mut env = ModrinthEnv::acquire("modrinth_install_pinned").await;

        let jar_v1 = b"mod a v1".to_vec();
        let version_v1 = named_jar_version(&env, "ver1", "1.0.0", &jar_v1);

        mock_pinned_version(&mut env, version_v1, &jar_v1).await;

        let ctx = env.install_ctx();
        let report = install_project(&ctx, "A", Some("ver1"))
            .await
            .expect("установка версии по пину");

        assert_eq!(report.installed, vec!["A-1.0.0.jar".to_string()]);
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A-1.0.0.jar")).expect("jar v1"),
            jar_v1,
            "должен скачаться jar запиненной версии, а не последней release"
        );
        let entry = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .get("A")
            .expect("запись A")
            .clone();
        assert_eq!(entry.version_id, "ver1");
        assert_eq!(entry.version_number, "1.0.0");
    }

    #[tokio::test]
    async fn install_pinned_downgrade_replaces_newer_jar() {
        let mut env = ModrinthEnv::acquire("modrinth_install_downgrade").await;

        let jar_v1 = b"mod a v1".to_vec();
        let jar_v2 = b"mod a v2".to_vec();
        let version_v1 = named_jar_version(&env, "ver1", "1.0.0", &jar_v1);
        let version_v2 = named_jar_version(&env, "ver2", "2.0.0", &jar_v2);

        mock_version_env(&mut env, version_v2, &jar_v2).await;
        let ctx = env.install_ctx();

        install_project(&ctx, "A", None)
            .await
            .expect("установка последней версии без пина");
        assert_eq!(
            mods_dir_file_names(&ctx),
            vec!["A-2.0.0.jar".to_string()],
            "без пина должна выбираться последняя версия из списка"
        );

        clear_response_cache_for_tests();
        mock_pinned_version(&mut env, version_v1, &jar_v1).await;

        install_project(&ctx, "A", Some("ver1"))
            .await
            .expect("даунгрейд до v1");

        assert_eq!(
            mods_dir_file_names(&ctx),
            vec!["A-1.0.0.jar".to_string()],
            "jar более новой версии не должен оставаться в mods"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A-1.0.0.jar")).expect("jar v1"),
            jar_v1
        );
        let entry = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .get("A")
            .expect("запись A")
            .clone();
        assert_eq!(entry.version_id, "ver1");
        assert_eq!(entry.version_number, "1.0.0");
    }

    #[tokio::test]
    async fn install_pinned_incompatible_version_rejected_before_download() {
        let mut env = ModrinthEnv::acquire("modrinth_install_pinned_incompatible").await;

        let mut version_old = version_json(
            "verOld",
            "A",
            "0.5.0",
            format!("{}/cdn/a-old.jar", env.server.url()),
            sha1_hex(b"mod a old"),
            10,
            json!([]),
        );
        version_old["game_versions"] = json!(["1.20.1"]);
        version_old["files"][0]["filename"] = json!("A-0.5.0.jar");

        env.server
            .mock("GET", "/v2/version/verOld")
            .with_status(200)
            .with_body(version_old.to_string())
            .create_async()
            .await;

        let ctx = env.install_ctx();
        let error = install_project(&ctx, "A", Some("verOld"))
            .await
            .expect_err("несовместимая версия не должна ставиться");

        assert!(
            error.to_string().contains("несовместима"),
            "ошибка должна объяснять несовместимость с профилем: {error:#}"
        );
        assert!(
            !ctx.mods_dir.join("A-0.5.0.jar").exists(),
            "скачивание несовместимой версии не должно начинаться"
        );
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    #[tokio::test]
    async fn install_pinned_version_of_other_project_is_rejected() {
        let mut env = ModrinthEnv::acquire("modrinth_install_pinned_foreign").await;

        let version_b = version_json(
            "verB",
            "B",
            "1.0.0",
            format!("{}/cdn/b.jar", env.server.url()),
            sha1_hex(b"mod b jar"),
            10,
            json!([]),
        );
        env.server
            .mock("GET", "/v2/version/verB")
            .with_status(200)
            .with_body(version_b.to_string())
            .create_async()
            .await;

        let ctx = env.install_ctx();
        let error = install_project(&ctx, "A", Some("verB"))
            .await
            .expect_err("версия чужого проекта не должна ставиться");

        assert!(
            error.to_string().contains("принадлежит моду B"),
            "ошибка должна называть чужой проект версии: {error:#}"
        );
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    fn manifest_entry(
        project: &str,
        sha1: &str,
        version_id: &str,
        version_number: &str,
    ) -> ManifestEntry {
        ManifestEntry {
            project_id: project.to_string(),
            slug: None,
            title: format!("Mod {project}"),
            icon_url: None,
            filename: format!("{project}.jar"),
            sha1: sha1.to_string(),
            version_id: version_id.to_string(),
            version_number: version_number.to_string(),
        }
    }

    async fn seed_mod_manifest(ctx: &InstallContext, entries: Vec<(&str, ManifestEntry)>) {
        if let Some(parent) = ctx.manifest_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .expect("создание каталога проекта");
        }
        let manifest = ModrinthManifest {
            mods: entries
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
            known_hashes: Vec::new(),
        };
        save_manifest(&ctx.manifest_path, &manifest)
            .await
            .expect("запись стартового манифеста");
    }

    async fn seeded_env(
        label: &str,
        entries: Vec<(&str, ManifestEntry)>,
    ) -> (ModrinthEnv, InstallContext) {
        let env = ModrinthEnv::acquire(label).await;
        let ctx = env.install_ctx();
        seed_mod_manifest(&ctx, entries).await;
        (env, ctx)
    }

    async fn assert_manifest_keys(ctx: &InstallContext, removed: &str, kept: &str) {
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(!manifest.mods.contains_key(removed));
        assert!(manifest.mods.contains_key(kept));
    }

    #[tokio::test]
    async fn check_updates_reports_newer_and_same_versions_in_one_batch() {
        let (mut env, ctx) = seeded_env(
            "modrinth_check_updates",
            vec![
                ("A", manifest_entry("A", "hash-a", "verA1", "1.0.0")),
                ("B", manifest_entry("B", "hash-b", "verB1", "2.0.0")),
                ("C", manifest_entry("C", "hash-c", "verC1", "3.0.0")),
            ],
        )
        .await;

        let batch_mock = env
            .server
            .mock("POST", "/v2/version_files/update")
            .match_body(Matcher::PartialJsonString(
                json!({
                    "algorithm": "sha1",
                    "loaders": ["fabric"],
                    "game_versions": ["1.21.1"]
                })
                .to_string(),
            ))
            .with_status(200)
            .with_body(
                json!({
                    "hash-a": {"id": "verA2", "project_id": "A", "version_number": "1.1.0", "version_type": "release", "dependencies": [], "files": []},
                    "hash-b": {"id": "verB1", "project_id": "B", "version_number": "2.0.0", "version_type": "release", "dependencies": [], "files": []}
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let by_project = updates_by_project(&ctx).await;
        assert_eq!(by_project.len(), 3, "каждый мод должен попасть в отчёт");
        assert_eq!(
            by_project.get("A").and_then(|v| v.as_deref()),
            Some("1.1.0"),
            "новая версия на сервере — обновление доступно"
        );
        assert_eq!(
            by_project.get("B"),
            Some(&None),
            "та же версия не должна считаться обновлением"
        );
        assert_eq!(
            by_project.get("C"),
            Some(&None),
            "хеш, неизвестный Modrinth, — это отсутствие данных, а не обновление"
        );
        batch_mock.assert_async().await;
    }

    #[tokio::test]
    async fn check_updates_requests_only_releases_and_suppresses_non_release_suggestions() {
        let (mut env, ctx) = seeded_env(
            "modrinth_check_updates_release_only",
            vec![
                ("A", manifest_entry("A", "hash-a", "verA1", "1.0.0")),
                ("B", manifest_entry("B", "hash-b", "verB1", "2.0.0")),
                ("D", manifest_entry("D", "hash-d", "verD1", "4.0.0")),
            ],
        )
        .await;

        let batch_mock = env
            .server
            .mock("POST", "/v2/version_files/update")
            .match_body(Matcher::PartialJsonString(
                json!({"version_types": ["release"]}).to_string(),
            ))
            .with_status(200)
            .with_body(
                json!({
                    "hash-a": {"id": "verA1", "project_id": "A", "version_number": "1.0.0", "version_type": "release", "dependencies": [], "files": []},
                    "hash-b": {"id": "verB2", "project_id": "B", "version_number": "2.1.0", "version_type": "release", "dependencies": [], "files": []},
                    "hash-d": {"id": "verD2", "project_id": "D", "version_number": "4.1.0-beta", "version_type": "beta", "dependencies": [], "files": []}
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let by_project = updates_by_project(&ctx).await;
        assert_eq!(
            by_project.get("A"),
            Some(&None),
            "установленная версия совпадает с предложенной — обновления нет"
        );
        assert_eq!(
            by_project.get("B").and_then(|v| v.as_deref()),
            Some("2.1.0"),
            "свежий релиз показывается как обновление"
        );
        assert_eq!(
            by_project.get("D"),
            Some(&None),
            "beta-подсказка подавляется: установщик выбирает только релизы, иначе обновление показывается вечно"
        );
        batch_mock.assert_async().await;
    }

    #[tokio::test]
    async fn check_updates_errors_when_api_fails() {
        let mut env = ModrinthEnv::acquire("modrinth_check_updates_fail").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        env.server
            .mock("POST", "/v2/version_files/update")
            .match_query(Matcher::Any)
            .with_status(429)
            .with_header("Retry-After", "0")
            .create_async()
            .await;

        let error = check_updates(&ctx)
            .await
            .expect_err("сбой API не должен выглядеть как «обновлений нет»");
        assert!(
            error
                .to_string()
                .contains("Не удалось проверить обновления"),
            "ошибка должна объяснять, что проверка не состоялась: {error:#}"
        );
    }

    #[tokio::test]
    async fn check_updates_with_empty_manifest_queries_nothing() {
        let env = ModrinthEnv::acquire("modrinth_check_updates_empty").await;
        let ctx = env.install_ctx();

        let updates = check_updates(&ctx).await.expect("пустой манифест");

        assert!(updates.is_empty());
    }

    #[tokio::test]
    async fn sync_does_not_requery_known_duplicate_hashes() {
        let mut env = ModrinthEnv::acquire("modrinth_sync_dup_no_requery").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        let batch_mock = env
            .server
            .mock("POST", "/v2/version_files")
            .with_status(200)
            .with_body(
                json!({"hash-f": {"id": "verF1", "project_id": "A", "name": "Dup", "version_number": "9.9.9", "version_type": "release", "dependencies": [], "files": []}})
                    .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let local_hashes: HashMap<String, String> = HashMap::from([
            ("A.jar".to_string(), "hash-a".to_string()),
            ("Other.jar".to_string(), "hash-f".to_string()),
        ]);

        let manifest = sync_installed_from_hashes(&ctx, local_hashes.clone())
            .await
            .expect("первая синхронизация");
        assert_eq!(
            manifest.mods.len(),
            1,
            "дубликат по проекту не усыновляется, но запоминается"
        );

        let manifest = sync_installed_from_hashes(&ctx, local_hashes)
            .await
            .expect("повторная синхронизация");
        assert_eq!(manifest.mods.len(), 1);
        assert!(
            manifest.known_hashes.contains(&"hash-f".to_string()),
            "хеш дубликата фиксируется в манифесте: {:?}",
            manifest.known_hashes
        );

        batch_mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_installed_drops_missing_files_and_adopts_foreign_mods() {
        let (mut env, ctx) = seeded_env(
            "modrinth_sync_adopt",
            vec![
                ("A", manifest_entry("A", "hash-a", "verA1", "1.0.0")),
                ("B", manifest_entry("B", "hash-b", "verB1", "2.0.0")),
            ],
        )
        .await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(200)
            .with_body(
                json!({"hash-f": {"id": "verF1", "project_id": "F", "name": "Foreign", "version_number": "0.5.0", "version_type": "release", "dependencies": [], "files": []}})
                    .to_string(),
            )
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(
                json!([{"id": "F", "project_type": "mod", "title": "Foreign Mod"}]).to_string(),
            )
            .create_async()
            .await;

        let local_hashes: HashMap<String, String> = HashMap::from([
            ("A.jar".to_string(), "hash-a".to_string()),
            ("Foreign.jar".to_string(), "hash-f".to_string()),
        ]);

        let manifest = sync_installed_from_hashes(&ctx, local_hashes)
            .await
            .expect("синхронизация манифеста по хешам");

        assert!(manifest.mods.contains_key("A"));
        assert!(
            !manifest.mods.contains_key("B"),
            "запись без файла в mods должна удаляться из манифеста"
        );
        let foreign = manifest.mods.get("F").expect("foreign-мод усыновляется");
        assert_eq!(foreign.filename, "Foreign.jar");
        assert_eq!(foreign.title, "Foreign Mod");
        assert_eq!(foreign.sha1, "hash-f");
        assert_eq!(foreign.version_number, "0.5.0");

        let saved = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение сохранённого манифеста");
        assert_eq!(
            saved.mods.len(),
            2,
            "результат синхронизации должен сохраняться на диск"
        );
        assert!(saved.mods.contains_key("F"));
    }

    #[tokio::test]
    async fn sync_installed_falls_back_to_version_name_when_projects_fail() {
        let mut env = ModrinthEnv::acquire("modrinth_sync_fallback").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(&ctx, vec![]).await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(200)
            .with_body(
                json!({"hash-f": {"id": "verF1", "project_id": "F", "name": "Foreign jar", "version_number": "0.5.0", "version_type": "release", "dependencies": [], "files": []}})
                    .to_string(),
            )
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(429)
            .with_header("Retry-After", "0")
            .create_async()
            .await;

        let manifest = sync_installed_from_hashes(
            &ctx,
            HashMap::from([("Foreign.jar".to_string(), "hash-f".to_string())]),
        )
        .await
        .expect("синхронизация");

        let foreign = manifest.mods.get("F").expect("мод усыновляется");
        assert_eq!(
            foreign.title, "Foreign jar",
            "без данных проекта используется имя версии"
        );
    }

    #[tokio::test]
    async fn sync_installed_keeps_manifest_when_hash_lookup_fails() {
        let (mut env, ctx) = seeded_env(
            "modrinth_sync_lookup_fail",
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(429)
            .with_header("Retry-After", "0")
            .create_async()
            .await;

        let manifest = sync_installed_from_hashes(
            &ctx,
            HashMap::from([
                ("A.jar".to_string(), "hash-a".to_string()),
                ("Foreign.jar".to_string(), "hash-f".to_string()),
            ]),
        )
        .await
        .expect("сбой определения foreign-модов не должен ронять синхронизацию");

        assert!(
            manifest.mods.contains_key("A"),
            "существующая запись остаётся"
        );
        assert!(
            !manifest.mods.contains_key("F"),
            "неопознанный foreign-мод не усыновляется"
        );
    }

    #[tokio::test]
    async fn sync_installed_skips_foreign_mod_with_known_project() {
        let (mut env, ctx) = seeded_env(
            "modrinth_sync_known_project",
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(200)
            .with_body(
                json!({"hash-f": {"id": "verF1", "project_id": "A", "name": "Dup", "version_number": "9.9.9", "version_type": "release", "dependencies": [], "files": []}})
                    .to_string(),
            )
            .create_async()
            .await;

        let manifest = sync_installed_from_hashes(
            &ctx,
            HashMap::from([
                ("A.jar".to_string(), "hash-a".to_string()),
                ("Other.jar".to_string(), "hash-f".to_string()),
            ]),
        )
        .await
        .expect("синхронизация");

        assert_eq!(manifest.mods.len(), 1, "проект A уже в манифесте");
        let entry = manifest.mods.get("A").expect("запись A");
        assert_eq!(entry.version_number, "1.0.0");
        assert_eq!(
            entry.filename, "A.jar",
            "существующая запись не должна перетираться foreign-версией"
        );
    }

    #[tokio::test]
    async fn uninstall_project_removes_file_and_manifest_entry() {
        let (_env, ctx) = seeded_env(
            "modrinth_uninstall",
            vec![
                ("A", manifest_entry("A", "hash-a", "verA1", "1.0.0")),
                ("B", manifest_entry("B", "hash-b", "verB1", "2.0.0")),
            ],
        )
        .await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), b"a")
            .await
            .unwrap();
        tokio::fs::write(ctx.mods_dir.join("B.jar"), b"b")
            .await
            .unwrap();

        uninstall_project(&ctx, "A").await.expect("удаление мода");

        assert!(
            !ctx.mods_dir.join("A.jar").exists(),
            "файл удалённого мода должен быть убран"
        );
        assert!(ctx.mods_dir.join("B.jar").exists());

        assert_manifest_keys(&ctx, "A", "B").await;
    }

    #[tokio::test]
    async fn uninstall_project_errors_for_unknown_project() {
        let env = ModrinthEnv::acquire("modrinth_uninstall_unknown").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        let error = uninstall_project(&ctx, "Unknown")
            .await
            .expect_err("неустановленный мод не удаляется");
        assert!(
            error.to_string().contains("не установлен"),
            "ошибка должна объяснять, что мод не установлен: {error}"
        );
    }

    #[tokio::test]
    async fn uninstall_project_rejects_unsafe_filename() {
        let env = ModrinthEnv::acquire("modrinth_unsafe_uninstall").await;
        let ctx = env.install_ctx();
        let mut unsafe_entry = manifest_entry("A", "hash-a", "verA1", "1.0.0");
        unsafe_entry.filename = "../evil.jar".to_string();
        seed_mod_manifest(&ctx, vec![("A", unsafe_entry)]).await;

        let result = uninstall_project(&ctx, "A").await;
        assert!(result.is_err(), "traversal-имя файла должно отклоняться");
        assert!(
            !ctx.mods_dir
                .parent()
                .expect("каталог проекта")
                .join("evil.jar")
                .exists(),
            "удаление не должно выходить за пределы mods"
        );
    }

    #[tokio::test]
    async fn uninstall_project_tolerates_missing_file() {
        let env = ModrinthEnv::acquire("modrinth_uninstall_no_file").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        uninstall_project(&ctx, "A")
            .await
            .expect("отсутствующий файл не должен ломать удаление");

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(manifest.mods.is_empty(), "запись из манифеста убирается");
    }

    #[tokio::test]
    async fn uninstall_keeps_file_tracked_by_other_project() {
        let env = ModrinthEnv::acquire("modrinth_uninstall_foreign").await;
        let ctx = env.install_ctx();
        let shared_content = b"shared jar".to_vec();
        let mut entry_a = manifest_entry("A", &sha1_hex(&shared_content), "verA1", "1.0.0");
        entry_a.filename = "shared.jar".to_string();
        let mut entry_b = manifest_entry("B", &sha1_hex(&shared_content), "verB1", "2.0.0");
        entry_b.filename = "shared.jar".to_string();
        seed_mod_manifest(&ctx, vec![("A", entry_a), ("B", entry_b)]).await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("shared.jar"), &shared_content)
            .await
            .unwrap();

        uninstall_project(&ctx, "A").await.expect("удаление мода A");

        assert!(
            ctx.mods_dir.join("shared.jar").exists(),
            "файл, отслеживаемый другим project_id, должен остаться после удаления A"
        );
        assert_manifest_keys(&ctx, "A", "B").await;
    }

    #[tokio::test]
    async fn concurrent_install_and_uninstall_keep_both_changes() {
        let mut env = ModrinthEnv::acquire("modrinth_race_manifest").await;

        let jar_a = b"mod a jar".to_vec();
        let version_a = jar_version(&env, "verA", "A", "1.0.0", "a.jar", &jar_a, json!([]));
        mock_version_env(&mut env, version_a, &jar_a).await;

        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("B", manifest_entry("B", "hash-b", "verB1", "2.0.0"))],
        )
        .await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("B.jar"), b"b")
            .await
            .unwrap();

        let (install_result, uninstall_result) = tokio::join!(
            install_project(&ctx, "A", None),
            uninstall_project(&ctx, "B"),
        );
        install_result.expect("параллельная установка");
        uninstall_result.expect("параллельное удаление");

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(
            manifest.mods.contains_key("A"),
            "параллельный uninstall не должен терять запись установки: {:?}",
            manifest.mods.keys().collect::<Vec<_>>()
        );
        assert!(
            !manifest.mods.contains_key("B"),
            "параллельная установка не должна откатывать удаление"
        );
        assert!(ctx.mods_dir.join("A.jar").exists());
        assert!(!ctx.mods_dir.join("B.jar").exists());
    }

    #[tokio::test]
    async fn concurrent_installs_same_filename_both_succeed() {
        let mut env = ModrinthEnv::acquire("modrinth_install_parallel_same_file").await;

        let jar_a = b"mod a jar".to_vec();
        let version_a = jar_version(&env, "verA", "A", "1.0.0", "a.jar", &jar_a, json!([]));
        mock_version_list(&mut env, version_a).await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", &jar_a).await;

        let ctx = env.install_ctx();
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();

        let commit_guard = MANIFEST_WRITE_LOCK.lock().await;
        let ctx_first = env.install_ctx();
        let ctx_second = env.install_ctx();
        let first = tokio::spawn(async move { install_project(&ctx_first, "A", None).await });
        let second = tokio::spawn(async move { install_project(&ctx_second, "A", None).await });
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        drop(commit_guard);

        let first = first
            .await
            .unwrap()
            .expect("первая параллельная установка не должна падать");
        let second = second
            .await
            .unwrap()
            .expect("вторая параллельная установка не должна падать");

        assert_eq!(first.installed, vec!["A.jar".to_string()]);
        assert_eq!(second.installed, vec!["A.jar".to_string()]);
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("jar на диске"),
            jar_a
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.len(),
            1,
            "двойная установка одного мода не должна дублировать запись"
        );
        let entry = manifest.mods.get("A").expect("запись A");
        assert_eq!(entry.sha1, sha1_hex(&jar_a));
        assert!(
            part_files_in(&ctx.mods_dir).is_empty(),
            "staging-файлы параллельных установок должны уйти при коммите"
        );
    }

    #[tokio::test]
    async fn failed_rename_commit_removes_staging_file() {
        let mut env = ModrinthEnv::acquire("modrinth_rename_fail_cleanup").await;

        let jar_a = b"mod a jar".to_vec();
        let version_a = jar_version(&env, "verA", "A", "1.0.0", "a.jar", &jar_a, json!([]));
        mock_version_env(&mut env, version_a, &jar_a).await;

        let ctx = env.install_ctx();
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::create_dir(ctx.mods_dir.join("A.jar"))
            .await
            .expect("каталог на месте jar блокирует rename");

        let result = install_project(&ctx, "A", None).await;

        let error = result.expect_err("rename поверх каталога должен валить установку");
        assert!(
            error.to_string().contains("переместить"),
            "ошибка должна указывать на неудачный перенос файла: {error:#}"
        );
        assert!(
            part_files_in(&ctx.mods_dir).is_empty(),
            "staging-файл должен быть удалён после неудачного rename"
        );
    }

    #[tokio::test]
    async fn failed_rename_commit_keeps_renamed_files_and_drops_failed_entry() {
        let mut env = ModrinthEnv::acquire("modrinth_rename_fail_partial").await;

        let jar_a = b"mod a jar".to_vec();
        let jar_b = b"mod b jar".to_vec();
        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            required_dep("B", None),
        );
        let version_b = jar_version(&env, "verB", "B", "0.2.0", "b.jar", &jar_b, json!([]));

        mock_project_versions(&mut env, "A", &[version_a]).await;
        mock_project_versions(&mut env, "B", &[version_b]).await;
        mock_projects_list(&mut env, &[("A", "Mod A"), ("B", "Mod B")]).await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", &jar_a).await;
        mock_cdn_jar(&mut env, "/cdn/b.jar", &jar_b).await;

        let ctx = env.install_ctx();
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::create_dir(ctx.mods_dir.join("B.jar"))
            .await
            .expect("каталог на месте jar зависимости блокирует rename");

        let result = install_project(&ctx, "A", None).await;
        let error = result.expect_err("rename поверх каталога должен валить установку");
        assert!(
            error.to_string().contains("переместить"),
            "ошибка должна указывать на неудачный перенос файла: {error:#}"
        );

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.len(),
            1,
            "в манифесте остаётся только удачно переименованный файл"
        );
        let entry_a = manifest.mods.get("A").expect("запись A");
        assert_eq!(
            entry_a.version_number, "1.0.0",
            "успешно переименованный файл остаётся в манифесте"
        );
        assert_eq!(entry_a.sha1, sha1_hex(&jar_a));
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("jar A на диске"),
            jar_a,
            "содержимое файла на диске соответствует записи манифеста"
        );
        assert!(
            !manifest.mods.contains_key("B"),
            "запись файла с несостоявшимся rename не должна оставаться в манифесте"
        );
        assert!(
            part_files_in(&ctx.mods_dir).is_empty(),
            "staging-файлы должны быть убраны после сбоя коммита"
        );
    }

    #[tokio::test]
    async fn failed_rename_commit_reverts_update_entry_and_keeps_displaced_file() {
        let mut env = ModrinthEnv::acquire("modrinth_rename_fail_displaced").await;
        let (ctx, jar_v1, _jar_v2) =
            setup_installed_version_update(&mut env, Some("A-2.0.0.jar")).await;
        tokio::fs::create_dir(ctx.mods_dir.join("A-2.0.0.jar"))
            .await
            .expect("каталог на месте нового jar блокирует rename");

        let result = install_project(&ctx, "A", None).await;
        let error = result.expect_err("rename поверх каталога должен валить установку");
        assert!(
            error.to_string().contains("переместить"),
            "ошибка должна указывать на неудачный перенос файла: {error:#}"
        );

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(manifest.mods.len(), 1);
        let entry = manifest.mods.get("A").expect("запись A");
        assert_eq!(
            entry.version_number, "1.0.0",
            "запись манифеста откатывается к прежней версии"
        );
        assert_eq!(entry.filename, "A.jar");
        assert_eq!(entry.sha1, sha1_hex(&jar_v1));
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("прежний jar на месте"),
            jar_v1,
            "вытесненный файл прежней версии не должен удаляться при сбое rename"
        );
        assert!(
            part_files_in(&ctx.mods_dir).is_empty(),
            "staging-файлы должны быть убраны после сбоя коммита"
        );
    }

    #[tokio::test]
    async fn sync_drops_entry_when_file_content_diverges_from_manifest() {
        let env = ModrinthEnv::acquire("modrinth_sync_content_diverged").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![(
                "A",
                manifest_entry("A", &sha1_hex(b"expected jar"), "verA1", "1.0.0"),
            )],
        )
        .await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), b"replaced by user")
            .await
            .unwrap();

        let manifest = sync_installed_from_scan(&ctx)
            .await
            .expect("синхронизация при разошедшемся содержимом");

        assert!(
            !manifest.mods.contains_key("A"),
            "запись, чей sha1 не совпадает с файлом на диске, не должна оставаться"
        );
        let saved = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение сохранённого манифеста");
        assert!(saved.mods.is_empty());
    }

    #[tokio::test]
    async fn failed_update_download_keeps_previous_jar() {
        let mut env = ModrinthEnv::acquire("modrinth_update_net_fail").await;

        let jar_v1 = b"mod a v1".to_vec();
        let version_v1 = jar_version(&env, "ver1", "A", "1.0.0", "a.jar", &jar_v1, json!([]));
        let version_v2 = jar_version(&env, "ver2", "A", "2.0.0", "a.jar", b"mod a v2", json!([]));

        let ctx = install_first_version(&mut env, version_v1, &jar_v1).await;

        clear_response_cache_for_tests();
        mock_version_list(&mut env, version_v2).await;
        env.server
            .mock("GET", "/cdn/a.jar")
            .with_status(404)
            .create_async()
            .await;

        let result = install_project(&ctx, "A", None).await;
        assert!(
            result.is_err(),
            "сбой сети при обновлении должен давать ошибку"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("старый jar на месте"),
            jar_v1,
            "обрыв сети после precheck не должен оставлять пользователя без работавшего jar"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("A").expect("запись A").version_number,
            "1.0.0",
            "манифест остаётся на старой версии"
        );
    }

    #[tokio::test]
    async fn install_retries_transient_cdn_failure() {
        let mut env = ModrinthEnv::acquire("modrinth_install_retry").await;

        let jar_a = b"mod a jar".to_vec();
        let version_a = jar_version(&env, "verA", "A", "1.0.0", "a.jar", &jar_a, json!([]));
        mock_version_list(&mut env, version_a).await;

        let transient_mock = env
            .server
            .mock("GET", "/cdn/a.jar")
            .with_status(503)
            .expect(1)
            .create_async()
            .await;
        env.server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(jar_a.clone())
            .create_async()
            .await;

        let ctx = env.install_ctx();
        let report = install_project(&ctx, "A", None)
            .await
            .expect("транзиентный сбой CDN не должен валить установку");

        transient_mock.assert_async().await;
        assert_eq!(report.installed, vec!["A.jar".to_string()]);
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("jar после ретрая"),
            jar_a
        );
    }

    #[tokio::test]
    async fn install_rejects_oversized_download() {
        let mut env = ModrinthEnv::acquire("modrinth_install_size_limit").await;

        let jar_a = b"unexpectedly long jar body".to_vec();
        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(&jar_a),
            2,
            json!([]),
        );
        mock_version_list(&mut env, version_a).await;
        env.server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(jar_a.clone())
            .create_async()
            .await;

        let ctx = env.install_ctx();
        let result = install_project(&ctx, "A", None).await;

        let error = result.expect_err("заявленный размер должен ограничивать скачивание");
        assert!(
            error.to_string().contains("превысил ожидаемый"),
            "ошибка должна называть превышение размера: {error:#}"
        );
        assert!(!ctx.mods_dir.join("A.jar").exists());
        assert!(
            part_files_in(&ctx.mods_dir).is_empty(),
            "временные файлы превышенного размера должны быть убраны"
        );
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    #[tokio::test]
    async fn install_cleans_partial_download_on_failure() {
        let mut env = ModrinthEnv::acquire("modrinth_install_partial_fail").await;

        let jar_a = b"mod a jar".to_vec();
        let jar_c = b"mod c jar".to_vec();
        let version_a = jar_version(
            &env,
            "verA",
            "A",
            "1.0.0",
            "a.jar",
            &jar_a,
            required_dep("B", None),
        );
        let version_b = jar_version(
            &env,
            "verB",
            "B",
            "0.2.0",
            "b.jar",
            b"mod b jar",
            required_dep("C", None),
        );
        let version_c = jar_version(&env, "verC", "C", "0.3.0", "c.jar", &jar_c, json!([]));

        for (path, version) in [("A", version_a), ("B", version_b), ("C", version_c)] {
            mock_project_versions(&mut env, path, &[version]).await;
        }
        mock_projects_list(&mut env, &[("A", "Mod A"), ("B", "Mod B"), ("C", "Mod C")]).await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", &jar_a).await;
        env.server
            .mock("GET", "/cdn/b.jar")
            .with_status(404)
            .expect(1)
            .create_async()
            .await;
        mock_cdn_jar(&mut env, "/cdn/c.jar", &jar_c).await;

        let ctx = env.install_ctx();
        let result = install_project(&ctx, "A", None).await;
        assert!(
            result.is_err(),
            "отказ одного файла должен валить установку"
        );

        assert!(
            mods_dir_file_names(&ctx).is_empty(),
            "успешно скачанные файлы неудавшейся установки не должны оставаться orphan'ами"
        );
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    #[tokio::test]
    async fn partial_failure_keeps_file_of_tracked_project() {
        let mut env = ModrinthEnv::acquire("modrinth_partial_tracked").await;

        let jar_v1 = b"mod a v1".to_vec();
        let jar_v2 = b"mod a v2".to_vec();
        let version_v2 = jar_version(
            &env,
            "ver2",
            "A",
            "2.0.0",
            "a.jar",
            &jar_v2,
            required_dep("B", None),
        );
        let version_b = jar_version(&env, "verB", "B", "0.2.0", "b.jar", b"mod b jar", json!([]));

        mock_project_versions(&mut env, "A", &[version_v2]).await;
        mock_project_versions(&mut env, "B", &[version_b]).await;
        mock_projects_list(&mut env, &[("A", "Mod A"), ("B", "Mod B")]).await;
        mock_cdn_jar(&mut env, "/cdn/a.jar", &jar_v2).await;
        env.server
            .mock("GET", "/cdn/b.jar")
            .with_status(404)
            .expect(1)
            .create_async()
            .await;

        let ctx = env.install_ctx();
        let tracked = manifest_entry("A", &sha1_hex(&jar_v1), "ver1", "1.0.0");
        seed_mod_manifest(&ctx, vec![("A", tracked)]).await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), &jar_v1)
            .await
            .unwrap();

        let result = install_project(&ctx, "A", None).await;
        assert!(result.is_err());

        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("старый jar на месте"),
            jar_v1,
            "файл отслеживаемого проекта должен остаться с прежним содержимым: новая версия коммитится только после проверки всех файлов"
        );
        assert!(
            part_files_in(&ctx.mods_dir).is_empty(),
            "staging-файлы неудавшейся установки должны быть убраны"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("A").expect("запись A").version_number,
            "1.0.0",
            "манифест остаётся в состоянии до установки"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn install_fails_cleanly_when_manifest_save_fails() {
        let mut env = ModrinthEnv::acquire("modrinth_install_save_fail").await;

        let jar_v1 = b"mod a v1".to_vec();
        let jar_v2 = b"mod a v2".to_vec();
        let version_v1 = jar_version(&env, "ver1", "A", "1.0.0", "a.jar", &jar_v1, json!([]));
        let version_v2 = jar_version(&env, "ver2", "A", "2.0.0", "a.jar", &jar_v2, json!([]));

        let ctx = install_first_version(&mut env, version_v1, &jar_v1).await;

        clear_response_cache_for_tests();
        mock_version_env(&mut env, version_v2, &jar_v2).await;

        set_dir_permissions(env.project_dir().as_path(), 0o555);
        let result = install_project(&ctx, "A", None).await;
        set_dir_permissions(env.project_dir().as_path(), 0o755);

        let error = result.expect_err("сбой сохранения манифеста должен валить установку");
        assert!(
            error.to_string().contains("манифест"),
            "ошибка должна указывать на сохранение манифеста: {error:#}"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("старый jar на месте"),
            jar_v1,
            "при сбое сохранения манифеста файл мода должен остаться прежним: rename-коммит идёт после записи манифеста"
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("A").expect("запись A").version_number,
            "1.0.0",
            "манифест на диске остаётся прежним"
        );
        assert!(
            part_files_in(&ctx.mods_dir).is_empty(),
            "staging-файлы должны быть убраны после сбоя коммита"
        );
    }

    #[cfg(unix)]
    fn set_dir_permissions(path: &std::path::Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = std::fs::metadata(path)
            .expect("метаданные каталога проекта")
            .permissions();
        permissions.set_mode(mode);
        std::fs::set_permissions(path, permissions).expect("права каталога проекта");
    }

    #[tokio::test]
    async fn install_keeps_file_tracked_by_other_project() {
        let mut env = ModrinthEnv::acquire("modrinth_displace_foreign").await;

        let jar_old_b = b"shared file of mod b".to_vec();
        let jar_a2 = b"mod a v2".to_vec();
        let mut version_a2 = version_json(
            "verA2",
            "A",
            "2.0.0",
            format!("{}/cdn/a2.jar", env.server.url()),
            sha1_hex(&jar_a2),
            jar_a2.len() as u64,
            json!([]),
        );
        version_a2["files"][0]["filename"] = json!("A-2.0.0.jar");

        mock_version_env(&mut env, version_a2, &jar_a2).await;

        let ctx = env.install_ctx();
        let mut entry_a = manifest_entry("A", "hash-a-old", "verA1", "1.0.0");
        entry_a.filename = "shared.jar".to_string();
        let mut entry_b = manifest_entry("B", &sha1_hex(&jar_old_b), "verB1", "2.0.0");
        entry_b.filename = "shared.jar".to_string();
        seed_mod_manifest(&ctx, vec![("A", entry_a), ("B", entry_b)]).await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("shared.jar"), &jar_old_b)
            .await
            .unwrap();

        install_project(&ctx, "A", None)
            .await
            .expect("установка новой версии A");

        assert_eq!(
            std::fs::read(ctx.mods_dir.join("shared.jar")).expect("файл проекта B"),
            jar_old_b,
            "файл, отслеживаемый другим project_id, не должен удаляться при вытеснении"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A-2.0.0.jar")).expect("новый jar A"),
            jar_a2
        );
        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("A").expect("запись A").filename,
            "A-2.0.0.jar"
        );
        assert_eq!(
            manifest.mods.get("B").expect("запись B").filename,
            "shared.jar"
        );
        assert_eq!(
            manifest.mods.get("B").expect("запись B").version_number,
            "2.0.0"
        );
    }

    #[tokio::test]
    async fn sync_cancels_without_save_when_mods_dir_unreadable() {
        let env = ModrinthEnv::acquire("modrinth_sync_unreadable").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;
        tokio::fs::write(&ctx.mods_dir, b"not a directory")
            .await
            .unwrap();

        let result = sync_installed_from_scan(&ctx).await;
        assert!(
            result.is_err(),
            "ошибка чтения mods (не «папки нет») должна отменять синхронизацию"
        );

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(
            manifest.mods.contains_key("A"),
            "манифест не должен сохраняться при ошибке чтения папки модов"
        );
    }

    #[tokio::test]
    async fn sync_waiting_on_manifest_lock_keeps_mod_installed_during_wait() {
        let env = ModrinthEnv::acquire("modrinth_sync_lock_race").await;
        let ctx = env.install_ctx();
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();

        let jar_b = b"mod b jar".to_vec();
        tokio::fs::write(ctx.mods_dir.join("B.jar"), &jar_b)
            .await
            .unwrap();
        seed_mod_manifest(
            &ctx,
            vec![(
                "B",
                manifest_entry("B", &sha1_hex(&jar_b), "verB1", "2.0.0"),
            )],
        )
        .await;

        let lock_guard = MANIFEST_WRITE_LOCK.lock().await;
        let sync_ctx = env.install_ctx();
        let sync_handle = tokio::spawn(async move { sync_installed_from_scan(&sync_ctx).await });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let jar_a = b"mod a jar".to_vec();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), &jar_a)
            .await
            .unwrap();
        let mut manifest = load_manifest(&ctx.manifest_path).await.unwrap();
        manifest.mods.insert(
            "A".to_string(),
            manifest_entry("A", &sha1_hex(&jar_a), "verA1", "1.0.0"),
        );
        save_manifest(&ctx.manifest_path, &manifest).await.unwrap();

        drop(lock_guard);
        let result = sync_handle.await.unwrap().expect("синхронизация");

        assert!(
            result.mods.contains_key("A"),
            "мод, установленный пока sync ждал лок, не должен выпадать из манифеста"
        );
        assert!(result.mods.contains_key("B"));
        let saved = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(saved.mods.contains_key("A"));
        assert!(saved.mods.contains_key("B"));
    }

    #[tokio::test]
    async fn sync_prunes_known_hashes_without_files() {
        let env = ModrinthEnv::acquire("modrinth_prune_known").await;
        let ctx = env.install_ctx();
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();

        let jar_a = b"mod a jar".to_vec();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), &jar_a)
            .await
            .unwrap();
        let manifest = ModrinthManifest {
            mods: [(
                "A".to_string(),
                manifest_entry("A", &sha1_hex(&jar_a), "verA1", "1.0.0"),
            )]
            .into_iter()
            .collect(),
            known_hashes: vec![sha1_hex(&jar_a), "hash-gone".to_string()],
        };
        save_manifest(&ctx.manifest_path, &manifest).await.unwrap();

        let synced = sync_installed_from_scan(&ctx)
            .await
            .expect("синхронизация с пруном");

        assert_eq!(
            synced.known_hashes,
            vec![sha1_hex(&jar_a)],
            "хеши без файла в mods не должны накапливаться"
        );
        let saved = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(saved.known_hashes, vec![sha1_hex(&jar_a)]);
    }
}

#[cfg(all(test, unix))]
mod collect_installed_hashes_tests {
    use super::collect_installed_hashes;
    use crate::test_support::LauncherDirGuard;

    #[tokio::test]
    async fn collect_installed_hashes_skips_entries_with_read_error() {
        let guard = LauncherDirGuard::acquire("modrinth_installed_scan").await;
        let mods_dir = guard.project_dir("Proj").join("mods");
        tokio::fs::create_dir_all(&mods_dir)
            .await
            .expect("создание папки модов");
        tokio::fs::write(mods_dir.join("good.jar"), b"jar-content")
            .await
            .expect("запись мода");

        let unreadable = mods_dir.join("broken.jar");
        tokio::fs::write(&unreadable, b"broken")
            .await
            .expect("запись проблемного мода");
        deny_read_permission(&unreadable);

        let hashes = collect_installed_hashes(&mods_dir)
            .await
            .expect("скан папки модов");
        assert_eq!(
            hashes.len(),
            1,
            "скан должен продолжиться после ошибки чтения"
        );
        assert!(hashes.contains_key("good.jar"));
    }

    fn deny_read_permission(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = std::fs::metadata(path)
            .expect("метаданные проблемного мода")
            .permissions();
        permissions.set_mode(0o000);
        std::fs::set_permissions(path, permissions).expect("права на проблемный мод");
    }
}
