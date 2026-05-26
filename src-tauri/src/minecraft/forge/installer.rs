use anyhow::{bail, Context, Result};
use tokio::process::Command;

use crate::utils::{download_file::download_file, env_info::launcher_patch};
use serde_json::json;
use tokio::fs;

pub async fn create_installer(forge_version: &String) -> Result<()> {
    let forge_installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{0}/forge-{0}-installer.jar",
        forge_version
    );
    let base = launcher_patch(Some("libra"))?;
    let installer_path = base.join("forge-installer.jar");

    fs::create_dir_all(&base)
        .await
        .context("Не удалось создать директорию: ")?; // TODO
    download_file(&forge_installer_url, &installer_path)
        .await
        .context("Не удалось скачать installer: ")?;

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
            .context("Не удалось сериализовать profiles: ")?;
        fs::write(&launcher_profiles_path, profiles_str)
            .await
            .context("Не удалось создать launcher_profiles.json: ")?;
    }

    Ok(())
}

pub async fn start_installer() -> Result<()> {
    let base = launcher_patch(Some("libra"))?;
    let installer_path = base.join("forge-installer.jar");

    println!("🔧 Запуск Forge installer...");
    let output = Command::new("java")
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installClient")
        .arg(base.to_string_lossy().to_string())
        .output()
        .await
        .context("Не удалось запустить Forge installer: ")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    println!("Stdout: {}", stdout);
    if !stderr.is_empty() {
        eprintln!("Stderr: {}", stderr);
    }

    if !output.status.success() {
        bail!(format!(
            "Forge installer завершился с ошибкой (код {:?}):\n{}",
            output.status.code(),
            stderr
        ))
    }

    Ok(())
}

pub async fn cleanup_temp_files() -> Result<()> {
    let base_dir = launcher_patch(Some("libra"))?;
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
