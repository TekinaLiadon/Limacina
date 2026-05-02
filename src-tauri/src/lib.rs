// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod core;
mod minecraft;
mod utils;

use core::downloader::download_all_files;
use minecraft::fabric::get_fabric;
use minecraft::forge::get_forge;
use minecraft::get_manifest::download_minecraft_version;
use minecraft::jvm::start_jvm;
use tauri::{AppHandle, Emitter};
use utils::home_dir::get_home_dir;
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
            get_home_dir,
            start_jvm,
            download_minecraft_version,
            get_fabric,
            get_forge,
            download_all_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
