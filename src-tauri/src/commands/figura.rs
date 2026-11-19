use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::sync::Mutex;

use crate::state::config::validated_project_name;
use crate::utils::allowlisted_read::AllowlistedRead;
use crate::utils::download_file::write_atomic;
use crate::utils::env_info::{is_safe_relative_path, launcher_path};
use crate::utils::errors::LauncherError;
use crate::utils::ipc_headers::{header_raw, required_text_header};
use crate::utils::tauri_err::CommandResult;
use crate::utils::zip::extract_zip_with_wrap;
use crate::{log_err, log_info};

const FIGURA_DIR: &str = "figura";
const AVATARS_DIR: &str = "avatars";
const AVATAR_META_FILE: &str = "avatar.json";
const AVATAR_MODEL_FILE: &str = "model.bbmodel";
const STAGING_DIR: &str = ".staging";
const TEXTURE_DATA_URL_MARKER: &[u8] = b"data:image/png";
const META_MAX_BYTES: u64 = 64 * 1024;
const MODEL_MAX_BYTES: u64 = 8 * 1024 * 1024;
const ARCHIVE_EXT: &str = "zip";
const ARCHIVE_MAX_BYTES: u64 = 64 * 1024 * 1024;
const EXTRACT_MAX_BYTES: u64 = 128 * 1024 * 1024;
const AVATAR_NAME_MAX_CHARS: usize = 64;
const RESERVED_NAME_CHARS: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

const PROJECT_NAME_HEADER: &str = "Project-Name";
const AVATAR_NAME_HEADER: &str = "Avatar-Name";
const AVATAR_OVERWRITE_HEADER: &str = "Avatar-Overwrite";

const AVATAR_META_READ: AllowlistedRead =
    AllowlistedRead::new("json", META_MAX_BYTES, 1024, "КБ", "avatar.json аватара");
const AVATAR_MODEL_READ: AllowlistedRead = AllowlistedRead::new(
    "bbmodel",
    MODEL_MAX_BYTES,
    1024 * 1024,
    "МБ",
    "модели аватара",
);
const AVATAR_ARCHIVE_READ: AllowlistedRead = AllowlistedRead::new(
    ARCHIVE_EXT,
    ARCHIVE_MAX_BYTES,
    1024 * 1024,
    "МБ",
    "архива аватара",
);

