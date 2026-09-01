use anyhow::{anyhow, Context, Result};
use md5::{Digest, Md5};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use std::{
    process::{Command, Stdio},
    thread,
};
use tauri::{AppHandle, Emitter};
use uuid::{Builder, Variant, Version};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::utils::logger_utils::ConsolePayload;
use crate::utils::{compare_versions, get_classpath_separator};
use crate::{log_err, log_info, minecraft::structs::GameConfig};


pub fn generate_offline_uuid(nickname: &str) -> String {
    log_info!("Генерация офлайн uuid");
    let data = format!("OfflinePlayer:{}", nickname);

    let hash = Md5::digest(data.as_bytes());

    let mut builder = Builder::from_bytes(hash.into());

    builder
        .set_variant(Variant::RFC4122)
        .set_version(Version::Md5);

    builder.into_uuid().to_string().replace("-", "")
}

pub fn maven_to_path(name: &str) -> Result<PathBuf> {
    let parts: Vec<&str> = name.split(':').collect();
    let group_id = parts[0];
    let artifact_id = parts[1];
    let version = parts[2];

    let group_path = group_id.replace('.', "/");
    let file_name = format!("{}-{}.jar", artifact_id, version);

    let mut local_path = PathBuf::new();
    local_path = local_path
        .join(&group_path)
        .join(artifact_id)
        .join(version)
        .join(&file_name);

    Ok(local_path)
}

pub fn maven_to_url(coord: &str, url: &str) -> String {
    let parts: Vec<&str> = coord.split(':').collect();
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    format!(
        "{}/{}/{}/{}/{}-{}.jar",
        url, group, artifact, version, artifact, version
    )
}

pub fn filter_classpath(classpath: Vec<String>) -> Vec<String> {
    let mut latest_versions: HashMap<String, String> = HashMap::new();
    for path_str in &classpath {
        if let Some((artifact_id, version)) = extract_maven_info(path_str) {
            if let Some(existing_version) = latest_versions.get(&artifact_id) {
                if compare_versions(&version, existing_version) == Ordering::Greater {
                    latest_versions.insert(artifact_id, version);
                }
            } else {
                latest_versions.insert(artifact_id, version);
            }
        }
    }

    let mut final_classpath = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for path_str in classpath {
        let normalized = path_str.replace('\\', "/");
        if !seen.contains(&normalized) {
            if let Some((artifact_id, version)) = extract_maven_info(&path_str) {
                if let Some(latest) = latest_versions.get(&artifact_id) {
                    if &version == latest {
                        final_classpath.push(path_str.clone());
                        seen.insert(normalized);
                    }
                }
            } else {
                final_classpath.push(path_str.clone());
                seen.insert(normalized);
            }
        }
    }

    final_classpath
}



pub fn strip_classpath_args(args: Vec<String>) -> Vec<String> {
    let mut result = Vec::with_capacity(args.len());
    let mut skip_next = false;

    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if arg == "-cp" {
            skip_next = true;
            continue;
        }
        if arg.contains("${classpath}") {
            continue;
        }
        result.push(arg);
    }

    result
}

