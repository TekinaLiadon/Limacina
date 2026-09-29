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

fn exit_reason(last_output: &StdMutex<VecDeque<String>>) -> Option<String> {
    let log = last_output.lock().unwrap_or_else(|e| e.into_inner());
    if log.iter().any(|line| line.contains(OUT_OF_MEMORY_MARKER)) {
        return Some(OUT_OF_MEMORY_REASON.to_string());
    }
    None
}

#[derive(Clone, Serialize)]
pub struct GameExitPayload {
    pub success: bool,
    pub code: Option<i32>,
    pub reason: Option<String>,
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
            send_game_output(format!("[MC] {}", line), is_error);
            track_output(&last_output, line);
            if !window_opened.load(AtomicOrdering::Relaxed) && is_window_open_marker(line) {
                log_info!("Обнаружено открытие окна игры");
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
) -> Result<GameProcess> {
    log_info!("\n▶ Запуск Minecraft...");
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
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|e| {
        LauncherError::GameProcess(format!("Не удалось запустить Java процесс: {e:#}"))
    })?;

    let stdout = child.stdout.take().ok_or(LauncherError::GameProcess(
        "Не удалось получить stdout процесса".to_string(),
    ))?;
    let stderr = child.stderr.take().ok_or(LauncherError::GameProcess(
        "Не удалось получить stderr процесса".to_string(),
    ))?;

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
    );

    let stderr_reader = spawn_output_reader(
        stderr,
        Arc::clone(&process.last_output),
        Arc::clone(&process.window_opened),
        true,
    );

    let exited = Arc::clone(&process.exited);
    let exit_status = Arc::clone(&process.exit_status);
    let last_output = Arc::clone(&process.last_output);
    thread::spawn(move || {
        let result = match child.wait() {
            Ok(status) => {
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                log_info!("Minecraft завершился: {:?}", status);
                let reason = if status.success() {
                    None
                } else {
                    exit_reason(&last_output)
                };
                let _ = app.emit(
                    "game-exit",
                    GameExitPayload {
                        success: status.success(),
                        code: status.code(),
                        reason,
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
                        reason: None,
                    },
                );
                Some(format!("ошибка ожидания: {}", e))
            }
        };
        *exit_status.lock().unwrap_or_else(|e| e.into_inner()) = result;
        exited.store(true, AtomicOrdering::Relaxed);
        crate::tray::set_game_state(&app, false, "");
        crate::discord::on_game_exit();
    });

    Ok(process)
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
