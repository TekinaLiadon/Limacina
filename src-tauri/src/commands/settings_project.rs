use crate::utils::errors::LauncherError;
use anyhow::{bail, Context, Result};
use std::path::PathBuf;
use tokio::sync::Mutex;

use crate::init::init_project_config;
use crate::java::find_java_executable;
use crate::log_info;
use crate::state::config::{load_config, update_project_config};
use crate::state::dto::{GlobalState, ProjectConfig};
use crate::utils::blocking;
use crate::utils::env_info::launcher_path;
use crate::utils::tauri_err::CommandResult;

#[tauri::command]
pub async fn save_settings_project(
    state: tauri::State<'_, Mutex<GlobalState>>,
    config: ProjectConfig,
) -> CommandResult<ProjectConfig> {
    let saved = save_project_settings(&state, config).await?;
    Ok(saved)
}

async fn save_project_settings(
    state: &Mutex<GlobalState>,
    config: ProjectConfig,
) -> Result<ProjectConfig> {
    let saved = update_project_config(state, async |stored: &mut ProjectConfig| {
        let mut incoming = config;
        incoming.java_version = resolve_saved_java_version(&incoming).await;
        *stored = incoming;
        Ok(())
    })
    .await?;
    Ok(saved)
}

fn extract_java_major(output: &str) -> Option<u32> {
    let start = output.find('"')? + 1;
    let rest = &output[start..];
    let end = rest.find('"')?;
    let version = rest[..end].trim();
    let mut parts = version.split('.');
    let first = parts.next()?.trim();
    if first == "1" {
        parts.next()?.trim().parse().ok()
    } else {
        first.parse().ok()
    }
}

#[tauri::command]
pub async fn probe_java_version(path: String) -> CommandResult<Option<u32>> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(
            LauncherError::Java(format!("Папка {path} не существует или недоступна")).into(),
        );
    }
    let executable = blocking(
        "Поиск Java в выбранной папке",
        move || find_java_executable(&dir),
    )
    .await?
    .context("В выбранной папке не найден исполняемый файл Java (bin/java)")?;
    let output = tokio::process::Command::new(&executable)
        .arg("-version")
        .output()
        .await
        .context("Не удалось запустить java -version")?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let major = extract_java_major(&text)
        .ok_or_else(|| anyhow::anyhow!("Не удалось определить версию Java в выбранной папке"))?;
    Ok(Some(major))
}

async fn resolve_saved_java_version(config: &ProjectConfig) -> Option<u32> {
    let stored = load_config(&config.project_name).await.ok()?;
    if stored.java_path == config.java_path {
        return stored.java_version;
    }
    None
}

#[tauri::command]
pub async fn load_settings_project(
    state: tauri::State<'_, Mutex<GlobalState>>,
    project_name: String,
) -> CommandResult<ProjectConfig> {
    Ok(load_settings_project_inner(&state, &project_name).await?)
}

