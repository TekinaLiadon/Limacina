use std::env;

#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    match env::home_dir() {
            Some(path) => Ok(path.to_string_lossy().to_string()),
                    None => Err("Не удалось получить домашнюю директорию".to_string()),
        }
}