fn extract_maven_info(path_str: &str) -> Option<(String, String)> {
    let path = Path::new(path_str);
    let file_name = path.file_name()?.to_str()?;
    let version = path.parent()?.file_name()?.to_str()?;
    let artifact_id = path.parent()?.parent()?.file_name()?.to_str()?;

    if file_name.starts_with(artifact_id) && file_name.contains(version) {
        return Some((artifact_id.to_string(), version.to_string()));
    }
    None
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


const WINDOW_OPEN_MARKERS: &[&str] = &[
    "Reloading ResourceManager",
    "Sound engine started",
    "OpenAL initialized",
    "Backend library: LWJGL",
    "LWJGL Version:",
];


const OUTPUT_TAIL_LIMIT: usize = 20;
const ERROR_TAIL_LINES: usize = 5;


pub struct GameProcess {
    window_opened: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    exit_status: Arc<StdMutex<Option<String>>>,
    last_output: Arc<StdMutex<VecDeque<String>>>,
}

impl GameProcess {



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
                anyhow::bail!("Игра завершилась до открытия окна ({}){}", status, details);
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
}

fn is_window_open_marker(line: &str) -> bool {
    WINDOW_OPEN_MARKERS.iter().any(|marker| line.contains(marker))
}

fn track_output(last_output: &StdMutex<VecDeque<String>>, line: &str) {
    let truncated: String = line.chars().take(300).collect();
    let mut log = last_output.lock().unwrap_or_else(|e| e.into_inner());
    if log.len() >= OUTPUT_TAIL_LIMIT {
        log.pop_front();
    }
    log.push_back(truncated);
}



pub fn spawn_game_process(
    app: AppHandle,
    config: GameConfig,
    server_url: Option<&str>,
) -> Result<GameProcess> {
    log_info!("\n▶ Запуск Minecraft...");
    log_info!("Main class: {}", &config.main_class);
    log_info!("Java: {:?}", &config.java_path);
    log_info!("Classpath entries: {}", config.classpath.len());

    if !config.java_path.exists() {
        log_err!("Java не найдена: {:?}", config.java_path);
        anyhow::bail!("Файл Java не найден: {:?}", config.java_path);
    }

    let mut command = Command::new(&config.java_path);
    let separator = get_classpath_separator();
    let classpath = &config.classpath.join(separator);
    let mut jvm_args: Vec<String> = config
        .jvm_args
        .iter().filter(|&arg| !arg.is_empty()).cloned()
        .collect();

    if let (Some(server_url), Some(authlib_path)) = (server_url, find_authlib_jar(&config.game_dir)) {
        let agent_arg = format!("-javaagent:{}={}", authlib_path.to_string_lossy(), server_url);
        log_info!("Authlib-injector: {}", agent_arg);
        jvm_args.insert(0, agent_arg);
    }

    log_info!("{}", classpath);
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
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .context("Не удалось запустить Java процесс")?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Не удалось получить stdout процесса"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Не удалось получить stderr процесса"))?;

    let process = GameProcess {
        window_opened: Arc::new(AtomicBool::new(false)),
        exited: Arc::new(AtomicBool::new(false)),
        exit_status: Arc::new(StdMutex::new(None)),
        last_output: Arc::new(StdMutex::new(VecDeque::new())),
    };

    let app_out = app.clone();
    let window_opened_out = Arc::clone(&process.window_opened);
    let last_output_out = Arc::clone(&process.last_output);
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            log_info!("[MC] {}", line);
            let _ = app_out.emit(
                "game-console",
                ConsolePayload {
                    line: line.clone(),
                    is_error: false,
                },
            );
            track_output(&last_output_out, &line);
            if !window_opened_out.load(AtomicOrdering::Relaxed)
                && is_window_open_marker(&line)
            {
                log_info!("Обнаружено открытие окна игры");
                window_opened_out.store(true, AtomicOrdering::Relaxed);
            }
        }
    });

    let app_err = app.clone();
    let window_opened_err = Arc::clone(&process.window_opened);
    let last_output_err = Arc::clone(&process.last_output);
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            log_err!("[MC] {}", line);
            let _ = app_err.emit(
                "game-console",
                ConsolePayload {
                    line: line.clone(),
                    is_error: true,
                },
            );
            track_output(&last_output_err, &line);
            if !window_opened_err.load(AtomicOrdering::Relaxed)
                && is_window_open_marker(&line)
            {
                log_info!("Обнаружено открытие окна игры");
                window_opened_err.store(true, AtomicOrdering::Relaxed);
            }
        }
    });

    let exited = Arc::clone(&process.exited);
    let exit_status = Arc::clone(&process.exit_status);
    thread::spawn(move || {
        let result = match child.wait() {
            Ok(status) => {
                log_info!("Minecraft завершился: {:?}", status);
                Some(status.to_string())
            }
            Err(e) => {
                log_err!("Ошибка ожидания процесса: {}", e);
                Some(format!("ошибка ожидания: {}", e))
            }
        };
        *exit_status.lock().unwrap_or_else(|e| e.into_inner()) = result;
        exited.store(true, AtomicOrdering::Relaxed);
    });

    Ok(process)
}
