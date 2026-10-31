use anyhow::Result;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::{fs, process::Command, time::timeout};

use crate::utils::errors::LauncherError;
use crate::{
    log_err, log_info,
    minecraft::{
        mod_loader::{
            config::loader_version_jar_name,
            download::library_targets,
            manifest::{
                installer_artifacts_missing, loader_libraries, loader_manifest_path,
                loader_version_or_err, Manifest,
            },
        },
        structs::{LibraryMod, VersionMod},
    },
    state::dto::ProjectConfig,
    step_try,
    utils::{
        blocking,
        download_file::{download_file, download_json, write_atomic},
        env_info::{ensure_safe_relative_path, launcher_path},
        integrity::{
            ensure_files, record_installed_hash, settle_install_step, HashKind, IntegrityTarget,
            TargetDownload,
        },
        java::find_java,
        step_events::StepHandle,
    },
};

#[cfg(target_os = "windows")]
use crate::minecraft::process::CREATE_NO_WINDOW;

const INSTALLER_TIMEOUT: Duration = Duration::from_secs(600);

pub async fn create_installer_manifest(base_url: &Path) -> Result<()> {
    let launcher_profiles_path = base_url.join("launcher_profiles.json");
    if !tokio::fs::try_exists(&launcher_profiles_path)
        .await
        .unwrap_or(false)
    {
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

        let profiles_str = serde_json::to_string_pretty(&profiles).map_err(|e| {
            LauncherError::ManifestParse(format!("Не удалось сериализовать profiles: {e:#}"))
        })?;
        write_atomic(&launcher_profiles_path, profiles_str.as_bytes())
            .await
            .map_err(|e| {
                LauncherError::DiskIo(format!(
                    "Не удалось создать launcher_profiles.json: {launcher_profiles_path:?}: {e:#}"
                ))
            })?;
    }
    Ok(())
}

pub async fn run_loader_installer(
    loader_name: &str,
    installer_path: &Path,
    vanilla_dir: &Path,
    state_project: &ProjectConfig,
) -> Result<()> {
    let java_config = state_project.java_path.clone();
    let java_cmd = blocking(
        "Поиск Java для инсталлера лоадера",
        move || find_java(java_config),
    )
    .await??;
    let mut command = Command::new(java_cmd);
    command
        .arg("-jar")
        .arg(installer_path)
        .arg("--installClient")
        .arg(vanilla_dir)
        .kill_on_drop(true);

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = timeout(INSTALLER_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            LauncherError::LoaderSetup(format!(
                "{loader_name} инсталлер не завершился за {} сек и был прерван",
                INSTALLER_TIMEOUT.as_secs()
            ))
        })?
        .map_err(|e| {
            LauncherError::LoaderSetup(format!(
                "Не удалось запустить {loader_name} инсталлер: {e:#}"
            ))
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stdout.is_empty() {
        log_info!("Stdout инсталлера {loader_name}: {}", stdout);
    }
    if !stderr.is_empty() {
        log_err!("Stderr инсталлера {loader_name}: {}", stderr);
    }

    if !output.status.success() {
        return Err(LauncherError::LoaderSetup(format!(
            "{} инсталлер завершился с ошибкой (код {:?}):\n{}",
            loader_name,
            output.status.code(),
            stderr
        ))
        .into());
    }

    Ok(())
}

async fn version_subdirs(versions_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut entries = fs::read_dir(versions_dir).await.map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось прочитать {versions_dir:?}: {e:#}"))
    })?;
    let mut subdirs = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось прочитать запись в versions: {e:#}"))
    })? {
        let path = entry.path();
        let is_dir = fs::metadata(&path)
            .await
            .map(|meta| meta.is_dir())
            .unwrap_or(false);
        if is_dir {
            subdirs.push(path);
        }
    }
    subdirs.sort();
    Ok(subdirs)
}

