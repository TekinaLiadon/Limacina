mod auth;
mod commands;
mod discord;
mod init;
mod java;
mod launcher_server;
mod minecraft;
mod state;
mod updater;
mod utils;

use commands::auth::{auth_login, auth_logins, auth_refresh, auth_register, auth_saved, change_password, delete_account};
use commands::download::download_java;
use commands::download::download_minecraft;
use commands::download::download_server_file;
use commands::download::download_server_mods;
use commands::download::get_java_distributions;
use commands::download::download_alternative_java;
use commands::init::{initialize_launcher, initialize_project, set_initialized};
use commands::integrity::check_files_integrity;
use commands::launcher_config::{get_app_init_data, save_launcher_config, save_launcher_settings, save_theme, save_animations_enabled};
use commands::profile::{
    create_offline_profile, create_server_profile, get_loader_versions, get_minecraft_versions,
    refresh_manifests, save_current_project,
};
use commands::settings_project::clear_minecraft_config;
use commands::settings_project::load_settings_project;
use commands::settings_project::save_settings_project;
use commands::start::exit_launcher;
use commands::start::start_minecraft;
use commands::update::{apply_update_cmd, check_update, get_launcher_versions};
use commands::user_content::{
    delete_model, delete_skin, get_profile_skin, get_session_info, list_models, list_skins,
    logout_account, select_account, upload_model, upload_skin,
};
use tauri::Manager;
use tokio::sync::Mutex;
use utils::logger_utils;
use utils::logger_utils::get_startup_logs;

use crate::state::dto::GlobalState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    for line in include_str!("../.env").lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if !key.is_empty() {
                std::env::set_var(key, value);
            }
        }
    }

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            logger_utils::init_logger(handle);

            let launcher_config = crate::state::launcher_config::LauncherConfig::load().ok().flatten();
            crate::utils::bandwidth::set_limit(
                launcher_config.as_ref().and_then(|c| c.download_speed_limit),
            );

            let base_path = if let Some(ref lc) = launcher_config {
                std::path::PathBuf::from(&lc.launcher_path)
            } else {
                crate::utils::env_info::launcher_patch(None)
                    .unwrap_or_else(|_| std::env::home_dir().unwrap_or_default().join("Limacina"))
            };

            let _ = std::fs::create_dir_all(&base_path);
            let _ = std::fs::create_dir_all(base_path.join("project"));
            let _ = std::fs::create_dir_all(base_path.join("manifest"));
            let _ = std::fs::create_dir_all(base_path.join("java"));

            let discord_enabled = launcher_config
                .as_ref()
                .map(|c| c.discord_activity)
                .unwrap_or(true);

            let gs = GlobalState {
                launcher_config,
                app_version: app.package_info().version.to_string(),
                ..GlobalState::default()
            };
            app.manage(Mutex::new(gs));

            updater::cleanup_old_binaries();

            tauri::async_runtime::spawn_blocking(move || {
                discord::init(discord_enabled);
            });

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            auth_login,
            auth_register,
            auth_refresh,
            auth_saved,
            auth_logins,
            change_password,
            delete_account,
            get_app_init_data,
            save_launcher_config,
            save_launcher_settings,
            save_theme,
            save_animations_enabled,
            initialize_launcher,
            initialize_project,
            set_initialized,
            create_server_profile,
            create_offline_profile,
            save_current_project,
    get_minecraft_versions,
    get_loader_versions,
    refresh_manifests,
            download_server_file,
            download_server_mods,
            check_files_integrity,
            download_minecraft,
            download_java,
            download_alternative_java,
            get_java_distributions,
            start_minecraft,
            exit_launcher,
            save_settings_project,
            load_settings_project,
            clear_minecraft_config,
            check_update,
            apply_update_cmd,
            get_launcher_versions,
            get_startup_logs,
            logger_utils::send_frontend_log,
            select_account,
            get_session_info,
            logout_account,
            upload_skin,
            list_skins,
            delete_skin,
            get_profile_skin,
            upload_model,
            list_models,
            delete_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
