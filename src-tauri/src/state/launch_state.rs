use std::sync::atomic::{AtomicBool, Ordering};

use crate::utils::tauri_err::CommandResult;

static LAUNCH_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub fn set_launch_in_progress(running: bool) {
    LAUNCH_IN_PROGRESS.store(running, Ordering::Relaxed);
}

pub fn launch_in_progress() -> bool {
    LAUNCH_IN_PROGRESS.load(Ordering::Relaxed)
}

pub fn clear_on_error<T>(result: CommandResult<T>) -> CommandResult<T> {
    if result.is_err() {
        set_launch_in_progress(false);
    }
    result
}