pub async fn move_version_jar(base_url: &Path, mc_version: &str) -> Result<()> {
    let versions_dir = base_url.join("versions");
    let jar_name = format!("{}.jar", mc_version);
    let target_jar = base_url.join(&jar_name);

    if tokio::fs::try_exists(&target_jar).await.unwrap_or(false) {
        return Ok(());
    }

    let direct = versions_dir.join(mc_version).join(&jar_name);
    if tokio::fs::try_exists(&direct).await.unwrap_or(false) {
        fs::rename(&direct, &target_jar).await.map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось переместить {direct:?} в {target_jar:?}: {e:#}"
            ))
        })?;
        return Ok(());
    }

    let mut inner_candidates: Vec<PathBuf> = Vec::new();
    for path in version_subdirs(&versions_dir).await? {
        let candidate = path.join(&jar_name);
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            inner_candidates.push(candidate);
        }
    }
    inner_candidates.sort();

    let source = inner_candidates.first().cloned().ok_or_else(|| {
        LauncherError::LoaderSetup(format!(
            "Jar версии {mc_version} не найден в {versions_dir:?}"
        ))
    })?;

    fs::rename(&source, &target_jar).await.map_err(|e| {
        LauncherError::DiskIo(format!(
            "Не удалось переместить {source:?} в {target_jar:?}: {e:#}"
        ))
    })?;
    Ok(())
}

pub async fn find_manifest_json_in_dir(
    dir: &Path,
    mc_version: &str,
    loader_version: &str,
) -> Result<Option<PathBuf>> {
    let mut inner = fs::read_dir(dir)
        .await
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось прочитать {dir:?}: {e:#}")))?;
    while let Some(entry) = inner.next_entry().await.map_err(|e| {
        LauncherError::DiskIo(format!("Не удалось прочитать запись в {dir:?}: {e:#}"))
    })? {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("json")
            && is_manifest_for_version(&p, mc_version, loader_version).await?
        {
            return Ok(Some(p));
        }
    }
    Ok(None)
}

async fn is_manifest_for_version(
    path: &Path,
    mc_version: &str,
    loader_version: &str,
) -> Result<bool> {
    let content = match fs::read_to_string(path).await {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => {
            return Err(
                LauncherError::DiskIo(format!("Не удалось прочитать {path:?}: {e:#}")).into(),
            )
        }
    };
    let Ok(json) = serde_json::from_str::<Value>(&content) else {
        return Ok(false);
    };
    if json.get("inheritsFrom").and_then(|v| v.as_str()) != Some(mc_version) {
        return Ok(false);
    }
    let loader_suffix = format!("-{loader_version}");
    Ok(json
        .get("id")
        .and_then(|v| v.as_str())
        .is_some_and(|id| id.ends_with(&loader_suffix)))
}

pub async fn locate_installed_manifest(
    versions_dir: &Path,
    mc_version: &str,
    loader_version: &str,
) -> Result<PathBuf> {
    if let Some(json_path) =
        find_manifest_json_in_dir(versions_dir, mc_version, loader_version).await?
    {
        return Ok(json_path);
    }

    for path in version_subdirs(versions_dir).await? {
        if let Some(json_path) =
            find_manifest_json_in_dir(&path, mc_version, loader_version).await?
        {
            return Ok(json_path);
        }
    }

    Err(LauncherError::LoaderSetup(format!(
        "Манифест лоадера {loader_version} для игры {mc_version} не найден в {versions_dir:?}"
    ))
    .into())
}

pub fn manifest_paths(state_project: &ProjectConfig, prefix: &str) -> Result<(PathBuf, PathBuf)> {
    let version = loader_version_or_err(state_project)?;
    let manifest_path = loader_manifest_path(prefix, version)?;
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
    ensure_safe_relative_path(&state_project.mc_version, "версии игры")?;
    run_loader_installer(loader_name, installer_path, vanilla_dir, state_project).await?;

    let (loader_manifest, base_url) = manifest_paths(state_project, manifest_prefix)?;
    let versions_dir = base_url.join("versions");
    let loader_version = loader_version_or_err(state_project)?;

    let source =
        locate_installed_manifest(&versions_dir, &state_project.mc_version, loader_version).await?;

    move_version_jar(&base_url, &state_project.mc_version).await?;

    if source != loader_manifest {
        if let Some(parent) = loader_manifest.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                LauncherError::DiskIo(format!("Не удалось создать {parent:?}: {e:#}"))
            })?;
        }
        fs::rename(&source, &loader_manifest).await.map_err(|e| {
            LauncherError::DiskIo(format!(
                "Не удалось переместить {source:?} в {loader_manifest:?}: {e:#}"
            ))
        })?;
    }

    if let Err(e) = fs::remove_dir_all(&versions_dir).await {
        log_err!(
            "Не удалось очистить каталог версий {:?} после установки лоадера {}: {}",
            versions_dir,
            loader_name,
            e
        );
    }

    download_json::<Manifest>(None, &loader_manifest).await
}

