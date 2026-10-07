use serde::Serialize;
use std::path::PathBuf;
use sysinfo::System;
use tauri::State;
use tokio::sync::Mutex;

use crate::state::dto::GlobalState;
use crate::state::launcher_config::LauncherConfig;
use crate::utils::blocking;
use crate::utils::env_info::{
    default_server_url, get_default_project_name, get_home_dir, get_launcher_name, is_offline_build,
};
use crate::utils::errors::LauncherError;
use crate::utils::install_id::{compute_install_id_blocking, set_install_id};
use crate::utils::tauri_err::CommandResult;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInitData {
    pub launcher_name: String,
    pub default_parent_path: String,
    pub launcher_config: Option<LauncherConfig>,
    pub version: String,
    pub total_memory_mb: u64,
    pub offline_build: bool,
    pub env_project_name: Option<String>,
}

static LAUNCHER_CONFIG_WRITE_LOCK: Mutex<()> = Mutex::const_new(());

pub(crate) async fn update_launcher_config(
    state: &Mutex<GlobalState>,
    mutate: impl FnOnce(&mut LauncherConfig),
) -> anyhow::Result<LauncherConfig> {
    let _write_guard = LAUNCHER_CONFIG_WRITE_LOCK.lock().await;

    let mut config = {
        let guard = state.lock().await;
        guard.launcher_config.clone()
    };
    if config.is_none() {
        config = Some(load_launcher_config().await?);
    }
    let mut config = config.unwrap_or_default();

    mutate(&mut config);

    let content = config.serialize_for_save().map_err(|e| {
        anyhow::Error::new(LauncherError::DiskIo(format!(
            "Не удалось сериализовать конфиг: {}",
            e
        )))
    })?;
    let path = LauncherConfig::config_file_path_public().map_err(|e| {
        anyhow::Error::new(LauncherError::DiskIo(format!(
            "Не удалось определить путь конфига: {}",
            e
        )))
    })?;

    blocking(
        "Не удалось выполнить запись конфига",
        move || LauncherConfig::write_serialized(&path, &content),
    )
    .await??;

    config.on_saved_update_path();

    {
        let mut guard = state.lock().await;
        guard.launcher_config = Some(config.clone());
    }

    Ok(config)
}

async fn load_launcher_config() -> anyhow::Result<LauncherConfig> {
    match LauncherConfig::load() {
        Ok(Some(config)) => Ok(config),
        Ok(None) => Ok(LauncherConfig::default()),
        Err(e) => Err(anyhow::Error::new(LauncherError::DiskIo(format!(
            "Не удалось прочитать конфиг лаунчера: {}",
            e
        )))),
    }
}

#[tauri::command]
pub async fn get_app_init_data(state: State<'_, Mutex<GlobalState>>) -> CommandResult<AppInitData> {
    Ok(get_app_init_data_inner(&state).await?)
}

async fn get_app_init_data_inner(state: &Mutex<GlobalState>) -> anyhow::Result<AppInitData> {
    let (config, version) = {
        let _write_guard = LAUNCHER_CONFIG_WRITE_LOCK.lock().await;

        let mut config = blocking("Не удалось выполнить чтение конфига", LauncherConfig::load)
            .await?
            .ok()
            .flatten();

        if let Some(ref mut cfg) = config {
            let mut changed = cfg.apply_default_project();
            if cfg.install_id.is_none() {
                let id = blocking(
                    "Не удалось вычислить ID установки",
                    compute_install_id_blocking,
                )
                .await?;
                cfg.install_id = Some(id);
                changed = true;
            }
            if changed {
                let cfg_clone = cfg.clone();
                let _ = blocking(
                    "Не удалось выполнить запись конфига",
                    move || cfg_clone.save(),
                )
                .await;
            }
        }

        let install_id = match config.as_ref().and_then(|cfg| cfg.install_id.clone()) {
            Some(id) => id,
            None => {
                blocking(
                    "Не удалось вычислить ID установки",
                    compute_install_id_blocking,
                )
                .await?
            }
        };
        set_install_id(&install_id);

        let version;
        {
            let mut guard = state.lock().await;
            guard.launcher_config = config.clone();
            version = guard.app_version.clone();
        }
        (config, version)
    };

    let default_parent_path = get_home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut sys = System::new();
    sys.refresh_memory();
    let total_memory_mb = sys.total_memory() / 1024 / 1024;

    let env_project_name = if is_offline_build() {
        None
    } else {
        let name = get_default_project_name();
        (!name.is_empty()).then_some(name)
    };

    Ok(AppInitData {
        launcher_name: get_launcher_name(),
        default_parent_path,
        launcher_config: config,
        version,
        total_memory_mb,
        offline_build: default_server_url().is_none(),
        env_project_name,
    })
}

