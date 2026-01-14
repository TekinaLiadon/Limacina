// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod utils;
mod minecraft;

use utils::home_dir::get_home_dir;
use minecraft::jvm::start_jvm;
use minecraft::get_manifest::download_minecraft_version;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_home_dir])
        .invoke_handler(tauri::generate_handler![start_jvm])
        .invoke_handler(tauri::generate_handler![download_minecraft_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
