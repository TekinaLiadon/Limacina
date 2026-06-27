// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod auth;
mod commands;
mod java;
mod launcher_server;
mod minecraft;
mod state;
mod utils;

use commands::auth::{auth_login, auth_logins, auth_saved};
use commands::download::download_java;
use commands::download::download_minecraft;
use commands::download::download_server_file;
use commands::download::download_server_mods;
use commands::launcher_config::{get_app_init_data, save_launcher_config};
use commands::settings_project::load_settings_project;
use commands::settings_project::save_settings_project;
use commands::start::start_minecraft;
use tauri::Manager;
use tokio::sync::Mutex;
use utils::logger_utils;

use crate::state::dto::GlobalState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::from_path(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env")).ok();

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            logger_utils::init_logger(handle);

            let launcher_config = crate::state::launcher_config::LauncherConfig::load().ok().flatten();

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

            let gs = GlobalState {
                launcher_config,
                ..GlobalState::default()
            };
            app.manage(Mutex::new(gs));

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            auth_login,
            auth_saved,
            auth_logins,
            get_app_init_data,
            save_launcher_config,
            download_server_file,
            download_server_mods,
            download_minecraft,
            download_java,
            start_minecraft,
            save_settings_project,
            load_settings_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
