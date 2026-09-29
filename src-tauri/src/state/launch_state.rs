use std::sync::atomic::{AtomicU64, Ordering};

static LAUNCH_STEP_OWNER: AtomicU64 = AtomicU64::new(0);
static LAUNCH_STEP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct LaunchStepGuard {
    token: u64,
}

impl Drop for LaunchStepGuard {
    fn drop(&mut self) {
        let _ =
            LAUNCH_STEP_OWNER.compare_exchange(self.token, 0, Ordering::SeqCst, Ordering::SeqCst);
    }
}

pub fn acquire_launch_step() -> LaunchStepGuard {
    let token = LAUNCH_STEP_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    LAUNCH_STEP_OWNER.store(token, Ordering::SeqCst);
    LaunchStepGuard { token }
}

pub fn force_release() {
    LAUNCH_STEP_OWNER.store(0, Ordering::SeqCst);
}

pub fn launch_in_progress() -> bool {
    LAUNCH_STEP_OWNER.load(Ordering::SeqCst) != 0
}

#[cfg(test)]
mod tests {
    use super::{acquire_launch_step, force_release, launch_in_progress};

    #[test]
    fn launch_step_guard_owns_flag() {
        force_release();
        assert!(!launch_in_progress());

        let stale = acquire_launch_step();
        assert!(launch_in_progress());

        let fresh = acquire_launch_step();
        drop(stale);
        assert!(
            launch_in_progress(),
            "устаревший гард не должен сбрасывать флаг нового шага"
        );

        drop(fresh);
        assert!(!launch_in_progress());

        let guard = acquire_launch_step();
        force_release();
        assert!(!launch_in_progress());

        drop(guard);
        assert!(
            !launch_in_progress(),
            "дроп после сброса не восстанавливает флаг"
        );
    }
}