static FIGURA_INSTALL_LOCK: Mutex<()> = Mutex::const_new(());
static TEMP_ARCHIVE_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiguraAvatarEntry {
    pub name: String,
    pub authors: Vec<String>,
    pub description: String,
    pub has_model: bool,
    pub has_texture: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct FiguraAvatarMeta {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiguraAvatarData {
    pub name: String,
    pub authors: Vec<String>,
    pub description: String,
    pub color: Option<String>,
    pub model: Vec<u8>,
}

fn avatars_dir(project_name: &str) -> Result<PathBuf> {
    Ok(launcher_path(Some(project_name))?
        .join(FIGURA_DIR)
        .join(AVATARS_DIR))
}

fn validated_avatar_name(raw: &str) -> Result<&str> {
    let name = raw.trim();
    let single_segment = !name.is_empty() && name != "." && name != "..";
    let invalid_chars = name.contains(RESERVED_NAME_CHARS);
    let too_long = name.chars().count() > AVATAR_NAME_MAX_CHARS;
    if !single_segment || invalid_chars || too_long || !is_safe_relative_path(name) {
        bail!(LauncherError::InvalidInput(format!(
            "Некорректное имя аватара Figura: {raw}"
        )));
    }
    Ok(name)
}

async fn is_dir(path: &Path) -> bool {
    fs::metadata(path)
        .await
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
}

async fn is_file(path: &Path) -> bool {
    fs::metadata(path)
        .await
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

async fn load_avatar_meta(dir: &Path) -> Result<FiguraAvatarMeta> {
    let path = dir.join(AVATAR_META_FILE);
    if !is_file(&path).await {
        return Ok(FiguraAvatarMeta::default());
    }
    let path_str = path.to_str().ok_or_else(|| {
        LauncherError::DiskIo(format!("Некорректный путь avatar.json: {:?}", path))
    })?;
    let bytes = AVATAR_META_READ.read(path_str).await?;
    serde_json::from_slice::<FiguraAvatarMeta>(&bytes)
        .with_context(|| format!("Не удалось разобрать avatar.json {:?}", path))
}

async fn read_avatar_meta(dir: &Path) -> FiguraAvatarMeta {
    match load_avatar_meta(dir).await {
        Ok(meta) => meta,
        Err(e) => {
            log_err!("Не удалось прочитать avatar.json: {e:#}");
            FiguraAvatarMeta::default()
        }
    }
}

async fn has_embedded_texture(model_path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(model_path).await else {
        return false;
    };
    if !metadata.is_file() || metadata.len() > MODEL_MAX_BYTES {
        return false;
    }
    let Ok(bytes) = fs::read(model_path).await else {
        return false;
    };
    bytes
        .windows(TEXTURE_DATA_URL_MARKER.len())
        .any(|window| window == TEXTURE_DATA_URL_MARKER)
}

async fn avatar_entry(dir: &Path, name: &str) -> FiguraAvatarEntry {
    let meta = read_avatar_meta(dir).await;
    let model_path = dir.join(AVATAR_MODEL_FILE);
    let has_model = is_file(&model_path).await;
    FiguraAvatarEntry {
        name: name.to_string(),
        authors: meta.authors,
        description: meta.description,
        has_model,
        has_texture: has_model && has_embedded_texture(&model_path).await,
    }
}

async fn list_avatars(project_name: &str) -> Result<Vec<FiguraAvatarEntry>> {
    let dir = avatars_dir(project_name)?;
    let mut entries = match fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log_info!("Каталог аватаров Figura отсутствует: {:?}", dir);
            return Ok(Vec::new());
        }
        Err(e) => {
            return LauncherError::classify(
                Err(e).with_context(|| format!("Не удалось прочитать каталог аватаров {dir:?}")),
                LauncherError::DiskIo,
            );
        }
    };

    let mut avatars = Vec::new();
    while let Some(entry) = LauncherError::classify(
        entries
            .next_entry()
            .await
            .context("Не удалось прочитать запись каталога аватаров Figura"),
        LauncherError::DiskIo,
    )? {
        let path = entry.path();
        if !is_dir(&path).await {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with('.') || validated_avatar_name(name).is_err() {
            continue;
        }
        avatars.push(avatar_entry(&path, name).await);
    }
    avatars.sort_by(|a, b| a.name.cmp(&b.name));
    log_info!("Найдено аватаров Figura: {}", avatars.len());
    Ok(avatars)
}

async fn read_avatar(project_name: &str, avatar_name: &str) -> Result<FiguraAvatarData> {
    let name = validated_avatar_name(avatar_name)?;
    let dir = avatars_dir(project_name)?.join(name);
    if !is_dir(&dir).await {
        bail!(LauncherError::DiskIo(format!(
            "Аватар Figura «{name}» не найден"
        )));
    }

    let meta = load_avatar_meta(&dir).await?;
    let model_path = dir.join(AVATAR_MODEL_FILE);
    if !is_file(&model_path).await {
        bail!(LauncherError::DiskIo(format!(
            "В аватаре Figura «{name}» нет файла {AVATAR_MODEL_FILE}"
        )));
    }
    let model_path_str = model_path.to_str().ok_or_else(|| {
        LauncherError::DiskIo(format!(
            "Некорректный путь модели аватара Figura: {:?}",
            model_path
        ))
    })?;
    let model = AVATAR_MODEL_READ.read(model_path_str).await?;
    let display_name = if meta.name.trim().is_empty() {
        name.to_string()
    } else {
        meta.name.clone()
    };

    log_info!(
        "Аватар Figura прочитан: {name} ({} байт модели)",
        model.len()
    );
    Ok(FiguraAvatarData {
        name: display_name,
        authors: meta.authors,
        description: meta.description,
        color: meta.color,
        model,
    })
}

async fn remove_dir_best_effort(path: &Path) {
    if !path.exists() {
        return;
    }
    if let Err(e) = fs::remove_dir_all(path).await {
        log_err!("Не удалось удалить каталог {:?}: {e:#}", path);
    }
}

fn temp_archive_path(staging_dir: &Path, name: &str) -> PathBuf {
    let seq = TEMP_ARCHIVE_SEQ.fetch_add(1, Ordering::Relaxed);
    staging_dir.join(format!("{name}.{seq}.{ARCHIVE_EXT}"))
}

async fn avatar_root(extracted: &Path) -> Result<PathBuf> {
    if is_file(&extracted.join(AVATAR_MODEL_FILE)).await {
        return Ok(extracted.to_path_buf());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut entries = fs::read_dir(extracted)
        .await
        .with_context(|| format!("Не удалось прочитать распакованный архив {:?}", extracted))?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .with_context(|| format!("Не удалось прочитать распакованный архив {:?}", extracted))?
    {
        let path = entry.path();
        if is_file(&path.join(AVATAR_MODEL_FILE)).await {
            candidates.push(path);
        }
    }
    match candidates.len() {
        0 => bail!(LauncherError::InvalidInput(format!(
            "В архиве аватара не найден файл {AVATAR_MODEL_FILE}"
        ))),
        1 => Ok(candidates.remove(0)),
        _ => bail!(LauncherError::InvalidInput(
            "Архив содержит несколько аватаров, нужен ровно один".to_string()
        )),
    }
}

async fn install_avatar_from_archive(
    project_name: &str,
    avatar_name: &str,
    archive_path: &Path,
    overwrite: bool,
) -> Result<()> {
    install_avatar_from_archive_limited(
        project_name,
        avatar_name,
        archive_path,
        overwrite,
        EXTRACT_MAX_BYTES,
    )
    .await
}

async fn install_avatar_from_archive_limited(
    project_name: &str,
    avatar_name: &str,
    archive_path: &Path,
    overwrite: bool,
    extract_limit: u64,
) -> Result<()> {
    let name = validated_avatar_name(avatar_name)?;
    let root = avatars_dir(project_name)?;
    let target = root.join(name);

    let _guard = FIGURA_INSTALL_LOCK.lock().await;
    if is_dir(&target).await && !overwrite {
        bail!(LauncherError::FiguraAvatarExists(name.to_string()));
    }
    let staging_dir = root.join(STAGING_DIR).join(format!(
        "{name}.{}",
        TEMP_ARCHIVE_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    if let Err(e) = fs::create_dir_all(&staging_dir).await {
        return Err(LauncherError::DiskIo(format!(
            "Не удалось создать временный каталог {:?}: {e:#}",
            staging_dir
        ))
        .into());
    }

    let result = install_avatar_staged(&staging_dir, &target, archive_path, extract_limit).await;
    remove_dir_best_effort(&staging_dir).await;
    let _ = fs::remove_dir(root.join(STAGING_DIR)).await;
    result
}

async fn install_avatar_staged(
    staging_dir: &Path,
    target: &Path,
    archive_path: &Path,
    extract_limit: u64,
) -> Result<()> {
    let extract_dir = staging_dir.join("extracted");
    fs::create_dir_all(&extract_dir)
        .await
        .with_context(|| format!("Не удалось создать каталог распаковки {extract_dir:?}"))?;
    let archive = archive_path.to_path_buf();
    let extract_to = extract_dir.clone();
    crate::utils::blocking(
        "Не удалось распаковать архив аватара Figura",
        move || {
            extract_zip_with_wrap(&archive, &extract_to, extract_limit, |message| {
                LauncherError::InvalidInput(message)
            })
        },
    )
    .await??;

    let root = avatar_root(&extract_dir).await?;
    let backup = staging_dir.join("previous");
    if target.exists() {
        fs::rename(target, &backup)
            .await
            .with_context(|| format!("Не удалось отложить предыдущий аватар Figura {target:?}"))?;
    }
    if let Err(e) = fs::rename(&root, target).await {
        if backup.exists() {
            let _ = fs::rename(&backup, target).await;
        }
        return Err(e)
            .with_context(|| format!("Не удалось переместить аватар Figura в {target:?}"));
    }
    remove_dir_best_effort(&backup).await;
    log_info!("Аватар Figura установлен: {:?}", target);
    Ok(())
}

fn parse_install_request(
    headers: &tauri::http::HeaderMap,
    body: &tauri::ipc::InvokeBody,
) -> Result<(String, String, bool, Vec<u8>)> {
    let data = match body {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(LauncherError::InvalidInput(
                "Архив аватара должен передаваться бинарным телом запроса".to_string(),
            )
            .into());
        }
    };
    let overwrite = match header_raw(headers, AVATAR_OVERWRITE_HEADER) {
        Some("true") => true,
        Some("false") | None => false,
        Some(_) => {
            return Err(LauncherError::InvalidInput(format!(
                "Некорректное значение заголовка {AVATAR_OVERWRITE_HEADER}"
            ))
            .into());
        }
    };
    if data.len() as u64 > ARCHIVE_MAX_BYTES {
        return Err(LauncherError::InvalidInput(format!(
            "Архив аватара слишком большой: {} МБ, максимум {} МБ",
            data.len() / (1024 * 1024),
            ARCHIVE_MAX_BYTES / (1024 * 1024)
        ))
        .into());
    }
    Ok((
        required_text_header(headers, PROJECT_NAME_HEADER)?,
        required_text_header(headers, AVATAR_NAME_HEADER)?,
        overwrite,
        data,
    ))
}

#[tauri::command]
pub async fn read_figura_archive(path: String) -> CommandResult<tauri::ipc::Response> {
    let bytes = AVATAR_ARCHIVE_READ.read(&path).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn install_figura_avatar(request: tauri::ipc::Request<'_>) -> CommandResult<()> {
    let (project_name, avatar_name, overwrite, data) =
        parse_install_request(request.headers(), request.body())?;
    let project_name = validated_project_name(&project_name)?;
    let name = validated_avatar_name(&avatar_name)?;
    let root = avatars_dir(project_name)?;
    fs::create_dir_all(&root)
        .await
        .with_context(|| format!("Не удалось создать каталог аватаров {root:?}"))?;
    let staging_dir = root.join(STAGING_DIR);
    fs::create_dir_all(&staging_dir)
        .await
        .with_context(|| format!("Не удалось создать каталог установки {staging_dir:?}"))?;
    let archive_path = temp_archive_path(&staging_dir, name);
    write_atomic(&archive_path, &data).await?;
    let result = install_avatar_from_archive(project_name, name, &archive_path, overwrite).await;
    let _ = fs::remove_file(&archive_path).await;
    result?;
    Ok(())
}

#[tauri::command]
pub async fn list_figura_avatars(project_name: String) -> CommandResult<Vec<FiguraAvatarEntry>> {
    let project_name = validated_project_name(&project_name)?;
    Ok(list_avatars(project_name).await?)
}

#[tauri::command]
pub async fn read_figura_avatar(
    project_name: String,
    avatar_name: String,
) -> CommandResult<FiguraAvatarData> {
    let project_name = validated_project_name(&project_name)?;
    Ok(read_avatar(project_name, &avatar_name).await?)
}

#[cfg(test)]
mod tests {
    use super::{
        install_avatar_from_archive, install_avatar_from_archive_limited, list_avatars,
        read_avatar, validated_avatar_name, AVATAR_META_FILE, AVATAR_MODEL_FILE,
    };
    use crate::test_support::{write_test_zip, LauncherDirGuard};
    use crate::utils::errors::LauncherError;
    use std::path::{Path, PathBuf};

    const PROJECT: &str = "Cordelia";
    const MODEL_WITH_TEXTURE: &str =
        r#"{"elements":[],"textures":[{"source":"data:image/png;base64,iVBORw0KGgo="}]}"#;
    const AVATAR_META_JSON: &str = r#"{"name":"Hecate","authors":["tekina"]}"#;

    fn avatars_root(guard: &LauncherDirGuard) -> PathBuf {
        guard.project_dir(PROJECT).join("figura").join("avatars")
    }

    async fn avatar_dir(guard: &LauncherDirGuard, name: &str) -> PathBuf {
        let dir = avatars_root(guard).join(name);
        tokio::fs::create_dir_all(&dir).await.unwrap();
        dir
    }

    async fn write_meta(dir: &Path, content: &str) {
        tokio::fs::write(dir.join(AVATAR_META_FILE), content)
            .await
            .unwrap();
    }

    async fn write_model(dir: &Path) {
        tokio::fs::write(dir.join(AVATAR_MODEL_FILE), b"{}")
            .await
            .unwrap();
    }

    async fn write_textured_model(dir: &Path) {
        tokio::fs::write(dir.join(AVATAR_MODEL_FILE), MODEL_WITH_TEXTURE)
            .await
            .unwrap();
    }

    fn archive_dir(guard: &LauncherDirGuard) -> PathBuf {
        guard.root().join("figura_archives")
    }

    async fn write_zip(
        guard: &LauncherDirGuard,
        file_name: &str,
        entries: &[(&str, &[u8])],
    ) -> PathBuf {
        let path = archive_dir(guard).join(file_name);
        write_test_zip(&path, entries);
        path
    }

    async fn write_avatar_zip(
        guard: &LauncherDirGuard,
        file_name: &str,
        wrapper: &str,
        with_model: bool,
    ) -> PathBuf {
        let model_path = format!("{wrapper}/{AVATAR_MODEL_FILE}");
        let meta_path = format!("{wrapper}/{AVATAR_META_FILE}");
        let mut entries: Vec<(&str, &[u8])> = vec![(&meta_path, AVATAR_META_JSON.as_bytes())];
        if with_model {
            entries.push((&model_path, b"{}"));
        }
        write_zip(guard, file_name, &entries).await
    }

    #[tokio::test]
    async fn missing_directory_is_an_empty_list() {
        let _guard = LauncherDirGuard::acquire("figura_list_missing").await;

        let avatars = list_avatars(PROJECT)
            .await
            .expect("отсутствующий каталог это пустой список");

        assert!(avatars.is_empty());
    }

    #[tokio::test]
    async fn empty_directory_is_an_empty_list() {
        let guard = LauncherDirGuard::acquire("figura_list_empty").await;
        tokio::fs::create_dir_all(avatars_root(&guard))
            .await
            .unwrap();

        let avatars = list_avatars(PROJECT).await.expect("пустой каталог");

        assert!(avatars.is_empty());
    }

    #[tokio::test]
    async fn avatar_with_meta_is_listed_with_author() {
        let guard = LauncherDirGuard::acquire("figura_list_meta").await;
        let dir = avatar_dir(&guard, "Tekina").await;
        write_meta(
            &dir,
            r##"{"name":"Tekina","description":"Базовый скин","authors":["tekina"],"color":"#7a4b8f"}"##,
        )
        .await;
        write_model(&dir).await;

        let avatars = list_avatars(PROJECT).await.expect("каталог с аватаром");

        assert_eq!(avatars.len(), 1);
        assert_eq!(avatars[0].name, "Tekina");
        assert_eq!(avatars[0].authors, vec!["tekina".to_string()]);
        assert_eq!(avatars[0].description, "Базовый скин");
        assert!(avatars[0].has_model);
        assert!(!avatars[0].has_texture);
    }

    #[tokio::test]
    async fn avatar_without_model_has_model_false() {
        let guard = LauncherDirGuard::acquire("figura_list_no_model").await;
        let dir = avatar_dir(&guard, "Empty").await;
        write_meta(&dir, r#"{"name":"Empty","authors":["a"]}"#).await;

        let avatars = list_avatars(PROJECT).await.expect("каталог с аватаром");

        assert_eq!(avatars.len(), 1);
        assert!(!avatars[0].has_model);
        let error = read_avatar(PROJECT, "Empty")
            .await
            .expect_err("без модели аватар не читается");
        assert!(
            error.to_string().contains(AVATAR_MODEL_FILE),
            "ошибка называет файл: {error}"
        );
    }

    #[tokio::test]
    async fn avatar_with_embedded_texture_has_texture_true() {
        let guard = LauncherDirGuard::acquire("figura_list_texture").await;
        let dir = avatar_dir(&guard, "Tekina").await;
        write_meta(&dir, r#"{"name":"Tekina"}"#).await;
        write_textured_model(&dir).await;

        let avatars = list_avatars(PROJECT).await.expect("каталог с аватаром");

        assert!(avatars[0].has_model);
        assert!(avatars[0].has_texture);
    }

    #[tokio::test]
    async fn avatar_without_embedded_texture_has_texture_false() {
        let guard = LauncherDirGuard::acquire("figura_list_plain_model").await;
        let dir = avatar_dir(&guard, "Tekina").await;
        write_meta(&dir, r#"{"name":"Tekina"}"#).await;
        write_model(&dir).await;

        let avatars = list_avatars(PROJECT).await.expect("каталог с аватаром");

        assert!(avatars[0].has_model);
        assert!(!avatars[0].has_texture);
    }

    #[tokio::test]
    async fn corrupt_meta_keeps_avatar_listed() {
        let guard = LauncherDirGuard::acquire("figura_list_corrupt").await;
        let dir = avatar_dir(&guard, "Broken").await;
        write_meta(&dir, "{ это не json").await;
        write_model(&dir).await;

        let avatars = list_avatars(PROJECT)
            .await
            .expect("битый avatar.json не роняет список");

        assert_eq!(avatars.len(), 1);
        assert_eq!(avatars[0].name, "Broken");
        assert!(avatars[0].authors.is_empty());
        assert!(avatars[0].has_model);
    }

    #[tokio::test]
    async fn plain_files_are_not_listed() {
        let guard = LauncherDirGuard::acquire("figura_list_files").await;
        let root = avatars_root(&guard);
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(root.join("notes.txt"), b"x")
            .await
            .unwrap();

        let avatars = list_avatars(PROJECT).await.expect("файлы не аватары");

        assert!(avatars.is_empty());
    }

    #[tokio::test]
    async fn avatars_are_sorted_by_name() {
        let guard = LauncherDirGuard::acquire("figura_list_order").await;
        avatar_dir(&guard, "beta").await;
        avatar_dir(&guard, "alpha").await;

        let avatars = list_avatars(PROJECT).await.expect("сортировка имён");
        let names: Vec<&str> = avatars.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(names, vec!["alpha", "beta"]);
    }

    #[tokio::test]
    async fn read_avatar_returns_model_bytes_and_meta() {
        let guard = LauncherDirGuard::acquire("figura_read_ok").await;
        let dir = avatar_dir(&guard, "Tekina").await;
        write_meta(
            &dir,
            r##"{"name":"Tekina","description":"Описание","authors":["tekina"],"color":"#7a4b8f"}"##,
        )
        .await;
        tokio::fs::write(dir.join(AVATAR_MODEL_FILE), b"model-bytes")
            .await
            .unwrap();

        let data = read_avatar(PROJECT, "Tekina")
            .await
            .expect("чтение аватара");

        assert_eq!(data.name, "Tekina");
        assert_eq!(data.authors, vec!["tekina".to_string()]);
        assert_eq!(data.description, "Описание");
        assert_eq!(data.color.as_deref(), Some("#7a4b8f"));
        assert_eq!(data.model, b"model-bytes");
    }

    #[tokio::test]
    async fn read_avatar_without_meta_falls_back_to_folder_name() {
        let guard = LauncherDirGuard::acquire("figura_read_no_meta").await;
        let dir = avatar_dir(&guard, "Tekina").await;
        write_model(&dir).await;

        let data = read_avatar(PROJECT, "Tekina")
            .await
            .expect("чтение без avatar.json");

        assert_eq!(data.name, "Tekina");
        assert!(data.authors.is_empty());
        assert!(data.color.is_none());
    }

    #[tokio::test]
    async fn read_avatar_reports_corrupt_meta() {
        let guard = LauncherDirGuard::acquire("figura_read_corrupt_meta").await;
        let dir = avatar_dir(&guard, "Broken").await;
        write_meta(&dir, "{ это не json").await;
        write_model(&dir).await;

        let error = read_avatar(PROJECT, "Broken")
            .await
            .expect_err("битый avatar.json не отдаётся молча");

        assert!(
            error.to_string().contains(AVATAR_META_FILE),
            "ошибка называет файл: {error}"
        );
    }

    #[tokio::test]
    async fn read_avatar_rejects_absolute_name() {
        let _guard = LauncherDirGuard::acquire("figura_read_abs").await;

        let error = read_avatar(PROJECT, "/etc/passwd")
            .await
            .expect_err("абсолютный путь отклоняется");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error}"
        );
    }

    #[tokio::test]
    async fn read_avatar_rejects_parent_dir_name() {
        let _guard = LauncherDirGuard::acquire("figura_read_parent").await;

        let error = read_avatar(PROJECT, "../secret")
            .await
            .expect_err("выход из каталога отклоняется");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error}"
        );
    }

    #[test]
    fn avatar_name_with_parent_dir_is_rejected() {
        assert!(validated_avatar_name("..").is_err());
        assert!(validated_avatar_name(".").is_err());
        assert!(validated_avatar_name("../secret").is_err());
        assert!(validated_avatar_name("nested/avatar").is_err());
        assert!(validated_avatar_name(r"nested\avatar").is_err());
        assert!(validated_avatar_name("/etc/passwd").is_err());
        assert!(validated_avatar_name(r"C:\avatars").is_err());
        assert!(validated_avatar_name("").is_err());
        assert!(validated_avatar_name("   ").is_err());
        assert_eq!(
            validated_avatar_name(" Tekina ").expect("имя папки допустимо"),
            "Tekina"
        );
    }

    #[test]
    fn avatar_name_with_reserved_chars_is_rejected() {
        for name in ["a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b"] {
            assert!(
                validated_avatar_name(name).is_err(),
                "имя {name:?} должно отклоняться"
            );
        }
        assert!(
            validated_avatar_name(&"a".repeat(65)).is_err(),
            "имя длиннее 64 символов отклоняется"
        );
        assert_eq!(
            validated_avatar_name(&"a".repeat(64)).expect("имя на границе допустимо"),
            "a".repeat(64)
        );
        assert_eq!(
            validated_avatar_name("Геката").expect("кириллица допустима"),
            "Геката"
        );
    }

    #[tokio::test]
    async fn install_extracts_archive_into_named_avatar_dir() {
        let guard = LauncherDirGuard::acquire("figura_install_ok").await;
        let archive = write_avatar_zip(&guard, "Hecate.zip", "Hecate", true).await;

        install_avatar_from_archive(PROJECT, "Hecate", &archive, false)
            .await
            .expect("установка аватара из архива");

        let target = avatars_root(&guard).join("Hecate");
        assert!(
            target.join(AVATAR_MODEL_FILE).exists(),
            "модель на месте установки"
        );
        assert!(
            target.join(AVATAR_META_FILE).exists(),
            "avatar.json на месте"
        );

        let avatars = list_avatars(PROJECT).await.expect("список после установки");
        assert_eq!(avatars.len(), 1);
        assert_eq!(avatars[0].name, "Hecate");
        assert!(avatars[0].has_model, "установленный аватар виден модели");
    }

    #[tokio::test]
    async fn install_unwraps_single_wrapping_directory() {
        let guard = LauncherDirGuard::acquire("figura_install_wrap").await;
        let archive = write_avatar_zip(&guard, "Hecate.zip", "wrapped", true).await;

        install_avatar_from_archive(PROJECT, "Hecate", &archive, false)
            .await
            .expect("установка аватара с обёрточной папкой");

        let target = avatars_root(&guard).join("Hecate");
        assert!(
            target.join(AVATAR_MODEL_FILE).is_file(),
            "модель развёрнута из вложенной папки"
        );
        assert!(
            !target.join("wrapped").exists(),
            "обёрточная папка не остаётся внутри аватара"
        );
    }

    #[tokio::test]
    async fn install_rejects_archive_without_model() {
        let guard = LauncherDirGuard::acquire("figura_install_nomodel").await;
        let archive = write_avatar_zip(&guard, "Broken.zip", "Broken", false).await;

        let error = install_avatar_from_archive(PROJECT, "Broken", &archive, false)
            .await
            .expect_err("архив без model.bbmodel отклоняется");

        assert!(
            error.to_string().contains(AVATAR_MODEL_FILE),
            "ошибка называет модель: {error}"
        );
        assert!(
            !avatars_root(&guard).join("Broken").exists(),
            "неудачная установка не оставляет каталог аватара"
        );
    }

    #[tokio::test]
    async fn install_reports_existing_avatar_without_overwrite() {
        let guard = LauncherDirGuard::acquire("figura_install_exists").await;
        let existing = avatar_dir(&guard, "Hecate").await;
        tokio::fs::write(existing.join(AVATAR_MODEL_FILE), b"old-model")
            .await
            .unwrap();
        let archive = write_avatar_zip(&guard, "Hecate.zip", "Hecate", true).await;

        let error = install_avatar_from_archive(PROJECT, "Hecate", &archive, false)
            .await
            .expect_err("существующий аватар без замены");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::FiguraAvatarExists(_))
            ),
            "ожидается FiguraAvatarExists: {error}"
        );
        assert_eq!(
            tokio::fs::read(existing.join(AVATAR_MODEL_FILE))
                .await
                .unwrap(),
            b"old-model",
            "старый аватар не изменён"
        );
    }

    #[tokio::test]
    async fn install_replaces_existing_avatar_with_overwrite() {
        let guard = LauncherDirGuard::acquire("figura_install_overwrite").await;
        let existing = avatar_dir(&guard, "Hecate").await;
        tokio::fs::write(existing.join(AVATAR_MODEL_FILE), b"old-model")
            .await
            .unwrap();
        tokio::fs::write(existing.join("stale.lua"), b"old-script")
            .await
            .unwrap();
        let archive = write_avatar_zip(&guard, "Hecate.zip", "Hecate", true).await;

        install_avatar_from_archive(PROJECT, "Hecate", &archive, true)
            .await
            .expect("замена существующего аватара");

        let model = tokio::fs::read(existing.join(AVATAR_MODEL_FILE))
            .await
            .unwrap();
        assert_ne!(model, b"old-model", "модель заменена");
        assert!(
            !existing.join("stale.lua").exists(),
            "файлы старого аватара удалены"
        );
        let mut entries = tokio::fs::read_dir(avatars_root(&guard)).await.unwrap();
        let mut leftovers: Vec<String> = Vec::new();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                leftovers.push(name);
            }
        }
        assert!(
            leftovers.is_empty(),
            "служебные каталоги убраны: {leftovers:?}"
        );
    }

    #[tokio::test]
    async fn install_skips_traversal_entries() {
        let guard = LauncherDirGuard::acquire("figura_install_slip").await;
        let archive = write_zip(
            &guard,
            "Hecate.zip",
            &[("../evil.txt", b"evil"), (AVATAR_MODEL_FILE, b"{}")],
        )
        .await;

        install_avatar_from_archive(PROJECT, "Hecate", &archive, false)
            .await
            .expect("traversal-запись пропускается");

        let escaped = avatars_root(&guard).join("evil.txt");
        assert!(!escaped.exists(), "запись с .. не выходит из каталога");
        assert!(
            !guard.project_dir(PROJECT).join("evil.txt").exists(),
            "запись с .. не поднимается выше figura"
        );
    }

    #[tokio::test]
    async fn install_rejects_oversized_archive() {
        let guard = LauncherDirGuard::acquire("figura_install_big").await;
        let archive = write_avatar_zip(&guard, "Big.zip", "Big", true).await;

        let error = install_avatar_from_archive_limited(PROJECT, "Big", &archive, false, 16)
            .await
            .expect_err("превышение лимита распаковки");

        assert!(
            error.to_string().contains("лимит") || error.to_string().contains("распаковать"),
            "ошибка объясняет лимит: {error}"
        );
        assert!(
            !avatars_root(&guard).join("Big").exists(),
            "неудачная установка не оставляет каталог"
        );
    }

    #[tokio::test]
    async fn install_rejects_invalid_avatar_name() {
        let guard = LauncherDirGuard::acquire("figura_install_badname").await;
        let archive = write_avatar_zip(&guard, "Hecate.zip", "Hecate", true).await;

        let error = install_avatar_from_archive(PROJECT, "../secret", &archive, false)
            .await
            .expect_err("недопустимое имя аватара");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error}"
        );
    }

    #[tokio::test]
    async fn install_keeps_service_dirs_out_of_the_list() {
        let guard = LauncherDirGuard::acquire("figura_install_service").await;
        tokio::fs::create_dir_all(avatars_root(&guard).join(".staging"))
            .await
            .unwrap();

        let avatars = list_avatars(PROJECT)
            .await
            .expect("служебный каталог не аватар");

        assert!(avatars.is_empty(), "скрытые каталоги не попадают в список");
    }
}
