use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::{fs, process::Command};

use crate::{
    log_err,
    log_info,
    state::dto::ProjectConfig,
    utils::env_info::launcher_patch,
};

pub async fn create_installer_manifest(base_url: &Path) -> Result<()> {
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
            .context("Не удалось сериализовать profiles")?;
        fs::write(&launcher_profiles_path, profiles_str)
            .await
            .with_context(|| format!("Не удалось создать launcher_profiles.json: {:?}", launcher_profiles_path))?;
    }
    Ok(())
}

pub async fn run_loader_installer(
    loader_name: &str,
    installer_path: &Path,
    vanilla_dir: &Path,
    state_project: &ProjectConfig,
) -> Result<()> {
    let java_cmd = state_project
        .java_path
        .as_deref()
        .unwrap_or("java");
    let mut command = Command::new(java_cmd);
    command
        .arg("-jar")
        .arg(installer_path)
        .arg("--installClient")
        .arg(vanilla_dir);

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .await
        .with_context(|| format!("Не удалось запустить {} installer", loader_name))?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stderr.is_empty() {
        log_err!("Stderr: {}", stderr);
    }

    if !output.status.success() {
        bail!(
            "{} installer завершился с ошибкой (код {:?}):\n{}",
            loader_name,
            output.status.code(),
            stderr
        );
    }

    Ok(())
}

pub async fn move_version_jar(base_url: &Path, mc_version: &str) -> Result<()> {
    let versions_dir = base_url.join("versions");
    let jar_name = format!("{}.jar", mc_version);
    let target_jar = base_url.join(&jar_name);

    if target_jar.exists() {
        return Ok(());
    }

    let direct = versions_dir.join(mc_version).join(&jar_name);
    if direct.exists() {
        fs::rename(&direct, &target_jar)
            .await
            .with_context(|| format!("Не удалось переместить {:?} в {:?}", direct, target_jar))?;
        return Ok(());
    }

    let mut inner_candidates: Vec<PathBuf> = Vec::new();
    let mut entries = fs::read_dir(&versions_dir)
        .await
        .with_context(|| format!("Не удалось прочитать {:?}", versions_dir))?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .context("Не удалось прочитать запись в versions")?
    {
        let path = entry.path();
        if path.is_dir() {
            let candidate = path.join(&jar_name);
            if candidate.exists() {
                inner_candidates.push(candidate);
            }
        }
    }

    let source = inner_candidates.first().cloned().ok_or_else(|| {
        anyhow!("Jar версии {} не найден в {:?}", mc_version, versions_dir)
    })?;

    fs::rename(&source, &target_jar)
        .await
        .with_context(|| format!("Не удалось переместить {:?} в {:?}", source, target_jar))?;
    Ok(())
}

pub async fn find_manifest_json_in_dir(dir: &Path, inherits_from: &str) -> Option<PathBuf> {
    let mut inner = fs::read_dir(dir).await.ok()?;
    while let Some(entry) = inner.next_entry().await.ok()? {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("json")
            && is_manifest_with_parent(&p, inherits_from).await
        {
            return Some(p);
        }
    }
    None
}

async fn is_manifest_with_parent(path: &Path, inherits_from: &str) -> bool {
    let Ok(content) = fs::read_to_string(path).await else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<Value>(&content) else {
        return false;
    };
    json.get("inheritsFrom").and_then(|v| v.as_str()) == Some(inherits_from)
}

pub async fn locate_installed_manifest(
    versions_dir: &Path,
    mc_version: &str,
    dest: &Path,
) -> Result<PathBuf> {
    if let Some(json_path) = find_manifest_json_in_dir(versions_dir, mc_version).await {
        return Ok(json_path);
    }

    let mut entries = fs::read_dir(versions_dir)
        .await
        .with_context(|| format!("Не удалось прочитать {:?}", versions_dir))?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .context("Не удалось прочитать запись в versions")?
    {
        let path = entry.path();
        if path.is_dir() {
            if let Some(json_path) = find_manifest_json_in_dir(&path, mc_version).await {
                return Ok(json_path);
            }
        }
    }

    log_info!(
        "Манифест лоадера не найден в {:?}, используем существующий {:?}",
        versions_dir,
        dest
    );
    Ok(dest.to_path_buf())
}

pub fn manifest_paths(state_project: &ProjectConfig, prefix: &str) -> Result<(PathBuf, PathBuf)> {
    let version = state_project
        .loader_version
        .as_deref()
        .ok_or_else(|| anyhow!("Лоадер не выбран"))?;
    let manifest_path = launcher_patch(None)?
        .join("manifest")
        .join(format!("{}_{}.json", prefix, version));
    let project_dir = launcher_patch(Some(&state_project.project_name))?;
    Ok((manifest_path, project_dir))
}
