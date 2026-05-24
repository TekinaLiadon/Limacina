// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod core;
mod minecraft;
mod utils;
mod api;

use core::downloader::download_all_files;
use minecraft::forge::forge::get_forge;
use minecraft::jvm::jvm::start_jvm;
use api::download::download_minecraft;
use api::start::start_minecraft;
use utils::logger_utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            logger_utils::init_logger(handle);

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_jvm,
            get_forge,
            download_all_files,
            download_minecraft,
            start_minecraft
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
