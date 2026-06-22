use ::anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::{fs, process::Command};

use crate::{
    log_info,
    minecraft::mod_loader::neoforge::structs::Manifest,
    state::dto::ProjectConfig,
    utils::{download_file::download_json, env_info::launcher_patch},
};

pub async fn create_installer_manifest(base_url: &PathBuf) -> Result<()> {
    let launcher_profiles_path = base_url.join("launcher_profiles.json");
    if !launcher_profiles_path.exists() {
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

async fn find_neoforge_json_in_dir(dir: &Path) -> Option<PathBuf> {
    let mut inner = match fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return None,
    };
    while let Some(entry) = inner.next_entry().await.ok()? {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("json") {
            if is_neoforge_manifest(&p).await {
                return Some(p);
            }
        }
    }
    None
}

async fn is_neoforge_manifest(path: &Path) -> bool {
    let content = match fs::read_to_string(path).await {
        Ok(c) => c,
        Err(_) => return false,
    };
    let json: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    json.get("inheritsFrom").is_some()
}

pub async fn start_installer(
    url: &PathBuf,
    vanilla_url: &PathBuf,
    state_project: &ProjectConfig,
) -> Result<Manifest> {
    let java_cmd = state_project.java_path.as_deref().unwrap_or("java");
    let output = Command::new(java_cmd)
        .arg("-jar")
        .arg(&url)
        .arg("--installClient")
        .arg(&vanilla_url)
        .output()
        .await
        .context("Не удалось запустить NeoForge installer: ")?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stderr.is_empty() {
        eprintln!("Stderr: {}", stderr);
    }

    if !output.status.success() {
        bail!(format!(
            "NeoForge installer завершился с ошибкой (код {:?}):\n{}",
            output.status.code(),
            stderr
        ))
    }

    let version = state_project
        .loader_version
        .as_deref()
        .ok_or(anyhow!("Лоадер не выбран"))?;
    let neoforge_manifest = launcher_patch(None)?
        .join("manifest")
        .join(format!("neoforge_{}.json", &version));
    let base_url = launcher_patch(Some(&state_project.project_name))?;
    let versions_dir = base_url.join("versions");

    let jar_minecraft = format!("{}.jar", state_project.mc_version);
    let jar_path = base_url.join(&jar_minecraft);
    if !jar_path.exists() {
        if let Ok(mut entries) = fs::read_dir(&versions_dir).await {
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.is_dir() {
                    let jar_candidate = path.join(&jar_minecraft);
                    if jar_candidate.exists() {
                        let _ = fs::rename(&jar_candidate, &jar_path).await;
                        break;
                    }
                    let mut inner = fs::read_dir(&path).await?;
                    while let Some(inner_entry) = inner.next_entry().await? {
                        let inner_path = inner_entry.path();
                        if inner_path.extension().and_then(|e| e.to_str()) == Some("jar") {
                            let _ = fs::rename(&inner_path, &jar_path).await;
                            break;
                        }
                    }
                } else if path.extension().and_then(|e| e.to_str()) == Some("jar") {
                    let _ = fs::rename(&path, &jar_path).await;
                }
            }
        }
    }

    if versions_dir.exists() {
        let mut found = false;
        if let Some(json_path) = find_neoforge_json_in_dir(&versions_dir).await {
            log_info!("Найден NeoForge манифест: {:?}", &json_path);
            fs::rename(&json_path, &neoforge_manifest).await?;
            found = true;
        }
        if !found {
            let mut entries = fs::read_dir(&versions_dir).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(json_path) = find_neoforge_json_in_dir(&path).await {
                        log_info!("Найден NeoForge манифест: {:?}", &json_path);
                        fs::rename(&json_path, &neoforge_manifest).await?;
                        found = true;
                        break;
                    }
                }
            }
        }
        if !found {
            log_info!("NeoForge манифест не найден в versions/, используем существующий");
        }
    }

    let manifest = download_json::<Manifest>(None, &neoforge_manifest).await?;
    Ok(manifest)
}
