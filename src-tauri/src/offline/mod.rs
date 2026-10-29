use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::utils::errors::LauncherError;
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use tokio::fs;

use crate::utils::blocking;
use crate::utils::download_file::{download_file, file_sha256, write_atomic};
use crate::utils::env_info::launcher_path;
use crate::{log_err, log_info};

mod launch;
mod server;

pub use launch::AuthlibLaunch;
use server::SkinServer;

const AUTHLIB_LATEST_URL: &str = "https://authlib-injector.yushi.moe/artifact/latest.json";
const AUTHLIB_LATEST_TTL: Duration = Duration::from_secs(6 * 60 * 60);

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

async fn start_offline_skin_server(
    project_name: &str,
    username: &str,
    uuid: &str,
) -> Result<Option<SkinServer>> {
    let skin = read_offline_skin(project_name).await?;
    let game_dir = launcher_path(Some(project_name))?;
    let jar = match resolve_launch_jar(&game_dir).await {
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

async fn resolve_launch_jar(game_dir: &Path) -> Result<PathBuf> {
    resolve_launch_jar_from(game_dir, AUTHLIB_LATEST_URL).await
}

async fn resolve_launch_jar_from(game_dir: &Path, latest_url: &str) -> Result<PathBuf> {
    let jar_path = game_dir.join("authlib-injector.jar");
    let version_path = game_dir.join("authlib-injector.json");
    if jar_path.exists() && installed_authlib_version(version_path).await?.is_some() {
        let background_dir = game_dir.to_path_buf();
        let background_url = latest_url.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = ensure_authlib_jar_from(&background_dir, &background_url).await {
                log_err!("Фоновое обновление authlib-injector не удалось: {e}");
            }
        });
        return Ok(jar_path);
    }
    ensure_authlib_jar_from(game_dir, latest_url).await
}

async fn ensure_authlib_jar_from(game_dir: &Path, latest_url: &str) -> Result<PathBuf> {
    let jar_path = game_dir.join("authlib-injector.jar");
    let version_path = game_dir.join("authlib-injector.json");
    let scratch_path = authlib_scratch_path()?;

    let latest = match fetch_authlib_latest(latest_url, &scratch_path).await {
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

    let staging_path = jar_path.with_extension("part");
    let _ = fs::remove_file(&staging_path).await;
    download_file(&latest.download_url, &staging_path)
        .await
        .context("Не удалось скачать authlib-injector.jar")?;

    let expected_sha = latest.checksums.sha256.clone();
    let actual_sha = file_sha256(&staging_path)
        .await
        .context("Не удалось проверить authlib-injector.jar")?;
    if !actual_sha.eq_ignore_ascii_case(&expected_sha) {
        let _ = fs::remove_file(&staging_path).await;
        bail!("Контрольная сумма authlib-injector.jar не совпала");
    }

    fs::rename(&staging_path, &jar_path).await.context(format!(
        "Не удалось заменить authlib-injector.jar новой версией {:?}",
        jar_path
    ))?;

    let version_meta = serde_json::json!({ "version": latest.version });
    write_atomic(&version_path, version_meta.to_string().as_bytes())
        .await
        .context("Не удалось записать версию authlib-injector")?;

    Ok(jar_path)
}

fn authlib_scratch_path() -> Result<PathBuf> {
    Ok(launcher_path(None)?
        .join("manifest")
        .join("authlib-latest.json"))
}

async fn authlib_cache_fresh(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path).await else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    modified.elapsed().is_ok_and(|age| age < AUTHLIB_LATEST_TTL)
}