async fn load_settings_project_inner(
    state: &Mutex<GlobalState>,
    project_name: &str,
) -> Result<ProjectConfig> {
    let config = match load_config(project_name).await {
        Ok(config) => config,
        Err(_) => {
            let launcher_path =
                crate::state::launcher_config::LauncherConfig::resolved_launcher_path()
                    .to_string_lossy()
                    .to_string();

            init_project_config(&launcher_path, project_name, None).await?
        }
    };

    update_project_config(state, async |stored: &mut ProjectConfig| {
        *stored = config;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn clear_minecraft_config(
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<String> {
    let (project_name, keep_old_configs) = {
        let guard = state.lock().await;
        (
            guard.project_config.project_name.clone(),
            guard
                .launcher_config
                .as_ref()
                .map(|c| c.keep_old_configs)
                .unwrap_or(false),
        )
    };

    clear_minecraft_config_inner(&project_name, keep_old_configs)
        .await
        .map_err(Into::into)
}

async fn clear_minecraft_config_inner(
    project_name: &str,
    keep_old_configs: bool,
) -> Result<String> {
    if project_name.trim().is_empty() {
        bail!(LauncherError::ProjectNotSelected);
    }

    let game_dir = launcher_path(Some(project_name))?;
    let config_dir = game_dir.join("config");

    if !config_dir.exists() {
        let staging_dir = game_dir.join("old_config.part");
        if staging_dir.exists() {
            if keep_old_configs {
                let old_dir = game_dir.join("old_config");
                if old_dir.exists() {
                    tokio::fs::remove_dir_all(&old_dir).await.with_context(|| {
                        format!("Не удалось удалить старую папку {:?}", old_dir)
                    })?;
                }
                tokio::fs::rename(&staging_dir, &old_dir)
                    .await
                    .with_context(|| format!("Не удалось переименовать папку {:?}", staging_dir))?;
                log_info!(
                    "Дописан прерванный перенос конфигов проекта {} в old_config",
                    project_name
                );
                return Ok("Конфиги перемещены в резервную копию".to_string());
            }
            tokio::fs::remove_dir_all(&staging_dir)
                .await
                .with_context(|| format!("Не удалось удалить папку {:?}", staging_dir))?;
            log_info!("Удалена прерванная копия конфигов проекта {}", project_name);
            return Ok("Папка конфигов удалена".to_string());
        }
        return Ok("Папка конфигов отсутствует".to_string());
    }

    if keep_old_configs {
        let old_dir = game_dir.join("old_config");
        let staging_dir = game_dir.join("old_config.part");
        tokio::fs::rename(&config_dir, &staging_dir)
            .await
            .with_context(|| format!("Не удалось переименовать папку {:?}", config_dir))?;
        if old_dir.exists() {
            tokio::fs::remove_dir_all(&old_dir)
                .await
                .with_context(|| format!("Не удалось удалить старую папку {:?}", old_dir))?;
        }
        tokio::fs::rename(&staging_dir, &old_dir)
            .await
            .with_context(|| format!("Не удалось переименовать папку {:?}", staging_dir))?;
        log_info!("Конфиги проекта {} перемещены в old_config", project_name);
        Ok("Конфиги перемещены в резервную копию".to_string())
    } else {
        tokio::fs::remove_dir_all(&config_dir)
            .await
            .with_context(|| format!("Не удалось удалить папку {:?}", config_dir))?;
        log_info!("Папка config проекта {} удалена", project_name);
        Ok("Папка конфигов удалена".to_string())
    }
}

#[cfg(test)]
mod save_settings_tests {
    use super::{
        clear_minecraft_config_inner, extract_java_major, load_settings_project_inner,
        save_project_settings,
    };
    use crate::state::config::{load_config, update_project_config};
    use crate::state::dto::{GlobalState, ProjectConfig};
    use crate::test_support::LauncherDirGuard;
    use std::time::Duration;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn clear_finalizes_interrupted_old_config_rename() {
        let dir = LauncherDirGuard::acquire("clear_minecraft_staging").await;
        let game_dir = dir.project_dir("Cordelia");
        let staging = game_dir.join("old_config.part");
        std::fs::create_dir_all(staging.join("options.txt").parent().unwrap()).unwrap();
        std::fs::write(staging.join("options.txt"), b"mouse_sensitive=1").unwrap();

        let message = clear_minecraft_config_inner("Cordelia", true)
            .await
            .expect("прерванный перенос должен финализироваться");

        assert!(
            message.contains("резервную копию"),
            "ожидается сообщение о переносе: {message}"
        );
        assert!(
            game_dir.join("old_config").join("options.txt").exists(),
            "конфиги должны оказаться в old_config"
        );
        assert!(!staging.exists(), "staging-папка должна исчезнуть");
    }

    #[tokio::test]
    async fn clear_without_keep_removes_interrupted_staging() {
        let dir = LauncherDirGuard::acquire("clear_minecraft_staging_delete").await;
        let game_dir = dir.project_dir("Cordelia");
        let staging = game_dir.join("old_config.part");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("options.txt"), b"x").unwrap();

        let message = clear_minecraft_config_inner("Cordelia", false)
            .await
            .expect("удаление без резервной копии");

        assert!(
            message.contains("удалены") || message.contains("удалена"),
            "ожидается сообщение об удалении: {message}"
        );
        assert!(
            !staging.exists(),
            "staging должен быть удалён без финализации"
        );
        assert!(
            !game_dir.join("old_config").exists(),
            "old_config не должен создаваться без keep_old_configs"
        );
    }

    #[tokio::test]
    async fn settings_save_survives_parallel_config_update() {
        let _guard = LauncherDirGuard::acquire("project_config_settings_race").await;
        let base = ProjectConfig {
            project_name: "RaceSave".to_string(),
            mc_version: "1.20.1".to_string(),
            ..ProjectConfig::default()
        };
        base.save_config()
            .await
            .expect("сохранение базового конфига");
        let state = Mutex::new(GlobalState {
            project_config: base,
            ..Default::default()
        });

        let payload = ProjectConfig {
            project_name: "RaceSave".to_string(),
            mc_version: "1.20.1".to_string(),
            max_memory: "-Xmx8G".to_string(),
            ..ProjectConfig::default()
        };

        let (update_result, save_result) = tokio::join!(
            update_project_config(&state, async |config: &mut ProjectConfig| {
                tokio::time::sleep(Duration::from_millis(80)).await;
                config.java_path = Some("java-path".to_string());
                Ok(())
            }),
            save_project_settings(&state, payload),
        );
        update_result.expect("мутация java_path");
        let saved = save_result.expect("сохранение настроек");
        assert_eq!(
            saved.max_memory, "-Xmx8G",
            "параллельное сохранение настроек не должно теряться"
        );
    }

    #[tokio::test]
    async fn project_switch_survives_parallel_settings_save() {
        let _guard = LauncherDirGuard::acquire("project_switch_race").await;
        for name in ["SwitchFrom", "SwitchTo"] {
            ProjectConfig {
                project_name: name.to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            }
            .save_config()
            .await
            .expect("сохранение конфига проекта");
        }
        let state = Mutex::new(GlobalState {
            project_config: ProjectConfig {
                project_name: "SwitchFrom".to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            },
            ..Default::default()
        });

        let (save_result, switch_result) = tokio::join!(
            update_project_config(&state, async |config: &mut ProjectConfig| {
                tokio::time::sleep(Duration::from_millis(80)).await;
                config.java_path = Some("java-path".to_string());
                Ok(())
            }),
            load_settings_project_inner(&state, "SwitchTo"),
        );
        save_result.expect("сохранение настроек");
        switch_result.expect("переключение проекта");

        let saved = load_config("SwitchFrom").await.expect("чтение конфига");
        assert_eq!(
            saved.java_path.as_deref(),
            Some("java-path"),
            "параллельное сохранение настроек не должно теряться при переключении проекта"
        );

        let current = state.lock().await.project_config.clone();
        assert_eq!(
            current.project_name, "SwitchTo",
            "переключение проекта не должно откатываться параллельным сохранением"
        );
    }

    #[test]
    fn extracts_major_from_java_version_output() {
        assert_eq!(
            extract_java_major(r#"openjdk version "21.0.3" 2024-04-16"#),
            Some(21)
        );
        assert_eq!(extract_java_major(r#"java version "1.8.0_392""#), Some(8));
        assert_eq!(extract_java_major("no version here"), None);
    }
}
