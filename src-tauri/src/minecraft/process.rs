use anyhow::{anyhow, Context, Result};
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

const OUTPUT_TAIL_LIMIT: usize = 20;
const ERROR_TAIL_LINES: usize = 5;

#[derive(Clone, Serialize)]
pub struct GameExitPayload {
    pub success: bool,
    pub code: Option<i32>,
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
) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            send_game_output(format!("[MC] {}", line), is_error);
            track_output(&last_output, &line);
            if !window_opened.load(AtomicOrdering::Relaxed) && is_window_open_marker(&line) {
                log_info!("Обнаружено открытие окна игры");
                window_opened.store(true, AtomicOrdering::Relaxed);
            }
        }
    });
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
        .iter()
        .filter(|&arg| !arg.is_empty())
        .cloned()
        .collect();

    if let (Some(server_url), Some(authlib_path)) = (server_url, find_authlib_jar(&config.game_dir))
    {
        let agent_arg = format!(
            "-javaagent:{}={}",
            authlib_path.to_string_lossy(),
            server_url
        );
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

    spawn_output_reader(
        stdout,
        Arc::clone(&process.last_output),
        Arc::clone(&process.window_opened),
        false,
    );

    spawn_output_reader(
        stderr,
        Arc::clone(&process.last_output),
        Arc::clone(&process.window_opened),
        true,
    );

    let exited = Arc::clone(&process.exited);
    let exit_status = Arc::clone(&process.exit_status);
    thread::spawn(move || {
        let result = match child.wait() {
            Ok(status) => {
                log_info!("Minecraft завершился: {:?}", status);
                let _ = app.emit(
                    "game-exit",
                    GameExitPayload {
                        success: status.success(),
                        code: status.code(),
                    },
                );
                Some(status.to_string())
            }
            Err(e) => {
                log_err!("Ошибка ожидания процесса: {}", e);
                let _ = app.emit(
                    "game-exit",
                    GameExitPayload {
                        success: false,
                        code: None,
                    },
                );
                Some(format!("ошибка ожидания: {}", e))
            }
        };
        *exit_status.lock().unwrap_or_else(|e| e.into_inner()) = result;
        exited.store(true, AtomicOrdering::Relaxed);
        crate::discord::on_game_exit();
    });

    Ok(process)
}
