use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::Result;

use crate::utils::errors::LauncherError;

static LAUNCH_STEP_OWNER: AtomicU64 = AtomicU64::new(0);
static LAUNCH_STEP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub struct LaunchStepGuard {
    token: u64,
}

impl Drop for LaunchStepGuard {
    fn drop(&mut self) {
        let _ =
            LAUNCH_STEP_OWNER.compare_exchange(self.token, 0, Ordering::SeqCst, Ordering::SeqCst);
    }
}

pub fn try_acquire_launch_step() -> Result<LaunchStepGuard> {
    let token = LAUNCH_STEP_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    LAUNCH_STEP_OWNER
        .compare_exchange(0, token, Ordering::SeqCst, Ordering::SeqCst)
        .map(|_| LaunchStepGuard { token })
        .map_err(|_| LauncherError::LaunchInProgress.into())
}

pub fn launch_in_progress() -> bool {
    LAUNCH_STEP_OWNER.load(Ordering::SeqCst) != 0
}

#[cfg(test)]
pub(crate) fn lock_launch_step_tests() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    use super::{launch_in_progress, lock_launch_step_tests, try_acquire_launch_step};
    use crate::utils::errors::LauncherError;

    #[cfg(test)]
    fn reset_for_tests() {
        super::LAUNCH_STEP_OWNER.store(0, Ordering::SeqCst);
    }

    #[test]
    fn second_acquire_is_rejected_with_typed_error() {
        let _guard = lock_launch_step_tests();
        reset_for_tests();

        let first = try_acquire_launch_step().expect("свободный шаг захватывается");
        assert!(launch_in_progress());

        let error =
            try_acquire_launch_step().expect_err("параллельный шаг должен отклоняться на бекенде");
        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::LaunchInProgress)
            ),
            "ожидается типизированная ошибка: {error}"
        );
        assert!(
            error.to_string().contains("уже выполняются"),
            "сообщение должно объяснять состояние: {error}"
        );

        drop(first);
        assert!(!launch_in_progress());
    }

    #[test]
    fn concurrent_acquire_yields_single_winner() {
        let _guard = lock_launch_step_tests();
        reset_for_tests();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("тестовый рантайм");
        let winners = Arc::new(AtomicU64::new(0));
        let attempts = 8;
        let results = runtime.block_on(async {
            let mut handles = Vec::new();
            for _ in 0..attempts {
                let winners = Arc::clone(&winners);
                handles.push(tokio::task::spawn_blocking(
                    move || match try_acquire_launch_step() {
                        Ok(guard) => {
                            winners.fetch_add(1, Ordering::SeqCst);
                            Some(guard)
                        }
                        Err(_) => None,
                    },
                ));
            }
            let mut guards = Vec::new();
            for handle in handles {
                guards.push(handle.await.expect("задача захвата"));
            }
            guards
        });

        assert_eq!(
            winners.load(Ordering::SeqCst),
            1,
            "ровно один из параллельных start/download/init должен пройти"
        );
        assert!(launch_in_progress());
        drop(results);
        assert!(!launch_in_progress());
    }

    #[test]
    fn stale_guard_drop_keeps_current_owner() {
        let _guard = lock_launch_step_tests();
        reset_for_tests();

        let stale = try_acquire_launch_step().expect("первый захват");
        reset_for_tests();
        let fresh = try_acquire_launch_step().expect("второй захват после сброса");
        drop(stale);
        assert!(
            launch_in_progress(),
            "дроп устаревшего гарда не должен сбрасывать текущий шаг"
        );

        drop(fresh);
        assert!(!launch_in_progress());
    }
}
