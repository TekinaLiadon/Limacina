use crate::utils::errors::LauncherError;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::PathBuf;
use tokio::sync::Mutex;

use crate::java::find_java_executable;
use crate::log_info;
use crate::state::config::{
    ensure_project_selected, is_corrupt_config, is_missing_config, load_config,
    recover_project_config, update_project_config, validated_project_name,
};
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
    update_project_config(state, async |stored: &mut ProjectConfig| {
        if config.project_name != stored.project_name {
            bail!(LauncherError::ProjectSettingsMismatch(
                config.project_name.clone(),
                stored.project_name.clone(),
            ));
        }
        if let Some(cores) = config.cpu_cores {
            let available = crate::utils::env_info::available_cpu_cores()?;
            if cores == 0 || cores > available {
                bail!(LauncherError::InvalidInput(format!(
                    "Некорректное число ядер CPU: {cores}. Допустимо от 1 до {available}"
                )));
            }
        }
        let java_version = if stored.java_path == config.java_path {
            stored.java_version
        } else {
            config.java_version
        };
        let online = stored.online;
        let server_url = stored.server_url.clone();
        let initialized = stored.initialized;
        let mut incoming = config;
        incoming.java_version = java_version;
        incoming.online = online;
        incoming.server_url = server_url;
        incoming.initialized = initialized;
        *stored = incoming;
        Ok(())
    })
    .await
}

