use anyhow::{Context, Result};
use std::path::PathBuf;
use tokio::fs;

use crate::log_err;
use crate::state::dto::ProjectConfig;
use crate::state::launcher_config::LauncherConfig;
use crate::utils::env_info::{default_server_url, get_launcher_name, normalize_server_url};
use crate::utils::http::http_client;

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
        let base = PathBuf::from(parent_path.replace('/', std::path::MAIN_SEPARATOR_STR)).join(&name);
        Ok(Self {
            project: base.join("project"),
            config: base.join("project").join("config"),
            manifest: base.join("manifest"),
            java: base.join("java"),
            base,
        })
    }

    pub fn create_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(&self.base)
            .with_context(|| format!("Не удалось создать папку \"{}\"", self.base.display()))?;
        std::fs::create_dir_all(&self.project)
            .with_context(|| "Не удалось создать папку \"project\"")?;
        std::fs::create_dir_all(&self.config)
            .with_context(|| "Не удалось создать папку \"config\"")?;
        std::fs::create_dir_all(&self.manifest)
            .with_context(|| "Не удалось создать папку \"manifest\"")?;
        std::fs::create_dir_all(&self.java)
            .with_context(|| "Не удалось создать папку \"java\"")?;
        Ok(())
    }
}

pub fn init_launcher(parent_path: &str) -> Result<LauncherConfig> {
    let paths = InitPaths::new(parent_path)?;
    paths.create_dirs()?;

    let mut config = LauncherConfig::load().ok().flatten().unwrap_or_default();
    config.launcher_path = paths.base.to_string_lossy().to_string();
    config.save()?;

    Ok(config)
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
        let toml_path = config_dir.join(format!("{}.toml", project_name));
        if toml_path.exists() {
            let content = fs::read_to_string(&toml_path).await?;
            let config: ProjectConfig = toml::from_str(&content)?;
            return Ok(config);
        }
    }

    let base_url = match server_url {
        Some(url) => normalize_server_url(url),
        None => default_server_url(),
    };
    let response = http_client()
        .get(format!("{}/launcher/config", base_url))
        .send()
        .await
        .context("Не удалось подключиться к серверу конфига проекта")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log_err!("Сервер вернул {} при запросе конфига: {}", status, body);
        anyhow::bail!("Сервер {} вернул {} при запросе конфига проекта", base_url, status);
    }

    let mut config: ProjectConfig = response
        .json()
        .await
        .context("Не удалось распарсить конфиг с сервера")?;

    if config.project_name.trim().is_empty() {
        anyhow::bail!("Сервер не вернул название проекта");
    }

    if !project_name.is_empty() {
        config.project_name = project_name.to_string();
    }
    config.initialized = false;
    config.server_url = server_url.map(normalize_server_url);

    let toml_path = config_dir.join(format!("{}.toml", config.project_name));
    let toml_string = toml::to_string_pretty(&config)?;
    fs::write(&toml_path, toml_string).await?;
    Ok(config)
}
