// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod utils;
mod minecraft;
mod core;

use core::downloader::download_all_files;
use utils::home_dir::get_home_dir;
use minecraft::jvm::start_jvm;
use minecraft::get_manifest::download_minecraft_version;
use minecraft::fabric::get_fabric;
use minecraft::forge::get_forge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
