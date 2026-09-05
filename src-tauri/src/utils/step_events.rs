use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;

use crate::utils::logger_utils::global_app_handle;

const STEP_EVENT: &str = "launch-steps";
const INTEGRITY_EVENT: &str = "integrity-steps";

#[derive(Clone, Copy)]
pub enum StepChannel {
    Launch,
    Integrity,
}

impl StepChannel {
    fn event_name(&self) -> &'static str {
        match self {
            StepChannel::Launch => STEP_EVENT,
            StepChannel::Integrity => INTEGRITY_EVENT,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StepEvent {
    Started { id: String, label: String },
    Progress { id: String, current: u64, total: u64 },
    Detail { id: String, text: String },
    Finished { id: String, skipped: bool },
    Failed { id: String, message: String },
}

fn emit_step_event(channel: StepChannel, event: &StepEvent) {
    if let Some(app) = global_app_handle() {
        let _ = app.emit(channel.event_name(), event);
    }
}

#[derive(Clone)]
pub struct StepHandle {
    id: &'static str,
    state: Arc<StepState>,
    channel: StepChannel,
}

struct StepState {
    current: AtomicU64,
    total: AtomicU64,
}

impl StepHandle {
    pub fn start(id: &'static str, label: impl Into<String>) -> Self {
        Self::start_channel(StepChannel::Launch, id, label)
    }

    pub fn start_channel(channel: StepChannel, id: &'static str, label: impl Into<String>) -> Self {
        emit_step_event(
            channel,
            &StepEvent::Started {
                id: id.to_string(),
                label: label.into(),
            },
        );
        Self {
            id,
            state: Arc::new(StepState {
                current: AtomicU64::new(0),
                total: AtomicU64::new(0),
            }),
            channel,
        }
    }

    pub fn detail(&self, text: &str) {
        emit_step_event(
            self.channel,
            &StepEvent::Detail {
                id: self.id.to_string(),
                text: text.to_string(),
            },
        );
    }

    pub fn set_total(&self, total: u64) {
        self.state.current.store(0, Ordering::Relaxed);
        self.state.total.store(total, Ordering::Relaxed);
        emit_step_event(
            self.channel,
            &StepEvent::Progress {
                id: self.id.to_string(),
                current: 0,
                total,
            },
        );
    }

    pub fn inc(&self) {
        let current = self.state.current.fetch_add(1, Ordering::Relaxed) + 1;
        let total = self.state.total.load(Ordering::Relaxed);
        emit_step_event(
            self.channel,
            &StepEvent::Progress {
                id: self.id.to_string(),
                current,
                total,
            },
        );
    }

    pub fn finish(self, skipped: bool) {
        emit_step_event(
            self.channel,
            &StepEvent::Finished {
                id: self.id.to_string(),
                skipped,
            },
        );
    }

    pub fn fail(self, message: impl Into<String>) {
        emit_step_event(
            self.channel,
            &StepEvent::Failed {
                id: self.id.to_string(),
                message: message.into(),
            },
        );
    }
}

#[macro_export]
macro_rules! step_try {
    ($step:expr, $expr:expr) => {
        match $expr {
            Ok(value) => value,
            Err(error) => {
                $step.fail(error.to_string());
                return Err(error.into());
            }
        }
    };
}
