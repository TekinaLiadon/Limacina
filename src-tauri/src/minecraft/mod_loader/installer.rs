use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::{fs, process::Command};

use crate::{
    log_err,
    log_info,
    minecraft::{
        mod_loader::{download::library_targets, manifest::Manifest},
        structs::{LibraryMod, VersionMod},
    },
    state::dto::ProjectConfig,
    step_try,
    utils::{
        download_file::{download_file, download_json},
        env_info::launcher_path,
        integrity::{ensure_files, record_installed_hash, HashKind, IntegrityTarget, TargetDownload},
        step_events::StepHandle,
    },
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
    let manifest_path = launcher_path(None)?
        .join("manifest")
        .join(format!("{}_{}.json", prefix, version));
    let project_dir = launcher_path(Some(&state_project.project_name))?;
    Ok((manifest_path, project_dir))
}

pub async fn start_installer(
    loader_name: &str,
    manifest_prefix: &str,
    installer_path: &Path,
    vanilla_dir: &Path,
    state_project: &ProjectConfig,
) -> Result<Manifest> {
    run_loader_installer(loader_name, installer_path, vanilla_dir, state_project).await?;

    let (loader_manifest, base_url) = manifest_paths(state_project, manifest_prefix)?;
    let versions_dir = base_url.join("versions");

    let fast_name = format!(
        "{}_{}_{}",
        state_project.mc_version,
        manifest_prefix,
        state_project.loader_version.as_deref().unwrap_or_default()
    );
    let fast_manifest = versions_dir
        .join(&fast_name)
        .join(format!("{}.json", fast_name));

    let source = if fast_manifest.exists() {
        fast_manifest
    } else {
        locate_installed_manifest(&versions_dir, &state_project.mc_version, &loader_manifest).await?
    };

    move_version_jar(&base_url, &state_project.mc_version).await?;

    if source != loader_manifest {
        if let Some(parent) = loader_manifest.parent() {
            fs::create_dir_all(parent)
                .await
                .with_context(|| format!("Не удалось создать {:?}", parent))?;
        }
        fs::rename(&source, &loader_manifest)
            .await
            .with_context(|| format!("Не удалось переместить {:?} в {:?}", source, loader_manifest))?;
    }

    let _ = fs::remove_dir_all(versions_dir).await;

    download_json::<Manifest>(None, &loader_manifest).await
}

async fn install_loader_files(
    step: StepHandle,
    base: &Path,
    project: &str,
    target_version: &str,
    library: &[LibraryMod],
    installer_url: &str,
) -> Result<()> {
    let mut targets = library_targets(library)?;
    targets.push(IntegrityTarget {
        rel_path: PathBuf::from(format!("{}.jar", target_version)),
        hash: String::new(),
        hash_kind: HashKind::Sha1,
        download: TargetDownload::Url(installer_url.to_string()),
    });
    step_try!(step, ensure_files(&step, base, project, targets).await);
    step_try!(step, record_installed_hash(
        project,
        base,
        &PathBuf::from(format!("{}.jar", target_version)),
    )
    .await);
    Ok(())
}

pub async fn setup_loader(
    loader_name: &str,
    manifest_prefix: &str,
    state: &ProjectConfig,
    manifest: &[VersionMod],
    library_from: fn(Manifest) -> Result<Vec<LibraryMod>>,
) -> Result<()> {
    let base_url = launcher_path(Some(&state.project_name))?;
    let loader_version = state
        .loader_version
        .as_deref()
        .ok_or_else(|| anyhow!("Лоадер не выбран"))?;
    let target_version = format!("{}-{}", &state.mc_version, loader_version);
    let version_info = manifest
        .iter()
        .find(|v| v.id == target_version)
        .ok_or_else(|| anyhow!("Версия не найдена"))?;

    let step = StepHandle::start("loader", format!("Установка {}", loader_name));

    let loader_manifest_path = launcher_path(None)?
        .join("manifest")
        .join(format!("{}_{}.json", manifest_prefix, loader_version));

    if loader_manifest_path.exists() {
        let version_manifest = download_json::<Manifest>(None, &loader_manifest_path).await?;
        let library = library_from(version_manifest)?;
        install_loader_files(
            step.clone(),
            &base_url,
            &state.project_name,
            &target_version,
            &library,
            &version_info.url,
        )
        .await?;
        log_info!("{} уже установлен, проверка файлов завершена", loader_name);
        step.finish(true);
        return Ok(());
    }

    step.detail("Скачивание инсталлера");
    step.set_total(1);
    let installer_path = base_url.join(format!("{}.jar", &target_version));
    step_try!(step, download_file(&version_info.url, &installer_path).await);
    step.inc();

    step_try!(step, create_installer_manifest(&base_url).await);

    step.detail("Запуск инсталлера");
    log_info!("Запуск инсталлера {}", loader_name);
    let loader_manifest = step_try!(
        step,
        start_installer(loader_name, manifest_prefix, &installer_path, &base_url, state).await
    );
    let library = step_try!(step, library_from(loader_manifest));

    step.detail("Скачивание библиотек");
    log_info!("Скачивание библиотек {}", loader_name);
    install_loader_files(
        step.clone(),
        &base_url,
        &state.project_name,
        &target_version,
        &library,
        &version_info.url,
    )
    .await?;

    log_info!("Установка {} завершена", loader_name);
    step.finish(false);
    Ok(())
}
