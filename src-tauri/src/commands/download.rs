use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::commands::game_options::{
    clear_pending_after_install, install_game_options, install_options_for_project, GameOptions,
};
use crate::java::alternative_java::{
    cancel_alt_java_download, download_alt_java, get_java_distributions_list, JavaDistribution,
};
use crate::java::install_java;
use crate::java::parse_java_major;
use crate::java::resolve_java_version;
use crate::launcher_server::downloader::{download_all_files, download_mods};
use crate::minecraft::structs::MinecraftLoader;
use crate::state::config::{current_project_config, update_project_config};
use crate::state::dto::ModLoader as ConfigModLoader;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::state::launch_state::{try_acquire_launch_step, LaunchStepGuard};
use crate::utils::env_info::{is_offline_build, is_safe_relative_path, launcher_path};
use crate::utils::errors::LauncherError;
use crate::utils::http::{http_client, read_body_capped};
use crate::{log_err, log_info, minecraft::vanilla::Vanilla, utils::tauri_err::CommandResult};
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn download_minecraft(
    state: tauri::State<'_, Mutex<GlobalState>>,
    options: Option<GameOptions>,
) -> CommandResult<()> {
    let _guard = try_acquire_launch_step()?;
    download_minecraft_inner(state.inner(), options.as_ref()).await
}

async fn store_java_install(
    state: &Mutex<GlobalState>,
    target: &ProjectConfig,
    java_path: String,
    java_major: u32,
) -> Result<bool> {
    let stored = update_project_config(state, async |stored: &mut ProjectConfig| {
        if stored.project_name == target.project_name {
            stored.java_path = Some(java_path);
            stored.java_version = Some(java_major);
        }
        Ok(())
    })
    .await?;
    Ok(stored.project_name == target.project_name)
}

async fn store_loader_version(
    state: &Mutex<GlobalState>,
    target: &ProjectConfig,
    version: String,
) -> Result<bool> {
    let record = version.clone();
    let stored = update_project_config(state, async |stored: &mut ProjectConfig| {
        if stored.project_name == target.project_name
            && stored.mc_version == target.mc_version
            && stored.mod_loader == target.mod_loader
            && stored.loader_version.is_none()
        {
            stored.loader_version = Some(record);
        }
        Ok(())
    })
    .await?;
    Ok(stored.project_name == target.project_name
        && stored.loader_version.as_deref() == Some(version.as_str()))
}

async fn download_minecraft_inner(
    state: &Mutex<GlobalState>,
    options: Option<&GameOptions>,
) -> CommandResult<()> {
    let mut project_config = current_project_config(state).await?;
    let mod_loader = project_config.mod_loader.clone();

    let loader_manifest = if matches!(mod_loader, ConfigModLoader::Vanilla) {
        None
    } else {
        let loader = create_mod_loader(&mod_loader)?;
        let manifest = LauncherError::classify(
            loader.versions(&project_config).await,
            LauncherError::ManifestParse,
        )?;
        if project_config.loader_version.is_none() {
            let version = LauncherError::classify(
                loader
                    .latest_version(&project_config, &manifest)
                    .await
                    .with_context(|| {
                        format!(
                            "Не удалось определить последнюю версию загрузчика модов (проект: {})",
                            project_config.project_name
                        )
                    }),
                LauncherError::ManifestParse,
            )?;
            if !store_loader_version(state, &project_config, version.clone()).await? {
                log_info!(
                    "[minecraft] loader_version не записан: активный проект изменился во время установки (цель: {})",
                    project_config.project_name
                );
            }
            project_config.loader_version = Some(version);
        }
        Some(manifest)
    };

    LauncherError::classify(
        Vanilla.setup(&project_config).await,
        LauncherError::GameDownload,
    )?;

    let project_name = project_config.project_name.clone();
    let game_dir = launcher_path(Some(&project_name))?;
    let install_options = install_options_for_project(&project_name, options).await?;
    install_game_options(
        &game_dir,
        &project_config.mc_version,
        install_options.as_ref(),
    )
    .await?;
    clear_pending_after_install(&project_name, &game_dir).await?;

    if let Some(manifest) = loader_manifest {
        let loader = create_mod_loader(&mod_loader)?;
        LauncherError::classify(
            loader.setup(&project_config, &manifest).await,
            LauncherError::LoaderSetup,
        )?;
    }

    Ok(())
}

