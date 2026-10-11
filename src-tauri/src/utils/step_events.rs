use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

use crate::utils::logger_utils::global_app_handle;

const STEP_EVENT: &str = "launch-steps";
const INTEGRITY_EVENT: &str = "integrity-steps";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
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

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StepEvent {
    Started {
        id: String,
        label: String,
    },
    Progress {
        id: String,
        current: u64,
        total: u64,
    },
    Detail {
        id: String,
        text: String,
    },
    Finished {
        id: String,
        skipped: bool,
    },
    Failed {
        id: String,
        message: String,
    },
}

fn emit_step_event(channel: StepChannel, event: &StepEvent) {
    #[cfg(test)]
    test_capture::record(channel, event);
    if let Some(app) = global_app_handle() {
        let _ = app.emit(channel.event_name(), event);
    }
}

#[cfg(test)]
pub(crate) mod test_capture {
    use super::{StepChannel, StepEvent};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    static ENABLED: AtomicBool = AtomicBool::new(false);
    static EVENTS: Mutex<Vec<(StepChannel, StepEvent)>> = Mutex::new(Vec::new());
    static WINDOW: Mutex<()> = Mutex::new(());

    pub(crate) struct CaptureGuard {
        _window: std::sync::MutexGuard<'static, ()>,
    }

    impl CaptureGuard {
        pub(crate) fn new() -> Self {
            let _window = WINDOW.lock().unwrap_or_else(|e| e.into_inner());
            EVENTS.lock().unwrap_or_else(|e| e.into_inner()).clear();
            ENABLED.store(true, Ordering::SeqCst);
            Self { _window }
        }
    }

    impl Drop for CaptureGuard {
        fn drop(&mut self) {
            ENABLED.store(false, Ordering::SeqCst);
        }
    }

    pub(crate) fn record(channel: StepChannel, event: &StepEvent) {
        if !ENABLED.load(Ordering::SeqCst) {
            return;
        }
        EVENTS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((channel, event.clone()));
    }

    pub(crate) fn captured() -> Vec<(StepChannel, StepEvent)> {
        EVENTS.lock().unwrap_or_else(|e| e.into_inner()).clone()
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
    order: Mutex<()>,
}

impl StepHandle {
    pub fn start(id: &'static str, label: impl Into<String>) -> Self {
        Self::start_channel(StepChannel::Launch, id, label)
    }

    pub fn start_channel(channel: StepChannel, id: &'static str, label: impl Into<String>) -> Self {
        let handle = Self {
            id,
            state: Arc::new(StepState {
                current: AtomicU64::new(0),
                total: AtomicU64::new(0),
                order: Mutex::new(()),
            }),
            channel,
        };
        emit_step_event(
            channel,
            &StepEvent::Started {
                id: id.to_string(),
                label: label.into(),
            },
        );
        handle
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
        let _order = self.state.order.lock().unwrap_or_else(|e| e.into_inner());
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
        let _order = self.state.order.lock().unwrap_or_else(|e| e.into_inner());
        let mut current = self.state.current.fetch_add(1, Ordering::Relaxed) + 1;
        let total = self.state.total.load(Ordering::Relaxed);
        if total > 0 {
            current = current.min(total);
        }
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

#[cfg(test)]
mod tests {
    use super::{test_capture, StepEvent, StepHandle};

    fn progress_currents(id: &str) -> Vec<u64> {
        test_capture::captured()
            .into_iter()
            .filter(|(_, event)| match event {
                StepEvent::Progress { id: event_id, .. } => event_id == id,
                _ => false,
            })
            .filter_map(|(_, event)| match event {
                StepEvent::Progress { current, .. } => Some(current),
                _ => None,
            })
            .collect()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn parallel_incs_emit_progress_in_increment_order() {
        let _capture = test_capture::CaptureGuard::new();
        let step = StepHandle::start("test.progress", "Тест порядка");
        let total = 96u64;
        step.set_total(total);

        let mut tasks = Vec::new();
        for _ in 0..total {
            let step = step.clone();
            tasks.push(tokio::spawn(async move {
                step.inc();
            }));
        }
        for task in tasks {
            task.await.expect("задача инкремента");
        }

        assert_eq!(
            progress_currents("test.progress"),
            (0..=total).collect::<Vec<u64>>(),
            "эмит прогресса должен идти в порядке инкрементов без пропусков и повторов"
        );
    }

    #[test]
    fn inc_clamps_current_to_total() {
        let _capture = test_capture::CaptureGuard::new();
        let step = StepHandle::start("test.clamp", "Тест клэмпа");

        step.set_total(2);
        for _ in 0..5 {
            step.inc();
        }

        assert_eq!(
            progress_currents("test.clamp"),
            vec![0, 1, 2, 2, 2, 2],
            "прогресс не должен превышать total"
        );
    }

    #[test]
    fn set_total_resets_current_counter() {
        let _capture = test_capture::CaptureGuard::new();
        let step = StepHandle::start("test.reset", "Тест сброса");

        step.set_total(3);
        step.inc();
        step.inc();
        step.set_total(5);

        assert_eq!(
            progress_currents("test.reset"),
            vec![0, 1, 2, 0],
            "set_total должен сбрасывать счётчик текущего прогресса"
        );
    }
}