async fn fetch_authlib_latest(latest_url: &str, scratch_path: &Path) -> Result<AuthlibLatest> {
    let mut refetched = false;
    loop {
        if !authlib_cache_fresh(scratch_path).await {
            let _ = fs::remove_file(scratch_path).await;
            download_file(latest_url, scratch_path).await?;
        }
        let scratch = scratch_path.to_path_buf();
        let parsed: Result<AuthlibLatest> = blocking(
            "Не удалось разобрать манифест authlib-injector",
            move || -> Result<AuthlibLatest> {
                let bytes = std::fs::read(&scratch)?;
                Ok(serde_json::from_slice(&bytes)?)
            },
        )
        .await?;
        match parsed {
            Ok(latest) => return Ok(latest),
            Err(e) => {
                let _ = fs::remove_file(scratch_path).await;
                if refetched {
                    return Err(e.context("Не удалось разобрать манифест authlib-injector"));
                }
                refetched = true;
            }
        }
    }
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
    use super::{
        authlib_cache_fresh, authlib_scratch_path, ensure_authlib_jar_from, offline_skin_paths,
        parse_offline_skin_model, resolve_launch_jar_from, AUTHLIB_LATEST_TTL,
    };
    use crate::test_support::{part_files_in, LauncherDirGuard};
    use crate::utils::hex::digest_hex;
    use mockito::Server;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant, SystemTime};

    fn sha256_hex(bytes: &[u8]) -> String {
        digest_hex(Sha256::digest(bytes))
    }

    async fn mock_artifact(
        server: &mut Server,
        manifest_path: &str,
        jar_path: &str,
        version: &str,
        jar: &[u8],
    ) -> (mockito::Mock, mockito::Mock) {
        let manifest = json!({
            "version": version,
            "download_url": format!("{}{}", server.url(), jar_path),
            "checksums": {"sha256": sha256_hex(jar)}
        });
        let manifest_mock = server
            .mock("GET", manifest_path)
            .with_status(200)
            .with_body(manifest.to_string())
            .expect(1)
            .create_async()
            .await;
        let jar_mock = server
            .mock("GET", jar_path)
            .with_status(200)
            .with_body(jar)
            .expect(1)
            .create_async()
            .await;
        (manifest_mock, jar_mock)
    }

    fn sidecar_version(game_dir: &Path) -> String {
        let bytes =
            std::fs::read(game_dir.join("authlib-injector.json")).expect("чтение sidecar версии");
        String::from_utf8(bytes).expect("sidecar — utf8 json")
    }

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

    #[tokio::test]
    async fn scratch_path_lives_in_launcher_manifest_dir() {
        let guard = LauncherDirGuard::acquire("authlib_scratch").await;

        let scratch = authlib_scratch_path().expect("путь scratch-файла");

        assert_eq!(
            scratch,
            guard.root().join("manifest").join("authlib-latest.json"),
            "scratch должен лежать в каталоге данных лаунчера, а не в общем temp"
        );
    }

    #[tokio::test]
    async fn cache_fresh_respects_ttl() {
        let guard = LauncherDirGuard::acquire("authlib_ttl").await;
        let cache = guard.root().join("manifest").join("authlib-latest.json");
        tokio::fs::create_dir_all(cache.parent().unwrap())
            .await
            .unwrap();

        assert!(
            !authlib_cache_fresh(&cache).await,
            "отсутствующий кеш не свежий"
        );

        tokio::fs::write(&cache, b"{}").await.unwrap();
        assert!(
            authlib_cache_fresh(&cache).await,
            "только что записанный кеш свежий"
        );

        let stale = SystemTime::now() - AUTHLIB_LATEST_TTL - Duration::from_secs(60);
        let times = std::fs::FileTimes::new().set_modified(stale);
        std::fs::File::open(&cache)
            .unwrap()
            .set_times(times)
            .unwrap();
        assert!(
            !authlib_cache_fresh(&cache).await,
            "кеш старше TTL не свежий"
        );
    }

    #[tokio::test]
    async fn ensure_authlib_jar_replaces_outdated_jar() {
        let guard = LauncherDirGuard::acquire("authlib_update").await;
        let mut server = Server::new_async().await;
        let game_dir = guard.root().join("project/AuthGame");

        let jar_v1 = b"authlib agent v1".to_vec();
        let jar_v2 = b"authlib agent v2".to_vec();
        let (manifest_v1_mock, jar_v1_mock) = mock_artifact(
            &mut server,
            "/artifact/latest.json",
            "/artifact/authlib-1.jar",
            "1.0.0",
            &jar_v1,
        )
        .await;

        let latest_url = format!("{}/artifact/latest.json", server.url());
        let jar = ensure_authlib_jar_from(&game_dir, &latest_url)
            .await
            .expect("первая установка authlib-injector");
        assert_eq!(jar, game_dir.join("authlib-injector.jar"));
        assert_eq!(std::fs::read(&jar).expect("jar v1"), jar_v1);
        assert!(sidecar_version(&game_dir).contains("1.0.0"));

        tokio::fs::remove_file(authlib_scratch_path().expect("scratch путь"))
            .await
            .expect("сброс кеша манифеста — имитация нового релиза");

        let (manifest_v2_mock, jar_v2_mock) = mock_artifact(
            &mut server,
            "/artifact/latest-2.json",
            "/artifact/authlib-2.jar",
            "2.0.0",
            &jar_v2,
        )
        .await;

        let latest_url_v2 = format!("{}/artifact/latest-2.json", server.url());
        let jar = ensure_authlib_jar_from(&game_dir, &latest_url_v2)
            .await
            .expect("обновление authlib-injector должно заменить jar без ошибок");
        assert_eq!(std::fs::read(&jar).expect("jar v2"), jar_v2);
        assert!(
            sidecar_version(&game_dir).contains("2.0.0"),
            "sidecar версии должен обновиться: {}",
            sidecar_version(&game_dir)
        );

        manifest_v1_mock.assert_async().await;
        jar_v1_mock.assert_async().await;
        manifest_v2_mock.assert_async().await;
        jar_v2_mock.assert_async().await;
    }

    #[tokio::test]
    async fn ensure_authlib_jar_uses_cached_jar_when_version_matches() {
        let guard = LauncherDirGuard::acquire("authlib_cached").await;
        let mut server = Server::new_async().await;
        let game_dir = guard.root().join("project/AuthGame");

        let jar_v1 = b"authlib agent v1".to_vec();
        let (manifest_mock, jar_mock) = mock_artifact(
            &mut server,
            "/artifact/latest.json",
            "/artifact/authlib-1.jar",
            "1.0.0",
            &jar_v1,
        )
        .await;

        let latest_url = format!("{}/artifact/latest.json", server.url());
        let first = ensure_authlib_jar_from(&game_dir, &latest_url)
            .await
            .expect("первая установка authlib-injector");
        let second = ensure_authlib_jar_from(&game_dir, &latest_url)
            .await
            .expect("повторный вызов должен отдать скачанный jar");

        assert_eq!(first, second);
        assert_eq!(std::fs::read(&first).expect("jar"), jar_v1);
        manifest_mock.assert_async().await;
        jar_mock.assert_async().await;
    }

    async fn corrupt_scratch_cache(body: &[u8]) -> PathBuf {
        let scratch = authlib_scratch_path().expect("scratch путь");
        tokio::fs::create_dir_all(scratch.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&scratch, body)
            .await
            .expect("битый кеш манифеста");
        scratch
    }

    #[tokio::test]
    async fn broken_latest_cache_is_refetched_once() {
        let guard = LauncherDirGuard::acquire("authlib_broken_cache").await;
        let mut server = Server::new_async().await;
        let game_dir = guard.root().join("project/AuthGame");

        let jar = b"authlib agent fresh";
        let (manifest_mock, jar_mock) = mock_artifact(
            &mut server,
            "/artifact/latest.json",
            "/artifact/authlib.jar",
            "1.0.0",
            jar,
        )
        .await;

        corrupt_scratch_cache(b"<html>captive portal error page</html>").await;

        let latest_url = format!("{}/artifact/latest.json", server.url());
        let jar_path = ensure_authlib_jar_from(&game_dir, &latest_url)
            .await
            .expect("битый кеш должен инвалидоваться и перекачаться");

        assert_eq!(std::fs::read(&jar_path).expect("jar"), jar);
        assert!(sidecar_version(&game_dir).contains("1.0.0"));
        manifest_mock.assert_async().await;
        jar_mock.assert_async().await;
    }

    #[tokio::test]
    async fn unparsable_latest_is_removed_after_single_retry() {
        let guard = LauncherDirGuard::acquire("authlib_garbage_manifest").await;
        let mut server = Server::new_async().await;
        let game_dir = guard.root().join("project/AuthGame");

        let manifest_mock = server
            .mock("GET", "/artifact/latest.json")
            .with_status(200)
            .with_body("<html>captive portal</html>")
            .expect(1)
            .create_async()
            .await;

        let scratch = corrupt_scratch_cache(b"{ not json").await;

        let latest_url = format!("{}/artifact/latest.json", server.url());
        let error = ensure_authlib_jar_from(&game_dir, &latest_url)
            .await
            .expect_err("мусор вместо манифеста должен давать ошибку");

        assert!(
            error.to_string().contains("Не удалось скачать манифест"),
            "ошибка должна называть проблему манифеста: {error}"
        );
        assert!(
            !scratch.exists(),
            "битый манифест не должен оставаться в кеше до конца TTL"
        );
        manifest_mock.assert_async().await;
    }

    #[tokio::test]
    async fn resolve_launch_jar_skips_network_when_jar_and_sidecar_present() {
        let guard = LauncherDirGuard::acquire("authlib_launch_fast").await;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("глухой порт");
        let game_dir = guard.root().join("project/AuthGame");
        tokio::fs::create_dir_all(&game_dir).await.unwrap();

        let jar_bytes = b"installed agent";
        tokio::fs::write(game_dir.join("authlib-injector.jar"), jar_bytes)
            .await
            .unwrap();
        tokio::fs::write(
            game_dir.join("authlib-injector.json"),
            br#"{"version":"1.0.0"}"#,
        )
        .await
        .unwrap();

        let latest_url = format!(
            "http://127.0.0.1:{}/artifact/latest.json",
            listener.local_addr().unwrap().port()
        );
        let started = Instant::now();
        let jar = resolve_launch_jar_from(&game_dir, &latest_url)
            .await
            .expect("наличие jar и sidecar не должно требовать сеть");
        let elapsed = started.elapsed();

        assert!(
            elapsed < Duration::from_secs(2),
            "запуск не должен ждать недоступный хост: {elapsed:?}"
        );
        assert_eq!(std::fs::read(&jar).expect("jar"), jar_bytes);
        assert_eq!(
            sidecar_version(&game_dir),
            r#"{"version":"1.0.0"}"#,
            "sidecar не должен меняться на быстром пути"
        );
    }

    #[tokio::test]
    async fn failed_update_keeps_previous_jar() {
        let guard = LauncherDirGuard::acquire("authlib_update_fail").await;
        let mut server = Server::new_async().await;
        let game_dir = guard.root().join("project/AuthGame");

        let jar_v1 = b"authlib agent v1";
        let (manifest_v1_mock, jar_v1_mock) = mock_artifact(
            &mut server,
            "/artifact/latest.json",
            "/artifact/authlib-1.jar",
            "1.0.0",
            jar_v1,
        )
        .await;
        let latest_url = format!("{}/artifact/latest.json", server.url());
        ensure_authlib_jar_from(&game_dir, &latest_url)
            .await
            .expect("первая установка authlib-injector");
        manifest_v1_mock.assert_async().await;
        jar_v1_mock.assert_async().await;

        tokio::fs::remove_file(authlib_scratch_path().expect("scratch путь"))
            .await
            .expect("сброс кеша манифеста");
        server
            .mock("GET", "/artifact/latest-2.json")
            .with_status(200)
            .with_body(
                json!({
                    "version": "2.0.0",
                    "download_url": format!("{}/artifact/authlib-2.jar", server.url()),
                    "checksums": {"sha256": sha256_hex(jar_v1)}
                })
                .to_string(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/artifact/authlib-2.jar")
            .with_status(500)
            .create_async()
            .await;

        let latest_url_v2 = format!("{}/artifact/latest-2.json", server.url());
        let error = ensure_authlib_jar_from(&game_dir, &latest_url_v2)
            .await
            .expect_err("неудачная загрузка должна давать ошибку");
        assert!(
            error
                .to_string()
                .contains("Не удалось скачать authlib-injector.jar"),
            "ошибка должна называть проблему загрузки: {error}"
        );
        assert_eq!(
            std::fs::read(game_dir.join("authlib-injector.jar")).expect("старый jar"),
            jar_v1,
            "неудачная загрузка не должна трогать рабочий jar"
        );
        assert!(
            sidecar_version(&game_dir).contains("1.0.0"),
            "sidecar версии должен остаться прежним"
        );
        assert!(
            part_files_in(&game_dir).is_empty(),
            "после неудачи не должно оставаться временных файлов"
        );

        tokio::fs::remove_file(authlib_scratch_path().expect("scratch путь"))
            .await
            .expect("сброс кеша манифеста");
        server
            .mock("GET", "/artifact/latest-3.json")
            .with_status(200)
            .with_body(
                json!({
                    "version": "3.0.0",
                    "download_url": format!("{}/artifact/authlib-3.jar", server.url()),
                    "checksums": {"sha256": sha256_hex(b"authlib agent v3 genuine")}
                })
                .to_string(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/artifact/authlib-3.jar")
            .with_status(200)
            .with_body(b"authlib agent v3 corrupted")
            .create_async()
            .await;

        let latest_url_v3 = format!("{}/artifact/latest-3.json", server.url());
        let error = ensure_authlib_jar_from(&game_dir, &latest_url_v3)
            .await
            .expect_err("несовпадение контрольной суммы должно давать ошибку");
        assert!(
            error.to_string().contains("Контрольная сумма"),
            "ошибка должна называть несовпадение суммы: {error}"
        );
        assert_eq!(
            std::fs::read(game_dir.join("authlib-injector.jar")).expect("старый jar"),
            jar_v1,
            "несовпадение суммы не должно трогать рабочий jar"
        );
        assert!(
            sidecar_version(&game_dir).contains("1.0.0"),
            "sidecar версии должен остаться прежним после несовпадения суммы"
        );
        assert!(part_files_in(&game_dir).is_empty());
    }
}
