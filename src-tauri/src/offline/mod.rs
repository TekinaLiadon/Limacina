use std::path::{Path, PathBuf};

use crate::utils::errors::LauncherError;
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::utils::blocking;
use crate::utils::download_file::{download_file, write_atomic};
use crate::utils::env_info::launcher_path;
use crate::utils::hex::digest_hex;
use crate::{log_err, log_info};

pub use server::SkinServer;

mod server;

const AUTHLIB_LATEST_URL: &str = "https://authlib-injector.yushi.moe/artifact/latest.json";

#[derive(Deserialize)]
struct AuthlibLatest {
    version: String,
    download_url: String,
    checksums: AuthlibChecksums,
}

#[derive(Deserialize)]
struct AuthlibChecksums {
    sha256: String,
}

pub fn offline_skin_paths(project_name: &str) -> Result<(PathBuf, PathBuf)> {
    if project_name.trim().is_empty() {
        bail!(LauncherError::ProjectNotSelected);
    }
    let cache_dir = launcher_path(Some(project_name))?.join("profile_skins");
    Ok((
        cache_dir.join("offline_skin.png"),
        cache_dir.join("offline_skin.json"),
    ))
}

pub fn parse_offline_skin_model(bytes: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    value
        .get("model")
        .and_then(|m| m.as_str())
        .filter(|m| *m == "slim" || *m == "classic")
        .map(|m| m.to_string())
}

pub async fn delete_offline_skin_files(project_name: &str) -> Result<()> {
    let (png_path, meta_path) = offline_skin_paths(project_name)?;
    blocking(
        "Не удалось удалить локальный скин",
        move || {
            let _ = std::fs::remove_file(&png_path);
            let _ = std::fs::remove_file(&meta_path);
        },
    )
    .await
}

pub async fn start_offline_skin_server(
    project_name: &str,
    username: &str,
    uuid: &str,
) -> Result<Option<SkinServer>> {
    let skin = read_offline_skin(project_name).await?;
    let game_dir = launcher_path(Some(project_name))?;
    let jar = match ensure_authlib_jar(&game_dir).await {
        Ok(jar) => jar,
        Err(e) => {
            log_err!(
                "Офлайн-запуск: не удалось подготовить authlib-injector ({}), мультиплеер и скин могут быть недоступны",
                e
            );
            return Ok(None);
        }
    };
    log_info!("authlib-injector готов: {}", jar.display());

    let server = SkinServer::start(skin, uuid.to_string(), username.to_string())?;
    log_info!("Локальный authlib-шим: {}", server.url());
    Ok(Some(server))
}

async fn read_offline_skin(project_name: &str) -> Result<Option<(Vec<u8>, Option<String>)>> {
    let (png_path, meta_path) = offline_skin_paths(project_name)?;
    blocking(
        "Не удалось прочитать локальный скин",
        move || -> Result<Option<(Vec<u8>, Option<String>)>> {
            let bytes = match std::fs::read(&png_path) {
                Ok(bytes) if !bytes.is_empty() => bytes,
                Ok(_) => return Ok(None),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(e) => bail!("Не удалось прочитать {:?}: {}", png_path, e),
            };
            let model = std::fs::read(&meta_path)
                .ok()
                .and_then(|meta| parse_offline_skin_model(&meta));
            Ok(Some((bytes, model)))
        },
    )
    .await?
}

