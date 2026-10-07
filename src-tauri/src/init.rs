use anyhow::{Context, Result};
use std::path::PathBuf;
use tokio::fs;
use tokio::sync::Mutex;

use crate::commands::launcher_config::update_launcher_config;
use crate::log_err;
use crate::state::config::validate_project_name;
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::state::launcher_config::LauncherConfig;
use crate::utils::blocking;
use crate::utils::download_file::write_atomic;
use crate::utils::env_info::{default_server_url, get_launcher_name, normalize_server_url};
use crate::utils::errors::LauncherError;
use crate::utils::http::{http_client, with_launcher_id};

pub struct InitPaths {
    pub base: PathBuf,
    pub project: PathBuf,
    pub config: PathBuf,
    pub manifest: PathBuf,
    pub java: PathBuf,
}

impl InitPaths {
    pub fn new(parent_path: &str) -> Result<Self> {
        let name = get_launcher_name();
        let base =
            PathBuf::from(parent_path.replace('/', std::path::MAIN_SEPARATOR_STR)).join(&name);
        Ok(Self {
            project: base.join("project"),
            config: base.join("project").join("config"),
            manifest: base.join("manifest"),
            java: base.join("java"),
            base,
        })
    }

    pub fn create_dirs(&self) -> Result<()> {
        LauncherError::classify(self.create_dirs_inner(), LauncherError::DiskIo)
    }

    fn create_dirs_inner(&self) -> Result<()> {
        std::fs::create_dir_all(&self.base)
            .with_context(|| format!("Не удалось создать папку \"{}\"", self.base.display()))?;
        std::fs::create_dir_all(&self.project)
            .with_context(|| "Не удалось создать папку \"project\"")?;
        std::fs::create_dir_all(&self.config)
            .with_context(|| "Не удалось создать папку \"config\"")?;
        std::fs::create_dir_all(&self.manifest)
            .with_context(|| "Не удалось создать папку \"manifest\"")?;
        std::fs::create_dir_all(&self.java).with_context(|| "Не удалось создать папку \"java\"")?;
        Ok(())
    }
}

pub async fn init_launcher(
    state: &Mutex<GlobalState>,
    parent_path: &str,
) -> Result<LauncherConfig> {
    let parent = parent_path.to_string();
    let launcher_path = blocking(
        "Не удалось выполнить инициализацию лаунчера",
        move || -> Result<String> {
            let paths = InitPaths::new(&parent)?;
            paths.create_dirs()?;
            Ok(paths.base.to_string_lossy().to_string())
        },
    )
    .await??;

    update_launcher_config(state, |config| {
        config.apply_default_project();
        config.launcher_path = launcher_path;
    })
    .await
}

