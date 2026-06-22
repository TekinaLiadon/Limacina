// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod java;
mod launcher_server;
mod minecraft;
mod state;
mod utils;

use commands::download::download_java;
use commands::download::download_minecraft;
use commands::download::download_server_file;
use commands::download::download_server_mods;
use commands::settings_project::load_settings_project;
use commands::settings_project::save_settings_project;
use commands::start::start_minecraft;
use tokio::sync::Mutex;
use utils::logger_utils;

use crate::state::dto::GlobalState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            logger_utils::init_logger(handle);
            Ok(())
        })
        .manage(Mutex::new(GlobalState::default()))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
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
