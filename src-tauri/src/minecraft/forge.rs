use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;
use tokio::process::Command;

#[derive(Debug, Deserialize)]
struct ForgePromotions {
    promos: HashMap<String, String>,
}

fn get_home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

async fn download_file(client: &Client, url: &str, dest: &PathBuf) -> Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await?;
    }

    println!("⬇ Скачивание: {}", url);

    let response = client
        .get(url)
        .send()
        .await?
        .error_for_status()
        .with_context(|| format!("HTTP ошибка для {}", url))?;

    let content = response.bytes().await?;
    fs::write(dest, &content).await?;

    Ok(())
}

async fn cleanup_temp_files(base_dir: &PathBuf, installer_path: &PathBuf) {
    if installer_path.exists() {
        let _ = fs::remove_file(installer_path).await;
        println!("Удалён installer: {:?}", installer_path);
    }

    // Удаляем временные папки, созданные installer'ом
    let temp_dirs = ["installer_logs", "temp", ".tmp"];
    for dir_name in temp_dirs {
        let temp_path = base_dir.join(dir_name);
        if temp_path.exists() {
            let _ = fs::remove_dir_all(&temp_path).await;
            println!("Удалена временная папка: {:?}", temp_path);
        }
    }
}

#[tauri::command]
pub async fn get_forge(mc_version: String) -> Result<String, String> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (compatible; MinecraftLauncher/1.0)")
        .build()
        .map_err(|e| format!("Не удалось создать HTTP клиент: {}", e))?;

    let promotions_url =
        "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json";
    println!("🔍 Получение списка версий Forge...");

    let promos_str = client
        .get(promotions_url)
        .send()
        .await
        .map_err(|e| format!("Не удалось получить список версий Forge: {}", e))?
        .error_for_status()
        .map_err(|e| format!("HTTP-ошибка: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Не удалось прочитать ответ: {}", e))?;

    let promotions: ForgePromotions = serde_json::from_str(&promos_str)
        .map_err(|e| format!("Не удалось распарсить список версий: {}", e))?;

    let forge_version = promotions
        .promos
        .get(&format!("{}-recommended", mc_version))
        .or_else(|| promotions.promos.get(&format!("{}-latest", mc_version)))
        .ok_or_else(|| {
            let available: Vec<_> = promotions
                .promos
                .keys()
                .filter(|k| k.ends_with("-recommended") || k.ends_with("-latest"))
                .filter_map(|k| k.split('-').next())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            format!(
                "Нет версий Forge для MC {}. Доступные: {:?}",
                mc_version, available
            )
        })?;

    println!(
        "✓ Найдена версия Forge: {} для MC {}",
        forge_version, mc_version
    );

    let forge_full_version = format!("{}-{}", mc_version, forge_version);
    let forge_installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{0}/forge-{0}-installer.jar",
        forge_full_version
    );

    let home_dir = get_home_dir().ok_or("Не удалось определить домашнюю директорию")?;

    let launcher_name =
        std::env::var("LAUNCHER_NAME").unwrap_or_else(|_| ".minecraft_launcher".to_string());

    let base = home_dir.join(&launcher_name);
    let installer_path = base.join("forge-installer.jar");

    fs::create_dir_all(&base)
        .await
        .map_err(|e| format!("Не удалось создать директорию: {}", e))?;

    download_file(&client, &forge_installer_url, &installer_path)
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

    cleanup_temp_files(&base, &installer_path).await;

    if !output.status.success() {
        return Err(format!(
            "Forge installer завершился с ошибкой (код {:?}):\n{}",
            output.status.code(),
            stderr
        ));
    }

    println!("✓ Forge установлен успешно!");

    Ok(format!(
        "✓ Forge {} для Minecraft {} успешно установлен!",
        forge_version, mc_version
    ))
}
