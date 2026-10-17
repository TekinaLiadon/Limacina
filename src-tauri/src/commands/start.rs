use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Context};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::commands::dto::create_mod_loader;
use crate::commands::game_options::{
    disable_narrator, parse_options_version, OPTIONS_FILE, OPTIONS_VERSION_KEY,
};
use crate::discord;
use crate::minecraft::autojoin::{auto_join_args, first_server_address};
use crate::minecraft::process::{spawn_game_process, GameProcess};
use crate::minecraft::structs::{new_launch_config, GameConfig, MinecraftLoader};
use crate::state::dto::{GlobalState, ModLoader, ProjectConfig};
use crate::utils::blocking;
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
    let _guard = crate::state::launch_state::try_acquire_launch_step()?;
    let username = {
        let state = state.lock().await;
        let session = state
            .session
            .as_ref()
            .ok_or_else(|| anyhow!(LauncherError::NoSession))?;
        session.username.clone()
    };
    crate::minecraft::process::ensure_session_free(&username)?;
    start_minecraft_inner(app, state).await
}

struct LaunchContext {
    username: String,
    uuid: String,
    access_token: String,
    project: String,
    mc_version: String,
    discord_enabled: bool,
}

async fn start_minecraft_inner(
    app: AppHandle,
    state: tauri::State<'_, Mutex<GlobalState>>,
) -> CommandResult<()> {
    let config_step = StepHandle::start("launch.config", "Подготовка конфигурации");
    let (ctx, mut project_config) = read_launch_context(&state, config_step.clone()).await?;
    project_config = repair_stale_java_path(&state, project_config).await;

    let authlib = offline::AuthlibLaunch::resolve(&project_config, &ctx.username, &ctx.uuid).await;
    if project_config.online {
        if let Err(e) = crate::commands::cpm_models::sync_player_models(&state).await {
            log_err!("Не удалось синхронизировать модели CPM: {}", e);
        }
    }

    let mut game_config = assemble_game_config(&project_config, &ctx, config_step.clone()).await?;
    apply_auto_join(&project_config, &mut game_config, config_step.clone()).await?;
    config_step.finish(false);

    if let Err(e) = prepare_options_file(&game_config.game_dir).await {
        log_err!("[start] Не удалось подготовить options.txt: {}", e);
    }

    let process_step = StepHandle::start("launch.process", "Запуск процесса игры");
    let process = step_try!(
        process_step,
        spawn_game_step(&app, game_config, authlib.server_url(), &ctx)
    );
    process_step.finish(false);
    let _ = app.emit("game-started", ctx.username.clone());

    authlib.stop_on_game_exit(process.exited_flag());

    wait_for_game_window(&process, &ctx.project).await?;
    notify_game_activity(&process, &ctx);
    Ok(())
}

