mod auth;
mod commands;
mod discord;
mod init;
mod java;
mod launcher_server;
mod minecraft;
mod modrinth;
mod offline;
mod state;
mod tray;
mod updater;
mod utils;

#[cfg(test)]
mod test_support;

use commands::auth::{
    auth_login, auth_logins, auth_refresh, auth_register, change_password, delete_account,
};
use commands::cpm_models::{
    get_player_models_limit, read_cpm_project_file, save_player_model, set_player_models_limit,
    take_cpm_project_path,
};
use commands::download::download_alternative_java;
use commands::download::download_java;
use commands::download::download_minecraft;
use commands::download::download_server_file;
use commands::download::download_server_mods;
use commands::download::get_java_distributions;
use commands::download::get_java_version;
use commands::game_options::{
    get_game_options, import_global_game_options, save_game_options, save_global_game_options,
};
use commands::init::{initialize_launcher, initialize_project, set_initialized};
use commands::install_journal::{clear_install_journal, load_install_journal, record_install_step};
use commands::integrity::check_files_integrity;
use commands::launcher_config::{
    get_app_init_data, save_animations_enabled, save_launcher_config, save_launcher_settings,
    save_theme,
};
use commands::modrinth::{
    modrinth_check_updates, modrinth_install, modrinth_installed, modrinth_project,
    modrinth_search, modrinth_uninstall,
};
use commands::notification::get_notification_icon;
use commands::profile::{
    create_offline_profile, create_server_profile, delete_project, get_loader_versions,
    get_minecraft_versions, get_server_connect_url, refresh_manifests, save_current_project,
};
use commands::settings_project::clear_minecraft_config;
use commands::settings_project::load_settings_project;
use commands::settings_project::save_settings_project;
use commands::start::exit_launcher;
use commands::start::get_game_state;
use commands::start::get_launch_state;
use commands::start::start_minecraft;
use commands::update::{
    apply_update_cmd, check_update, get_launcher_versions, get_server_status, ping_launcher_server,
};
use commands::user_content::{
    clear_session, delete_model, delete_offline_skin, delete_skin, get_offline_skin,
    get_offline_skin_model, get_profile_skin, get_session_info, list_models, list_skins,
    read_skin_file, save_offline_skin, select_account, set_active_skin, upload_model, upload_skin,
};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use utils::logger_utils;
use utils::logger_utils::get_startup_logs;

use crate::state::dto::GlobalState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
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

            if let Err(e) = crate::utils::desktop_entry::sync_desktop_entry(app.handle()) {
                log_err!("Не удалось обновить запись в меню приложений: {e:#}");
            }

            let launcher_config = crate::state::launcher_config::LauncherConfig::load()
                .ok()
                .flatten();
            crate::utils::bandwidth::set_limit(
                launcher_config
                    .as_ref()
                    .and_then(|c| c.download_speed_limit),
            );
            crate::utils::logger_utils::set_console_emit_enabled(
                launcher_config
                    .as_ref()
                    .map(|c| c.debug_mode)
                    .unwrap_or(false),
            );
            crate::utils::logger_utils::set_game_output_enabled(
                launcher_config
                    .as_ref()
                    .map(|c| c.debug_mode)
                    .unwrap_or(false),
            );

            let base_path = if let Some(ref lc) = launcher_config {
                std::path::PathBuf::from(&lc.launcher_path)
            } else {
                crate::utils::env_info::launcher_path(None)
                    .unwrap_or_else(|_| std::env::home_dir().unwrap_or_default().join("Limacina"))
            };

            let _ = std::fs::create_dir_all(&base_path);
            let _ = std::fs::create_dir_all(base_path.join("project"));
            let _ = std::fs::create_dir_all(base_path.join("manifest"));
            let _ = std::fs::create_dir_all(base_path.join("java"));

            crate::utils::winreg::init_uninstall_registry_key(app.config());
            crate::utils::winreg::remember_data_path(&base_path);

            let discord_enabled = launcher_config
                .as_ref()
                .map(|c| c.discord_activity)
                .unwrap_or(true);

            tray::set_minimize_to_tray(
                app.handle(),
                launcher_config
                    .as_ref()
                    .map(|c| c.minimize_to_tray)
                    .unwrap_or(false),
            );
            if let Err(e) = tray::init(app.handle()) {
                log_err!("Не удалось инициализировать иконку трея: {}", e);
            }

            let gs = GlobalState {
                launcher_config,
                app_version: app.package_info().version.to_string(),
                ..GlobalState::default()
            };
            app.manage(Mutex::new(gs));

            tauri::async_runtime::spawn_blocking(updater::cleanup_old_binaries);

            tauri::async_runtime::spawn_blocking(move || {
                discord::init(discord_enabled);
            });

            if let Some(path) =
                commands::cpm_models::extract_cpm_project_path(std::env::args().skip(1))
            {
                commands::cpm_models::store_cpm_project_path(Some(path));
            }

            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(path) =
                    commands::cpm_models::extract_cpm_project_path(argv.into_iter().skip(1))
                {
                    let _ = window.emit("cpm-project-open", path);
                }
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if tray::minimize_to_tray_enabled() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth_login,
            auth_register,
            auth_refresh,
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
            load_install_journal,
            record_install_step,
            clear_install_journal,
            create_server_profile,
            create_offline_profile,
            delete_project,
            get_server_connect_url,
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
            get_java_version,
            start_minecraft,
            exit_launcher,
            get_game_state,
            get_launch_state,
            save_settings_project,
            load_settings_project,
            clear_minecraft_config,
            get_game_options,
            save_game_options,
            save_global_game_options,
            import_global_game_options,
            check_update,
            apply_update_cmd,
            get_launcher_versions,
            get_server_status,
            ping_launcher_server,
            get_startup_logs,
            get_notification_icon,
            logger_utils::send_frontend_log,
            select_account,
            get_session_info,
            clear_session,
            upload_skin,
            save_offline_skin,
            get_offline_skin,
            get_offline_skin_model,
            delete_offline_skin,
            list_skins,
            delete_skin,
            set_active_skin,
            get_profile_skin,
            read_skin_file,
            upload_model,
            list_models,
            delete_model,
            save_player_model,
            get_player_models_limit,
            set_player_models_limit,
            read_cpm_project_file,
            take_cpm_project_path,
            modrinth_search,
            modrinth_project,
            modrinth_installed,
            modrinth_check_updates,
            modrinth_install,
            modrinth_uninstall,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn install_panic_hook() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        utils::file_logger::write_panic(info, &backtrace);
        previous_hook(info);
    }));
}
