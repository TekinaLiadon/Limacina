use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use serde::Serialize;

static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[derive(Clone, Serialize)]
struct ConsolePayload {
    line: String,
    is_error: bool,
}

pub fn init_logger(app: AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(app);
}

pub fn send_log(msg: String, is_error: bool) {
    if is_error {
        eprintln!("[ERR] {}", msg);
    } else {
        println!("[LOG] {}", msg);
    }

    if let Some(app) = GLOBAL_APP_HANDLE.get() {
        let _ = app.emit("game-console", ConsolePayload {
            line: msg,
            is_error,
        });
    }
}

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => {
        $crate::logger_utils::send_log(format!($($arg)*), false);
    };
}

#[macro_export]
macro_rules! log_err {
    ($($arg:tt)*) => {
        $crate::logger_utils::send_log(format!($($arg)*), true);
    };
}