pub(crate) async fn install_loader_files(
    step: StepHandle,
    base: &Path,
    project: &str,
    version_id: &str,
    library: &[LibraryMod],
    installer_url: &str,
) -> Result<()> {
    let mut targets = library_targets(library)?;
    targets.push(IntegrityTarget {
        rel_path: PathBuf::from(loader_version_jar_name(version_id)),
        hash: String::new(),
        hash_kind: HashKind::Sha1,
        download: TargetDownload::Url(installer_url.to_string()),
    });
    let report = step_try!(step, ensure_files(&step, base, project, targets).await);
    step_try!(
        step,
        record_installed_hash(
            project,
            base,
            &PathBuf::from(loader_version_jar_name(version_id)),
        )
        .await
    );
    settle_install_step(step, &report)
}

pub(crate) fn find_loader_version<'a>(
    manifest: &'a [VersionMod],
    target_id: &str,
) -> Result<&'a VersionMod> {
    manifest
        .iter()
        .find(|v| v.id == target_id)
        .ok_or_else(|| LauncherError::LoaderSetup("Версия не найдена".to_string()).into())
}

pub(crate) async fn install_version_files(
    state: &ProjectConfig,
    version_info: &VersionMod,
    library: &[LibraryMod],
    label: String,
) -> Result<()> {
    let step = StepHandle::start("loader", label);
    let base = step_try!(
        step,
        launcher_path(Some(&state.project_name)).map_err(|e| {
            LauncherError::LoaderSetup(format!(
                "Не удалось определить путь к файлам проекта: {e:#}"
            ))
        })
    );
    install_loader_files(
        step,
        &base,
        &state.project_name,
        &version_info.id,
        library,
        &version_info.url,
    )
    .await
}

pub async fn setup_loader(
    loader_name: &str,
    manifest_prefix: &str,
    state: &ProjectConfig,
    manifest: &[VersionMod],
    maven_base: &str,
) -> Result<()> {
    let base_url = launcher_path(Some(&state.project_name))?;
    let loader_version = loader_version_or_err(state)?;
    let target_version = format!("{}-{}", state.mc_version, loader_version);
    let version_info = find_loader_version(manifest, &target_version)?;
    let label = format!("Установка {loader_name}");
    let loader_manifest_file = loader_manifest_path(manifest_prefix, loader_version)?;

    if tokio::fs::try_exists(&loader_manifest_file)
        .await
        .unwrap_or(false)
    {
        let version_manifest = download_json::<Manifest>(None, &loader_manifest_file).await?;
        if !installer_artifacts_missing(&base_url, &version_manifest.libraries).await? {
            let library = loader_libraries(version_manifest.libraries, maven_base)?;
            install_version_files(state, version_info, &library, label.clone()).await?;
            log_info!("{} уже установлен, проверка файлов завершена", loader_name);
            return Ok(());
        }
        log_info!(
            "{} требует повторной установки: отсутствуют локальные артефакты",
            loader_name
        );
    }

    let step = StepHandle::start("loader", label);

    step.detail("Скачивание инсталлера");
    step.set_total(1);
    let installer_path = base_url.join(loader_version_jar_name(&target_version));
    step_try!(
        step,
        download_file(&version_info.url, &installer_path).await
    );
    step.inc();

    step_try!(step, create_installer_manifest(&base_url).await);

    step.detail("Запуск инсталлера");
    log_info!("Запуск инсталлера {}", loader_name);
    let loader_manifest = step_try!(
        step,
        start_installer(
            loader_name,
            manifest_prefix,
            &installer_path,
            &base_url,
            state
        )
        .await
    );
    let library = step_try!(
        step,
        loader_libraries(loader_manifest.libraries, maven_base)
    );

    step.detail("Скачивание библиотек");
    log_info!("Скачивание библиотек {}", loader_name);
    install_loader_files(
        step,
        &base_url,
        &state.project_name,
        &target_version,
        &library,
        &version_info.url,
    )
    .await?;

    log_info!("Установка {} завершена", loader_name);
    Ok(())
}

