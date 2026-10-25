use crate::utils::errors::LauncherError;
use anyhow::{bail, Context, Result};
use md5::{Digest, Md5};
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::launcher_server::user_content::{self, UserContentItem};
use crate::offline::{delete_offline_skin_files, offline_skin_paths, parse_offline_skin_model};
use crate::state::config::{current_project_config, validated_project_name};
use crate::state::dto::GlobalState;
use crate::utils::allowlisted_read::AllowlistedRead;
use crate::utils::download_file::{download_file, write_atomic};
use crate::utils::env_info::{ensure_safe_relative_path, launcher_path};
use crate::utils::hex::digest_hex;
use crate::utils::tauri_err::CommandResult;
use crate::{log_err, log_info};

#[derive(Serialize)]
pub struct SessionInfo {
    pub uuid: String,
    pub username: String,
}

#[tauri::command]
pub async fn get_session_info(
    state: State<'_, Mutex<GlobalState>>,
) -> CommandResult<Option<SessionInfo>> {
    let state = state.lock().await;
    Ok(state.session.as_ref().map(|s| SessionInfo {
        uuid: s.uuid.clone(),
        username: s.username.clone(),
    }))
}

#[tauri::command]
pub async fn clear_session(state: State<'_, Mutex<GlobalState>>) -> CommandResult<()> {
    let mut state = state.lock().await;
    state.session = None;
    Ok(())
}

#[tauri::command]
pub async fn upload_skin(
    state: State<'_, Mutex<GlobalState>>,
    request: tauri::ipc::Request<'_>,
) -> CommandResult<UserContentItem> {
    let (model, file_data) = parse_skin_request(&request, "загрузки скина")?;
    ensure_skin_size(file_data.len() as u64)?;

    let item = user_content::upload_skin(&state, file_data, model.as_deref()).await?;
    Ok(item)
}

fn parse_skin_request(
    request: &tauri::ipc::Request<'_>,
    body_context: &str,
) -> Result<(Option<String>, Vec<u8>)> {
    let model = request
        .headers()
        .get("Skin-Model")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| match value {
            "slim" => Some("slim".to_string()),
            "classic" => Some("classic".to_string()),
            _ => None,
        });

    let file_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(value) => LauncherError::classify(
            serde_json::from_value(value.clone())
                .with_context(|| format!("Некорректное тело запроса {body_context}")),
            LauncherError::InvalidInput,
        )?,
    };

    Ok((model, file_data))
}

#[tauri::command]
pub async fn list_skins(
    state: State<'_, Mutex<GlobalState>>,
    uuid: String,
) -> CommandResult<Vec<UserContentItem>> {
    let items = user_content::list_skins(&state, uuid).await?;
    Ok(items)
}

#[tauri::command]
pub async fn delete_skin(state: State<'_, Mutex<GlobalState>>, id: i64) -> CommandResult<()> {
    user_content::delete_skin(&state, id).await?;
    Ok(())
}

#[tauri::command]
pub async fn set_active_skin(state: State<'_, Mutex<GlobalState>>, id: i64) -> CommandResult<()> {
    user_content::set_active_skin(&state, id).await?;
    Ok(())
}

fn skin_cache_name(uuid: &str, url: &str) -> Result<String> {
    let hash = Md5::digest(url.as_bytes());
    let name = format!("{}_{}.png", uuid, digest_hex(hash));
    ensure_safe_relative_path(&name, "uuid профиля")?;
    Ok(name)
}

fn ensure_skin_origin(url: &str, server_url: Option<&str>) -> Result<()> {
    let Some(server_url) = server_url else {
        return Err(LauncherError::InvalidInput(
            "Скин можно получить только с сервера профиля".to_string(),
        )
        .into());
    };
    let skin = url::Url::parse(url)
        .map_err(|_| LauncherError::InvalidInput("Некорректная ссылка на скин".to_string()))?;
    if !matches!(skin.scheme(), "http" | "https") {
        return Err(LauncherError::InvalidInput(
            "Скин можно получить только по http(s)-ссылке".to_string(),
        )
        .into());
    }
    let origin = url::Url::parse(server_url).map_err(|_| {
        LauncherError::LauncherServer("Не удалось разобрать адрес сервера профиля".to_string())
    })?;
    if skin.scheme() != origin.scheme()
        || skin.host() != origin.host()
        || skin.port_or_known_default() != origin.port_or_known_default()
    {
        return Err(LauncherError::InvalidInput(
            "Скин можно получить только с сервера профиля".to_string(),
        )
        .into());
    }
    Ok(())
}

