use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static LOG_BUFFER: OnceLock<Mutex<Vec<ConsolePayload>>> = OnceLock::new();

#[derive(Clone, Serialize)]
pub struct ConsolePayload {
    pub line: String,
    pub is_error: bool,
}

pub fn init_logger(app: AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(app);
    let _ = LOG_BUFFER.set(Mutex::new(Vec::new()));
}

pub fn send_log(msg: String, is_error: bool) {
    if is_error {
        eprintln!("[ERR] {}", msg);
    } else {
        println!("[LOG] {}", msg);
    }

    let payload = ConsolePayload {
        line: msg,
        is_error,
    };

    if let Some(app) = GLOBAL_APP_HANDLE.get() {
        let _ = app.emit("game-console", &payload);
    }

    if let Some(buffer) = LOG_BUFFER.get() {
        if let Ok(mut buf) = buffer.lock() {
            buf.push(payload);
        }
    }
}

pub fn drain_startup_logs() -> Vec<ConsolePayload> {
    LOG_BUFFER
        .get()
        .and_then(|buf| buf.lock().ok())
        .map(|mut buf| std::mem::take(&mut *buf))
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_startup_logs() -> Vec<ConsolePayload> {
    drain_startup_logs()
}

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => {
        $crate::logger_utils::send_log(format!($($arg)*), false)
    };
}

#[macro_export]
macro_rules! log_err {
    ($($arg:tt)*) => {
        $crate::logger_utils::send_log(format!($($arg)*), true)
    };
}