#[tauri::command]
pub async fn save_launcher_config(
    state: State<'_, Mutex<GlobalState>>,
    parent_path: String,
) -> CommandResult<LauncherConfig> {
    let name = get_launcher_name();
    let launcher_path = PathBuf::from(&parent_path)
        .join(&name)
        .to_string_lossy()
        .to_string();

    let config = update_launcher_config(&state, |config| {
        config.launcher_path = launcher_path.clone();
    })
    .await?;

    let base = PathBuf::from(&config.launcher_path);
    let dirs_to_create = [
        base.clone(),
        base.join("project"),
        base.join("manifest"),
        base.join("java"),
    ];
    blocking(
        "Не удалось выполнить создание папок",
        move || {
            for dir in dirs_to_create {
                std::fs::create_dir_all(&dir).map_err(|e| {
                    anyhow::Error::new(LauncherError::DiskIo(format!(
                        "Не удалось создать папку \"{}\": {}",
                        dir.display(),
                        e
                    )))
                })?;
            }
            Ok::<(), anyhow::Error>(())
        },
    )
    .await??;

    Ok(config)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettingsPayload {
    pub discord_activity: bool,
    pub keep_old_configs: bool,
    pub download_speed_limit: Option<u64>,
    pub auto_update: bool,
    pub system_notifications: bool,
    pub debug_mode: bool,
    pub start_with_system: bool,
    pub close_after_launch: bool,
    pub minimize_to_tray: bool,
}

#[tauri::command]
pub async fn save_launcher_settings(
    app: tauri::AppHandle,
    state: State<'_, Mutex<GlobalState>>,
    settings: LauncherSettingsPayload,
) -> CommandResult<LauncherConfig> {
    let config = update_launcher_config(&state, |config| {
        config.discord_activity = settings.discord_activity;
        config.keep_old_configs = settings.keep_old_configs;
        config.download_speed_limit = settings.download_speed_limit;
        config.auto_update = settings.auto_update;
        config.system_notifications = settings.system_notifications;
        config.debug_mode = settings.debug_mode;
        config.start_with_system = settings.start_with_system;
        config.close_after_launch = settings.close_after_launch;
        config.minimize_to_tray = settings.minimize_to_tray;
    })
    .await?;

    crate::utils::bandwidth::set_limit(config.download_speed_limit);

    crate::utils::logger_utils::set_console_emit_enabled(config.debug_mode);
    crate::utils::logger_utils::set_game_output_enabled(config.debug_mode);

    crate::tray::set_minimize_to_tray(&app, config.minimize_to_tray);

    let discord_enabled = config.discord_activity;
    tauri::async_runtime::spawn_blocking(move || {
        crate::discord::on_settings_saved(discord_enabled);
    });

    Ok(config)
}

#[tauri::command]
pub async fn save_theme(
    state: State<'_, Mutex<GlobalState>>,
    theme: String,
) -> CommandResult<LauncherConfig> {
    update_launcher_config(&state, |config| {
        config.theme = theme.clone();
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn save_animations_enabled(
    state: State<'_, Mutex<GlobalState>>,
    animations_enabled: bool,
) -> CommandResult<LauncherConfig> {
    update_launcher_config(&state, |config| {
        config.animations_enabled = animations_enabled;
    })
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod update_flow_tests {
    use super::*;
    use crate::state::dto::GlobalState;
    use crate::test_support::{ConfigFileGuard, LauncherDirGuard};

    fn state_with(config: LauncherConfig) -> Mutex<GlobalState> {
        Mutex::new(GlobalState {
            launcher_config: Some(config),
            ..Default::default()
        })
    }

    #[tokio::test]
    async fn concurrent_updates_persist_both_mutations() {
        let dir_guard = LauncherDirGuard::acquire("launcher_config_concurrent").await;
        let _path_guard = ConfigFileGuard::acquire(dir_guard.root(), "config.json");
        let state = state_with(LauncherConfig {
            launcher_path: dir_guard.root().to_string_lossy().to_string(),
            ..Default::default()
        });

        let (first, second) = tokio::join!(
            update_launcher_config(&state, |config| config.theme = "theme-a".to_string()),
            update_launcher_config(&state, |config| config.debug_mode = true),
        );

        first.expect("первая мутация");
        second.expect("вторая мутация");

        let saved = LauncherConfig::load()
            .expect("чтение сохранённого конфига")
            .expect("конфиг должен быть записан");
        assert_eq!(saved.theme, "theme-a");
        assert!(saved.debug_mode, "параллельная мутация не должна теряться");

        let in_memory = state
            .lock()
            .await
            .launcher_config
            .clone()
            .expect("in-memory конфиг");
        assert_eq!(in_memory.theme, "theme-a");
        assert!(in_memory.debug_mode);
    }

    #[tokio::test]
    async fn failed_write_keeps_in_memory_config_untouched() {
        let dir_guard = LauncherDirGuard::acquire("launcher_config_write_fail").await;
        let blocked = dir_guard.root().join("blocked");
        std::fs::write(&blocked, b"not a directory").expect("файл-заглушка вместо папки");
        let _path_guard = ConfigFileGuard::acquire(dir_guard.root(), "blocked/config.json");
        let state = state_with(LauncherConfig {
            launcher_path: dir_guard.root().to_string_lossy().to_string(),
            theme: "keep".to_string(),
            ..Default::default()
        });

        let error = update_launcher_config(&state, |config| config.theme = "changed".to_string())
            .await
            .expect_err("запись под файлом-заглушкой должна упасть");
        assert!(
            error.to_string().contains("os error"),
            "ожидается ошибка записи, получено: {error}"
        );

        let in_memory = state
            .lock()
            .await
            .launcher_config
            .clone()
            .expect("in-memory конфиг");
        assert_eq!(
            in_memory.theme, "keep",
            "неудачная запись не должна менять in-memory конфиг"
        );
    }

    #[tokio::test]
    async fn unreadable_config_fails_update_instead_of_default_overwrite() {
        let dir_guard = LauncherDirGuard::acquire("launcher_config_load_fail").await;
        std::fs::create_dir_all(dir_guard.root().join("config.json"))
            .expect("директория вместо конфига");
        let _path_guard = ConfigFileGuard::acquire(dir_guard.root(), "config.json");
        let state = Mutex::new(GlobalState::default());

        let error = update_launcher_config(&state, |config| config.theme = "x".to_string())
            .await
            .expect_err("чтение директории должно вернуть ошибку");

        assert!(
            error
                .to_string()
                .contains("Не удалось прочитать конфиг лаунчера"),
            "ожидается ошибка чтения, получено: {error}"
        );
        assert!(
            state.lock().await.launcher_config.is_none(),
            "in-memory не должен заполняться дефолтом при ошибке чтения"
        );
    }

    #[tokio::test]
    async fn app_init_seed_keeps_parallel_theme_mutation() {
        let dir_guard = LauncherDirGuard::acquire("app_init_config_race").await;
        let _path_guard = ConfigFileGuard::acquire(dir_guard.root(), "config.json");
        let seeded = LauncherConfig {
            theme: "seed".to_string(),
            ..Default::default()
        };
        seeded
            .save()
            .expect("сохранение стартового конфига без install_id");

        let state = Mutex::new(GlobalState::default());

        let (init_result, theme_result) = tokio::join!(
            get_app_init_data_inner(&state),
            update_launcher_config(&state, |config| config.theme = "race-theme".to_string()),
        );
        init_result.expect("инициализация приложения");
        theme_result.expect("смена темы");

        let saved = LauncherConfig::load()
            .expect("чтение сохранённого конфига")
            .expect("конфиг должен быть записан");
        assert_eq!(
            saved.theme, "race-theme",
            "параллельная смена темы не должна теряться на диске"
        );
        assert!(
            saved.install_id.is_some(),
            "сид install_id не должен теряться на диске"
        );

        let in_memory = state
            .lock()
            .await
            .launcher_config
            .clone()
            .expect("in-memory конфиг");
        assert_eq!(
            in_memory.theme, "race-theme",
            "параллельная смена темы не должна откатываться в памяти"
        );
        assert!(
            in_memory.install_id.is_some(),
            "in-memory конфиг должен содержать свежий install_id"
        );
    }
}