async fn ensure_authlib_jar(game_dir: &Path) -> Result<PathBuf> {
    let jar_path = game_dir.join("authlib-injector.jar");
    let version_path = game_dir.join("authlib-injector.json");
    let scratch_path = std::env::temp_dir().join("limacina-authlib-latest.json");

    let latest = match fetch_authlib_latest(&scratch_path).await {
        Ok(latest) => latest,
        Err(e) => {
            if jar_path.exists() {
                log_err!(
                    "authlib-injector: манифест версии недоступен ({}), используется скачанный jar",
                    e
                );
                return Ok(jar_path);
            }
            return Err(e.context("Не удалось скачать манифест authlib-injector"));
        }
    };

    if jar_path.exists() {
        let installed_version = installed_authlib_version(version_path.clone()).await?;
        if installed_version.as_deref() == Some(latest.version.as_str()) {
            return Ok(jar_path);
        }
        log_info!(
            "Обновление authlib-injector: {} -> {}",
            installed_version.unwrap_or_default(),
            latest.version
        );
    } else {
        log_info!("Скачивание authlib-injector {}...", latest.version);
    }

    download_file(&latest.download_url, &jar_path)
        .await
        .context("Не удалось скачать authlib-injector.jar")?;

    let (jar_for_hash, expected_sha) = (jar_path.clone(), latest.checksums.sha256.clone());
    blocking(
        "Не удалось проверить authlib-injector.jar",
        move || -> Result<()> {
            let bytes = std::fs::read(&jar_for_hash)?;
            let actual = digest_hex(Sha256::digest(&bytes));
            if !actual.eq_ignore_ascii_case(&expected_sha) {
                std::fs::remove_file(&jar_for_hash).ok();
                bail!("Контрольная сумма authlib-injector.jar не совпала");
            }
            Ok(())
        },
    )
    .await??;

    let version_meta = serde_json::json!({ "version": latest.version });
    write_atomic(&version_path, version_meta.to_string().as_bytes())
        .await
        .context("Не удалось записать версию authlib-injector")?;

    Ok(jar_path)
}

async fn fetch_authlib_latest(scratch_path: &Path) -> Result<AuthlibLatest> {
    download_file(AUTHLIB_LATEST_URL, scratch_path).await?;
    let scratch = scratch_path.to_path_buf();
    blocking(
        "Не удалось разобрать манифест authlib-injector",
        move || -> Result<AuthlibLatest> {
            let bytes = std::fs::read(&scratch)?;
            Ok(serde_json::from_slice(&bytes)?)
        },
    )
    .await?
}

async fn installed_authlib_version(version_path: PathBuf) -> Result<Option<String>> {
    blocking(
        "Не удалось прочитать версию authlib-injector",
        move || {
            std::fs::read(&version_path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .and_then(|value| {
                    value
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string())
                })
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{offline_skin_paths, parse_offline_skin_model};

    #[test]
    fn offline_skin_paths_include_project_folder() {
        let (png, meta) = offline_skin_paths("Cordelia").expect("путь должен построиться");
        let png_str = png.to_string_lossy().replace('\\', "/");
        let meta_str = meta.to_string_lossy().replace('\\', "/");
        assert!(png_str.ends_with("/project/Cordelia/profile_skins/offline_skin.png"));
        assert!(meta_str.ends_with("/project/Cordelia/profile_skins/offline_skin.json"));
    }

    #[test]
    fn offline_skin_paths_reject_empty_project() {
        assert!(offline_skin_paths("").is_err());
        assert!(offline_skin_paths("   ").is_err());
    }

    #[test]
    fn offline_skin_model_parses_valid_sidecar() {
        assert_eq!(
            parse_offline_skin_model(br#"{"model":"slim"}"#),
            Some("slim".to_string())
        );
        assert_eq!(
            parse_offline_skin_model(br#"{"model":"classic"}"#),
            Some("classic".to_string())
        );
    }

    #[test]
    fn offline_skin_model_rejects_invalid_sidecar() {
        assert_eq!(parse_offline_skin_model(br#"{"model":"heroic"}"#), None);
        assert_eq!(parse_offline_skin_model(br#"{"other":1}"#), None);
        assert_eq!(parse_offline_skin_model(b"not json"), None);
    }

    #[test]
    #[ignore = "требует доступ к authlib-injector.yushi.moe"]
    fn ensure_authlib_jar_downloads_and_caches() {
        let game_dir =
            std::env::temp_dir().join(format!("limacina-authlib-test-{}", std::process::id()));
        std::fs::create_dir_all(&game_dir).expect("каталог должен создаться");

        let jar = tokio::runtime::Runtime::new()
            .expect("runtime должен создаться")
            .block_on(async { super::ensure_authlib_jar(&game_dir).await })
            .expect("докачка jar должна удаться");
        assert!(jar.exists());
        assert_eq!(jar.file_name().unwrap(), "authlib-injector.jar");

        let second = tokio::runtime::Runtime::new()
            .expect("runtime должен создаться")
            .block_on(async { super::ensure_authlib_jar(&game_dir).await })
            .expect("повторный вызов должен отдать кеш");
        assert_eq!(second, jar);

        std::fs::remove_dir_all(&game_dir).ok();
    }
}
