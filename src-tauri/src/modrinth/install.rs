use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};

use super::client;
use super::structs::{ManifestEntry, ModrinthFile, ModrinthManifest, ModrinthVersion};
use crate::log_err;
use crate::log_info;
use crate::utils::download_file::{download_file, file_sha1, write_atomic};

pub struct InstallContext {
    pub loaders: Vec<String>,
    pub game_versions: Vec<String>,
    pub mods_dir: PathBuf,
    pub manifest_path: PathBuf,
}

pub struct InstallReport {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
}

pub async fn load_manifest(path: &Path) -> ModrinthManifest {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
            log_err!("[modrinth] Некорректный манифест модов {:?}: {}", path, e);
            ModrinthManifest::default()
        }),
        Err(_) => ModrinthManifest::default(),
    }
}

pub async fn save_manifest(path: &Path, manifest: &ModrinthManifest) -> Result<()> {
    let content =
        serde_json::to_vec_pretty(manifest).context("Не удалось сериализовать манифест модов")?;
    write_atomic(path, &content)
        .await
        .with_context(|| format!("Не удалось сохранить манифест модов {:?}", path))
}

pub async fn install_project(ctx: &InstallContext, project_id: &str) -> Result<InstallReport> {
    let mut visited: HashSet<String> = HashSet::new();
    let mut resolved: Vec<ModrinthVersion> = Vec::new();

    log_info!(
        "[modrinth] Установка мода {}: loaders={:?}, game_versions={:?}",
        project_id,
        ctx.loaders,
        ctx.game_versions
    );
    resolve_project(ctx, project_id, &mut visited, &mut resolved).await?;

    tokio::fs::create_dir_all(&ctx.mods_dir)
        .await
        .with_context(|| format!("Не удалось создать директорию модов {:?}", ctx.mods_dir))?;

    let mut manifest = load_manifest(&ctx.manifest_path).await;
    let mut report = InstallReport {
        installed: Vec::new(),
        skipped: Vec::new(),
    };

    for version in &resolved {
        let file = primary_file(version)?;
        let sha1 = file
            .hashes
            .get("sha1")
            .cloned()
            .ok_or_else(|| anyhow!("Файл версии {} без SHA1 хеша", version.version_number))?;

        let (title, icon_url, slug) = project_display_info(&version.project_id).await;

        let entry = ManifestEntry {
            project_id: version.project_id.clone(),
            slug,
            title,
            icon_url,
            filename: file.filename.clone(),
            sha1,
            version_id: version.id.clone(),
            version_number: version.version_number.clone(),
        };
        let dest = ctx.mods_dir.join(&entry.filename);

        if install_file(&dest, &entry.sha1, &file.url).await? {
            log_info!(
                "[modrinth] Установлен: {} ({})",
                entry.filename,
                entry.version_number
            );
            report.installed.push(entry.filename.clone());
        } else {
            log_info!(
                "[modrinth] Уже установлен: {} ({})",
                entry.filename,
                entry.version_number
            );
            report.skipped.push(entry.filename.clone());
        }

        manifest.mods.insert(entry.project_id.clone(), entry);
    }

    save_manifest(&ctx.manifest_path, &manifest).await?;
    Ok(report)
}

async fn resolve_project(
    ctx: &InstallContext,
    project_id: &str,
    visited: &mut HashSet<String>,
    resolved: &mut Vec<ModrinthVersion>,
) -> Result<()> {
    if !visited.insert(project_id.to_string()) {
        return Ok(());
    }

    let versions = client::get_project_versions(project_id, &ctx.loaders, &ctx.game_versions)
        .await
        .with_context(|| format!("Не удалось получить версии мода {}", project_id))?;
    let version = pick_version(&versions).ok_or_else(|| {
        anyhow!(
            "Для Minecraft {} и лоадера {:?} не найдено совместимых версий мода {}",
            ctx.game_versions.join(", "),
            ctx.loaders,
            project_id
        )
    })?;
    log_info!(
        "[modrinth] Выбрана версия {} ({}) для проекта {}",
        version.version_number,
        version.id,
        project_id
    );
    resolved.push(version.clone());

    for dependency in &version.dependencies {
        if dependency.dependency_type != "required" {
            continue;
        }
        let dep_project_id = match &dependency.project_id {
            Some(id) => id.clone(),
            None => match &dependency.version_id {
                Some(version_id) => client::get_version(version_id).await?.project_id,
                None => continue,
            },
        };
        Box::pin(resolve_project(ctx, &dep_project_id, visited, resolved)).await?;
    }

    Ok(())
}