#[cfg(test)]
mod loader_install_tests {
    use super::*;
    use crate::test_support::{sha1_hex, step_event_id, LauncherDirGuard};
    use mockito::Server;
    use serde_json::json;
    use std::fs;

    struct SetupLoaderEnv {
        dir: LauncherDirGuard,
        _server: mockito::ServerGuard,
        state: ProjectConfig,
        manifest: Vec<VersionMod>,
        maven_base: String,
    }

    async fn setup_loader_env(label: &str) -> SetupLoaderEnv {
        let dir = LauncherDirGuard::acquire(label).await;
        let mut server = Server::new_async().await;

        server
            .mock(
                "GET",
                "/maven/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar",
            )
            .with_status(200)
            .with_body(b"loader jar bytes".as_slice())
            .create_async()
            .await;
        server
            .mock("GET", "/maven/org/ow2/asm/asm/9.7/asm-9.7.jar")
            .with_status(200)
            .with_body(b"asm lib bytes".as_slice())
            .create_async()
            .await;
        server
            .mock("GET", "/installer/1.20.1-0.16.9.jar")
            .with_status(200)
            .with_body(b"installer bytes".as_slice())
            .create_async()
            .await;

        let maven_base = format!("{}/maven", server.url());
        let manifest_path = dir.root().join("manifest").join("forge_0.16.9.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            loader_manifest_json(
                &format!("{maven_base}/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"),
                &format!("{maven_base}/org/ow2/asm/asm/9.7/asm-9.7.jar"),
                &sha1_hex(b"loader jar bytes"),
                &sha1_hex(b"asm lib bytes"),
                b"loader jar bytes".len() as i64,
                b"asm lib bytes".len() as i64,
            )
            .to_string(),
        )
        .unwrap();

        let state = project_config("LoaderProj");
        let manifest = vec![VersionMod {
            url: format!("{}/installer/1.20.1-0.16.9.jar", server.url()),
            id: "1.20.1-0.16.9".to_string(),
            main_class: String::new(),
            library: Vec::new(),
        }];