pub async fn init_project_config(
    launcher_path: &str,
    project_name: &str,
    server_url: Option<&str>,
) -> Result<ProjectConfig> {
    let normalized = launcher_path.replace('/', std::path::MAIN_SEPARATOR_STR);
    let config_dir = PathBuf::from(&normalized).join("project").join("config");
    fs::create_dir_all(&config_dir).await?;

    if !project_name.is_empty() {
        validate_project_name(project_name)?;
        let toml_path = config_dir.join(format!("{}.toml", project_name));
        if toml_path.exists() {
            let parsed = fs::read_to_string(&toml_path)
                .await
                .map_err(|e| {
                    anyhow::Error::new(e).context(format!("Не удалось прочитать {toml_path:?}"))
                })
                .and_then(|content| {
                    toml::from_str::<ProjectConfig>(&content).map_err(|e| {
                        anyhow::Error::new(e).context(format!("Не удалось разобрать {toml_path:?}"))
                    })
                });
            match parsed {
                Ok(config) => return Ok(config),
                Err(e) => {
                    log_err!(
                        "Конфиг проекта {project_name} повреждён: {e:#} — пересоздаём с сервера"
                    );
                    let broken_path = config_dir.join(format!("{project_name}.toml.broken"));
                    let _ = fs::remove_file(&broken_path).await;
                    if let Err(rename_err) = fs::rename(&toml_path, &broken_path).await {
                        log_err!(
                            "Не удалось сохранить битый конфиг в {broken_path:?}: {rename_err:#}"
                        );
                    }
                }
            }
        }
    }

    let base_url = match server_url {
        Some(url) => normalize_server_url(url),
        None => default_server_url().ok_or_else(|| {
            anyhow::Error::new(LauncherError::Offline(
                "конфиг проекта доступен только с сервера".to_string(),
            ))
        })?,
    };
    let response = LauncherError::classify(
        with_launcher_id(http_client().get(format!("{}/v1/launcher/config", base_url)))
            .send()
            .await
            .context("Не удалось подключиться к серверу конфига проекта"),
        LauncherError::LauncherServer,
    )?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("Сервер вернул {} при запросе конфига: {}", status, body);
        anyhow::bail!(LauncherError::LauncherServer(format!(
            "Сервер {} вернул {} при запросе конфига проекта",
            base_url, status
        )));
    }

    let mut config: ProjectConfig = LauncherError::classify(
        response
            .json()
            .await
            .context("Не удалось распарсить конфиг с сервера"),
        LauncherError::LauncherServer,
    )?;

    if config.project_name.trim().is_empty() {
        anyhow::bail!(LauncherError::LauncherServer(
            "Сервер не вернул название проекта".to_string()
        ));
    }

    if !project_name.is_empty() {
        config.project_name = project_name.to_string();
    } else {
        validate_project_name(&config.project_name)?;
    }
    config.initialized = false;
    config.server_url = server_url.map(normalize_server_url);

    let toml_path = config_dir.join(format!("{}.toml", config.project_name));
    let toml_string = toml::to_string_pretty(&config)?;
    write_atomic(&toml_path, toml_string.as_bytes()).await?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use crate::commands::launcher_config::update_launcher_config;
    use crate::state::dto::GlobalState;
    use crate::state::launcher_config::LauncherConfig;
    use crate::test_support::{ConfigFileGuard, LauncherDirGuard};
    use mockito::Server;
    use std::fs;
    use tokio::sync::Mutex;

    use super::{init_launcher, init_project_config, InitPaths};

    #[tokio::test]
    async fn init_project_config_recreates_broken_toml_from_server() {
        let guard = LauncherDirGuard::acquire("init_broken_toml").await;
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/launcher/config")
            .with_status(200)
            .with_body(
                r#"{"projectName":"BrokenInit","mcVersion":"1.20.1","modLoader":"vanilla",
                    "loaderVersion":null,"javaPath":null,"jvmArgs":[],
                    "minMemory":"-Xms512M","maxMemory":"-Xmx4G"}"#,
            )
            .create_async()
            .await;

        let base = guard.root().to_string_lossy().to_string();
        let config_dir = guard.root().join("project").join("config");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("BrokenInit.toml"), "{ это битый toml").unwrap();

        let config = init_project_config(&base, "BrokenInit", Some(&server.url()))
            .await
            .expect("битый toml должен пересоздаваться с сервера");

        assert_eq!(config.project_name, "BrokenInit");
        assert_eq!(config.mc_version, "1.20.1");
        assert_eq!(config.min_memory, "-Xms512M");
        let restored = fs::read_to_string(config_dir.join("BrokenInit.toml")).unwrap();
        assert!(
            restored.contains("mcVersion"),
            "на диске должен быть свежий конфиг с сервера: {restored}"
        );
        assert!(
            config_dir.join("BrokenInit.toml.broken").exists(),
            "битый toml должен сохраняться рядом для диагностики"
        );
    }

    #[tokio::test]
    async fn init_rejects_traversal_name_before_write() {
        let guard = LauncherDirGuard::acquire("init_traversal_name").await;
        let base = guard.root().to_string_lossy().to_string();

        let result = init_project_config(&base, "../evil", None).await;
        assert!(result.is_err(), "traversal-имя должно отклоняться");

        assert!(!guard.root().join("project").join("evil.toml").exists());
        let config_dir = guard.root().join("project").join("config");
        let written = config_dir
            .read_dir()
            .map(|entries| entries.count())
            .unwrap_or(0);
        assert_eq!(written, 0, "в config не должно быть записей");
    }

    #[tokio::test]
    async fn init_launcher_keeps_parallel_theme_mutation() {
        let guard = LauncherDirGuard::acquire("init_launcher_race").await;
        let _path_guard = ConfigFileGuard::acquire(guard.root(), "config.json");
        let seeded = LauncherConfig {
            theme: "seed".to_string(),
            ..Default::default()
        };
        seeded.save().expect("сохранение стартового конфига");

        let state = Mutex::new(GlobalState::default());
        let parent = guard.root().to_string_lossy().to_string();
        let expected_path = InitPaths::new(&parent)
            .expect("пути инициализации")
            .base
            .to_string_lossy()
            .to_string();

        let (init_result, theme_result) = tokio::join!(
            init_launcher(&state, &parent),
            update_launcher_config(&state, |config| config.theme = "race-theme".to_string()),
        );
        init_result.expect("инициализация лаунчера");
        theme_result.expect("смена темы");

        let saved = LauncherConfig::load()
            .expect("чтение сохранённого конфига")
            .expect("конфиг должен быть записан");
        assert_eq!(saved.launcher_path, expected_path);
        assert_eq!(
            saved.theme, "race-theme",
            "параллельная смена темы не должна теряться на диске"
        );

        let in_memory = state
            .lock()
            .await
            .launcher_config
            .clone()
            .expect("in-memory конфиг");
        assert_eq!(in_memory.launcher_path, expected_path);
        assert_eq!(in_memory.theme, "race-theme");
    }
}