async fn project_display_info(project_id: &str) -> (String, Option<String>, Option<String>) {
    match client::get_project(project_id).await {
        Ok(project) => (
            project.title.clone(),
            project.icon_url.clone(),
            project.slug.clone(),
        ),
        Err(e) => {
            log_err!(
                "[modrinth] Не удалось получить информацию проекта {}: {}",
                project_id,
                e
            );
            (String::new(), None, None)
        }
    }
}

pub fn pick_version(versions: &[ModrinthVersion]) -> Option<&ModrinthVersion> {
    versions
        .iter()
        .find(|v| v.version_type == "release")
        .or_else(|| versions.first())
}

fn primary_file(version: &ModrinthVersion) -> Result<&ModrinthFile> {
    version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| anyhow!("Версия {} без файлов", version.version_number))
}

async fn install_file(dest: &Path, expected_sha1: &str, url: &str) -> Result<bool> {
    if dest.exists() {
        let hash = file_sha1(dest).await.unwrap_or_default();
        if hash == expected_sha1 {
            return Ok(false);
        }
        log_info!(
            "[modrinth] Файл {:?} отличается от ожидаемого — перекачивается",
            dest
        );
        let _ = tokio::fs::remove_file(dest).await;
    }

    download_file(url, dest)
        .await
        .with_context(|| format!("Не удалось скачать {}", url))?;

    let hash = file_sha1(dest).await?;
    if hash != expected_sha1 {
        let _ = tokio::fs::remove_file(dest).await;
        return Err(anyhow!(
            "SHA1 файла {:?} не совпал с ожидаемым ({} != {})",
            dest,
            hash,
            expected_sha1
        ));
    }
    Ok(true)
}

pub async fn uninstall_project(ctx: &InstallContext, project_id: &str) -> Result<()> {
    let mut manifest = load_manifest(&ctx.manifest_path).await;
    let entry = manifest
        .mods
        .remove(project_id)
        .ok_or_else(|| anyhow!("Мод {} не установлен через Modrinth", project_id))?;

    let dest = ctx.mods_dir.join(&entry.filename);
    if dest.exists() {
        tokio::fs::remove_file(&dest)
            .await
            .with_context(|| format!("Не удалось удалить файл мода {:?}", dest))?;
    }
    log_info!(
        "[modrinth] Удалён мод: {} ({})",
        entry.title,
        entry.version_number
    );

    save_manifest(&ctx.manifest_path, &manifest).await?;
    Ok(())
}

pub struct UpdateCheck {
    pub project_id: String,
    pub current_version: String,
    pub available_version: Option<String>,
}

pub async fn check_updates(ctx: &InstallContext) -> Result<Vec<UpdateCheck>> {
    let manifest = load_manifest(&ctx.manifest_path).await;
    let mut result = Vec::new();

    for entry in manifest.mods.values() {
        let available =
            client::get_version_from_hash(&entry.sha1, &ctx.loaders, &ctx.game_versions)
                .await
                .ok()
                .flatten()
                .filter(|v| v.id != entry.version_id)
                .map(|v| v.version_number);
        result.push(UpdateCheck {
            project_id: entry.project_id.clone(),
            current_version: entry.version_number.clone(),
            available_version: available,
        });
    }
    Ok(result)
}