async fn launch_step_project(
    state: &Mutex<GlobalState>,
) -> Result<(LaunchStepGuard, ProjectConfig)> {
    let guard = try_acquire_launch_step()?;
    let project_config = current_project_config(state).await?;
    Ok((guard, project_config))
}

#[tauri::command]
pub async fn download_server_file(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let (_guard, project_config) = launch_step_project(state.inner()).await?;
    download_all_files(project_config.project_name, &state).await?;
    Ok(())
}

#[tauri::command]
pub async fn download_java(state: tauri::State<'_, Mutex<GlobalState>>) -> CommandResult<()> {
    let (_guard, project_config) = launch_step_project(state.inner()).await?;
    let (java_path, java_version) =
        LauncherError::classify(install_java(&project_config).await, LauncherError::Java)?;
    let java_major = parse_java_major(&java_version)?;
    if !store_java_install(
        state.inner(),
        &project_config,
        java_path.to_string_lossy().into_owned(),
        java_major,
    )
    .await?
    {
        log_info!(
            "[java] Проект сменился во время установки Java, путь Java не записан (цель: {})",
            project_config.project_name
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn download_server_mods(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let (_guard, project_config) = launch_step_project(state.inner()).await?;
    download_mods(project_config.project_name, &state).await?;
    Ok(())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OptionalModEntry {
    pub path: String,
    pub hash: String,
}

const MAX_OPTIONAL_LIST_BODY_BYTES: u64 = 16 * 1024 * 1024;

async fn fetch_optional_mods_inner(state: &Mutex<GlobalState>) -> Result<Vec<OptionalModEntry>> {
    let config = current_project_config(state).await?;
    if !config.online || is_offline_build() {
        return Ok(Vec::new());
    }
    let Some(server_url) = config.resolved_server_url() else {
        log_info!("[optional-mods] Адрес сервера не задан, список необязательных модов пуст");
        return Ok(Vec::new());
    };
    let url = format!("{server_url}/v1/launcher/files/optional-mods");
    log_info!("[optional-mods] Запрос списка необязательных модов: {url}");
    let response = http_client().get(&url).send().await.with_context(|| {
        format!("Не удалось отправить запрос списка необязательных модов на {url}")
    })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        log_err!("[optional-mods] Сервер вернул {status}: {body}");
        return Err(anyhow!(
            "Сервер вернул {status} при запросе списка необязательных модов ({url}): {body}"
        ));
    }
    let response_bytes = read_body_capped(response, &url, MAX_OPTIONAL_LIST_BODY_BYTES).await?;
    let list: HashMap<String, String> =
        serde_json::from_slice(&response_bytes).with_context(|| {
            format!("Не удалось распарсить JSON списка необязательных модов ({url})")
        })?;
    let mut entries: Vec<(String, OptionalModEntry)> = Vec::new();
    for (key, hash) in list {
        if !is_safe_relative_path(&key) {
            log_err!("[optional-mods] Небезопасный путь из списка отброшен: {key}");
            continue;
        }
        let file_name = key
            .strip_prefix("optional-mods/")
            .unwrap_or(&key)
            .to_string();
        entries.push((file_name, OptionalModEntry { path: key, hash }));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let result: Vec<OptionalModEntry> = entries.into_iter().map(|(_, entry)| entry).collect();
    if result.is_empty() {
        log_info!("[optional-mods] Список необязательных модов пуст");
    } else {
        log_info!(
            "[optional-mods] Получено записей необязательных модов: {}",
            result.len()
        );
    }
    Ok(result)
}

#[tauri::command]
pub async fn fetch_optional_mods(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<Vec<OptionalModEntry>> {
    fetch_optional_mods_inner(state.inner())
        .await
        .map_err(crate::utils::tauri_err::CommandError::from)
}

async fn ensure_mods_dir(project: &str) -> Result<PathBuf> {
    let mods_dir = launcher_path(Some(project))?.join("mods");
    tokio::fs::create_dir_all(&mods_dir)
        .await
        .with_context(|| format!("Не удалось создать папку модов {mods_dir:?}"))?;
    Ok(mods_dir)
}

#[tauri::command]
pub async fn open_mods_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let project = current_project_config(state.inner()).await?.project_name;
    let mods_dir = ensure_mods_dir(&project).await?;
    app.opener()
        .open_path(mods_dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| anyhow!("Не удалось открыть папку модов: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn get_java_distributions() -> CommandResult<Vec<JavaDistribution>> {
    Ok(get_java_distributions_list())
}

#[tauri::command]
pub async fn get_java_version(mc_version: String) -> CommandResult<String> {
    Ok(resolve_java_version(&mc_version).await)
}

#[tauri::command]
pub async fn download_alternative_java(
    state: tauri::State<'_, Mutex<GlobalState>>,
    distribution: String,
    java_version: Option<String>,
    replace_default: bool,
) -> CommandResult<()> {
    let project_config = current_project_config(state.inner()).await?;
    let (java_path, alt_java_version) = LauncherError::classify(
        download_alt_java(
            &distribution,
            java_version.as_deref(),
            &project_config.mc_version,
        )
        .await,
        LauncherError::Java,
    )?;
    if replace_default {
        let java_major = parse_java_major(&alt_java_version)?;
        if !store_java_install(
            state.inner(),
            &project_config,
            java_path.to_string_lossy().into_owned(),
            java_major,
        )
        .await?
        {
            log_info!(
                "[java] Проект сменился во время установки альтернативной Java, путь Java не записан (цель: {})",
                project_config.project_name
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_alternative_java() -> CommandResult<bool> {
    Ok(cancel_alt_java_download())
}

#[cfg(test)]
mod project_config_write_tests {
    use super::{store_java_install, store_loader_version};
    use crate::state::config::{current_project_config, load_config, set_project_config};
    use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
    use crate::test_support::LauncherDirGuard;
    use tokio::sync::Mutex;

    fn sample_config(
        name: &str,
        mc_version: &str,
        loader: ModLoader,
        loader_version: Option<&str>,
    ) -> ProjectConfig {
        ProjectConfig {
            project_name: name.to_string(),
            mc_version: mc_version.to_string(),
            mod_loader: loader,
            loader_version: loader_version.map(str::to_string),
            ..ProjectConfig::default()
        }
    }

    async fn seeded_with_target(
        label: &str,
        alpha: ProjectConfig,
        beta: ProjectConfig,
    ) -> (LauncherDirGuard, Mutex<GlobalState>, ProjectConfig) {
        let guard = LauncherDirGuard::acquire(label).await;
        alpha.save_config().await.expect("сохранение конфига Alpha");
        beta.save_config().await.expect("сохранение конфига Beta");
        let state = Mutex::new(GlobalState {
            project_config: alpha,
            ..GlobalState::default()
        });
        let target = current_project_config(&state).await.expect("проект Alpha");
        (guard, state, target)
    }

    async fn switched_projects(
        label: &str,
        alpha: ProjectConfig,
        beta: ProjectConfig,
        switch: ProjectConfig,
    ) -> (LauncherDirGuard, Mutex<GlobalState>, ProjectConfig) {
        let (guard, state, target) = seeded_with_target(label, alpha, beta).await;
        set_project_config(&state, switch)
            .await
            .expect("переключение активного проекта до конца записи");
        (guard, state, target)
    }

    #[tokio::test]
    async fn java_install_write_lands_in_target_project() {
        let (_guard, state, target) = seeded_with_target(
            "download_java_write_happy",
            sample_config("Alpha", "1.20.1", ModLoader::Vanilla, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
        )
        .await;

        let written = store_java_install(&state, &target, "/java/bin/java".to_string(), 17)
            .await
            .expect("запись установленной Java");

        assert!(written, "запись должна выполняться для активного проекта");
        let stored = current_project_config(&state)
            .await
            .expect("конфиг после записи");
        assert_eq!(stored.java_path.as_deref(), Some("/java/bin/java"));
        assert_eq!(stored.java_version, Some(17));
        let disk = load_config("Alpha").await.expect("конфиг Alpha с диска");
        assert_eq!(disk.java_path.as_deref(), Some("/java/bin/java"));
        assert_eq!(disk.java_version, Some(17));
    }

    #[tokio::test]
    async fn java_install_write_skips_when_active_project_switched() {
        let (_guard, state, target) = switched_projects(
            "download_java_write_switch",
            sample_config("Alpha", "1.20.1", ModLoader::Vanilla, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
        )
        .await;

        let written = store_java_install(&state, &target, "/java/bin/java".to_string(), 17)
            .await
            .expect("защищённая запись не должна давать ошибку");

        assert!(!written, "запись в чужой проект не должна выполняться");
        let active = current_project_config(&state)
            .await
            .expect("активный проект");
        assert_eq!(active.project_name, "Beta");
        assert_eq!(
            active.java_path, None,
            "конфиг Beta не должен получить чужую Java"
        );
        assert_eq!(active.java_version, None);
        let beta_disk = load_config("Beta").await.expect("конфиг Beta с диска");
        assert_eq!(
            beta_disk.java_path, None,
            "конфиг Beta на диске не должен измениться"
        );
        assert_eq!(beta_disk.java_version, None);
        let alpha_disk = load_config("Alpha").await.expect("конфиг Alpha с диска");
        assert_eq!(alpha_disk.java_path, None);
    }

    #[tokio::test]
    async fn loader_version_write_lands_in_target_project() {
        let (_guard, state, target) = seeded_with_target(
            "download_loader_write_happy",
            sample_config("Alpha", "1.20.1", ModLoader::Fabric, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
        )
        .await;

        let written = store_loader_version(&state, &target, "0.16.9".to_string())
            .await
            .expect("запись версии лоадера");

        assert!(written, "запись должна выполняться для активного проекта");
        let stored = current_project_config(&state)
            .await
            .expect("конфиг после записи");
        assert_eq!(stored.loader_version.as_deref(), Some("0.16.9"));
        let disk = load_config("Alpha").await.expect("конфиг Alpha с диска");
        assert_eq!(disk.loader_version.as_deref(), Some("0.16.9"));
    }

    #[tokio::test]
    async fn loader_version_write_skips_when_active_project_switched() {
        let (_guard, state, target) = switched_projects(
            "download_loader_write_switch",
            sample_config("Alpha", "1.20.1", ModLoader::Fabric, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
        )
        .await;

        let written = store_loader_version(&state, &target, "0.16.9".to_string())
            .await
            .expect("защищённая запись не должна давать ошибку");

        assert!(!written, "loader_version не должен попасть в чужой проект");
        let active = current_project_config(&state)
            .await
            .expect("активный проект");
        assert_eq!(active.project_name, "Beta");
        assert_eq!(active.loader_version, None);
        let beta_disk = load_config("Beta").await.expect("конфиг Beta с диска");
        assert_eq!(beta_disk.loader_version, None);
        let alpha_disk = load_config("Alpha").await.expect("конфиг Alpha с диска");
        assert_eq!(alpha_disk.loader_version, None);
    }

    #[tokio::test]
    async fn loader_version_write_keeps_explicit_choice() {
        let (_guard, state, target) = seeded_with_target(
            "download_loader_write_kept",
            sample_config("Alpha", "1.20.1", ModLoader::Fabric, Some("0.14.21")),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
        )
        .await;

        let written = store_loader_version(&state, &target, "0.16.9".to_string())
            .await
            .expect("защищённая запись не должна давать ошибку");

        assert!(
            !written,
            "выбранная пользователем версия лоадера не перезаписывается"
        );
        let stored = current_project_config(&state)
            .await
            .expect("конфиг после записи");
        assert_eq!(stored.loader_version.as_deref(), Some("0.14.21"));
    }

    #[tokio::test]
    async fn loader_version_write_skips_when_mc_version_changed() {
        let (_guard, state, target) = switched_projects(
            "download_loader_write_mc_changed",
            sample_config("Alpha", "1.20.1", ModLoader::Fabric, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
            sample_config("Alpha", "1.21.4", ModLoader::Fabric, None),
        )
        .await;

        let written = store_loader_version(&state, &target, "0.16.9".to_string())
            .await
            .expect("защищённая запись не должна давать ошибку");

        assert!(
            !written,
            "loader_version не записывается при несовпадении mc_version"
        );
        let stored = current_project_config(&state)
            .await
            .expect("конфиг после записи");
        assert_eq!(stored.loader_version, None);
    }

    #[tokio::test]
    async fn loader_version_write_skips_when_loader_changed() {
        let (_guard, state, target) = switched_projects(
            "download_loader_write_loader_changed",
            sample_config("Alpha", "1.20.1", ModLoader::Fabric, None),
            sample_config("Beta", "1.21.4", ModLoader::Vanilla, None),
            sample_config("Alpha", "1.20.1", ModLoader::Forge, None),
        )
        .await;

        let written = store_loader_version(&state, &target, "0.16.9".to_string())
            .await
            .expect("защищённая запись не должна давать ошибку");

        assert!(
            !written,
            "loader_version не записывается при несовпадении лоадера"
        );
        let stored = current_project_config(&state)
            .await
            .expect("конфиг после записи");
        assert_eq!(stored.loader_version, None);
    }
}

#[cfg(test)]
mod open_mods_folder_tests {
    use super::ensure_mods_dir;
    use crate::test_support::LauncherDirGuard;

    #[tokio::test]
    async fn creates_missing_mods_dir() {
        let _guard = LauncherDirGuard::acquire("mods_dir_create").await;

        let mods_dir = ensure_mods_dir("Proj")
            .await
            .expect("папка модов должна создаваться");

        assert!(mods_dir.ends_with("mods"), "путь: {mods_dir:?}");
        assert!(mods_dir.is_dir(), "папка должна существовать на диске");
    }

    #[tokio::test]
    async fn keeps_existing_mods_dir() {
        let guard = LauncherDirGuard::acquire("mods_dir_exists").await;
        std::fs::create_dir_all(guard.project_dir("Proj").join("mods"))
            .expect("создание существующей папки");

        ensure_mods_dir("Proj")
            .await
            .expect("существующая папка не должна давать ошибку");
    }

    #[tokio::test]
    async fn errors_when_mods_path_is_a_file() {
        let guard = LauncherDirGuard::acquire("mods_dir_file").await;
        let project_dir = guard.project_dir("Proj");
        std::fs::create_dir_all(&project_dir).expect("создание папки проекта");
        std::fs::write(project_dir.join("mods"), b"not a dir").expect("запись файла");

        let error = ensure_mods_dir("Proj")
            .await
            .expect_err("файл вместо папки должен давать ошибку");

        assert!(
            error.to_string().contains("Не удалось создать папку модов"),
            "ошибка должна быть понятной: {error}"
        );
    }
}

#[cfg(test)]
mod fetch_optional_mods_tests {
    use super::fetch_optional_mods_inner;
    use crate::state::config::load_config;
    use crate::state::dto::{GlobalState, ModLoader, ProjectConfig, SessionTokens};
    use crate::test_support::{sha1_hex, LauncherDirGuard, MockEnv};
    use serde_json::json;
    use tokio::sync::Mutex;

    fn online_state(server_url: &str) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Cordelia".to_string(),
                server_url: Some(server_url.to_string()),
                ..ProjectConfig::default()
            },
            session: Some(SessionTokens {
                access_token: "test-token".to_string(),
                uuid: String::new(),
                username: "tester".to_string(),
                project_name: "Cordelia".to_string(),
            }),
            ..GlobalState::default()
        })
    }

    fn offline_state() -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "Cordelia".to_string(),
                online: false,
                ..ProjectConfig::default()
            },
            ..GlobalState::default()
        })
    }

    #[tokio::test]
    async fn fetch_optional_mods_sorts_by_filename_and_drops_unsafe_paths() {
        let MockEnv { dir: _, mut server } = MockEnv::acquire("optional_mods_list_sorted").await;
        let hash = sha1_hex(b"optional jar");
        server
            .mock("GET", "/v1/launcher/files/optional-mods")
            .with_status(200)
            .with_body(
                json!({
                    "optional-mods/b.jar": hash,
                    "optional-mods/a.jar": hash,
                    "../evil.jar": hash
                })
                .to_string(),
            )
            .create_async()
            .await;

        let state = online_state(&server.url());
        let entries = fetch_optional_mods_inner(&state)
            .await
            .expect("список необязательных модов");

        assert_eq!(
            entries.len(),
            2,
            "ключ с .. должен отбрасываться с логом: {entries:?}"
        );
        assert_eq!(entries[0].path, "optional-mods/a.jar");
        assert_eq!(entries[1].path, "optional-mods/b.jar");
        assert_eq!(
            entries[0].hash, hash,
            "hash должен приходить из карты сервера"
        );
    }

    #[tokio::test]
    async fn fetch_optional_mods_returns_err_on_server_500() {
        let MockEnv { dir: _, mut server } = MockEnv::acquire("optional_mods_list_500").await;
        server
            .mock("GET", "/v1/launcher/files/optional-mods")
            .with_status(500)
            .with_body("boom")
            .create_async()
            .await;

        let state = online_state(&server.url());
        let error = fetch_optional_mods_inner(&state)
            .await
            .expect_err("500 от сервера должен быть ошибкой");

        assert!(
            error.to_string().contains("500"),
            "ошибка должна называть статус сервера: {error}"
        );
    }

    #[tokio::test]
    async fn fetch_optional_mods_offline_profile_skips_http() {
        let MockEnv { dir: _, mut server } = MockEnv::acquire("optional_mods_list_offline").await;
        let unused_mock = server
            .mock("GET", "/v1/launcher/files/optional-mods")
            .with_status(200)
            .with_body("{}")
            .expect(0)
            .create_async()
            .await;

        let state = offline_state();
        let entries = fetch_optional_mods_inner(&state)
            .await
            .expect("офлайн-профиль должен возвращать пустой список");

        assert!(
            entries.is_empty(),
            "офлайн-профиль не должен иметь необязательных модов: {entries:?}"
        );
        unused_mock.assert_async().await;
    }

    #[tokio::test]
    async fn optional_mods_absent_in_toml_reads_as_empty() {
        let guard = LauncherDirGuard::acquire("optional_mods_toml_absent").await;
        let config = ProjectConfig {
            project_name: "Alpha".to_string(),
            mc_version: "1.20.1".to_string(),
            mod_loader: ModLoader::Fabric,
            optional_mods: vec!["optional-mods/a.jar".to_string()],
            ..ProjectConfig::default()
        };
        config.save_config().await.expect("сохранение конфига");

        let path = guard.root().join("project/config/Alpha.toml");
        let raw = std::fs::read_to_string(&path).expect("чтение конфига");
        let stripped: String = raw
            .lines()
            .filter(|line| !line.trim_start().starts_with("optionalMods"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&path, stripped).expect("перезапись конфига без поля");

        let loaded = load_config("Alpha").await.expect("чтение конфига без поля");
        assert!(
            loaded.optional_mods.is_empty(),
            "toml без поля optionalMods должен читаться как пустой выбор: {:?}",
            loaded.optional_mods
        );
    }

    #[tokio::test]
    async fn optional_mods_survives_toml_roundtrip() {
        let guard = LauncherDirGuard::acquire("optional_mods_toml_roundtrip").await;
        let config = ProjectConfig {
            project_name: "Alpha".to_string(),
            mc_version: "1.20.1".to_string(),
            mod_loader: ModLoader::Fabric,
            optional_mods: vec![
                "optional-mods/a.jar".to_string(),
                "optional-mods/b.jar".to_string(),
            ],
            ..ProjectConfig::default()
        };
        config.save_config().await.expect("сохранение конфига");

        let path = guard.root().join("project/config/Alpha.toml");
        let raw = std::fs::read_to_string(&path).expect("чтение конфига");
        assert!(
            raw.contains("optionalMods"),
            "поле должно сериализоваться в camelCase: {raw}"
        );

        let loaded = load_config("Alpha").await.expect("чтение конфига обратно");
        assert_eq!(
            loaded.optional_mods,
            vec![
                "optional-mods/a.jar".to_string(),
                "optional-mods/b.jar".to_string()
            ],
            "записанный optional_mods должен читаться обратно"
        );
    }
}