async fn read_launch_context(
    state: &tauri::State<'_, Mutex<GlobalState>>,
    step: StepHandle,
) -> CommandResult<(LaunchContext, ProjectConfig)> {
    let (username, uuid, access_token, project, mc_version, project_config, discord_enabled) = {
        let state = state.lock().await;
        let session = step_try!(
            step,
            state
                .session
                .as_ref()
                .ok_or_else(|| anyhow!(LauncherError::NoSession))
        );

        let project = state.project_config.project_name.clone();
        step_try!(
            step,
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

    Ok((
        LaunchContext {
            username,
            uuid,
            access_token,
            project,
            mc_version,
            discord_enabled,
        },
        project_config,
    ))
}

fn spawn_game_step(
    app: &AppHandle,
    game_config: GameConfig,
    authlib_server_url: Option<&str>,
    ctx: &LaunchContext,
) -> anyhow::Result<GameProcess> {
    crate::tray::add_game_session(app, &ctx.username);
    let spawn_result = LauncherError::classify(
        spawn_game_process(
            app.clone(),
            game_config,
            authlib_server_url,
            ctx.username.clone(),
        )
        .with_context(|| format!("Не удалось запустить Minecraft (проект: {})", ctx.project)),
        LauncherError::GameProcess,
    );
    match spawn_result {
        Ok(process) => Ok(process),
        Err(e) => {
            crate::tray::remove_game_session(app, &ctx.username);
            Err(e)
        }
    }
}

async fn assemble_game_config(
    project_config: &ProjectConfig,
    ctx: &LaunchContext,
    step: StepHandle,
) -> CommandResult<GameConfig> {
    let config = step_try!(
        step,
        LauncherError::classify(
            new_launch_config(&ctx.username, &ctx.uuid, &ctx.access_token, project_config)
                .with_context(|| format!(
                    "Не удалось создать конфиг запуска (проект: {})",
                    ctx.project
                )),
            LauncherError::ManifestParse
        )
    );
    let vanilla_config = step_try!(
        step,
        LauncherError::classify(
            Vanilla
                .config(project_config, &config)
                .await
                .with_context(|| format!(
                    "Не удалось получить конфиг Vanilla (проект: {})",
                    ctx.project
                )),
            LauncherError::ManifestParse
        )
    );

    if matches!(project_config.mod_loader, ModLoader::Vanilla) {
        return Ok(vanilla_config);
    }
    let loader = step_try!(step, create_mod_loader(&project_config.mod_loader));
    let versions = step_try!(
        step,
        LauncherError::classify(
            loader
                .versions(project_config)
                .await
                .with_context(|| format!(
                    "Не удалось получить список версий загрузчика модов (проект: {})",
                    ctx.project
                )),
            LauncherError::ManifestParse
        )
    );
    let version = step_try!(
        step,
        LauncherError::classify(
            loader
                .version_current(project_config, &versions)
                .await
                .with_context(|| format!(
                    "Не удалось получить текущую версию загрузчика модов (проект: {})",
                    ctx.project
                )),
            LauncherError::ManifestParse
        )
    );
    Ok(step_try!(
        step,
        LauncherError::classify(
            loader
                .config(project_config, vanilla_config, &version)
                .await
                .with_context(|| format!(
                    "Не удалось собрать конфиг игры (проект: {})",
                    ctx.project
                )),
            LauncherError::LoaderSetup
        )
    ))
}

async fn apply_auto_join(
    project_config: &ProjectConfig,
    game_config: &mut GameConfig,
    step: StepHandle,
) -> CommandResult<()> {
    if !project_config.auto_join_server {
        return Ok(());
    }
    let game_dir = game_config.game_dir.clone();
    let address = step_try!(
        step,
        LauncherError::classify(
            blocking(
                "Не удалось прочитать servers.dat",
                move || { first_server_address(&game_dir) }
            )
            .await
            .and_then(|inner| inner)
            .with_context(|| format!(
                "Не удалось прочитать servers.dat (проект: {})",
                project_config.project_name
            )),
            LauncherError::DiskIo
        )
        .and_then(|address| {
            address.ok_or_else(|| {
                anyhow!(LauncherError::InvalidInput(format!(
                    "Автозаход включён, но в servers.dat нет серверов (проект: {})",
                    project_config.project_name
                )))
            })
        })
    );
    let join_args = auto_join_args(&address, &project_config.mc_version);
    if !join_args.is_empty() {
        log_info!("[start] Автозаход на сервер: {}", address);
        game_config.game_args.extend(join_args);
    }
    Ok(())
}

async fn wait_for_game_window(process: &GameProcess, project: &str) -> CommandResult<()> {
    let window_step = StepHandle::start("launch.window", "Ожидание окна игры");
    step_try!(
        window_step.clone(),
        LauncherError::classify(
            process
                .wait_for_window(GAME_WINDOW_TIMEOUT)
                .await
                .with_context(|| format!("Проект: {}", project)),
            LauncherError::GameProcess
        )
    );
    if !process.window_opened() {
        window_step.detail("Окно игры не обнаружено за 120 сек, оно может открыться позже");
    }
    window_step.finish(false);
    Ok(())
}

fn notify_game_activity(process: &GameProcess, ctx: &LaunchContext) {
    if process.has_exited() {
        return;
    }
    let exited = process.exited_flag();
    let mc_version = ctx.mc_version.clone();
    let project = ctx.project.clone();
    let discord_enabled = ctx.discord_enabled;
    tauri::async_runtime::spawn(async move {
        discord::set_game_activity(discord_enabled, &mc_version, &project, Some(exited)).await;
    });
}

enum ExitBehavior {
    MinimizeToTray,
    Terminate,
}

fn exit_behavior(minimize_to_tray: bool) -> ExitBehavior {
    if minimize_to_tray {
        ExitBehavior::MinimizeToTray
    } else {
        ExitBehavior::Terminate
    }
}

#[tauri::command]
pub async fn exit_launcher(app: AppHandle) -> CommandResult<()> {
    match exit_behavior(crate::tray::minimize_to_tray_enabled()) {
        ExitBehavior::MinimizeToTray => {
            log_info!("Закрытие лаунчера после запуска игры: сворачивание в трей");
            match app.get_webview_window("main") {
                Some(window) => {
                    if let Err(e) = window.close() {
                        log_err!("Не удалось спрятать окно лаунчера в трей: {}", e);
                    }
                }
                None => app.exit(0),
            }
        }
        ExitBehavior::Terminate => {
            log_info!("Закрытие лаунчера после запуска игры");
            app.exit(0);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_game_state() -> CommandResult<Vec<String>> {
    Ok(crate::minecraft::process::game_usernames())
}

#[tauri::command]
pub async fn get_launch_state() -> CommandResult<bool> {
    Ok(crate::state::launch_state::launch_in_progress())
}

#[tauri::command]
pub async fn kill_game_process() -> CommandResult<()> {
    blocking(
        "Не удалось завершить процесс игры",
        crate::minecraft::process::kill_game_process,
    )
    .await??;
    Ok(())
}

async fn repair_stale_java_path(
    state: &tauri::State<'_, Mutex<GlobalState>>,
    mut config: ProjectConfig,
) -> ProjectConfig {
    let Some(stored) = config.java_path.clone() else {
        return config;
    };
    let stored_path = PathBuf::from(&stored);
    if tokio::fs::try_exists(&stored_path).await.unwrap_or(false) {
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
    let repaired_path = repaired.to_string_lossy().into_owned();
    let broken_path = stored;
    if let Err(e) =
        crate::state::config::update_project_config(state, async |stored: &mut ProjectConfig| {
            if stored.java_path.as_deref() == Some(broken_path.as_str()) {
                stored.java_path = Some(repaired_path);
            }
            Ok(())
        })
        .await
    {
        log_err!("[start] Не удалось сохранить исправленный путь Java: {}", e);
    }
    config.java_path = Some(repaired.to_string_lossy().into_owned());
    config
}

async fn prepare_options_file(game_dir: &Path) -> anyhow::Result<()> {
    let path = game_dir.join(OPTIONS_FILE);
    let existing = match tokio::fs::read_to_string(&path).await {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => bail!("Не удалось прочитать {:?}: {}", path, e),
    };
    if parse_options_version(&existing).is_none() {
        log_err!(
            "[start] В {:?} нет ключа {}: игра заменит файл дефолтными настройками",
            path,
            OPTIONS_VERSION_KEY
        );
        return Ok(());
    }

    let patched = disable_narrator(&existing);
    if patched == existing {
        return Ok(());
    }
    write_atomic(&path, patched.as_bytes())
        .await
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

#[cfg(test)]
mod exit_launcher_tests {
    use super::{exit_behavior, ExitBehavior};

    #[test]
    fn exit_behavior_follows_minimize_to_tray_setting() {
        assert!(matches!(exit_behavior(true), ExitBehavior::MinimizeToTray));
        assert!(matches!(exit_behavior(false), ExitBehavior::Terminate));
    }
}

#[cfg(test)]
mod options_file_tests {
    use super::prepare_options_file;
    use crate::commands::game_options::OPTIONS_FILE;
    use crate::test_support::TempDir;
    use std::fs;

    fn write_options(dir: &TempDir, content: &str) {
        fs::write(dir.0.join(OPTIONS_FILE), content).expect("запись options.txt");
    }

    fn read_options(dir: &TempDir) -> String {
        fs::read_to_string(dir.0.join(OPTIONS_FILE)).expect("чтение options.txt")
    }

    #[tokio::test]
    async fn prepare_options_file_disables_narrator_and_welcome_screen() {
        let dir = TempDir::new("options_narrator_replace");
        write_options(&dir, "version:2586\nmusicVolume:0.5\nnarrator:2\nfov:70\n");

        prepare_options_file(&dir.0)
            .await
            .expect("подготовка options.txt");

        assert_eq!(
            read_options(&dir),
            "version:2586\nmusicVolume:0.5\nnarrator:0\nfov:70\nonboardAccessibility:false\n"
        );
    }

    #[tokio::test]
    async fn prepare_options_file_leaves_prepared_file_unchanged() {
        let dir = TempDir::new("options_narrator_already_off");
        let content = "version:2586\nnarrator:0\nonboardAccessibility:false\n";
        write_options(&dir, content);

        prepare_options_file(&dir.0)
            .await
            .expect("подготовка options.txt");

        assert_eq!(read_options(&dir), content);
    }

    #[tokio::test]
    async fn prepare_options_file_does_not_create_missing_file() {
        let dir = TempDir::new("options_missing");

        prepare_options_file(&dir.0)
            .await
            .expect("подготовка options.txt");

        assert!(
            !dir.0.join(OPTIONS_FILE).exists(),
            "файл options.txt создаёт сама игра"
        );
    }

    #[tokio::test]
    async fn prepare_options_file_keeps_file_without_version_untouched() {
        let dir = TempDir::new("options_without_version");
        write_options(&dir, "fov:0.5\nnarrator:2\n");

        prepare_options_file(&dir.0)
            .await
            .expect("подготовка options.txt");

        assert_eq!(
            read_options(&dir),
            "fov:0.5\nnarrator:2\n",
            "файл без ключа version игра заменяет дефолтным, патчить его нечего"
        );
    }
}

#[cfg(test)]
mod auto_join_tests {
    use super::apply_auto_join;
    use crate::minecraft::structs::GameConfig;
    use crate::state::dto::ProjectConfig;
    use crate::test_support::{write_servers_dat, ServersDatContainer, TempDir};
    use crate::utils::step_events::StepHandle;
    use std::path::Path;

    fn game_config(game_dir: &Path) -> GameConfig {
        GameConfig::new(
            game_dir.join("java"),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            "net.minecraft.client.main.Main".to_string(),
            game_dir.to_path_buf(),
        )
    }

    fn project_config(mc_version: &str, auto_join: bool) -> ProjectConfig {
        ProjectConfig {
            auto_join_server: auto_join,
            mc_version: mc_version.to_string(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn appends_quick_play_args_for_modern_version() {
        let dir = TempDir::new("autojoin_quickplay");
        write_servers_dat(&dir.0, "play.example.com:25565", ServersDatContainer::Raw);
        let mut game = game_config(&dir.0);

        apply_auto_join(
            &project_config("1.20.4", true),
            &mut game,
            StepHandle::start("test.autojoin", "Тест автозахода"),
        )
        .await
        .expect("автозаход должен примениться");

        assert!(game
            .game_args
            .contains(&"--quickPlayMultiplayer".to_string()));
        assert!(
            game.game_args
                .windows(2)
                .any(|pair| pair[0] == "--quickPlayMultiplayer"
                    && pair[1] == "play.example.com:25565")
        );
    }

    #[tokio::test]
    async fn appends_legacy_server_args_for_old_version() {
        let dir = TempDir::new("autojoin_legacy");
        write_servers_dat(&dir.0, "play.example.com:25565", ServersDatContainer::Raw);
        let mut game = game_config(&dir.0);

        apply_auto_join(
            &project_config("1.16.5", true),
            &mut game,
            StepHandle::start("test.autojoin", "Тест автозахода"),
        )
        .await
        .expect("автозаход должен примениться");

        assert!(game
            .game_args
            .windows(2)
            .any(|pair| pair[0] == "--server" && pair[1] == "play.example.com"));
        assert!(game
            .game_args
            .windows(2)
            .any(|pair| pair[0] == "--port" && pair[1] == "25565"));
    }

    #[tokio::test]
    async fn disabled_flag_leaves_args_untouched() {
        let dir = TempDir::new("autojoin_disabled");
        write_servers_dat(&dir.0, "play.example.com:25565", ServersDatContainer::Raw);
        let mut game = game_config(&dir.0);

        apply_auto_join(
            &project_config("1.20.4", false),
            &mut game,
            StepHandle::start("test.autojoin", "Тест автозахода"),
        )
        .await
        .expect("выключенный автозаход не должен давать ошибку");

        assert!(game.game_args.is_empty(), "аргументы не должны добавляться");
    }

    #[tokio::test]
    async fn missing_servers_dat_is_input_error() {
        let dir = TempDir::new("autojoin_missing");
        let mut game = game_config(&dir.0);

        let error = apply_auto_join(
            &project_config("1.20.4", true),
            &mut game,
            StepHandle::start("test.autojoin", "Тест автозахода"),
        )
        .await
        .expect_err("запуск без servers.dat должен дать ошибку");

        assert!(
            error.message.contains("в servers.dat нет серверов"),
            "ошибка должна называть причину: {}",
            error.message
        );
    }

    #[tokio::test]
    async fn garbage_servers_dat_keeps_manifest_parse_error() {
        let dir = TempDir::new("autojoin_garbage");
        std::fs::write(dir.0.join("servers.dat"), b"PK\x03\x04fake zip").expect("запись мусора");
        let mut game = game_config(&dir.0);

        let error = apply_auto_join(
            &project_config("1.20.4", true),
            &mut game,
            StepHandle::start("test.autojoin", "Тест автозахода"),
        )
        .await
        .expect_err("битый servers.dat должен дать ошибку");

        assert_eq!(error.code, "manifest_parse");
        assert!(
            error.message.contains("Не удалось обработать манифест"),
            "типизированная ошибка должна сохраниться: {}",
            error.message
        );
    }
}