        SetupLoaderEnv {
            dir,
            _server: server,
            state,
            manifest,
            maven_base,
        }
    }

    #[tokio::test]
    async fn start_installer_rejects_traversal_mc_version_before_installer() {
        let state_project = ProjectConfig {
            mc_version: "../evil".to_string(),
            ..ProjectConfig::default()
        };
        let error = start_installer(
            "forge",
            "forge",
            Path::new("unused-installer.jar"),
            Path::new("unused-vanilla"),
            &state_project,
        )
        .await
        .expect_err("версия с обходом пути должна быть отклонена до инсталлятора");
        assert!(
            error
                .to_string()
                .contains("Некорректное значение версии игры"),
            "ошибка должна объяснять проблему: {error}"
        );
    }

    fn project_config(project: &str) -> ProjectConfig {
        ProjectConfig {
            project_name: project.to_string(),
            mc_version: "1.20.1".to_string(),
            loader_version: Some("0.16.9".to_string()),
            ..ProjectConfig::default()
        }
    }

    fn loader_manifest_json(
        lib_url: &str,
        extra_url: &str,
        lib_hash: &str,
        extra_hash: &str,
        lib_size: i64,
        extra_size: i64,
    ) -> serde_json::Value {
        json!({
            "id": "1.20.1-forge-0.16.9",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "net.minecraftforge.bootstrap.Bootstrap",
            "inheritsFrom": "1.20.1",
            "libraries": [
                {
                    "name": "net.fabricmc:fabric-loader:0.16.9",
                    "downloads": { "artifact": { "path": "", "url": lib_url, "sha1": lib_hash, "size": lib_size } }
                },
                {
                    "name": "org.ow2.asm:asm:9.7",
                    "downloads": { "artifact": { "path": "", "url": extra_url, "sha1": extra_hash, "size": extra_size } }
                }
            ]
        })
    }

    #[tokio::test]
    async fn setup_loader_fast_path_downloads_loader_and_libraries() {
        let env = setup_loader_env("loader_setup").await;

        setup_loader("Forge", "forge", &env.state, &env.manifest, &env.maven_base)
            .await
            .expect("установка лоадера");

        let project = env.dir.project_dir("LoaderProj");
        assert_eq!(
            fs::read(project.join("1.20.1-0.16.9.jar")).unwrap(),
            b"installer bytes"
        );
        assert_eq!(
            fs::read(
                project
                    .join("libraries/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar")
            )
            .unwrap(),
            b"loader jar bytes"
        );
        assert_eq!(
            fs::read(project.join("libraries/org/ow2/asm/asm/9.7/asm-9.7.jar")).unwrap(),
            b"asm lib bytes"
        );

        let installed = crate::utils::install_manifest::load_install_manifest("LoaderProj")
            .await
            .expect("install-манифест");
        assert!(installed.files.contains_key("1.20.1-0.16.9.jar"));
        assert!(
            !installed.files.contains_key(
                "libraries/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"
            ),
            "библиотека с исходным хешем не должна попадать в install-манифест: {:?}",
            installed.files
        );
        assert!(
            !installed
                .files
                .contains_key("libraries/org/ow2/asm/asm/9.7/asm-9.7.jar"),
            "библиотека с исходным хешем не должна попадать в install-манифест: {:?}",
            installed.files
        );
    }

    #[tokio::test]
    async fn setup_loader_fast_path_finishes_loader_step_once() {
        use crate::utils::step_events::test_capture;
        use crate::utils::step_events::StepEvent;

        let env = setup_loader_env("loader_setup_single_terminal").await;
        let _capture = test_capture::CaptureGuard::new();

        setup_loader("Forge", "forge", &env.state, &env.manifest, &env.maven_base)
            .await
            .expect("установка лоадера");

        let terminals: Vec<StepEvent> = test_capture::captured()
            .into_iter()
            .filter(|(channel, event)| {
                matches!(channel, crate::utils::step_events::StepChannel::Launch)
                    && matches!(event, StepEvent::Finished { .. } | StepEvent::Failed { .. })
                    && step_event_id(event) == "loader"
            })
            .map(|(_, event)| event)
            .collect();
        assert_eq!(
            terminals.len(),
            1,
            "шаг лоадера должен завершаться ровно одним терминальным событием: {terminals:?}"
        );
        assert!(
            matches!(
                terminals.first(),
                Some(StepEvent::Finished { skipped: false, .. })
            ),
            "установка со скачиванием не должна помечаться пропущенной: {terminals:?}"
        );
    }

    #[tokio::test]
    async fn setup_loader_fast_path_rejects_hostile_library_name_without_files() {
        fn collect_files(dir: &Path) -> Vec<PathBuf> {
            let mut out = Vec::new();
            let mut stack = vec![dir.to_path_buf()];
            while let Some(next) = stack.pop() {
                for entry in std::fs::read_dir(&next).expect("чтение каталога").flatten()
                {
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                    } else {
                        out.push(path);
                    }
                }
            }
            out.sort();
            out
        }

        let dir = LauncherDirGuard::acquire("loader_setup_hostile").await;
        let manifest_path = crate::test_support::write_loader_manifest(
            dir.root(),
            "forge_evil",
            &json!({
                "id": "1.20.1-forge-evil",
                "time": "2023-01-01T00:00:00+00:00",
                "releaseTime": "2023-01-01T00:00:00+00:00",
                "type": "release",
                "mainClass": "net.minecraftforge.bootstrap.Bootstrap",
                "inheritsFrom": "1.20.1",
                "libraries": [
                    {
                        "name": "../..:evil:1.0",
                        "downloads": { "artifact": { "path": "", "url": "", "sha1": "", "size": 1 } }
                    }
                ]
            }),
        );

        let state = ProjectConfig {
            project_name: "EvilProj".to_string(),
            mc_version: "1.20.1".to_string(),
            loader_version: Some("evil".to_string()),
            ..ProjectConfig::default()
        };
        let manifest = vec![VersionMod {
            url: String::new(),
            id: "1.20.1-evil".to_string(),
            main_class: String::new(),
            library: Vec::new(),
        }];

        let error = setup_loader(
            "Forge",
            "forge",
            &state,
            &manifest,
            "https://maven.minecraftforge.net",
        )
        .await
        .expect_err("враждебное имя библиотеки должно отклоняться");

        assert!(
            error.to_string().contains("Некорректная Maven-координата"),
            "ошибка должна называть враждебную координату: {error}"
        );
        assert_eq!(
            collect_files(dir.root()),
            vec![manifest_path],
            "никаких файлов, кроме самого манифеста, создаваться не должно"
        );
    }

    fn neoforge_manifest_json(mergetool_url: &str) -> serde_json::Value {
        let mergetool_sha1 = sha1_hex(b"mergetool bytes");
        json!({
            "id": "1.20.1-neoforge-21.1.80",
            "time": "2024-01-01T00:00:00+00:00",
            "releaseTime": "2024-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "net.neoforged.bootstrap.Bootstrap",
            "inheritsFrom": "1.20.1",
            "libraries": [
                {
                    "name": "net.neoforged:mergetool:2.0.3:api@jar",
                    "downloads": {
                        "artifact": {
                            "path": "net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar",
                            "url": mergetool_url,
                            "sha1": mergetool_sha1,
                            "size": b"mergetool bytes".len() as i64
                        }
                    }
                }
            ]
        })
    }

    #[tokio::test]
    async fn setup_loader_fast_path_uses_manifest_paths_for_classified_libraries() {
        let dir = LauncherDirGuard::acquire("loader_setup_neoforge").await;
        let mut server = Server::new_async().await;

        let mergetool_jar = b"mergetool bytes".to_vec();
        let installer_jar = b"installer bytes".to_vec();

        server
            .mock(
                "GET",
                "/maven/net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar",
            )
            .with_status(200)
            .with_body(mergetool_jar.clone())
            .create_async()
            .await;
        server
            .mock("GET", "/installer/1.20.1-21.1.80.jar")
            .with_status(200)
            .with_body(installer_jar.clone())
            .create_async()
            .await;

        let maven_base = format!("{}/maven", server.url());
        let manifest_path = dir.root().join("manifest").join("neoforge_21.1.80.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            neoforge_manifest_json(&format!(
                "{maven_base}/net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar"
            ))
            .to_string(),
        )
        .unwrap();

        let state = ProjectConfig {
            project_name: "NeoProj".to_string(),
            mc_version: "1.20.1".to_string(),
            loader_version: Some("21.1.80".to_string()),
            ..ProjectConfig::default()
        };
        let manifest = vec![VersionMod {
            url: format!("{}/installer/1.20.1-21.1.80.jar", server.url()),
            id: "1.20.1-21.1.80".to_string(),
            main_class: String::new(),
            library: Vec::new(),
        }];

        setup_loader("NeoForge", "neoforge", &state, &manifest, &maven_base)
            .await
            .expect("установка NeoForge");

        let project = dir.project_dir("NeoProj");
        assert_eq!(
            fs::read(
                project.join("libraries/net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar")
            )
            .unwrap(),
            b"mergetool bytes"
        );
        assert!(
            !project
                .join("libraries/net/neoforged/mergetool/2.0.3@jar")
                .exists(),
            "файл не должен попадать в каталог версии с суффиксом @jar"
        );

        let installed = crate::utils::install_manifest::load_install_manifest("NeoProj")
            .await
            .expect("install-манифест");
        assert!(
            !installed
                .files
                .contains_key("libraries/net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar"),
            "библиотека с исходным хешем не должна попадать в install-манифест: {:?}",
            installed.files
        );
        assert!(
            installed.files.contains_key("1.20.1-21.1.80.jar"),
            "jar инсталлера без исходного хеша должен записываться: {:?}",
            installed.files
        );
    }

    #[tokio::test]
    async fn move_version_jar_lifts_jar_from_version_dir() {
        let dir = LauncherDirGuard::acquire("move_jar").await;
        let base = dir.root().join("game");
        fs::create_dir_all(base.join("versions/1.20.1")).unwrap();
        fs::write(base.join("versions/1.20.1/1.20.1.jar"), b"jar").unwrap();

        move_version_jar(&base, "1.20.1")
            .await
            .expect("перенос jar");

        assert_eq!(fs::read(base.join("1.20.1.jar")).unwrap(), b"jar");
        assert!(!base.join("versions/1.20.1/1.20.1.jar").exists());
    }

    #[tokio::test]
    async fn move_version_jar_picks_candidate_deterministically() {
        let dir = LauncherDirGuard::acquire("move_jar_deterministic").await;
        let base = dir.root().join("game");

        for _ in 0..3 {
            fs::create_dir_all(base.join("versions/zzz-other")).unwrap();
            fs::create_dir_all(base.join("versions/aaa-fix")).unwrap();
            fs::write(base.join("versions/zzz-other/1.20.1.jar"), b"zzz").unwrap();
            fs::write(base.join("versions/aaa-fix/1.20.1.jar"), b"aaa").unwrap();

            move_version_jar(&base, "1.20.1")
                .await
                .expect("перенос jar из нескольких кандидатов");

            assert_eq!(
                fs::read(base.join("1.20.1.jar")).unwrap(),
                b"aaa",
                "переносится лексикографически первый кандидат независимо от порядка read_dir"
            );
            assert!(base.join("versions/zzz-other/1.20.1.jar").exists());
            assert!(!base.join("versions/aaa-fix/1.20.1.jar").exists());
            fs::remove_file(base.join("1.20.1.jar")).unwrap();
        }
    }

    #[tokio::test]
    async fn move_version_jar_errors_when_jar_missing() {
        let dir = LauncherDirGuard::acquire("move_jar_missing").await;
        let base = dir.root().join("game");
        fs::create_dir_all(&base).unwrap();

        let result = move_version_jar(&base, "1.20.1").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_installer_manifest_writes_profiles_once() {
        let dir = LauncherDirGuard::acquire("installer_manifest").await;
        let base = dir.root().join("game");
        fs::create_dir_all(&base).unwrap();

        create_installer_manifest(&base).await.unwrap();
        create_installer_manifest(&base).await.unwrap();

        let content = fs::read_to_string(base.join("launcher_profiles.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed["profiles"].is_object());
        assert!(parsed["clientToken"].is_string());
    }

    #[tokio::test]
    async fn locate_installed_manifest_finds_json_with_inherits_from() {
        let dir = LauncherDirGuard::acquire("locate_manifest").await;
        let versions = dir.root().join("game/versions/forge");
        fs::create_dir_all(&versions).unwrap();
        fs::write(
            versions.join("1.20.1-forge.json"),
            r#"{"id": "1.20.1-forge-0.16.9", "inheritsFrom": "1.20.1"}"#,
        )
        .unwrap();

        let found = locate_installed_manifest(&versions, "1.20.1", "0.16.9")
            .await
            .expect("поиск манифеста");

        assert_eq!(found, versions.join("1.20.1-forge.json"));
    }

    #[tokio::test]
    async fn locate_installed_manifest_is_deterministic_across_stale_subdirs() {
        let dir = LauncherDirGuard::acquire("locate_manifest_deterministic").await;
        let versions = dir.root().join("game/versions");
        for _ in 0..3 {
            fs::create_dir_all(versions.join("zzz-stale")).unwrap();
            fs::create_dir_all(versions.join("aaa-fresh")).unwrap();
            fs::write(
                versions.join("zzz-stale/old-1.20.1.json"),
                r#"{"id": "1.20.1-forge-0.16.9", "inheritsFrom": "1.20.1"}"#,
            )
            .unwrap();
            fs::write(
                versions.join("aaa-fresh/new-1.20.1.json"),
                r#"{"id": "1.20.1-forge-0.16.9", "inheritsFrom": "1.20.1"}"#,
            )
            .unwrap();

            let found = locate_installed_manifest(&versions, "1.20.1", "0.16.9")
                .await
                .expect("поиск манифеста среди stale-каталогов");

            assert_eq!(
                found,
                versions.join("aaa-fresh/new-1.20.1.json"),
                "лексикографически первый подкаталог побеждает независимо от порядка read_dir"
            );
            fs::remove_dir_all(&versions).unwrap();
        }
    }

    #[tokio::test]
    async fn locate_installed_manifest_skips_foreign_loader_version() {
        let dir = LauncherDirGuard::acquire("locate_manifest_foreign").await;
        let versions = dir.root().join("game/versions");
        fs::create_dir_all(versions.join("aaa-stale")).unwrap();
        fs::create_dir_all(versions.join("zzz-fresh")).unwrap();
        fs::write(
            versions.join("aaa-stale/1.20.1-forge.json"),
            r#"{"id": "1.20.1-forge-0.17.0", "inheritsFrom": "1.20.1"}"#,
        )
        .unwrap();
        fs::write(
            versions.join("zzz-fresh/1.20.1-forge.json"),
            r#"{"id": "1.20.1-forge-0.16.9", "inheritsFrom": "1.20.1"}"#,
        )
        .unwrap();

        let found = locate_installed_manifest(&versions, "1.20.1", "0.16.9")
            .await
            .expect("поиск манифеста своей версии среди чужих остатков");

        assert_eq!(
            found,
            versions.join("zzz-fresh/1.20.1-forge.json"),
            "остаток чужой версии лоадера, даже отсортированный первым, не должен подменять манифест запрошенной версии"
        );
    }

    #[tokio::test]
    async fn locate_installed_manifest_rejects_foreign_version_manifest() {
        let dir = LauncherDirGuard::acquire("locate_manifest_foreign_only").await;
        let versions = dir.root().join("game/versions");
        fs::create_dir_all(&versions).unwrap();
        fs::write(
            versions.join("1.20.1-forge.json"),
            r#"{"id": "1.20.1-forge-0.17.0", "inheritsFrom": "1.20.1"}"#,
        )
        .unwrap();
        fs::create_dir_all(versions.join("stale-loader")).unwrap();
        fs::write(
            versions.join("stale-loader/1.20.1-forge.json"),
            r#"{"id": "1.20.1-forge-0.17.0", "inheritsFrom": "1.20.1"}"#,
        )
        .unwrap();

        let error = locate_installed_manifest(&versions, "1.20.1", "0.16.9")
            .await
            .expect_err("чужой манифест не должен выдаваться за манифест запрошенной версии");

        assert!(
            error
                .to_string()
                .contains("Манифест лоадера 0.16.9 для игры 1.20.1"),
            "ошибка должна называть запрошенные версии: {error}"
        );
    }

    #[tokio::test]
    async fn locate_installed_manifest_rejects_manifest_without_id() {
        let dir = LauncherDirGuard::acquire("locate_manifest_no_id").await;
        let versions = dir.root().join("game/versions/forge");
        fs::create_dir_all(&versions).unwrap();
        fs::write(
            versions.join("1.20.1-forge.json"),
            r#"{"inheritsFrom": "1.20.1"}"#,
        )
        .unwrap();

        let error = locate_installed_manifest(&versions, "1.20.1", "0.16.9")
            .await
            .expect_err("манифест без id не может доказать принадлежность версии лоадера");

        assert!(
            error
                .to_string()
                .contains("Манифест лоадера 0.16.9 для игры 1.20.1"),
            "ошибка должна называть запрошенные версии: {error}"
        );
    }

    #[tokio::test]
    async fn locate_installed_manifest_matches_version_on_dash_boundary() {
        let dir = LauncherDirGuard::acquire("locate_manifest_boundary").await;
        let versions = dir.root().join("game/versions/forge");
        fs::create_dir_all(&versions).unwrap();
        fs::write(
            versions.join("1.20.1-forge.json"),
            r#"{"id": "1.20.1-forge-47.2.0", "inheritsFrom": "1.20.1"}"#,
        )
        .unwrap();

        let error = locate_installed_manifest(&versions, "1.20.1", "2.0")
            .await
            .expect_err("версия 47.2.0 не должна считаться версией 2.0 без границы по дефису");

        assert!(
            error
                .to_string()
                .contains("Манифест лоадера 2.0 для игры 1.20.1"),
            "ошибка должна называть запрошенные версии: {error}"
        );
    }

    #[tokio::test]
    async fn locate_installed_manifest_errors_when_manifest_missing() {
        let dir = LauncherDirGuard::acquire("locate_manifest_missing").await;
        let versions = dir.root().join("game/versions");
        fs::create_dir_all(&versions).unwrap();

        let error = locate_installed_manifest(&versions, "1.20.1", "0.16.9")
            .await
            .expect_err("ненайденный манифест должен давать явную ошибку, а не фейковый путь");

        assert!(
            error
                .to_string()
                .contains("Манифест лоадера 0.16.9 для игры 1.20.1"),
            "ошибка должна объяснять, что манифест не найден: {error}"
        );
    }
}
