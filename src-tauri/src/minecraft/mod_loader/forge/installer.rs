use ::anyhow::{anyhow, bail, Context, Result};
use serde_json::json;
use std::path::PathBuf;
use tokio::{fs, process::Command};

use crate::{
    minecraft::mod_loader::forge::structs::Manifest,
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
        .context("Не удалось запустить Forge installer: ")?;
    //let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

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

    let version = state_project
        .loader_version
        .as_deref()
        .ok_or(anyhow!("Лоадер не выбран"))?;
    let manifest_dir = launcher_patch(None)?.join("manifest");
    fs::create_dir_all(&manifest_dir).await?;
    let forge_manifest = manifest_dir.join(format!("forge_{}.json", &version));
    let base_url = launcher_patch(Some(&state_project.project_name))?;
    let forge_name_manifest = format!("{}_forge_{}", &state_project.mc_version, &version);
    let forge_manifest_old_path = base_url
        .join("versions")
        .join(&forge_name_manifest)
        .join(format!("{}.json", &forge_name_manifest));
    fs::rename(forge_manifest_old_path, &forge_manifest).await?;

    let old_dir = base_url.join("versions");
    let jar_minecraft = format!("{}.jar", state_project.mc_version);
    fs::rename(
        old_dir.join(&state_project.mc_version).join(&jar_minecraft),
        base_url.join(&jar_minecraft),
    )
    .await?;
    fs::remove_dir_all(old_dir).await?;

    let manifest = download_json::<Manifest>(None, &forge_manifest).await?;
    Ok(manifest)
}
