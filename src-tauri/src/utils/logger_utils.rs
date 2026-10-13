use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

const LOG_BUFFER_LIMIT: usize = 500;

static LOG_BUFFER: OnceLock<Mutex<VecDeque<ConsolePayload>>> = OnceLock::new();
static CONSOLE_EMIT_ENABLED: AtomicBool = AtomicBool::new(true);
static GAME_OUTPUT_ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolePayload {
    pub line: String,
    pub is_error: bool,
    pub session: Option<String>,
}

pub fn init_logger(app: AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(app);
    let _ = LOG_BUFFER.set(Mutex::new(VecDeque::new()));
}

pub fn global_app_handle() -> Option<&'static AppHandle> {
    GLOBAL_APP_HANDLE.get()
}

pub fn set_console_emit_enabled(enabled: bool) {
    CONSOLE_EMIT_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn set_game_output_enabled(enabled: bool) {
    GAME_OUTPUT_ENABLED.store(enabled, Ordering::Relaxed);
}

fn send_log_payload(payload: ConsolePayload) {
    if payload.is_error {
        eprintln!("[ERR] {}", payload.line);
        crate::utils::file_logger::write_error(&payload.line);
    } else {
        println!("[LOG] {}", payload.line);
    }

    if CONSOLE_EMIT_ENABLED.load(Ordering::Relaxed) {
        if let Some(app) = GLOBAL_APP_HANDLE.get() {
            let _ = app.emit("game-console", &payload);
        }
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

pub fn send_log(msg: String, is_error: bool) {
    send_log_payload(ConsolePayload {
        line: msg,
        is_error,
        session: None,
    });
}

pub fn send_game_output(msg: String, is_error: bool, session: &str) {
    if !GAME_OUTPUT_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    send_log_payload(ConsolePayload {
        line: msg,
        is_error,
        session: Some(session.to_string()),
    });
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

#[cfg(test)]
mod session_payload_tests {
    use super::{
        drain_startup_logs, send_game_output, send_log, set_game_output_enabled, ConsolePayload,
        LOG_BUFFER,
    };
    use std::collections::VecDeque;
    use std::sync::Mutex as StdMutex;

    static PAYLOAD_TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn ensure_log_buffer() {
        let _ = super::LOG_BUFFER.get_or_init(|| StdMutex::new(VecDeque::new()));
    }

    fn payload_with<'a>(drained: &'a [ConsolePayload], marker: &str) -> Option<&'a ConsolePayload> {
        drained.iter().find(|payload| payload.line.contains(marker))
    }

    #[test]
    fn game_output_carries_session_and_launcher_log_does_not() {
        let _guard = PAYLOAD_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_log_buffer();
        set_game_output_enabled(true);

        send_game_output(
            "[MC|Steve] session-payload-game-marker".to_string(),
            false,
            "Steve",
        );
        send_log("session-payload-launcher-marker".to_string(), false);

        let drained = drain_startup_logs();
        let game = payload_with(&drained, "session-payload-game-marker")
            .expect("строка игры попадает в буфер");
        assert_eq!(game.session.as_deref(), Some("Steve"));

        let launcher = payload_with(&drained, "session-payload-launcher-marker")
            .expect("лог лаунчера попадает в буфер");
        assert_eq!(
            launcher.session, None,
            "собственные логи лаунчера не привязаны к сессии"
        );

        set_game_output_enabled(false);
    }

    #[test]
    fn disabled_game_output_skips_payload_entirely() {
        let _guard = PAYLOAD_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        ensure_log_buffer();
        set_game_output_enabled(false);

        send_game_output(
            "[MC|Steve] session-payload-hidden-marker".to_string(),
            true,
            "Steve",
        );
        send_log("session-payload-visible-marker".to_string(), false);

        let drained = drain_startup_logs();
        assert!(
            payload_with(&drained, "session-payload-hidden-marker").is_none(),
            "выключенный стриминг игры не пишет в буфер"
        );
        assert!(payload_with(&drained, "session-payload-visible-marker").is_some());
    }
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
