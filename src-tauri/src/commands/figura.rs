use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::state::config::validated_project_name;
use crate::utils::allowlisted_read::AllowlistedRead;
use crate::utils::env_info::{is_safe_relative_path, launcher_path};
use crate::utils::errors::LauncherError;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};

const FIGURA_DIR: &str = "figura";
const AVATARS_DIR: &str = "avatars";
const AVATAR_META_FILE: &str = "avatar.json";
const AVATAR_MODEL_FILE: &str = "model.bbmodel";
const TEXTURE_DATA_URL_MARKER: &[u8] = b"data:image/png";
const META_MAX_BYTES: u64 = 64 * 1024;
const MODEL_MAX_BYTES: u64 = 8 * 1024 * 1024;

const AVATAR_META_READ: AllowlistedRead =
    AllowlistedRead::new("json", META_MAX_BYTES, 1024, "КБ", "avatar.json аватара");
const AVATAR_MODEL_READ: AllowlistedRead = AllowlistedRead::new(
    "bbmodel",
    MODEL_MAX_BYTES,
    1024 * 1024,
    "МБ",
    "модели аватара",
);

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
    if !single_segment || name.contains(['/', '\\']) || !is_safe_relative_path(name) {
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
        if validated_avatar_name(name).is_err() {
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
        list_avatars, read_avatar, validated_avatar_name, AVATAR_META_FILE, AVATAR_MODEL_FILE,
    };
    use crate::test_support::LauncherDirGuard;
    use crate::utils::errors::LauncherError;
    use std::path::{Path, PathBuf};

    const PROJECT: &str = "Cordelia";
    const MODEL_WITH_TEXTURE: &str =
        r#"{"elements":[],"textures":[{"source":"data:image/png;base64,iVBORw0KGgo="}]}"#;

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
}
