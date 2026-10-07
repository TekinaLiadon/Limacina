use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::utils::errors::LauncherError;
use anyhow::{Context, Result};

use super::client;
use super::structs::{ManifestEntry, ModrinthFile, ModrinthManifest, ModrinthVersion};
use crate::log_err;
use crate::log_info;
use crate::utils::download_file::{download_file, write_atomic};
use crate::utils::env_info::is_safe_relative_path;

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

pub async fn load_manifest(path: &Path) -> Result<ModrinthManifest> {
    let content = match tokio::fs::read_to_string(path).await {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ModrinthManifest::default())
        }
        Err(e) => {
            return Err(e).with_context(|| format!("Не удалось прочитать манифест модов {path:?}"))
        }
    };
    match serde_json::from_str(&content) {
        Ok(manifest) => Ok(manifest),
        Err(e) => {
            log_err!("[modrinth] Некорректный манифест модов {:?}: {}", path, e);
            Ok(ModrinthManifest::default())
        }
    }
}

pub async fn save_manifest(path: &Path, manifest: &ModrinthManifest) -> Result<()> {
    let content = serde_json::to_vec_pretty(manifest).map_err(|e| {
        LauncherError::Modrinth(format!("Не удалось сериализовать манифест модов: {e:#}"))
    })?;
    write_atomic(path, &content).await.map_err(|e| {
        LauncherError::Modrinth(format!(
            "Не удалось сохранить манифест модов {path:?}: {e:#}"
        ))
        .into()
    })
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
        .map_err(|e| {
            LauncherError::Modrinth(format!(
                "Не удалось создать директорию модов {:?}: {e:#}",
                ctx.mods_dir
            ))
        })?;

    let mut manifest = load_manifest(&ctx.manifest_path).await?;
    let mut report = InstallReport {
        installed: Vec::new(),
        skipped: Vec::new(),
    };

    for version in &resolved {
        let file = primary_file(version)?;
        let sha1 = file.hashes.get("sha1").cloned().ok_or_else(|| {
            LauncherError::Modrinth(format!(
                "Файл версии {} без SHA1 хеша",
                version.version_number
            ))
        })?;

        if !is_safe_relative_path(&file.filename) {
            return Err(LauncherError::InvalidModFilename(file.filename.clone()).into());
        }

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

        if let Some(previous) = manifest.mods.get(&version.project_id) {
            if previous.filename != entry.filename {
                remove_replaced_mod_file(&ctx.mods_dir, &previous.filename).await?;
            }
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
        .map_err(|e| {
            LauncherError::Modrinth(format!(
                "Не удалось получить версии мода {project_id}: {e:#}"
            ))
        })?;
    let version = pick_version(&versions).ok_or_else(|| {
        LauncherError::Modrinth(format!(
            "Для Minecraft {} и лоадера {:?} не найдено совместимых версий мода {}",
            ctx.game_versions.join(", "),
            ctx.loaders,
            project_id
        ))
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
        .ok_or_else(|| {
            LauncherError::Modrinth(format!("Версия {} без файлов", version.version_number)).into()
        })
}

async fn install_file(dest: &Path, expected_sha1: &str, url: &str) -> Result<bool> {
    let url = url.to_string();
    crate::utils::download_file::download_and_verify_with(
        dest,
        Some(expected_sha1),
        true,
        move |path| async move { download_file(&url, &path).await },
    )
    .await
}

async fn remove_replaced_mod_file(mods_dir: &Path, filename: &str) -> Result<()> {
    if !is_safe_relative_path(filename) {
        log_err!(
            "[modrinth] Заменённый файл мода имеет небезопасное имя, удаление пропущено: {}",
            filename
        );
        return Ok(());
    }

    let old_dest = mods_dir.join(filename);
    if !old_dest.exists() {
        return Ok(());
    }
    tokio::fs::remove_file(&old_dest).await.map_err(|e| {
        LauncherError::Modrinth(format!(
            "Не удалось удалить заменённый файл мода {old_dest:?}: {e:#}"
        ))
    })?;
    log_info!("[modrinth] Удалён заменённый файл мода: {}", filename);
    Ok(())
}

pub async fn uninstall_project(ctx: &InstallContext, project_id: &str) -> Result<()> {
    let mut manifest = load_manifest(&ctx.manifest_path).await?;
    let entry = manifest.mods.remove(project_id).ok_or_else(|| {
        LauncherError::Modrinth(format!("Мод {} не установлен через Modrinth", project_id))
    })?;

    if !is_safe_relative_path(&entry.filename) {
        return Err(LauncherError::InvalidModFilename(entry.filename.clone()).into());
    }

    let dest = ctx.mods_dir.join(&entry.filename);
    if dest.exists() {
        tokio::fs::remove_file(&dest).await.map_err(|e| {
            LauncherError::Modrinth(format!("Не удалось удалить файл мода {dest:?}: {e:#}"))
        })?;
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
    let manifest = load_manifest(&ctx.manifest_path).await?;
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
    let mut manifest = load_manifest(&ctx.manifest_path).await?;
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
    use mockito::{Matcher, Server, ServerGuard};
    use serde_json::json;

    struct ModrinthEnv {
        dir: LauncherDirGuard,
        server: ServerGuard,
    }

    impl ModrinthEnv {
        async fn acquire(label: &str) -> Self {
            let dir = LauncherDirGuard::acquire(label).await;
            let server = Server::new_async().await;
            override_api_base_for_tests(format!("{}/v2", server.url()));
            clear_response_cache_for_tests();
            Self { dir, server }
        }

        fn project_dir(&self) -> PathBuf {
            self.dir.project_dir("Test")
        }

        fn install_ctx(&self) -> InstallContext {
            let project_dir = self.project_dir();
            InstallContext {
                loaders: vec!["fabric".to_string()],
                game_versions: vec!["1.21.1".to_string()],
                mods_dir: project_dir.join("mods"),
                manifest_path: project_dir.join("modrinth.json"),
            }
        }
    }

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

    async fn mock_install_env(
        env: &mut ModrinthEnv,
        version: serde_json::Value,
        jar_body: &[u8],
        cdn_expect: usize,
    ) {
        env.server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version]).to_string())
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/project/A")
            .with_status(200)
            .with_body(project_json("A", "Mod A").to_string())
            .create_async()
            .await;
        env.server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(jar_body)
            .expect(cdn_expect)
            .create_async()
            .await;
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
        let mut env = ModrinthEnv::acquire("modrinth_install_deps").await;

        let jar_a = b"mod a jar".to_vec();
        let jar_b = b"mod b jar".to_vec();

        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(&jar_a),
            json!([{"version_id": null, "project_id": "B", "file_name": null, "dependency_type": "required"}]),
        );
        let version_b = version_json(
            "verB",
            "B",
            "0.2.0",
            format!("{}/cdn/b.jar", env.server.url()),
            sha1_hex(&jar_b),
            json!([]),
        );

        let va_mock = env
            .server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;
        let pa_mock = env
            .server
            .mock("GET", "/v2/project/A")
            .with_status(200)
            .with_body(project_json("A", "Mod A").to_string())
            .create_async()
            .await;
        let vb_mock = env
            .server
            .mock("GET", "/v2/project/B/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_b]).to_string())
            .create_async()
            .await;
        let pb_mock = env
            .server
            .mock("GET", "/v2/project/B")
            .with_status(200)
            .with_body(project_json("B", "Mod B").to_string())
            .create_async()
            .await;
        let jar_a_mock = env
            .server
            .mock("GET", "/cdn/a.jar")
            .with_status(200)
            .with_body(jar_a.clone())
            .create_async()
            .await;
        let jar_b_mock = env
            .server
            .mock("GET", "/cdn/b.jar")
            .with_status(200)
            .with_body(jar_b.clone())
            .create_async()
            .await;

        let ctx = env.install_ctx();

        let report = install_project(&ctx, "A").await.expect("установка мода");

        assert_eq!(report.installed.len(), 2);
        assert_eq!(std::fs::read(ctx.mods_dir.join("A.jar")).unwrap(), jar_a);
        assert_eq!(std::fs::read(ctx.mods_dir.join("B.jar")).unwrap(), jar_b);

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
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
        let mut env = ModrinthEnv::acquire("modrinth_install_corrupt").await;

        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(b"expected content"),
            json!([]),
        );
        mock_install_env(&mut env, version_a, b"corrupted content", 1).await;

        let ctx = env.install_ctx();

        let result = install_project(&ctx, "A").await;
        assert!(result.is_err());
        assert!(!ctx.mods_dir.join("A.jar").exists());
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    #[tokio::test]
    async fn install_rejects_unsafe_filename() {
        let mut env = ModrinthEnv::acquire("modrinth_install_unsafe_filename").await;

        let mut version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(b"mod a jar"),
            json!([]),
        );
        version_a["files"][0]["filename"] = json!("../evil.jar");

        env.server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version_a]).to_string())
            .create_async()
            .await;

        let ctx = env.install_ctx();

        let result = install_project(&ctx, "A").await;
        assert!(result.is_err(), "мод с traversal-именем должен отклоняться");

        assert!(!ctx.mods_dir.join("evil.jar").exists());
        assert!(!env.project_dir().join("evil.jar").exists());
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .is_empty());
    }

    #[tokio::test]
    async fn install_skips_existing_identical_file() {
        let mut env = ModrinthEnv::acquire("modrinth_install_skip").await;

        let jar_a = b"already installed".to_vec();
        let version_a = version_json(
            "verA",
            "A",
            "1.0.0",
            format!("{}/cdn/a.jar", env.server.url()),
            sha1_hex(&jar_a),
            json!([]),
        );
        mock_install_env(&mut env, version_a, &jar_a, 0).await;

        let ctx = env.install_ctx();
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), &jar_a)
            .await
            .unwrap();

        let report = install_project(&ctx, "A").await.expect("установка мода");

        assert!(report.installed.is_empty());
        assert_eq!(report.skipped, vec!["A.jar".to_string()]);
        assert!(load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста")
            .mods
            .contains_key("A"));
    }

    #[tokio::test]
    async fn load_manifest_defaults_on_missing_file() {
        let dir = LauncherDirGuard::acquire("modrinth_manifest_missing").await;
        let path = dir.project_dir("Test").join("modrinth.json");

        let manifest = load_manifest(&path)
            .await
            .expect("отсутствующий манифест — это пустой манифест");
        assert!(manifest.mods.is_empty());
    }

    #[tokio::test]
    async fn load_manifest_propagates_io_errors() {
        let dir = LauncherDirGuard::acquire("modrinth_manifest_io").await;
        let project_dir = dir.project_dir("Test");
        tokio::fs::create_dir_all(&project_dir).await.unwrap();
        let manifest_path = project_dir.join("modrinth.json");
        tokio::fs::create_dir(&manifest_path).await.unwrap();

        assert!(
            load_manifest(&manifest_path).await.is_err(),
            "ошибка чтения (не NotFound) должна прокидываться"
        );
    }

    #[tokio::test]
    async fn load_manifest_defaults_on_corrupt_json() {
        let dir = LauncherDirGuard::acquire("modrinth_manifest_corrupt").await;
        let path = dir.project_dir("Test").join("modrinth.json");
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, "{ not json").await.unwrap();

        let manifest = load_manifest(&path)
            .await
            .expect("битый json — пустой манифест с записью в лог");
        assert!(manifest.mods.is_empty());
    }

    async fn mock_version_env(env: &mut ModrinthEnv, version: serde_json::Value, jar: &[u8]) {
        env.server
            .mock("GET", "/v2/project/A/version")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!([version]).to_string())
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/project/A")
            .with_status(200)
            .with_body(project_json("A", "Mod A").to_string())
            .create_async()
            .await;
        let url = version["files"][0]["url"].as_str().unwrap().to_string();
        let path = url
            .strip_prefix(env.server.url().as_str())
            .unwrap()
            .to_string();
        env.server
            .mock("GET", path.as_str())
            .with_status(200)
            .with_body(jar)
            .create_async()
            .await;
    }

    fn mods_dir_file_names(ctx: &InstallContext) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&ctx.mods_dir)
            .expect("чтение каталога mods")
            .map(|entry| {
                entry
                    .expect("запись каталога mods")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        names.sort();
        names
    }

    #[tokio::test]
    async fn install_update_replaces_previous_jar_file() {
        let mut env = ModrinthEnv::acquire("modrinth_install_update_replace").await;

        let jar_v1 = b"mod a v1".to_vec();
        let jar_v2 = b"mod a v2".to_vec();
        let version_v1 = version_json(
            "ver1",
            "A",
            "1.0.0",
            format!("{}/cdn/a-1.0.0.jar", env.server.url()),
            sha1_hex(&jar_v1),
            json!([]),
        );
        let mut version_v2 = version_json(
            "ver2",
            "A",
            "2.0.0",
            format!("{}/cdn/a-2.0.0.jar", env.server.url()),
            sha1_hex(&jar_v2),
            json!([]),
        );
        version_v2["files"][0]["filename"] = json!("A-2.0.0.jar");

        mock_version_env(&mut env, version_v1, &jar_v1).await;
        let ctx = env.install_ctx();

        install_project(&ctx, "A")
            .await
            .expect("первая установка мода");
        assert_eq!(mods_dir_file_names(&ctx), vec!["A.jar".to_string()]);

        clear_response_cache_for_tests();
        mock_version_env(&mut env, version_v2, &jar_v2).await;

        install_project(&ctx, "A")
            .await
            .expect("обновление мода до v2");

        assert_eq!(
            mods_dir_file_names(&ctx),
            vec!["A-2.0.0.jar".to_string()],
            "в mods/ должен остаться только jar новой версии"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A-2.0.0.jar")).expect("jar v2"),
            jar_v2
        );

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        let entry = manifest.mods.get("A").expect("запись проекта A");
        assert_eq!(entry.filename, "A-2.0.0.jar");
        assert_eq!(entry.version_number, "2.0.0");
        assert_eq!(manifest.mods.len(), 1);
    }

    #[tokio::test]
    async fn install_update_same_filename_overwrites_content() {
        let mut env = ModrinthEnv::acquire("modrinth_install_update_same_name").await;

        let jar_v1 = b"mod a v1".to_vec();
        let jar_v2 = b"mod a v2".to_vec();
        let version_v1 = version_json(
            "ver1",
            "A",
            "1.0.0",
            format!("{}/cdn/a-1.0.0.jar", env.server.url()),
            sha1_hex(&jar_v1),
            json!([]),
        );
        let version_v2 = version_json(
            "ver2",
            "A",
            "2.0.0",
            format!("{}/cdn/a-2.0.0.jar", env.server.url()),
            sha1_hex(&jar_v2),
            json!([]),
        );

        mock_version_env(&mut env, version_v1, &jar_v1).await;
        let ctx = env.install_ctx();

        install_project(&ctx, "A")
            .await
            .expect("первая установка мода");
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("jar v1"),
            jar_v1
        );

        clear_response_cache_for_tests();
        mock_version_env(&mut env, version_v2, &jar_v2).await;

        install_project(&ctx, "A")
            .await
            .expect("обновление мода до v2");

        assert_eq!(
            mods_dir_file_names(&ctx),
            vec!["A.jar".to_string()],
            "обновление с тем же именем файла не должно дублировать jar"
        );
        assert_eq!(
            std::fs::read(ctx.mods_dir.join("A.jar")).expect("jar v2"),
            jar_v2
        );

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert_eq!(
            manifest.mods.get("A").expect("запись A").version_number,
            "2.0.0"
        );
    }

    fn manifest_entry(
        project: &str,
        sha1: &str,
        version_id: &str,
        version_number: &str,
    ) -> ManifestEntry {
        ManifestEntry {
            project_id: project.to_string(),
            slug: None,
            title: format!("Mod {project}"),
            icon_url: None,
            filename: format!("{project}.jar"),
            sha1: sha1.to_string(),
            version_id: version_id.to_string(),
            version_number: version_number.to_string(),
        }
    }

    async fn seed_mod_manifest(ctx: &InstallContext, entries: Vec<(&str, ManifestEntry)>) {
        if let Some(parent) = ctx.manifest_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .expect("создание каталога проекта");
        }
        let manifest = ModrinthManifest {
            mods: entries
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        };
        save_manifest(&ctx.manifest_path, &manifest)
            .await
            .expect("запись стартового манифеста");
    }

    #[tokio::test]
    async fn check_updates_reports_newer_ignores_same_and_swallows_api_errors() {
        let mut env = ModrinthEnv::acquire("modrinth_check_updates").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![
                ("A", manifest_entry("A", "hash-a", "verA1", "1.0.0")),
                ("B", manifest_entry("B", "hash-b", "verB1", "2.0.0")),
                ("C", manifest_entry("C", "hash-c", "verC1", "3.0.0")),
            ],
        )
        .await;

        env.server
            .mock("GET", "/v2/version_file/hash-a/update")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(
                json!({"id": "verA2", "project_id": "A", "version_number": "1.1.0", "version_type": "release", "dependencies": [], "files": []})
                    .to_string(),
            )
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/version_file/hash-b/update")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(
                json!({"id": "verB1", "project_id": "B", "version_number": "2.0.0", "version_type": "release", "dependencies": [], "files": []})
                    .to_string(),
            )
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/version_file/hash-c/update")
            .match_query(Matcher::Any)
            .with_status(500)
            .create_async()
            .await;

        let updates = check_updates(&ctx).await.expect("проверка обновлений");

        let by_project: HashMap<String, Option<String>> = updates
            .into_iter()
            .map(|update| (update.project_id, update.available_version))
            .collect();
        assert_eq!(by_project.len(), 3, "каждый мод должен попасть в отчёт");
        assert_eq!(
            by_project.get("A").and_then(|v| v.as_deref()),
            Some("1.1.0"),
            "новая версия на сервере — обновление доступно"
        );
        assert_eq!(
            by_project.get("B"),
            Some(&None),
            "та же версия не должна считаться обновлением"
        );
        assert_eq!(
            by_project.get("C"),
            Some(&None),
            "сбой API по одному моду не должен ронять всю проверку"
        );
    }

    #[tokio::test]
    async fn check_updates_with_empty_manifest_queries_nothing() {
        let env = ModrinthEnv::acquire("modrinth_check_updates_empty").await;
        let ctx = env.install_ctx();

        let updates = check_updates(&ctx).await.expect("пустой манифест");

        assert!(updates.is_empty());
    }

    #[tokio::test]
    async fn sync_installed_drops_missing_files_and_adopts_foreign_mods() {
        let mut env = ModrinthEnv::acquire("modrinth_sync_adopt").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![
                ("A", manifest_entry("A", "hash-a", "verA1", "1.0.0")),
                ("B", manifest_entry("B", "hash-b", "verB1", "2.0.0")),
            ],
        )
        .await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(200)
            .with_body(
                json!({"hash-f": {"id": "verF1", "project_id": "F", "name": "Foreign", "version_number": "0.5.0", "version_type": "release", "dependencies": [], "files": []}})
                    .to_string(),
            )
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(
                json!([{"id": "F", "project_type": "mod", "title": "Foreign Mod"}]).to_string(),
            )
            .create_async()
            .await;

        let local_hashes: HashMap<String, String> = HashMap::from([
            ("A.jar".to_string(), "hash-a".to_string()),
            ("Foreign.jar".to_string(), "hash-f".to_string()),
        ]);

        let manifest = sync_installed_from_hashes(&ctx, local_hashes)
            .await
            .expect("синхронизация манифеста по хешам");

        assert!(manifest.mods.contains_key("A"));
        assert!(
            !manifest.mods.contains_key("B"),
            "запись без файла в mods должна удаляться из манифеста"
        );
        let foreign = manifest.mods.get("F").expect("foreign-мод усыновляется");
        assert_eq!(foreign.filename, "Foreign.jar");
        assert_eq!(foreign.title, "Foreign Mod");
        assert_eq!(foreign.sha1, "hash-f");
        assert_eq!(foreign.version_number, "0.5.0");

        let saved = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение сохранённого манифеста");
        assert_eq!(
            saved.mods.len(),
            2,
            "результат синхронизации должен сохраняться на диск"
        );
        assert!(saved.mods.contains_key("F"));
    }

    #[tokio::test]
    async fn sync_installed_falls_back_to_version_name_when_projects_fail() {
        let mut env = ModrinthEnv::acquire("modrinth_sync_fallback").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(&ctx, vec![]).await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(200)
            .with_body(
                json!({"hash-f": {"id": "verF1", "project_id": "F", "name": "Foreign jar", "version_number": "0.5.0", "version_type": "release", "dependencies": [], "files": []}})
                    .to_string(),
            )
            .create_async()
            .await;
        env.server
            .mock("GET", "/v2/projects")
            .match_query(Matcher::Any)
            .with_status(500)
            .create_async()
            .await;

        let manifest = sync_installed_from_hashes(
            &ctx,
            HashMap::from([("Foreign.jar".to_string(), "hash-f".to_string())]),
        )
        .await
        .expect("синхронизация");

        let foreign = manifest.mods.get("F").expect("мод усыновляется");
        assert_eq!(
            foreign.title, "Foreign jar",
            "без данных проекта используется имя версии"
        );
    }

    #[tokio::test]
    async fn sync_installed_keeps_manifest_when_hash_lookup_fails() {
        let mut env = ModrinthEnv::acquire("modrinth_sync_lookup_fail").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(500)
            .create_async()
            .await;

        let manifest = sync_installed_from_hashes(
            &ctx,
            HashMap::from([
                ("A.jar".to_string(), "hash-a".to_string()),
                ("Foreign.jar".to_string(), "hash-f".to_string()),
            ]),
        )
        .await
        .expect("сбой определения foreign-модов не должен ронять синхронизацию");

        assert!(
            manifest.mods.contains_key("A"),
            "существующая запись остаётся"
        );
        assert!(
            !manifest.mods.contains_key("F"),
            "неопознанный foreign-мод не усыновляется"
        );
    }

    #[tokio::test]
    async fn sync_installed_skips_foreign_mod_with_known_project() {
        let mut env = ModrinthEnv::acquire("modrinth_sync_known_project").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        env.server
            .mock("POST", "/v2/version_files")
            .with_status(200)
            .with_body(
                json!({"hash-f": {"id": "verF1", "project_id": "A", "name": "Dup", "version_number": "9.9.9", "version_type": "release", "dependencies": [], "files": []}})
                    .to_string(),
            )
            .create_async()
            .await;

        let manifest = sync_installed_from_hashes(
            &ctx,
            HashMap::from([
                ("A.jar".to_string(), "hash-a".to_string()),
                ("Other.jar".to_string(), "hash-f".to_string()),
            ]),
        )
        .await
        .expect("синхронизация");

        assert_eq!(manifest.mods.len(), 1, "проект A уже в манифесте");
        let entry = manifest.mods.get("A").expect("запись A");
        assert_eq!(entry.version_number, "1.0.0");
        assert_eq!(
            entry.filename, "A.jar",
            "существующая запись не должна перетираться foreign-версией"
        );
    }

    #[tokio::test]
    async fn uninstall_project_removes_file_and_manifest_entry() {
        let env = ModrinthEnv::acquire("modrinth_uninstall").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![
                ("A", manifest_entry("A", "hash-a", "verA1", "1.0.0")),
                ("B", manifest_entry("B", "hash-b", "verB1", "2.0.0")),
            ],
        )
        .await;
        tokio::fs::create_dir_all(&ctx.mods_dir).await.unwrap();
        tokio::fs::write(ctx.mods_dir.join("A.jar"), b"a")
            .await
            .unwrap();
        tokio::fs::write(ctx.mods_dir.join("B.jar"), b"b")
            .await
            .unwrap();

        uninstall_project(&ctx, "A").await.expect("удаление мода");

        assert!(
            !ctx.mods_dir.join("A.jar").exists(),
            "файл удалённого мода должен быть убран"
        );
        assert!(ctx.mods_dir.join("B.jar").exists());

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(!manifest.mods.contains_key("A"));
        assert!(manifest.mods.contains_key("B"));
    }

    #[tokio::test]
    async fn uninstall_project_errors_for_unknown_project() {
        let env = ModrinthEnv::acquire("modrinth_uninstall_unknown").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        let error = uninstall_project(&ctx, "Unknown")
            .await
            .expect_err("неустановленный мод не удаляется");
        assert!(
            error.to_string().contains("не установлен"),
            "ошибка должна объяснять, что мод не установлен: {error}"
        );
    }

    #[tokio::test]
    async fn uninstall_project_rejects_unsafe_filename() {
        let env = ModrinthEnv::acquire("modrinth_unsafe_uninstall").await;
        let ctx = env.install_ctx();
        let mut unsafe_entry = manifest_entry("A", "hash-a", "verA1", "1.0.0");
        unsafe_entry.filename = "../evil.jar".to_string();
        seed_mod_manifest(&ctx, vec![("A", unsafe_entry)]).await;

        let result = uninstall_project(&ctx, "A").await;
        assert!(result.is_err(), "traversal-имя файла должно отклоняться");
        assert!(
            !ctx.mods_dir
                .parent()
                .expect("каталог проекта")
                .join("evil.jar")
                .exists(),
            "удаление не должно выходить за пределы mods"
        );
    }

    #[tokio::test]
    async fn uninstall_project_tolerates_missing_file() {
        let env = ModrinthEnv::acquire("modrinth_uninstall_no_file").await;
        let ctx = env.install_ctx();
        seed_mod_manifest(
            &ctx,
            vec![("A", manifest_entry("A", "hash-a", "verA1", "1.0.0"))],
        )
        .await;

        uninstall_project(&ctx, "A")
            .await
            .expect("отсутствующий файл не должен ломать удаление");

        let manifest = load_manifest(&ctx.manifest_path)
            .await
            .expect("чтение манифеста");
        assert!(manifest.mods.is_empty(), "запись из манифеста убирается");
    }
}
