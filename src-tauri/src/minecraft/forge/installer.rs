use tokio::process::Command;

use serde_json::json;
use tokio::fs;
use crate::utils::{download_file::download_file, env_info::launcher_patch};

pub async fn create_installer(forge_version: &String) -> Result<(), String> {
    let forge_installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{0}/forge-{0}-installer.jar",
        forge_version
    );
    let base = launcher_patch()?;
    let installer_path = base.join("forge-installer.jar");

    fs::create_dir_all(&base)
        .await
        .map_err(|e| format!("Не удалось создать директорию: {}", e))?; // TODO
    download_file(&forge_installer_url, &installer_path)
        .await
        .map_err(|e| format!("Не удалось скачать installer: {}", e))?;

    let launcher_profiles_path = base.join("launcher_profiles.json");
    if !launcher_profiles_path.exists() {
        println!("📝 Создание launcher_profiles.json...");

        let profiles = json!({
            "profiles": {},
            "selectedProfile": "",
            "clientToken": uuid::Uuid::new_v4().to_string(),
            "authenticationDatabase": {},
            "launcherVersion": {
                "name": "custom",
                "format": 21,
                "profilesFormat": 2
            }
        });

        let profiles_str = serde_json::to_string_pretty(&profiles)
            .map_err(|e| format!("Не удалось сериализовать profiles: {}", e))?;
        fs::write(&launcher_profiles_path, profiles_str)
            .await
            .map_err(|e| format!("Не удалось создать launcher_profiles.json: {}", e))?;
    }
    
    Ok(())
}

pub async fn start_installer() -> Result<(), String> {
    let base = launcher_patch()?;
    let installer_path = base.join("forge-installer.jar");

    println!("🔧 Запуск Forge installer...");
    let output = Command::new("java")
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installClient")
        .arg(base.to_string_lossy().to_string())
        .output()
        .await
        .map_err(|e| format!("Не удалось запустить Forge installer: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    println!("Stdout: {}", stdout);
    if !stderr.is_empty() {
        eprintln!("Stderr: {}", stderr);
    }

    if !output.status.success() {
        return Err(format!(
            "Forge installer завершился с ошибкой (код {:?}):\n{}",
            output.status.code(),
            stderr
        ));
    }

    Ok(())
}

pub async fn cleanup_temp_files() -> Result<(), String> {
    let base_dir = launcher_patch()?;
    let installer_path = base_dir.join("forge-installer.jar");
    
    if installer_path.exists() {
        let _ = fs::remove_file(&installer_path).await;
        println!("Удалён installer: {:?}", &installer_path);
    }

    let temp_dirs = ["installer_logs", "temp", ".tmp"];
    for dir_name in temp_dirs {
        let temp_path = base_dir.join(dir_name);
        if temp_path.exists() {
            let _ = fs::remove_dir_all(&temp_path).await;
            println!("Удалена временная папка: {:?}", temp_path);
        }
    }
    Ok(())
}