pub(crate) fn extract_java_major(output: &str) -> Option<u32> {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaProbe {
    pub java_path: String,
    pub java_version: u32,
}

#[tauri::command]
pub async fn probe_java_version(path: String) -> CommandResult<JavaProbe> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(LauncherError::Java("Не указана папка с Java".to_string()).into());
    }
    let dir = PathBuf::from(trimmed);
    if !dir.is_absolute() {
        return Err(LauncherError::Java(format!(
            "Путь к папке Java должен быть абсолютным: {trimmed}"
        ))
        .into());
    }
    let is_dir = tokio::fs::metadata(&dir)
        .await
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false);
    if !is_dir {
        return Err(
            LauncherError::Java(format!("Папка {trimmed} не существует или недоступна")).into(),
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
    Ok(JavaProbe {
        java_path: executable.to_string_lossy().into_owned(),
        java_version: major,
    })
}

#[tauri::command]
pub async fn available_cpu_cores() -> CommandResult<u16> {
    Ok(crate::utils::env_info::available_cpu_cores()?)
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
        Err(e) if is_corrupt_config(&e) || is_missing_config(&e) => {
            recover_project_config(state, project_name, e).await?
        }
        Err(e) => {
            return Err(e).context(format!(
                "Не удалось прочитать конфиг проекта {project_name}"
            ))
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
    project_name: String,
) -> CommandResult<String> {
    let project_name = validated_project_name(&project_name)?;
    let keep_old_configs = {
        let guard = state.lock().await;
        guard
            .launcher_config
            .as_ref()
            .map(|c| c.keep_old_configs)
            .unwrap_or(false)
    };

    clear_minecraft_config_inner(project_name, keep_old_configs)
        .await
        .map_err(Into::into)
}

static CLEAR_CONFIG_LOCK: Mutex<()> = Mutex::const_new(());

async fn clear_minecraft_config_inner(
    project_name: &str,
    keep_old_configs: bool,
) -> Result<String> {
    let _guard = CLEAR_CONFIG_LOCK.lock().await;
    ensure_project_selected(project_name)?;

    let game_dir = launcher_path(Some(project_name))?;
    let config_dir = game_dir.join("config");

    if !tokio::fs::try_exists(&config_dir).await.unwrap_or(false) {
        let staging_dir = game_dir.join("old_config.part");
        if tokio::fs::try_exists(&staging_dir).await.unwrap_or(false) {
            if keep_old_configs {
                let old_dir = game_dir.join("old_config");
                if tokio::fs::try_exists(&old_dir).await.unwrap_or(false) {
                    tokio::fs::remove_dir_all(&old_dir).await.with_context(|| {
                        format!("Не удалось удалить старую папку {:?}", old_dir)
                    })?;
                }
                tokio::fs::rename(&staging_dir, &old_dir)
                    .await
                    .with_context(|| format!("Не удалось переименовать папку {:?}", staging_dir))?;
                log_info!(
                    "Завершён прерванный перенос конфигов проекта {} в old_config",
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
        if tokio::fs::try_exists(&old_dir).await.unwrap_or(false) {
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
mod available_cores_tests {
    use super::available_cpu_cores;

    #[tokio::test]
    async fn returns_positive_core_count() {
        let cores = available_cpu_cores().await.expect("число ядер хоста");
        assert!(cores >= 1, "число ядер должно быть положительным: {cores}");
    }
}

#[cfg(test)]
mod load_settings_tests {
    use super::load_settings_project_inner;
    use crate::state::config::load_config;
    use crate::state::dto::{GlobalState, ProjectConfig};
    use crate::test_support::{offline_project_config, LauncherDirGuard};
    use tokio::sync::Mutex;

    fn offline_config(name: &str) -> ProjectConfig {
        ProjectConfig {
            max_memory: "-Xmx8G".to_string(),
            ..offline_project_config(name)
        }
    }

    #[tokio::test]
    async fn load_settings_recovers_offline_profile_without_server() {
        let guard = LauncherDirGuard::acquire("load_settings_missing_offline").await;
        let state = Mutex::new(GlobalState {
            project_config: offline_config("Solo"),
            ..GlobalState::default()
        });

        let config = load_settings_project_inner(&state, "Solo")
            .await
            .expect("потерянный конфиг офлайн-профиля восстанавливается из памяти");

        assert!(
            !config.online,
            "офлайн-профиль не должен становиться онлайн"
        );
        assert_eq!(config.mc_version, "1.20.1");
        assert_eq!(
            config.server_url.as_deref(),
            Some("https://per-project.example.com"),
            "сервер проекта не должен теряться при восстановлении"
        );

        let restored = load_config("Solo")
            .await
            .expect("восстановленный конфиг персистится");
        assert!(
            !restored.online,
            "на диске должен оказаться офлайн-конфиг: {}",
            guard.root().display()
        );
    }

    #[tokio::test]
    async fn load_settings_recovers_corrupt_profile_with_backup() {
        let guard = LauncherDirGuard::acquire("load_settings_corrupt_offline").await;
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        std::fs::write(config_dir.join("Solo.toml"), "not [valid toml").expect("битый toml");
        let state = Mutex::new(GlobalState {
            project_config: offline_config("Solo"),
            ..GlobalState::default()
        });

        let config = load_settings_project_inner(&state, "Solo")
            .await
            .expect("битый конфиг офлайн-профиля восстанавливается без сервера");

        assert!(
            !config.online,
            "офлайн-профиль не должен становиться онлайн"
        );
        assert_eq!(config.mc_version, "1.20.1");
        assert!(
            config_dir.join("Solo.toml.bak").exists(),
            "битый файл сохраняется в бэкап"
        );
        let restored = load_config("Solo")
            .await
            .expect("конфиг перезаписан рабочим");
        assert!(!restored.online);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn load_settings_propagates_transient_read_errors_without_overwrite() {
        use std::os::unix::fs::PermissionsExt;

        let guard = LauncherDirGuard::acquire("load_settings_transient").await;
        let config_dir = guard.root().join("project").join("config");
        std::fs::create_dir_all(&config_dir).expect("создание config");
        let toml_path = config_dir.join("Solo.toml");
        std::fs::write(&toml_path, "mcVersion = \"1.20.1\"\n").expect("запись toml");
        std::fs::set_permissions(&toml_path, std::fs::Permissions::from_mode(0o000))
            .expect("запрет чтения конфига");
        let state = Mutex::new(GlobalState {
            project_config: offline_config("Solo"),
            ..GlobalState::default()
        });

        let result = load_settings_project_inner(&state, "Solo").await;
        std::fs::set_permissions(&toml_path, std::fs::Permissions::from_mode(0o644))
            .expect("возврат прав");

        let error = result.expect_err("ошибка чтения должна доходить до вызывающего");
        assert!(
            error.to_string().contains("Не удалось прочитать конфиг"),
            "ошибка должна называть операцию: {error:#}"
        );
        assert_eq!(
            std::fs::read_to_string(&toml_path).expect("чтение после возврата прав"),
            "mcVersion = \"1.20.1\"\n",
            "транзиентная ошибка не должна перезаписывать конфиг: {}",
            guard.root().display()
        );
    }
}

#[cfg(test)]
mod probe_java_tests {
    use super::probe_java_version;

    #[tokio::test]
    async fn empty_path_is_rejected() {
        let error = probe_java_version("   ".to_string())
            .await
            .expect_err("пустой путь должен отклоняться");

        assert!(
            error.message.contains("Не указана папка"),
            "ошибка должна объяснять причину: {error:?}"
        );
    }

    #[tokio::test]
    async fn relative_path_is_rejected_before_disk_access() {
        let error = probe_java_version("java/jdk-21".to_string())
            .await
            .expect_err("относительный путь должен отклоняться");

        assert!(
            error.message.contains("должен быть абсолютным"),
            "ошибка должна объяснять причину: {error:?}"
        );
    }

    #[tokio::test]
    async fn missing_folder_is_rejected() {
        let missing = std::env::temp_dir().join("limacina_probe_java_missing");
        let error = probe_java_version(missing.to_string_lossy().into_owned())
            .await
            .expect_err("несуществующая папка должна отклоняться");

        assert!(
            error.message.contains("не существует или недоступна"),
            "ошибка должна объяснять причину: {error:?}"
        );
    }

    #[tokio::test]
    async fn file_instead_of_folder_is_rejected() {
        let dir = crate::test_support::TempDir::new("probe_java_file");
        let file = dir.0.join("java.txt");
        std::fs::write(&file, b"not a dir").expect("файл-заглушка");

        let error = probe_java_version(file.to_string_lossy().into_owned())
            .await
            .expect_err("файл вместо папки должен отклоняться");

        assert!(
            error.message.contains("не существует или недоступна"),
            "ошибка должна объяснять причину: {error:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_returns_the_executable_found_in_the_folder() {
        use std::os::unix::fs::PermissionsExt;

        let dir = crate::test_support::TempDir::new("probe_java_ok");
        let bin = dir.0.join("bin");
        std::fs::create_dir_all(&bin).expect("папка bin");
        let java = bin.join("java");
        std::fs::write(
            &java,
            b"#!/bin/sh\necho 'openjdk version \"21.0.3\" 2024-04-16'\n",
        )
        .expect("скрипт java");
        std::fs::set_permissions(&java, std::fs::Permissions::from_mode(0o755))
            .expect("права на запуск");

        let probe = probe_java_version(dir.0.to_string_lossy().into_owned())
            .await
            .expect("проба должна вернуть исполняемый файл и версию");

        assert_eq!(
            probe.java_path,
            java.to_string_lossy(),
            "в поле должен попадать найденный bin/java, а не выбранная папка"
        );
        assert_eq!(probe.java_version, 21, "версия берётся из java -version");
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
    use crate::test_support::{seeded_global_state, LauncherDirGuard};
    use crate::utils::errors::LauncherError;
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
    async fn parallel_clears_are_serialized_and_both_succeed() {
        let dir = LauncherDirGuard::acquire("clear_minecraft_parallel").await;
        let game_dir = dir.project_dir("Cordelia");
        let config = game_dir.join("config");
        std::fs::create_dir_all(&config).expect("создание config");
        std::fs::write(config.join("options.txt"), b"fov:90").expect("создание options.txt");

        let (first, second) = tokio::join!(
            clear_minecraft_config_inner("Cordelia", true),
            clear_minecraft_config_inner("Cordelia", true),
        );

        let first = first.expect("первая очистка должна пройти");
        let second = second.expect("параллельная очистка должна ждать лок, а не падать");
        assert!(
            first.contains("резервную копию") || second.contains("резервную копию"),
            "ровно одна из очисток должна переносить конфиги: {first} / {second}"
        );
        assert!(
            game_dir.join("old_config").join("options.txt").exists(),
            "конфиги должны оказаться в old_config"
        );
        assert!(
            !game_dir.join("old_config.part").exists(),
            "staging не должен оставаться после параллельных очисток"
        );
        assert!(!config.exists(), "исходная папка config должна исчезнуть");
    }

    #[tokio::test]
    async fn settings_save_survives_parallel_config_update() {
        let (_guard, state) = seeded_global_state(
            "project_config_settings_race",
            ProjectConfig {
                project_name: "RaceSave".to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            },
        )
        .await;

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

    #[tokio::test]
    async fn settings_save_rejects_zero_cpu_cores() {
        let (_guard, state, payload) = cores_settings("settings_cpu_cores_zero", Some(0)).await;
        let error = save_project_settings(&state, payload)
            .await
            .expect_err("нулевое число ядер должно отклоняться");

        assert!(
            error.to_string().contains("ядер CPU"),
            "ошибка должна называть настройку: {error}"
        );
    }

    async fn cores_settings(
        label: &str,
        cpu_cores: Option<u16>,
    ) -> (LauncherDirGuard, Mutex<GlobalState>, ProjectConfig) {
        let (guard, state) = seeded_global_state(
            label,
            ProjectConfig {
                project_name: "Cores".to_string(),
                mc_version: "1.20.1".to_string(),
                ..ProjectConfig::default()
            },
        )
        .await;
        let payload = ProjectConfig {
            project_name: "Cores".to_string(),
            mc_version: "1.20.1".to_string(),
            cpu_cores,
            ..ProjectConfig::default()
        };
        (guard, state, payload)
    }

    #[tokio::test]
    async fn settings_save_rejects_cpu_cores_above_available() {
        let available = crate::utils::env_info::available_cpu_cores().expect("число ядер хоста");
        let (_guard, state, payload) =
            cores_settings("settings_cpu_cores_high", Some(available.saturating_add(1))).await;
        let error = save_project_settings(&state, payload)
            .await
            .expect_err("значение больше доступных ядер должно отклоняться");

        assert!(
            error.to_string().contains("Допустимо"),
            "ошибка должна называть допустимый диапазон: {error}"
        );
    }

    #[tokio::test]
    async fn settings_save_keeps_valid_cpu_cores() {
        let available = crate::utils::env_info::available_cpu_cores().expect("число ядер хоста");
        let (_guard, state, payload) =
            cores_settings("settings_cpu_cores_valid", Some(available)).await;
        let saved = save_project_settings(&state, payload)
            .await
            .expect("валидное число ядер сохраняется");

        assert_eq!(saved.cpu_cores, Some(available));
    }

    #[tokio::test]
    async fn settings_save_keeps_java_version_only_while_path_unchanged() {
        let (_guard, state) = seeded_global_state(
            "settings_java_version",
            ProjectConfig {
                project_name: "JavaVer".to_string(),
                mc_version: "1.20.1".to_string(),
                java_path: Some("/old/java".to_string()),
                java_version: Some(17),
                ..ProjectConfig::default()
            },
        )
        .await;

        let same_path = ProjectConfig {
            project_name: "JavaVer".to_string(),
            mc_version: "1.20.1".to_string(),
            java_path: Some("/old/java".to_string()),
            java_version: Some(99),
            ..ProjectConfig::default()
        };
        let saved = save_project_settings(&state, same_path)
            .await
            .expect("сохранение с тем же java_path");
        assert_eq!(
            saved.java_version,
            Some(17),
            "неизменный java_path сохраняет известную версию из stored-конфига, а не значение формы"
        );

        let new_path = ProjectConfig {
            project_name: "JavaVer".to_string(),
            mc_version: "1.20.1".to_string(),
            java_path: Some("/new/java".to_string()),
            ..ProjectConfig::default()
        };
        let saved = save_project_settings(&state, new_path)
            .await
            .expect("сохранение с новым java_path без версии");
        assert_eq!(
            saved.java_version, None,
            "смена java_path без пробы сбрасывает версию до безопасного значения"
        );
    }

    #[tokio::test]
    async fn settings_save_uses_probed_java_version_when_path_changes() {
        let (_guard, state) = seeded_global_state(
            "settings_java_version_probed",
            ProjectConfig {
                project_name: "JavaVer".to_string(),
                mc_version: "1.20.1".to_string(),
                java_path: Some("/old/java".to_string()),
                java_version: Some(17),
                ..ProjectConfig::default()
            },
        )
        .await;

        let new_path = ProjectConfig {
            project_name: "JavaVer".to_string(),
            mc_version: "1.20.1".to_string(),
            java_path: Some("/new/java".to_string()),
            java_version: Some(21),
            ..ProjectConfig::default()
        };
        let saved = save_project_settings(&state, new_path)
            .await
            .expect("сохранение с новым java_path и пробой");

        assert_eq!(
            saved.java_version,
            Some(21),
            "версия пробы выбранной JDK сохраняется вместе с новым путём"
        );

        let from_disk = load_config("JavaVer").await.expect("чтение конфига");
        assert_eq!(
            from_disk.java_version,
            Some(21),
            "проба персистится в конфиг проекта и переживает перезапуск"
        );
    }

    #[tokio::test]
    async fn settings_save_rejects_project_name_substitution() {
        let (guard, state) = seeded_global_state(
            "settings_name_substitution",
            ProjectConfig {
                project_name: "Alpha".to_string(),
                mc_version: "1.20.1".to_string(),
                max_memory: "-Xmx4G".to_string(),
                ..ProjectConfig::default()
            },
        )
        .await;

        let payload = ProjectConfig {
            project_name: "Beta".to_string(),
            mc_version: "1.20.1".to_string(),
            max_memory: "-Xmx8G".to_string(),
            ..ProjectConfig::default()
        };
        let error = save_project_settings(&state, payload)
            .await
            .expect_err("подмена имени проекта должна отклоняться");

        let typed = error
            .chain()
            .find_map(|cause| cause.downcast_ref::<LauncherError>());
        assert!(
            matches!(typed, Some(LauncherError::ProjectSettingsMismatch(..))),
            "ошибка должна быть типизированной: {error:?}"
        );

        let config_dir = guard.root().join("project").join("config");
        assert!(
            !config_dir.join("Beta.toml").exists(),
            "TOML чужого проекта не должен создаваться"
        );
        let stored = load_config("Alpha").await.expect("чтение конфига Alpha");
        assert_eq!(
            stored.max_memory, "-Xmx4G",
            "исходный конфиг не должен перезаписываться"
        );
        let active = state.lock().await.project_config.clone();
        assert_eq!(
            active.project_name, "Alpha",
            "активный проект не должен подменяться в памяти"
        );
    }

    #[tokio::test]
    async fn settings_save_preserves_server_fields_of_online_profile() {
        let (_guard, state) = seeded_global_state(
            "settings_server_fields",
            ProjectConfig {
                project_name: "Online".to_string(),
                mc_version: "1.20.1".to_string(),
                online: true,
                initialized: true,
                server_url: Some("https://real.example.com".to_string()),
                ..ProjectConfig::default()
            },
        )
        .await;

        let payload = ProjectConfig {
            project_name: "Online".to_string(),
            mc_version: "1.20.1".to_string(),
            online: false,
            initialized: false,
            server_url: Some("https://evil.example.com".to_string()),
            max_memory: "-Xmx8G".to_string(),
            ..ProjectConfig::default()
        };
        let saved = save_project_settings(&state, payload)
            .await
            .expect("сохранение настроек");

        assert_eq!(
            saved.max_memory, "-Xmx8G",
            "пользовательские настройки применяются"
        );
        assert!(saved.online, "online не должен перезаписываться входом");
        assert!(
            saved.initialized,
            "initialized не должен перезаписываться входом"
        );
        assert_eq!(
            saved.server_url.as_deref(),
            Some("https://real.example.com"),
            "server_url не должен перезаписываться входом"
        );

        let from_disk = load_config("Online").await.expect("чтение конфига с диска");
        assert!(from_disk.online);
        assert!(from_disk.initialized);
        assert_eq!(
            from_disk.server_url.as_deref(),
            Some("https://real.example.com")
        );
    }
}
