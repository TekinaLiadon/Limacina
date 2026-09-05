use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();



const LOG_BUFFER_LIMIT: usize = 500;

static LOG_BUFFER: OnceLock<Mutex<VecDeque<ConsolePayload>>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolePayload {
    pub line: String,
    pub is_error: bool,
}

pub fn init_logger(app: AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(app);
    let _ = LOG_BUFFER.set(Mutex::new(VecDeque::new()));
}

pub fn global_app_handle() -> Option<&'static AppHandle> {
    GLOBAL_APP_HANDLE.get()
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
            if buf.len() >= LOG_BUFFER_LIMIT {
                buf.pop_front();
            }
            buf.push_back(payload);
        }
    }
}

pub fn drain_startup_logs() -> Vec<ConsolePayload> {
    LOG_BUFFER
        .get()
        .and_then(|buf| buf.lock().ok())
        .map(|mut buf| buf.drain(..).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_startup_logs() -> Vec<ConsolePayload> {
    drain_startup_logs()
}

#[tauri::command]
pub fn send_frontend_log(line: String, is_error: bool) {
    send_log(line, is_error);
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
