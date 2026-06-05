// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod launcher_server;
mod minecraft;
mod state;
mod utils;

use commands::download::download_minecraft;
use commands::download::download_server_file;
use commands::settings_project::load_settings_project;
use commands::settings_project::save_settings_project;
use commands::start::start_minecraft;
use minecraft::forge::forge::get_forge;
use minecraft::jvm::jvm::start_jvm;
use tokio::sync::Mutex;
use utils::logger_utils;

use crate::state::dto::ProjectConfig;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            logger_utils::init_logger(handle);
            Ok(())
        })
        .manage(Mutex::new(ProjectConfig::default()))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_jvm,
            get_forge,
            download_server_file,
            download_minecraft,
            start_minecraft,
            save_settings_project,
            load_settings_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
