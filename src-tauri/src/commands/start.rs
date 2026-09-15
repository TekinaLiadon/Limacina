use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Context};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::discord;
use crate::minecraft::autojoin::{auto_join_args, first_server_address};
use crate::minecraft::process::spawn_game_process;
use crate::minecraft::structs::{new_launch_config, MinecraftLoader};
use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
use crate::utils::download_file::write_atomic;
use crate::utils::step_events::StepHandle;
use crate::{
    log_err, log_info, minecraft::vanilla::Vanilla, offline, step_try,
    utils::errors::LauncherError, utils::java::repair_java_path, utils::tauri_err::CommandResult,
};

const GAME_WINDOW_TIMEOUT: Duration = Duration::from_secs(120);

#[tauri::command]
pub async fn start_minecraft(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let result = start_minecraft_inner(app, state).await;
    crate::state::launch_state::set_launch_in_progress(false);
    result
}

async fn start_minecraft_inner(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let config_step = StepHandle::start("launch.config", "Подготовка конфигурации");

    let (username, uuid, access_token, project, mc_version, project_config, discord_enabled) = {
        let state = state.lock().await;
        let session = step_try!(
            config_step,
            state
                .session
                .as_ref()
                .ok_or_else(|| anyhow!(LauncherError::NoSession))
        );

        let project = state.project_config.project_name.clone();
        step_try!(
            config_step,
            if session.project_name != project {
                Err(anyhow!(LauncherError::SessionMismatch(
                    session.project_name.clone(),
                    project.clone()
                )))
            } else {
                Ok(())
            }
        );
        let mc_version = state.project_config.mc_version.clone();
        let mod_loader = state.project_config.mod_loader.clone();

        let discord_enabled = state
            .launcher_config
            .as_ref()
            .map(|c| c.discord_activity)
            .unwrap_or(true);

        log_info!(
            "[start] Запуск для проекта={}, версия={}, лоадер={:?}, пользователь={}, онлайн={}",
            project,
            mc_version,
            mod_loader,
            session.username,
            state.project_config.online
        );

        (
            session.username.clone(),
            session.uuid.clone(),
            session.access_token.clone(),
            project,
            mc_version,
            state.project_config.clone(),
            discord_enabled,
        )
    };

    let project_config = repair_stale_java_path(&state, project_config).await;

    let mut offline_skin_server: Option<offline::SkinServer> = None;
    let authlib_server_url = if project_config.online {
        project_config.resolved_server_url()
    } else {
        match offline::start_offline_skin_server(&project, &username, &uuid).await {
            Ok(Some(server)) => {
                let url = server.url().to_string();
                offline_skin_server = Some(server);
                Some(url)
            }
            Ok(None) => None,
            Err(e) => {
                log_err!(
                    "[start] Офлайн-скин недоступен, запуск без скина ({}): {}",
                    project,
                    e
                );
                None
            }
        }
    };

    if project_config.online {
        if let Err(e) = crate::commands::cpm_models::sync_player_models(&state).await {
            log_err!("Не удалось синхронизировать модели CPM: {}", e);
        }
    }

    let config = step_try!(
        config_step,
        LauncherError::classify(
            new_launch_config(&username, &uuid, &access_token, &project_config)
                .await
                .with_context(|| format!(
                    "Не удалось создать конфиг запуска (проект: {})",
                    project
                )),
            LauncherError::ManifestParse
        )
    );
    let vanilla_config = step_try!(
        config_step,
        LauncherError::classify(
            Vanilla
                .config(&project_config, &config)
                .await
                .with_context(|| format!(
                    "Не удалось получить Vanilla конфиг (проект: {})",
                    project
                )),
            LauncherError::ManifestParse
        )
    );

    let mut game_config = if matches!(project_config.mod_loader, ModLoader::Vanilla) {
        vanilla_config
    } else {
        let loader = step_try!(config_step, create_mod_loader(&project_config.mod_loader));
        let versions = step_try!(
            config_step,
            LauncherError::classify(
                loader
                    .versions(&project_config)
                    .await
                    .with_context(|| format!(
                        "Не удалось получить список версий лоадера (проект: {})",
                        project
                    )),
                LauncherError::ManifestParse
            )
        );
        let version = step_try!(
            config_step,
            LauncherError::classify(
                loader
                    .version_current(&project_config, &versions)
                    .await
                    .with_context(|| format!(
                        "Не удалось получить текущую версию лоадера (проект: {})",
                        project
                    )),
                LauncherError::ManifestParse
            )
        );
        step_try!(
            config_step,
            LauncherError::classify(
                loader
                    .config(&project_config, vanilla_config, &version)
                    .await
                    .with_context(|| format!(
                        "Не удалось собрать конфиг игры (проект: {})",
                        project
                    )),
                LauncherError::LoaderSetup
            )
        )
    };

    if project_config.auto_join_server {
        let address = step_try!(
            config_step,
            LauncherError::classify(
                first_server_address(&game_config.game_dir).with_context(|| format!(
                    "Не удалось прочитать servers.dat (проект: {})",
                    project
                )),
                LauncherError::DiskIo
            )
            .and_then(|address| {
                address.ok_or_else(|| {
                    anyhow!(LauncherError::InvalidInput(format!(
                        "Автозаход включён, но в servers.dat нет серверов (проект: {})",
                        project
                    )))
                })
            })
        );
        let join_args = auto_join_args(&address, &project_config.mc_version);
        if !join_args.is_empty() {
            log_info!("[start] Автозаход на сервер: {}", address);
            game_config.game_args.extend(join_args);
        }
    }

    config_step.finish(false);

    if let Err(e) = force_narrator_off(&game_config.game_dir).await {
        log_err!("[start] Не удалось выключить нарратор: {}", e);
    }

    let process_step = StepHandle::start("launch.process", "Запуск процесса игры");
    let spawn_result = LauncherError::classify(
        spawn_game_process(app.clone(), game_config, authlib_server_url.as_deref())
            .with_context(|| format!("Не удалось запустить Minecraft (проект: {})", project)),
        LauncherError::GameProcess,
    );
    let process = match spawn_result {
        Ok(process) => process,
        Err(e) => {
            if let Some(server) = offline_skin_server.take() {
                server.stop();
            }
            process_step.fail(e.to_string());
            return Err(e.into());
        }
    };
    process_step.finish(false);
    crate::tray::set_game_state(&app, true, &username);
    let _ = app.emit("game-started", username.clone());

    if let Some(server) = offline_skin_server.take() {
        let exited = process.exited_flag();
        tauri::async_runtime::spawn_blocking(move || {
            loop {
                if exited.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            server.stop();
        });
    }

    let window_step = StepHandle::start("launch.window", "Ожидание окна игры");
    step_try!(
        window_step,
        LauncherError::classify(
            process
                .wait_for_window(GAME_WINDOW_TIMEOUT)
                .await
                .with_context(|| format!("Проект: {}", project)),
            LauncherError::GameProcess
        )
    );
    if !process.window_opened() {
        window_step.detail("Окно игры не обнаружено за 120 сек — оно может открыться позже");
    }
    window_step.finish(false);

    if !process.has_exited() {
        let exited = process.exited_flag();
        tauri::async_runtime::spawn_blocking(move || {
            discord::set_game_activity(discord_enabled, &mc_version, &project, Some(exited));
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn exit_launcher(app: AppHandle) -> CommandResult<()> {
    log_info!("Закрытие лаунчера после запуска игры");
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn get_game_state() -> CommandResult<Option<String>> {
    Ok(crate::tray::game_username())
}

#[tauri::command]
pub async fn get_launch_state() -> CommandResult<bool> {
    Ok(crate::state::launch_state::launch_in_progress())
}

async fn repair_stale_java_path(
    state: &tauri::State<'_, Mutex<GlobalState>>,
    mut config: ProjectConfig,
) -> ProjectConfig {
    let Some(stored) = config.java_path.clone() else {
        return config;
    };
    let stored_path = PathBuf::from(stored);
    if stored_path.exists() {
        return config;
    }
    let Some(repaired) = repair_java_path(&stored_path) else {
        return config;
    };
    log_info!(
        "[start] Сохранённый путь Java {:?} не найден, одноразово заменён на {:?}",
        stored_path,
        repaired
    );
    config.java_path = Some(repaired.to_string_lossy().into_owned());
    if let Err(e) = config.save_config().await {
        log_err!("[start] Не удалось сохранить исправленный путь Java: {}", e);
        return config;
    }
    state.lock().await.project_config = config.clone();
    config
}

async fn force_narrator_off(game_dir: &Path) -> anyhow::Result<()> {
    let path = game_dir.join("options.txt");
    let existing = match tokio::fs::read_to_string(&path).await {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => bail!("Не удалось прочитать {:?}: {}", path, e),
    };

    let mut found = false;
    let mut lines: Vec<String> = existing
        .lines()
        .map(|line| {
            if line.trim_start().starts_with("narrator:") {
                found = true;
                "narrator:0".to_string()
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        lines.push("narrator:0".to_string());
    }

    let mut content = lines.join("\n");
    content.push('\n');
    write_atomic(&path, content.as_bytes())
        .await
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

#[cfg(test)]
mod narrator_tests {
    use super::force_narrator_off;
    use std::fs;
    use std::path::PathBuf;

    struct TempDirGuard(PathBuf);

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_root(label: &str) -> (TempDirGuard, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("limacina_narrator_{label}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("создание тестовой папки");
        (TempDirGuard(root.clone()), root)
    }

    #[tokio::test]
    async fn force_narrator_off_replaces_existing_line() {
        let (_guard, root) = temp_root("replace");
        fs::write(
            root.join("options.txt"),
            "musicVolume:0.5\nnarrator:2\nfov:70\n",
        )
        .expect("запись options.txt");

        force_narrator_off(&root).await.expect("патч options.txt");

        let patched = fs::read_to_string(root.join("options.txt")).expect("чтение options.txt");
        let lines: Vec<&str> = patched.lines().collect();
        assert_eq!(lines, vec!["musicVolume:0.5", "narrator:0", "fov:70"]);
    }

    #[tokio::test]
    async fn force_narrator_off_appends_missing_line() {
        let (_guard, root) = temp_root("append");
        fs::write(root.join("options.txt"), "musicVolume:0.5\nfov:70\n")
            .expect("запись options.txt");

        force_narrator_off(&root).await.expect("патч options.txt");

        let patched = fs::read_to_string(root.join("options.txt")).expect("чтение options.txt");
        let lines: Vec<&str> = patched.lines().collect();
        assert_eq!(lines, vec!["musicVolume:0.5", "fov:70", "narrator:0"]);
    }

    #[tokio::test]
    async fn force_narrator_off_creates_missing_file() {
        let (_guard, root) = temp_root("create");

        force_narrator_off(&root).await.expect("патч options.txt");

        let patched = fs::read_to_string(root.join("options.txt")).expect("чтение options.txt");
        assert_eq!(patched, "narrator:0\n");
    }
}