async fn get_profile_skin_inner(
    state: &State<'_, Mutex<GlobalState>>,
    url: &str,
) -> Result<Vec<u8>> {
    let config = current_project_config(state.inner()).await?;
    let server_url = config.resolved_server_url();
    let project_name = config.project_name;
    let uuid = state
        .lock()
        .await
        .session
        .as_ref()
        .map(|s| s.uuid.clone())
        .ok_or(LauncherError::NoSession)?;

    ensure_skin_origin(url, server_url.as_deref())?;

    let cache_dir = launcher_path(Some(&project_name))?.join("profile_skins");
    let file_name = skin_cache_name(&uuid, url)?;
    let cache_path = cache_dir.join(&file_name);
    let prefix = format!("{}_", uuid);

    crate::utils::blocking("Не удалось очистить кэш скинов", {
        let cache_dir = cache_dir.clone();
        let file_name = file_name.clone();
        let prefix = prefix.clone();
        move || {
            if let Ok(entries) = std::fs::read_dir(&cache_dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.starts_with(&prefix) && name != file_name {
                            let _ = std::fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    })
    .await?;

    download_file(url, &cache_path).await?;

    let cache_path_clone = cache_path.clone();
    let bytes = crate::utils::blocking(
        "Не удалось прочитать кэш скина",
        move || {
            std::fs::read(&cache_path_clone)
                .with_context(|| format!("Не удалось прочитать {:?}", cache_path_clone))
        },
    )
    .await??;
    Ok(bytes)
}

#[tauri::command]
pub async fn get_profile_skin(
    state: State<'_, Mutex<GlobalState>>,
    url: String,
) -> CommandResult<tauri::ipc::Response> {
    let bytes = get_profile_skin_inner(&state, &url).await?;
    log_info!("Скин профиля получен из кэша: {}", url);
    Ok(tauri::ipc::Response::new(bytes))
}

const SKIN_EXT: &str = "png";
const SKIN_MAX_BYTES: u64 = 512 * 1024;
const SKIN_FILE_READ: AllowlistedRead =
    AllowlistedRead::new(SKIN_EXT, SKIN_MAX_BYTES, 1024, "КБ", "скина");

fn ensure_skin_size(len: u64) -> Result<()> {
    if len > SKIN_MAX_BYTES {
        return Err(LauncherError::InvalidInput(format!(
            "Файл скина слишком большой: {} КБ, максимум {} КБ",
            len / 1024,
            SKIN_MAX_BYTES / 1024
        ))
        .into());
    }
    Ok(())
}

#[tauri::command]
pub async fn read_skin_file(path: String) -> CommandResult<tauri::ipc::Response> {
    let bytes = SKIN_FILE_READ.read(&path).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn upload_model(
    state: State<'_, Mutex<GlobalState>>,
    file_content: String,
) -> CommandResult<UserContentItem> {
    let item = user_content::upload_model(&state, file_content).await?;
    Ok(item)
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, Mutex<GlobalState>>,
    uuid: String,
) -> CommandResult<Vec<UserContentItem>> {
    let items = user_content::list_models(&state, uuid).await?;
    Ok(items)
}

#[tauri::command]
pub async fn delete_model(state: State<'_, Mutex<GlobalState>>, id: i64) -> CommandResult<()> {
    user_content::delete_model(&state, id).await?;
    Ok(())
}

#[tauri::command]
pub async fn save_offline_skin(
    project_name: String,
    model: String,
    file_data: Vec<u8>,
) -> CommandResult<()> {
    save_offline_skin_inner(&project_name, &model, file_data).await?;
    Ok(())
}

async fn save_offline_skin_inner(
    project_name: &str,
    model: &str,
    file_data: Vec<u8>,
) -> Result<()> {
    let project_name = validated_project_name(project_name)?;
    if model != "slim" && model != "classic" {
        bail!(LauncherError::InvalidInput(
            "Некорректная модель скина".to_string()
        ));
    }
    ensure_skin_size(file_data.len() as u64)?;

    let (png_path, meta_path) = offline_skin_paths(project_name)?;
    let png_parent = png_path.parent().map(|p| p.to_path_buf());

    crate::utils::blocking(
        "Не удалось подготовить каталог скинов",
        move || -> Result<()> {
            if let Some(parent) = png_parent {
                std::fs::create_dir_all(&parent)
                    .with_context(|| format!("Не удалось создать каталог {:?}", parent))?;
            }
            Ok(())
        },
    )
    .await??;

    LauncherError::classify(
        write_atomic(&png_path, &file_data)
            .await
            .context("Не удалось записать локальный скин"),
        LauncherError::DiskIo,
    )?;

    let meta = serde_json::json!({ "model": model });
    if let Err(e) = write_atomic(&meta_path, meta.to_string().as_bytes()).await {
        let _ = tokio::fs::remove_file(&png_path).await;
        LauncherError::classify(
            Err(e).context("Не удалось записать метаданные локального скина"),
            LauncherError::DiskIo,
        )?;
    }

    log_info!("Локальный скин сохранён: {}", png_path.display());
    Ok(())
}

#[tauri::command]
pub async fn get_offline_skin(project_name: String) -> CommandResult<tauri::ipc::Response> {
    let project_name = validated_project_name(&project_name)?;
    let (png_path, _) = offline_skin_paths(project_name)?;
    let bytes = crate::utils::blocking(
        "Не удалось прочитать локальный скин",
        move || match std::fs::read(&png_path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => {
                log_err!("Не удалось прочитать локальный скин {:?}: {}", png_path, e);
                Vec::new()
            }
        },
    )
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_offline_skin_model(project_name: String) -> CommandResult<Option<String>> {
    let project_name = validated_project_name(&project_name)?;
    let (_, meta_path) = offline_skin_paths(project_name)?;
    let model = crate::utils::blocking(
        "Не удалось прочитать модель локального скина",
        move || {
            std::fs::read(&meta_path)
                .ok()
                .and_then(|bytes| parse_offline_skin_model(&bytes))
        },
    )
    .await?;
    Ok(model)
}

#[tauri::command]
pub async fn delete_offline_skin(project_name: String) -> CommandResult<()> {
    let project_name = validated_project_name(&project_name)?;
    delete_offline_skin_files(project_name).await?;
    Ok(())
}

#[cfg(test)]
mod skin_size_tests {
    use super::{ensure_skin_size, SKIN_MAX_BYTES};

    #[test]
    fn size_at_limit_is_accepted() {
        assert!(ensure_skin_size(SKIN_MAX_BYTES).is_ok());
        assert!(ensure_skin_size(0).is_ok());
    }

    #[test]
    fn size_above_limit_is_rejected() {
        let error = ensure_skin_size(SKIN_MAX_BYTES + 1).expect_err("превышение лимита");
        assert!(
            error.to_string().contains("слишком большой"),
            "ошибка должна объяснять превышение лимита: {error}"
        );
    }
}

#[cfg(test)]
mod skin_cache_name_tests {
    use super::{digest_hex, skin_cache_name};
    use md5::{Digest, Md5};

    #[test]
    fn traversal_uuid_is_rejected() {
        let error = skin_cache_name("../../evil", "https://example.invalid/skin.png")
            .expect_err("uuid с обходом пути должен быть отклонён");
        assert!(
            error.to_string().contains("Некорректное значение uuid"),
            "ошибка должна объяснять проблему: {error}"
        );
    }

    #[test]
    fn windows_style_traversal_uuid_is_rejected() {
        assert!(skin_cache_name("..\\evil", "https://example.invalid/skin.png").is_err());
    }

    #[test]
    fn normal_uuid_builds_cache_name() {
        let url = "https://example.invalid/skin.png";
        let name =
            skin_cache_name("069a79f4-44e9-4726-a5be-fca90e38aaf5", url).expect("валидный uuid");
        let hash = Md5::digest(url.as_bytes());
        assert_eq!(
            name,
            format!(
                "069a79f4-44e9-4726-a5be-fca90e38aaf5_{}.png",
                digest_hex(hash)
            )
        );
    }
}

#[cfg(test)]
mod skin_origin_tests {
    use super::ensure_skin_origin;
    use crate::utils::errors::LauncherError;

    const SERVER: &str = "https://mc.example.com";

    #[test]
    fn same_origin_url_is_allowed() {
        ensure_skin_origin("https://mc.example.com/skins/1.png", Some(SERVER))
            .expect("совпадающий origin должен проходить");
        ensure_skin_origin("https://mc.example.com:443/skins/1.png", Some(SERVER))
            .expect("порт по умолчанию эквивалентен отсутствию порта");
    }

    #[test]
    fn foreign_host_is_rejected() {
        let error = ensure_skin_origin("https://evil.example/skins/1.png", Some(SERVER))
            .expect_err("чужой хост должен отклоняться");
        assert!(
            error.to_string().contains("только с сервера профиля"),
            "ошибка должна объяснять причину: {error}"
        );
    }

    #[test]
    fn localhost_ssrf_target_is_rejected() {
        for url in [
            "http://127.0.0.1:8080/admin",
            "http://localhost/metadata",
            "http://169.254.169.254/latest/meta-data",
        ] {
            assert!(
                ensure_skin_origin(url, Some(SERVER)).is_err(),
                "внутренний адрес не должен скачиваться: {url}"
            );
        }
    }

    #[test]
    fn different_port_and_scheme_are_rejected() {
        assert!(ensure_skin_origin("https://mc.example.com:8443/skin.png", Some(SERVER)).is_err());
        assert!(ensure_skin_origin("http://mc.example.com/skin.png", Some(SERVER)).is_err());
    }

    #[test]
    fn non_http_scheme_is_rejected() {
        for url in [
            "file:///etc/passwd",
            "ftp://mc.example.com/skin.png",
            "\\\\server\\share\\skin.png",
        ] {
            let error = ensure_skin_origin(url, Some(SERVER))
                .expect_err("не-http схема должна отклоняться: {url}");
            assert!(
                matches!(
                    error.downcast_ref::<LauncherError>(),
                    Some(LauncherError::InvalidInput(_))
                ),
                "ожидается InvalidInput для {url}: {error}"
            );
        }
    }

    #[test]
    fn unparseable_url_is_rejected() {
        assert!(ensure_skin_origin("not a url", Some(SERVER)).is_err());
    }

    #[test]
    fn missing_server_url_is_rejected() {
        let error = ensure_skin_origin("https://mc.example.com/skins/1.png", None)
            .expect_err("без адреса сервера скачивание запрещено");
        assert!(
            error.to_string().contains("только с сервера профиля"),
            "ошибка должна объяснять причину: {error}"
        );
    }
}

#[cfg(test)]
mod offline_skin_tests {
    use super::{save_offline_skin_inner, SKIN_MAX_BYTES};
    use crate::test_support::LauncherDirGuard;
    use crate::utils::errors::LauncherError;

    #[tokio::test]
    async fn save_offline_skin_writes_into_the_named_project_dir() {
        let guard = LauncherDirGuard::acquire("offline_skin_named").await;

        save_offline_skin_inner("Alpha", "slim", vec![1, 2, 3])
            .await
            .expect("сохранение скина в именованный проект");

        let dir = guard.project_dir("Alpha").join("profile_skins");
        assert!(dir.join("offline_skin.png").exists(), "png на месте");
        assert!(
            dir.join("offline_skin.json").exists(),
            "метаданные на месте"
        );
        assert!(
            !guard.project_dir("Beta").exists(),
            "чужой проект не должен создаваться"
        );
    }

    #[tokio::test]
    async fn save_offline_skin_rejects_path_like_project_name() {
        let _guard = LauncherDirGuard::acquire("offline_skin_invalid_name").await;

        let error = save_offline_skin_inner("../Evil", "slim", vec![1])
            .await
            .expect_err("путь в имени проекта должен отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::ProjectNameInvalidChars)
            ),
            "ожидается ProjectNameInvalidChars: {error:#}"
        );
    }

    #[tokio::test]
    async fn save_offline_skin_rejects_unknown_model() {
        let guard = LauncherDirGuard::acquire("offline_skin_invalid_model").await;

        let error = save_offline_skin_inner("Alpha", "hd", vec![1])
            .await
            .expect_err("неизвестная модель должна отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error:#}"
        );
        assert!(
            !guard.project_dir("Alpha").exists(),
            "файлов быть не должно"
        );
    }

    #[tokio::test]
    async fn save_offline_skin_rejects_oversized_file() {
        let guard = LauncherDirGuard::acquire("offline_skin_oversize").await;

        let error =
            save_offline_skin_inner("Alpha", "slim", vec![0u8; SKIN_MAX_BYTES as usize + 1])
                .await
                .expect_err("превышение лимита должно отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error:#}"
        );
        assert!(
            !guard.project_dir("Alpha").exists(),
            "файлов быть не должно"
        );
    }
}