pub async fn sync_installed_from_hashes(
    ctx: &InstallContext,
    local_hashes: HashMap<String, String>,
) -> Result<ModrinthManifest> {
    let mut manifest = load_manifest(&ctx.manifest_path).await;
    let mut changed = false;

    manifest.mods.retain(|_, entry| {
        let present = local_hashes.values().any(|h| *h == entry.sha1);
        if !present {
            log_info!(
                "[modrinth] Файл манифеста отсутствует в mods: {} ({})",
                entry.filename,
                entry.version_number
            );
            changed = true;
        }
        present
    });

    let foreign_hashes: Vec<String> = local_hashes
        .values()
        .filter(|h| !manifest.mods.values().any(|e| &e.sha1 == *h))
        .cloned()
        .collect();

    if !foreign_hashes.is_empty() {
        match client::get_versions_from_hashes(&foreign_hashes, &ctx.loaders, &ctx.game_versions)
            .await
        {
            Ok(found) => {
                let missing_projects: Vec<String> = found
                    .values()
                    .map(|v| v.project_id.clone())
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .filter(|id| !manifest.mods.contains_key(id))
                    .collect();
                let projects: HashMap<String, (String, Option<String>)> =
                    if missing_projects.is_empty() {
                        HashMap::new()
                    } else {
                        match client::get_projects(&missing_projects).await {
                            Ok(list) => list
                                .into_iter()
                                .map(|p| (p.id.clone(), (p.title.clone(), p.icon_url.clone())))
                                .collect(),
                            Err(e) => {
                                log_err!("[modrinth] Не удалось получить проекты по id: {}", e);
                                HashMap::new()
                            }
                        }
                    };
                let hash_to_filename: HashMap<&str, &str> = local_hashes
                    .iter()
                    .map(|(filename, hash)| (hash.as_str(), filename.as_str()))
                    .collect();

                for (hash, version) in &found {
                    let Some(filename) = hash_to_filename.get(hash.as_str()) else {
                        continue;
                    };
                    let project_id = version.project_id.clone();
                    if manifest.mods.contains_key(&project_id) {
                        continue;
                    }
                    let (title, icon_url) = projects
                        .get(&project_id)
                        .cloned()
                        .unwrap_or_else(|| (version.name.clone(), None));
                    log_info!(
                        "[modrinth] Обнаружен мод Modrinth по хешу: {} ({})",
                        filename,
                        version.version_number
                    );
                    changed = true;
                    manifest.mods.insert(
                        project_id.clone(),
                        ManifestEntry {
                            project_id,
                            slug: None,
                            title,
                            icon_url,
                            filename: (*filename).to_string(),
                            sha1: hash.clone(),
                            version_id: version.id.clone(),
                            version_number: version.version_number.clone(),
                        },
                    );
                }
            }
            Err(e) => {
                log_err!("[modrinth] Не удалось определить моды по хешам: {}", e);
            }
        }
    }

    if changed {
        save_manifest(&ctx.manifest_path, &manifest).await?;
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modrinth::client::{clear_response_cache_for_tests, override_api_base_for_tests};
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use mockito::{Matcher, Server};
    use serde_json::json;

    fn version_json(
        id: &str,
        project_id: &str,
        version_number: &str,
        url: String,
        sha1: String,
        deps: serde_json::Value,
    ) -> serde_json::Value {
        json!({
            "id": id,
            "project_id": project_id,
            "name": format!("Mod {}", project_id),
            "version_number": version_number,
            "dependencies": deps,
            "game_versions": ["1.21.1"],
            "loaders": ["fabric"],
            "version_type": "release",
            "files": [{
                "hashes": {"sha1": sha1},
                "url": url,
                "filename": format!("{}.jar", project_id),
                "primary": true,
                "size": 4,
                "file_type": null
            }]
        })
    }

    fn project_json(id: &str, title: &str) -> serde_json::Value {
        json!({"id": id, "project_type": "mod", "title": title})
    }

    fn parsed_version(value: serde_json::Value) -> ModrinthVersion {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn pick_version_prefers_release_over_beta() {
        let beta = parsed_version(
            json!({"id": "beta", "project_id": "A", "version_number": "0.9", "version_type": "beta", "dependencies": [], "files": []}),
        );
        let release = parsed_version(
            json!({"id": "release", "project_id": "A", "version_number": "1.0", "version_type": "release", "dependencies": [], "files": []}),
        );
        assert_eq!(pick_version(&[beta, release]).unwrap().id, "release");
    }

    #[tokio::test]
    async fn install_project_downloads_required_dependencies() {
        let dir = LauncherDirGuard::acquire("modrinth_install_deps").await;
        let mut server = Server::new_async().await;
        override_api_base_for_tests(format!("{}/v2", server.url()));
        clear_response_cache_for_tests();

        let jar_a = b"mod a jar".to_vec();
        let jar_b = b"mod b jar".to_vec();

        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", server.url()),
            sha1_hex(&jar_a),
            json!([{"version_id": null, "project_id": "B", "file_name": null, "dependency_type": "required"}]),
        );
        let version_b = version_json(
            "verB",
            "B",
            "0.2.0",
            format!("{}/cdn/b.jar", server.url()),
            sha1_hex(&jar_b),
            json!([]),
        );

        let va_mock = server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;
        let pa_mock = server
            .mock("GET", "/v2/project/A")
            .with_status(200)
            .with_body(project_json("A", "Mod A").to_string())
            .create_async()
            .await;
        let vb_mock = server
            .mock("GET", "/v2/project/B/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_b]).to_string())
            .create_async()
            .await;
        let pb_mock = server
            .mock("GET", "/v2/project/B")
            .with_status(200)
            .with_body(project_json("B", "Mod B").to_string())
            .create_async()
            .await;
        let jar_a_mock = server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(jar_a.clone())
            .create_async()
            .await;
        let jar_b_mock = server
            .mock("GET", "/cdn/b.jar")
            .with_status(200)
            .with_body(jar_b.clone())
            .create_async()
            .await;

        let project_dir = dir.project_dir("Test");
        let ctx = InstallContext {
            loaders: vec!["fabric".to_string()],
            game_versions: vec!["1.21.1".to_string()],
            mods_dir: project_dir.join("mods"),
            manifest_path: project_dir.join("modrinth.json"),
        };

        let report = install_project(&ctx, "A").await.expect("установка мода");

        assert_eq!(report.installed.len(), 2);
        assert_eq!(std::fs::read(ctx.mods_dir.join("A.jar")).unwrap(), jar_a);
        assert_eq!(std::fs::read(ctx.mods_dir.join("B.jar")).unwrap(), jar_b);

        let manifest = load_manifest(&ctx.manifest_path).await;
        assert_eq!(manifest.mods.len(), 2);
        assert_eq!(manifest.mods.get("A").unwrap().title, "Mod A");
        assert_eq!(manifest.mods.get("B").unwrap().version_number, "0.2.0");

        va_mock.assert_async().await;
        pa_mock.assert_async().await;
        vb_mock.assert_async().await;
        pb_mock.assert_async().await;
        jar_a_mock.assert_async().await;
        jar_b_mock.assert_async().await;
    }

    #[tokio::test]
    async fn install_rejects_corrupted_download() {
        let dir = LauncherDirGuard::acquire("modrinth_install_corrupt").await;
        let mut server = Server::new_async().await;
        override_api_base_for_tests(format!("{}/v2", server.url()));
        clear_response_cache_for_tests();

        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", server.url()),
            sha1_hex(b"expected content"),
            json!([]),
        );
        server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v2/project/A")
            .with_status(200)
            .with_body(project_json("A", "Mod A").to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(b"corrupted content")
            .create_async()
            .await;

        let project_dir = dir.project_dir("Test");
        let ctx = InstallContext {
            loaders: vec!["fabric".to_string()],
            game_versions: vec!["1.21.1".to_string()],
            mods_dir: project_dir.join("mods"),
            manifest_path: project_dir.join("modrinth.json"),
        };

        let result = install_project(&ctx, "A").await;
        assert!(result.is_err());
        assert!(!ctx.mods_dir.join("A.jar").exists());
        assert!(load_manifest(&ctx.manifest_path).await.mods.is_empty());
    }

    #[tokio::test]
    async fn install_skips_existing_identical_file() {
        let dir = LauncherDirGuard::acquire("modrinth_install_skip").await;
        let mut server = Server::new_async().await;
        override_api_base_for_tests(format!("{}/v2", server.url()));
        clear_response_cache_for_tests();

        let jar_a = b"already installed".to_vec();
        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", server.url()),
            sha1_hex(&jar_a),
            json!([]),
        );
        server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v2/project/A")
            .with_status(200)
            .with_body(project_json("A", "Mod A").to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(jar_a.clone())
            .expect(0)
            .create_async()
            .await;

        let project_dir = dir.project_dir("Test");
        let ctx = InstallContext {
            loaders: vec!["fabric".to_string()],
            game_versions: vec!["1.21.1".to_string()],
            mods_dir: project_dir.join("mods"),
            manifest_path: project_dir.join("modrinth.json"),
        };
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), &jar_a)
            .await
            .unwrap();

        let report = install_project(&ctx, "A").await.expect("установка мода");

        assert!(report.installed.is_empty());
        assert_eq!(report.skipped, vec!["A.jar".to_string()]);
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .mods
            .contains_key("A"));
    }
}
