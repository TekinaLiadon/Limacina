use anyhow::{Context, Result};
use std::path::PathBuf;
use tokio::fs;

use crate::log_err;
use crate::state::config::validate_project_name;
use crate::state::dto::ProjectConfig;
use crate::state::launcher_config::LauncherConfig;
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

pub fn init_launcher(parent_path: &str) -> Result<LauncherConfig> {
    let paths = InitPaths::new(parent_path)?;
    paths.create_dirs()?;

    let mut config = LauncherConfig::load().ok().flatten().unwrap_or_default();
    config.apply_default_project();
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
        validate_project_name(project_name)?;
        let toml_path = config_dir.join(format!("{}.toml", project_name));
        if toml_path.exists() {
            let content = fs::read_to_string(&toml_path).await?;
            let config: ProjectConfig = toml::from_str(&content)?;
            return Ok(config);
        }
    }

    if crate::utils::env_info::is_legacy_build() {
        return init_legacy_project_config(&config_dir, project_name).await;
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

async fn init_legacy_project_config(
    config_dir: &std::path::Path,
    project_name: &str,
) -> Result<ProjectConfig> {
    use crate::legacy::requests::LegacyClient;

    let base_url = crate::utils::env_info::get_legacy_server_url().ok_or_else(|| {
        anyhow::Error::new(LauncherError::Offline(
            "легаси-сервер не настроен в сборке".to_string(),
        ))
    })?;
    let client = LegacyClient::new(&base_url)?;
    init_legacy_project_config_with(config_dir, project_name, &client, &base_url).await
}

async fn init_legacy_project_config_with(
    config_dir: &std::path::Path,
    project_name: &str,
    client: &crate::legacy::requests::LegacyClient,
    base_url: &str,
) -> Result<ProjectConfig> {
    validate_project_name(project_name)?;
    let (_, profiles) = client
        .fetch_profiles()
        .await
        .context("Не удалось получить профили легаси-сервера")?;
    let profile = crate::legacy::requests::choose_profile_record(profiles)?.profile;

    let project = ProjectConfig {
        project_name: project_name.to_string(),
        mc_version: profile.version.clone(),
        mod_loader: crate::state::dto::ModLoader::Vanilla,
        loader_version: None,
        java_path: None,
        java_version: None,
        jvm_args: Vec::new(),
        min_memory: "-Xms512M".to_string(),
        max_memory: "-Xmx4G".to_string(),
        online: true,
        initialized: false,
        server_url: Some(base_url.to_string()),
        auto_join_server: false,
        legacy: true,
        legacy_profile: Some(profile),
    };

    let toml_path = config_dir.join(format!("{}.toml", project_name));
    let toml_string = toml::to_string_pretty(&project)?;
    write_atomic(&toml_path, toml_string.as_bytes()).await?;
    Ok(project)
}

#[cfg(test)]
mod tests {
    use crate::test_support::LauncherDirGuard;

    use super::init_project_config;

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
    async fn init_legacy_project_picks_lowest_sort_index() {
        use crate::legacy::crypto::{generate_test_key, sign_sha256_with_rsa_raw};
        use crate::legacy::requests::LegacyClient;
        use crate::test_support::legacy_profile_data;
        use rsa::RsaPublicKey;

        let _guard = LauncherDirGuard::acquire("init_legacy").await;
        let mut server = mockito::Server::new_async().await;
        let key = generate_test_key(2048).expect("тестовый ключ");
        let client = LegacyClient::with_test_key(&server.url(), RsaPublicKey::from(&key));

        let first = legacy_profile_data("LowSort", 5);
        let second = legacy_profile_data("HighSort", 9);
        let mut body = crate::legacy::protocol::HWriter::new();
        body.write_string("");
        body.write_fixed(&vec![0u8; 256]);
        body.write_varint(2);
        body.write_prefixed(&first);
        body.write_fixed(&sign_sha256_with_rsa_raw(&key, &first).expect("подпись"));
        body.write_prefixed(&second);
        body.write_fixed(&sign_sha256_with_rsa_raw(&key, &second).expect("подпись"));

        let mock = server
            .mock("POST", "/api/launcher")
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let config_dir = _guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("папка конфигов");

        let config = super::init_legacy_project_config_with(
            &config_dir,
            "LegacyProj",
            &client,
            &server.url(),
        )
        .await
        .expect("легаси-конфиг создаётся");
        mock.assert_async().await;

        assert!(config.legacy);
        assert_eq!(config.mc_version, "1.16.5");
        assert_eq!(config.server_url.as_deref(), Some(server.url().as_str()));
        let profile = config.legacy_profile.expect("профиль");
        assert_eq!(
            profile.dir_name, "LowSort",
            "выбирается минимальный sortIndex"
        );

        let toml_path = config_dir.join("LegacyProj.toml");
        assert!(toml_path.exists(), "TOML записан");
        let reparsed: crate::state::dto::ProjectConfig =
            toml::from_str(&std::fs::read_to_string(&toml_path).expect("чтение TOML"))
                .expect("TOML читается");
        assert!(reparsed.legacy);
        assert_eq!(
            reparsed.legacy_profile.expect("профиль").dir_name,
            "LowSort"
        );
    }
}
