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

use crate::utils::env_info::available_cpu_cores;
use crate::utils::errors::LauncherError;
use crate::utils::get_classpath_separator;
use crate::utils::hex;
use crate::utils::logger_utils::send_game_output;
use crate::{log_err, log_info, minecraft::structs::GameConfig};
use sha1::{Digest, Sha1};

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

const CDS_MIN_JAVA_MAJOR: u32 = 19;
const ACTIVE_PROCESSOR_COUNT_MIN_JAVA_MAJOR: u32 = 10;
const CDS_CACHE_DIR: &str = "cache";
const CDS_ARCHIVE_PREFIX: &str = "app-";
const CDS_ARCHIVE_SUFFIX: &str = ".jsa";
const AUTO_CREATE_SHARED_ARCHIVE_FLAG: &str = "-XX:+AutoCreateSharedArchive";
const UNLOCK_DIAGNOSTIC_VM_OPTIONS_FLAG: &str = "-XX:+UnlockDiagnosticVMOptions";
const ALLOW_ARCHIVING_WITH_JAVA_AGENT_FLAG: &str = "-XX:+AllowArchivingWithJavaAgent";

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

const EXTRA_JDK_VALUE_OPTIONS: &[&str] = &["--sun-misc-unsafe-memory-access"];

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
    if let Some((option, value)) = arg.split_once('=') {
        if EXTRA_JDK_VALUE_OPTIONS.contains(&option) {
            return !value.is_empty();
        }
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
            "В JVM-аргументах проекта указан запрещённый параметр \"{arg}\": разрешены только параметры памяти, GC-тюнинга, системные свойства из списка, модульные и экстра-опции JDK. Удалите его в настройках проекта"
        ))
        .into());
    }
    Ok(())
}

fn cds_archive_path(
    java_major: Option<u32>,
    game_dir: &Path,
    classpath: &[String],
    username: &str,
) -> Option<PathBuf> {
    let major = java_major?;
    if major < CDS_MIN_JAVA_MAJOR {
        return None;
    }
    let cache_dir = game_dir.join(CDS_CACHE_DIR);
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        log_err!(
            "Не удалось создать каталог кэша {:?} для CDS-архива: {}",
            cache_dir,
            e
        );
        return None;
    }
    let generation_dir = cache_dir.join(cds_classpath_tag(classpath));
    if let Err(e) = std::fs::create_dir_all(&generation_dir) {
        log_err!(
            "Не удалось создать каталог поколения CDS-кэша {:?}: {}",
            generation_dir,
            e
        );
        return None;
    }
    cds_remove_stale_generations(&cache_dir, &generation_dir);
    Some(generation_dir.join(format!(
        "{CDS_ARCHIVE_PREFIX}{}{CDS_ARCHIVE_SUFFIX}",
        cds_account_tag(username)
    )))
}

fn cds_classpath_tag(classpath: &[String]) -> String {
    let mut hasher = Sha1::new();
    for entry in classpath {
        let attrs = match std::fs::metadata(entry) {
            Ok(meta) => {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0);
                format!("{entry}|{}|{mtime}\n", meta.len())
            }
            Err(_) => format!("{entry}|missing\n"),
        };
        hasher.update(attrs.as_bytes());
    }
    hex::to_hex(&hasher.finalize()[..4])
}

fn cds_account_tag(username: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(username.as_bytes());
    hex::to_hex(&hasher.finalize()[..4])
}

fn cds_remove_stale_generations(cache_dir: &Path, current: &Path) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == current || !path.is_dir() {
            continue;
        }
        if let Err(e) = std::fs::remove_dir_all(&path) {
            log_err!(
                "Не удалось удалить устаревшее поколение CDS-кэша {:?}: {}",
                path,
                e
            );
        }
    }
}

