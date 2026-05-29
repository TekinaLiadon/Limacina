// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod api;
mod core;
mod minecraft;
mod state;
mod utils;

use api::download::download_minecraft;
use api::settings_project::load_settings_project;
use api::settings_project::save_settings_project;
use api::start::start_minecraft;
use core::downloader::download_all_files;
use minecraft::forge::forge::get_forge;
use minecraft::jvm::jvm::start_jvm;
use tokio::sync::Mutex;
use utils::logger_utils;

use crate::state::dto::State;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            logger_utils::init_logger(handle);
            Ok(())
        })
        .manage(Mutex::new(State::default()))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_jvm,
            get_forge,
            download_all_files,
            download_minecraft,
            start_minecraft,
            save_settings_project,
            load_settings_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