fn active_processor_count_flag(cpu_cores: Option<u16>, java_major: Option<u32>) -> Option<String> {
    let cores = cpu_cores?;
    if cores == 0 {
        log_info!("Ядра CPU: некорректное значение 0 в конфиге, флаг -XX:ActiveProcessorCount не ставится");
        return None;
    }
    let Some(major) = java_major else {
        log_info!("Ядра CPU: версия Java неизвестна, флаг -XX:ActiveProcessorCount не ставится");
        return None;
    };
    if major < ACTIVE_PROCESSOR_COUNT_MIN_JAVA_MAJOR {
        log_info!(
            "Ядра CPU: Java {major} не поддерживает -XX:ActiveProcessorCount (нужна Java 10+), флаг не ставится"
        );
        return None;
    }
    let available = available_cpu_cores().ok()?;
    let clamped = cores.min(available);
    if clamped != cores {
        log_info!("Ядра CPU: запрошено {cores}, доступно {available}, флаг ограничен до {clamped}");
    }
    Some(format!("-XX:ActiveProcessorCount={clamped}"))
}

fn finalize_jvm_args(
    jvm_args: Vec<String>,
    authlib_agent: Option<String>,
    disable_attach: bool,
    cds_archive: Option<&Path>,
    cpu_flag: Option<String>,
) -> Result<Vec<String>> {
    validate_jvm_args(&jvm_args)?;
    let mut args = jvm_args;
    let has_agent = authlib_agent.is_some();
    if let Some(flag) = cpu_flag {
        args.insert(0, flag);
    }
    if let Some(agent) = authlib_agent {
        args.insert(0, agent);
    }
    if let Some(archive) = cds_archive {
        args.push(format!(
            "-XX:SharedArchiveFile={}",
            archive.to_string_lossy()
        ));
        args.push(AUTO_CREATE_SHARED_ARCHIVE_FLAG.to_string());
        if has_agent {
            args.push(UNLOCK_DIAGNOSTIC_VM_OPTIONS_FLAG.to_string());
            args.push(ALLOW_ARCHIVING_WITH_JAVA_AGENT_FLAG.to_string());
        }
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
#[serde(rename_all = "camelCase")]
pub struct GameExitPayload {
    pub success: bool,
    pub code: Option<i32>,
    pub reason: Option<String>,
    pub username: String,
    pub killed_by_launcher: bool,
}

type SharedGameChild = Arc<StdMutex<std::process::Child>>;
type LauncherTerminated = Arc<AtomicBool>;

struct RegisteredGame {
    child: SharedGameChild,
    username: String,
    project: String,
    launcher_terminated: LauncherTerminated,
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

pub fn project_game_username(project: &str) -> Option<String> {
    GAME_SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|game| game.project == project)
        .map(|game| game.username.clone())
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
    project: &str,
) -> std::result::Result<(SharedGameChild, LauncherTerminated), std::process::Child> {
    let mut registry = GAME_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    if registry.iter().any(|game| game.username == username) {
        return Err(child);
    }
    let shared = Arc::new(StdMutex::new(child));
    let launcher_terminated = Arc::new(AtomicBool::new(false));
    registry.push(RegisteredGame {
        child: Arc::clone(&shared),
        username: username.to_string(),
        project: project.to_string(),
        launcher_terminated: Arc::clone(&launcher_terminated),
    });
    Ok((shared, launcher_terminated))
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

#[cfg(test)]
fn spawn_dummy_process() -> std::process::Child {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "ping", "-n", "120", "127.0.0.1"]);
        command
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new("sleep");
        command.arg("120");
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("запуск тестового процесса-заглушки")
}

#[cfg(test)]
pub(crate) struct TestGameSessionGuard {
    child: SharedGameChild,
}

#[cfg(test)]
impl TestGameSessionGuard {
    pub(crate) fn acquire(project: &str, username: &str) -> Self {
        let child = spawn_dummy_process();
        let (shared, _) = match register_game_session(child, username, project) {
            Ok(session) => session,
            Err(mut orphan) => {
                kill_and_reap(&mut orphan);
                panic!("регистрация тестовой сессии {username} не удалась");
            }
        };
        Self { child: shared }
    }
}

#[cfg(test)]
pub(crate) fn lock_game_registry_tests() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
impl Drop for TestGameSessionGuard {
    fn drop(&mut self) {
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        kill_and_reap(&mut child);
        remove_game_session(&self.child);
    }
}

fn terminate_session_child(
    child: &SharedGameChild,
    launcher_terminated: &LauncherTerminated,
) -> Option<String> {
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
            launcher_terminated.store(true, AtomicOrdering::Relaxed);
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
    let sessions = GAME_SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|game| {
            (
                Arc::clone(&game.child),
                Arc::clone(&game.launcher_terminated),
            )
        })
        .collect::<Vec<_>>();
    if sessions.is_empty() {
        return Err(LauncherError::InvalidInput("Игра не запущена".to_string()).into());
    }
    let mut failures: Vec<String> = Vec::new();
    for (child, launcher_terminated) in &sessions {
        if let Some(failure) = terminate_session_child(child, launcher_terminated) {
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
    project: String,
    java_major: Option<u32>,
    cpu_cores: Option<u16>,
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
    let jvm_args = finalize_jvm_args(
        jvm_args,
        authlib_agent,
        !cfg!(debug_assertions),
        cds_archive_path(java_major, &config.game_dir, &config.classpath, &username).as_deref(),
        active_processor_count_flag(cpu_cores, java_major),
    )?;

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
    let (shared_child, launcher_terminated) =
        match register_game_session(child, &username, &project) {
            Ok(session) => session,
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
                    killed_by_launcher: launcher_terminated.load(AtomicOrdering::Relaxed),
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
                        killed_by_launcher: launcher_terminated.load(AtomicOrdering::Relaxed),
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
                killed_by_launcher: false,
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
    fn allows_new_schema_manifest_unsafe_memory_access_arg() {
        let args: Vec<String> = [
            "--sun-misc-unsafe-memory-access=allow",
            "--enable-native-access=ALL-UNNAMED",
            "-Djava.library.path=/game/natives",
            "-Djna.tmpdir=/game/natives",
            "-Dorg.lwjgl.system.SharedLibraryExtractPath=/game/natives",
            "-Dio.netty.native.workdir=/game",
            "-Dminecraft.launcher.brand=Limacina",
            "-Dminecraft.launcher.version=0.6.4",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect();

        validate_jvm_args(&args).expect("аргументы манифеста MC 26.x не должны запрещаться");
    }

    #[test]
    fn blocks_unsafe_memory_access_option_without_value() {
        let message = validation_error(&["--sun-misc-unsafe-memory-access"]);

        assert!(
            message.contains("--sun-misc-unsafe-memory-access"),
            "ошибка должна называть аргумент: {message}"
        );
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

        let error = finalize_jvm_args(server_args, None, true, None, None)
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
        finalize_jvm_args(safe_args, None, true, None, None)
            .expect("безопасный серверный конфиг запускается");
    }

    #[test]
    fn launcher_authlib_agent_passes_after_validation() {
        let agent = "-javaagent:/game/authlib-injector.jar=https://server.example".to_string();

        let args = finalize_jvm_args(
            vec!["-Xmx4G".to_string()],
            Some(agent.clone()),
            false,
            None,
            None,
        )
        .expect("агент лаунчера не должен блокироваться");

        assert_eq!(args[0], agent);
        assert_eq!(args[1], "-Xmx4G");
    }

    #[test]
    fn forbidden_user_arg_aborts_even_with_authlib() {
        let agent = "-javaagent:/game/authlib-injector.jar=https://server.example".to_string();

        let error = finalize_jvm_args(vec!["-Xdebug".to_string()], Some(agent), true, None, None)
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
            None,
            None,
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
        let args = finalize_jvm_args(vec!["-Xmx4G".to_string()], None, false, None, None)
            .expect("аргументы должны собраться без ошибок");

        assert_eq!(args, vec!["-Xmx4G".to_string()]);
    }
}

#[cfg(test)]
mod cds_args_tests {
    use super::{cds_archive_path, finalize_jvm_args, DISABLE_ATTACH_FLAG};
    use crate::test_support::TempDir;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime};

    fn authlib_agent() -> String {
        "-javaagent:/game/authlib-injector.jar=https://server.example".to_string()
    }

    fn jar_entry(dir: &Path, name: &str, content: &str) -> String {
        let path = dir.join(name);
        std::fs::write(&path, content).expect("запись jar-заглушки");
        path.to_string_lossy().into_owned()
    }

    fn cds_archive_fixture(label: &str) -> (TempDir, PathBuf) {
        let dir = TempDir::new(label);
        let classpath = vec![jar_entry(&dir.0, "a.jar", "one")];
        let archive = cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("путь архива");
        (dir, archive)
    }

    fn touch_mtime(jar: &str) {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(jar)
            .expect("открытие jar-заглушки");
        file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_234_567_890))
            .expect("смена mtime jar-заглушки");
    }

    #[test]
    fn cds_archive_path_requires_java_major_19_or_newer() {
        let dir = TempDir::new("cds_old_java");
        let classpath = vec![jar_entry(&dir.0, "a.jar", "one")];

        assert_eq!(cds_archive_path(Some(8), &dir.0, &classpath, "Steve"), None);
        assert_eq!(
            cds_archive_path(Some(18), &dir.0, &classpath, "Steve"),
            None
        );
        assert_eq!(
            cds_archive_path(None, &dir.0, &classpath, "Steve"),
            None,
            "неизвестная мажорная версия Java — CDS-флаги не добавляются"
        );
    }

    #[test]
    fn cds_archive_path_points_to_project_cache_and_creates_it() {
        let dir = TempDir::new("cds_archive_path");
        let classpath = vec![jar_entry(&dir.0, "a.jar", "one")];

        let archive = cds_archive_path(Some(19), &dir.0, &classpath, "Steve")
            .expect("для Java 19+ путь архива задаётся");

        let name = archive
            .file_name()
            .and_then(|name| name.to_str())
            .expect("имя файла архива");
        assert!(
            name.starts_with("app-") && name.ends_with(".jsa"),
            "имя архива строится из сигнатуры classpath и аккаунта: {name}"
        );
        assert!(
            dir.0.join("cache").is_dir(),
            "каталог cache создаётся до дампа архива"
        );

        let again =
            cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("повторный запуск");
        assert_eq!(again, archive, "путь стабилен между запусками");
    }

    #[test]
    fn cds_archive_name_follows_classpath_content_and_mtime() {
        let dir = TempDir::new("cds_classpath_sig");
        let jar = jar_entry(&dir.0, "a.jar", "one");
        let classpath = vec![jar.clone()];

        let first = cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("путь архива");

        std::fs::write(&jar, "replaced content").expect("обновление jar-заглушки");
        let second = cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("путь архива");
        assert_ne!(
            second, first,
            "обновлённое содержимое jar должно менять имя архива: JVM не перегенерирует несовпадающий архив сама"
        );

        touch_mtime(&jar);
        let third = cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("путь архива");
        assert_ne!(third, second, "смена mtime jar должна менять имя архива");
    }

    #[test]
    fn cds_archive_name_differs_per_account_without_deleting_others() {
        let dir = TempDir::new("cds_accounts");
        let classpath = vec![jar_entry(&dir.0, "a.jar", "one")];

        let steve = cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("путь архива");
        std::fs::write(&steve, b"steve").expect("запись архива Steve");
        let alex = cds_archive_path(Some(21), &dir.0, &classpath, "Alex").expect("путь архива");

        assert_ne!(
            steve, alex,
            "параллельные сессии разных аккаунтов должны дамить в разные файлы"
        );
        assert!(
            steve.exists(),
            "архив другого аккаунта с той же сигнатурой classpath сохраняется"
        );

        let nick = cds_archive_path(Some(21), &dir.0, &classpath, "И вaн/../..\\x")
            .expect("ник превращается в хеш, безопасный для имени файла");
        assert_ne!(nick, steve);
    }

    #[test]
    fn cds_archive_path_removes_stale_generations() {
        let dir = TempDir::new("cds_stale_cleanup");
        let classpath = vec![jar_entry(&dir.0, "a.jar", "one")];
        let cache = dir.0.join("cache");
        let stale_classpath = cache.join("00000000");
        let stale_old_classpath = cache.join("ffffffff");
        std::fs::create_dir_all(&stale_classpath).expect("создание устаревшего поколения");
        std::fs::write(stale_classpath.join("app-12345678.jsa"), b"stale").expect("запись архива");
        std::fs::create_dir_all(&stale_old_classpath).expect("создание второго поколения");
        std::fs::write(cache.join("keep.txt"), b"not-a-generation").expect("посторонний файл");

        let current = cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("путь архива");
        std::fs::write(&current, b"current").expect("запись текущего архива");

        cds_archive_path(Some(21), &dir.0, &classpath, "Steve").expect("повторный запуск");

        assert!(
            !stale_classpath.exists(),
            "поколение прежней сигнатуры classpath удаляется: JVM не перегенерирует несовпадающий архив сама"
        );
        assert!(
            !stale_old_classpath.exists(),
            "второе устаревшее поколение также удаляется"
        );
        assert!(
            cache.join("keep.txt").exists(),
            "файлы в корне кэша не трогаются"
        );
        assert!(current.exists(), "актуальный архив не удаляется");
    }

    #[test]
    fn cds_flags_name_archive_and_autocreate_without_agent() {
        let (_dir, archive) = cds_archive_fixture("cds_flags_no_agent");

        let args = finalize_jvm_args(
            vec!["-Xmx4G".to_string()],
            None,
            false,
            Some(archive.as_path()),
            None,
        )
        .expect("аргументы собираются");

        assert_eq!(
            args,
            vec![
                "-Xmx4G".to_string(),
                format!("-XX:SharedArchiveFile={}", archive.to_string_lossy()),
                "-XX:+AutoCreateSharedArchive".to_string(),
            ],
            "без агента диагностические флаги не добавляются"
        );
    }

    #[test]
    fn cds_flags_with_agent_unlock_diagnostic_and_allow_archiving() {
        let (_dir, archive) = cds_archive_fixture("cds_flags_agent");
        let agent = authlib_agent();

        let args = finalize_jvm_args(
            vec!["-Xmx4G".to_string()],
            Some(agent.clone()),
            false,
            Some(archive.as_path()),
            None,
        )
        .expect("аргументы собираются");

        assert_eq!(args[0], agent, "агент остаётся первым jvm-аргументом");
        let shared = args
            .iter()
            .position(|arg| arg.starts_with("-XX:SharedArchiveFile="))
            .expect("SharedArchiveFile добавлен");
        let auto = args
            .iter()
            .position(|arg| arg == "-XX:+AutoCreateSharedArchive")
            .expect("AutoCreateSharedArchive добавлен");
        let unlock = args
            .iter()
            .position(|arg| arg == "-XX:+UnlockDiagnosticVMOptions")
            .expect("UnlockDiagnosticVMOptions добавлен");
        let allow = args
            .iter()
            .position(|arg| arg == "-XX:+AllowArchivingWithJavaAgent")
            .expect("AllowArchivingWithJavaAgent добавлен");
        assert!(
            shared < auto && auto < unlock && unlock < allow,
            "unlock должен предшествовать диагностическому флагу, иначе JVM не стартует: {args:?}"
        );
    }

    #[test]
    fn cds_flags_absent_without_archive() {
        let args = finalize_jvm_args(vec!["-Xmx4G".to_string()], None, false, None, None)
            .expect("аргументы собираются");

        assert_eq!(args, vec!["-Xmx4G".to_string()]);
    }

    #[test]
    fn disable_attach_stays_last_with_cds_flags() {
        let (_dir, archive) = cds_archive_fixture("cds_flags_attach");

        let args = finalize_jvm_args(
            vec!["-Xmx4G".to_string()],
            Some(authlib_agent()),
            true,
            Some(archive.as_path()),
            None,
        )
        .expect("аргументы собираются");

        assert_eq!(
            args.last().map(String::as_str),
            Some(DISABLE_ATTACH_FLAG),
            "disable-attach остаётся последним jvm-аргументом: {args:?}"
        );
    }

    #[test]
    fn forbidden_user_arg_still_aborts_with_cds_flags() {
        let (_dir, archive) = cds_archive_fixture("cds_flags_guard");

        let error = finalize_jvm_args(
            vec!["-Xmx4G".to_string(), "-javaagent:evil.jar".to_string()],
            None,
            false,
            Some(archive.as_path()),
            None,
        )
        .expect_err("запрещённый пользовательский аргумент отклоняется и с CDS-флагами");

        assert!(
            error.to_string().contains("-javaagent:evil.jar"),
            "ошибка должна называть аргумент пользователя: {error}"
        );
    }
}

#[cfg(test)]
mod cpu_cores_flag_tests {
    use super::{
        active_processor_count_flag, finalize_jvm_args, ACTIVE_PROCESSOR_COUNT_MIN_JAVA_MAJOR,
    };
    use crate::utils::env_info::available_cpu_cores;

    #[test]
    fn auto_cores_and_unknown_java_add_no_flag() {
        assert_eq!(active_processor_count_flag(None, Some(21)), None);
        assert_eq!(
            active_processor_count_flag(None, None),
            None,
            "«Авто» — флаг не ставится при любой версии Java"
        );
        assert_eq!(
            active_processor_count_flag(Some(4), None),
            None,
            "неизвестная мажорная версия Java — флаг не ставится"
        );
    }

    #[test]
    fn java_before_10_does_not_get_the_flag() {
        assert_eq!(
            active_processor_count_flag(Some(4), Some(8)),
            None,
            "Java 8 может быть старше 8u191 — флаг не ставится"
        );
        assert_eq!(active_processor_count_flag(Some(4), Some(9)), None);
        assert_eq!(
            active_processor_count_flag(Some(4), Some(ACTIVE_PROCESSOR_COUNT_MIN_JAVA_MAJOR)),
            Some("-XX:ActiveProcessorCount=4".to_string())
        );
    }

    #[test]
    fn zero_cores_falls_back_to_auto() {
        assert_eq!(
            active_processor_count_flag(Some(0), Some(21)),
            None,
            "некорректный 0 не превращается в -XX:ActiveProcessorCount=1"
        );
    }

    #[test]
    fn cores_above_available_are_clamped() {
        let available = available_cpu_cores().expect("число ядер хоста");
        let requested = available.saturating_add(1);

        let flag = active_processor_count_flag(Some(requested), Some(21))
            .expect("значение выше доступного клампится, а не отбрасывается");

        assert_eq!(flag, format!("-XX:ActiveProcessorCount={available}"));
    }

    #[test]
    fn cpu_flag_is_added_exactly_once_before_user_args() {
        let args = finalize_jvm_args(
            vec![
                "-Xmx4G".to_string(),
                "-XX:ActiveProcessorCount=2".to_string(),
            ],
            None,
            false,
            None,
            Some("-XX:ActiveProcessorCount=4".to_string()),
        )
        .expect("аргументы собираются");

        let count = args
            .iter()
            .filter(|arg| *arg == "-XX:ActiveProcessorCount=4")
            .count();
        assert_eq!(
            count, 1,
            "лаунчерский флаг добавляется ровно один раз: {args:?}"
        );
        let launcher_flag = args
            .iter()
            .position(|arg| arg == "-XX:ActiveProcessorCount=4")
            .expect("лаунчерский флаг добавлен");
        let user_flag = args
            .iter()
            .position(|arg| arg == "-XX:ActiveProcessorCount=2")
            .expect("пользовательский аргумент сохранён");
        assert!(
            launcher_flag < user_flag,
            "лаунчерский флаг стоит до пользовательского, последний побеждает в JVM: {args:?}"
        );
    }

    #[test]
    fn cpu_flag_stays_after_authlib_agent() {
        let agent = "-javaagent:/game/authlib-injector.jar=https://server.example".to_string();

        let args = finalize_jvm_args(
            vec!["-Xmx4G".to_string()],
            Some(agent.clone()),
            false,
            None,
            Some("-XX:ActiveProcessorCount=4".to_string()),
        )
        .expect("аргументы собираются");

        assert_eq!(args[0], agent, "агент остаётся первым jvm-аргументом");
        assert_eq!(args[1], "-XX:ActiveProcessorCount=4");
        assert_eq!(args[2], "-Xmx4G");
    }

    #[test]
    fn cpu_flag_absent_when_none() {
        let args = finalize_jvm_args(vec!["-Xmx4G".to_string()], None, false, None, None)
            .expect("аргументы собираются");

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
            None,
            None,
        )
        .expect("валидные аргументы");
        assert_eq!(
            args,
            vec![
                "-javaagent:authlib-injector.jar=https://server".to_string(),
                "-Xmx1G".to_string()
            ]
        );

        let args = finalize_jvm_args(vec!["-Xmx1G".to_string()], None, true, None, None)
            .expect("валидные аргументы");
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
            None,
            None,
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
        kill_game_process, lock_game_registry_tests, mark_game_finalized, register_game_session,
        remove_game_session, GameExitPayload, GAME_SESSIONS,
    };
    use crate::utils::errors::LauncherError;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;

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
    fn exit_payload_reports_launcher_termination_explicitly() {
        let terminated = serde_json::to_value(GameExitPayload {
            success: false,
            code: Some(1),
            reason: None,
            username: "Steve".to_string(),
            killed_by_launcher: true,
        })
        .expect("payload сериализуется");
        assert_eq!(terminated["success"], false);
        assert_eq!(terminated["code"], 1);
        assert_eq!(
            terminated["killedByLauncher"], true,
            "признак завершения из лаунчера должен доходить до фронтенда явно"
        );

        let crashed = serde_json::to_value(GameExitPayload {
            success: false,
            code: Some(-1),
            reason: Some("Причина".to_string()),
            username: "Alex".to_string(),
            killed_by_launcher: false,
        })
        .expect("payload сериализуется");
        assert_eq!(crashed["success"], false);
        assert_eq!(crashed["reason"], "Причина");
        assert_eq!(
            crashed["killedByLauncher"], false,
            "самостоятельное падение игры не помечается как завершение из лаунчера"
        );
    }

    #[test]
    fn kill_reports_missing_game() {
        let _guard = lock_game_registry_tests();
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
        let _guard = lock_game_registry_tests();
        reset_registry();

        ensure_session_free("Steve").expect("без сессий запуск разрешён любому аккаунту");

        let (first, _) =
            register_game_session(spawn_helper(), "Steve", "KillProj").expect("регистрация");
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
        let _guard = lock_game_registry_tests();
        reset_registry();

        let (first, _) =
            register_game_session(spawn_helper(), "Steve", "KillProj").expect("регистрация Steve");
        let (second, _) =
            register_game_session(spawn_helper(), "Alex", "KillProj").expect("регистрация Alex");

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
        let _guard = lock_game_registry_tests();
        reset_registry();

        let (registered, _) =
            register_game_session(spawn_helper(), "Steve", "KillProj").expect("первая регистрация");
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
        let _guard = lock_game_registry_tests();
        reset_registry();

        let (first, _) =
            register_game_session(spawn_helper(), "Steve", "KillProj").expect("первая регистрация");

        let mut orphan = register_game_session(spawn_helper(), "Steve", "KillProj")
            .expect_err("второй процесс того же аккаунта должен отклоняться");
        let _ = orphan.kill();
        let _ = orphan.wait();

        let (second, _) = register_game_session(spawn_helper(), "Alex", "KillProj")
            .expect("другой аккаунт регистрируется");

        assert_eq!(game_usernames().len(), 2, "реестр держит обе сессии");

        let _ = lock_child(&first).kill();
        let _ = lock_child(&second).kill();
    }

    #[cfg(unix)]
    #[test]
    fn kill_terminates_all_registered_processes() {
        let _guard = lock_game_registry_tests();
        reset_registry();

        let first = Arc::new(StdMutex::new(spawn_helper()));
        let second = Arc::new(StdMutex::new(spawn_helper()));
        let first_terminated = Arc::new(AtomicBool::new(false));
        let second_terminated = Arc::new(AtomicBool::new(false));
        {
            let mut registry = GAME_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
            registry.push(super::RegisteredGame {
                child: Arc::clone(&first),
                username: "Steve".to_string(),
                project: "KillProj".to_string(),
                launcher_terminated: Arc::clone(&first_terminated),
            });
            registry.push(super::RegisteredGame {
                child: Arc::clone(&second),
                username: "Alex".to_string(),
                project: "KillProj".to_string(),
                launcher_terminated: Arc::clone(&second_terminated),
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
        assert!(
            first_terminated.load(Ordering::Relaxed) && second_terminated.load(Ordering::Relaxed),
            "kill из лаунчера должен помечать обе сессии как завершённые принудительно"
        );
        assert!(game_running(), "реестр очищают wait-потоки, а не сам kill");

        reset_registry();
    }

    #[cfg(unix)]
    #[test]
    fn kill_continues_past_already_exited_session() {
        let _guard = lock_game_registry_tests();
        reset_registry();

        let (exited, exited_terminated) = register_game_session(
            std::process::Command::new("sleep")
                .arg("0")
                .spawn()
                .expect("запуск короткоживущего процесса"),
            "Steve",
            "KillProj",
        )
        .expect("регистрация завершившейся сессии");
        lock_child(&exited)
            .wait()
            .expect("естественный выход первой игры");

        let live = Arc::new(StdMutex::new(spawn_helper()));
        let live_terminated = Arc::new(AtomicBool::new(false));
        {
            let mut registry = GAME_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
            registry.push(super::RegisteredGame {
                child: Arc::clone(&live),
                username: "Alex".to_string(),
                project: "KillProj".to_string(),
                launcher_terminated: Arc::clone(&live_terminated),
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
        assert!(
            !exited_terminated.load(Ordering::Relaxed),
            "уже завершившаяся игра не помечается как завершённая лаунчером"
        );
        assert!(
            live_terminated.load(Ordering::Relaxed),
            "живая сессия помечается как завершённая лаунчером"
        );

        remove_game_session(&exited);
        remove_game_session(&live);
    }

    #[cfg(unix)]
    #[test]
    fn kill_after_natural_exit_is_not_an_error() {
        let _guard = lock_game_registry_tests();
        reset_registry();

        let (shared, launcher_terminated) = register_game_session(
            std::process::Command::new("sleep")
                .arg("0")
                .spawn()
                .expect("запуск короткоживущего процесса"),
            "Steve",
            "KillProj",
        )
        .expect("регистрация");

        let status = lock_child(&shared)
            .wait()
            .expect("естественный выход процесса");
        assert!(status.success());

        kill_game_process().expect(
            "kill по уже завершившейся игре не должен давать ошибку и не должен бить по чужому процессу",
        );
        assert!(
            !launcher_terminated.load(Ordering::Relaxed),
            "естественный выход не должен помечаться как завершение из лаунчера"
        );

        remove_game_session(&shared);
    }
}

#[cfg(test)]
mod project_game_username_tests {
    use super::{lock_game_registry_tests, project_game_username, TestGameSessionGuard};

    #[test]
    fn project_game_username_matches_only_own_project_and_clears_on_exit() {
        let _guard = lock_game_registry_tests();

        assert_eq!(
            project_game_username("RegistryProj"),
            None,
            "без сессий у проекта нет запущенной игры"
        );

        let session = TestGameSessionGuard::acquire("RegistryProj", "RegistryPlayer");
        assert_eq!(
            project_game_username("RegistryProj").as_deref(),
            Some("RegistryPlayer")
        );
        assert_eq!(
            project_game_username("OtherProj"),
            None,
            "игра другого проекта не матчится"
        );

        drop(session);
        assert_eq!(
            project_game_username("RegistryProj"),
            None,
            "завершённая сессия снимается с реестра"
        );
    }

    #[test]
    fn project_game_username_reports_first_session_of_many() {
        let _guard = lock_game_registry_tests();

        let first = TestGameSessionGuard::acquire("CrowdProj", "FirstPlayer");
        let second = TestGameSessionGuard::acquire("CrowdProj", "SecondPlayer");

        let reported = project_game_username("CrowdProj").expect("сессия проекта найдена");
        assert!(
            reported == "FirstPlayer" || reported == "SecondPlayer",
            "сообщается одна из запущенных сессий проекта: {reported}"
        );

        drop(second);
        drop(first);
        assert_eq!(project_game_username("CrowdProj"), None);
    }
}
