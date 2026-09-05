use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::time::sleep;

use crate::log_info;

const BYTES_PER_KB: u64 = 1024;

struct TokenBucket {
    rate_bytes_per_sec: u64,
    tokens: f64,
    last_refill: Instant,
}

static BUCKET: Mutex<Option<TokenBucket>> = Mutex::new(None);

pub fn set_limit(kbps: Option<u64>) {
    let rate = kbps.unwrap_or(0).saturating_mul(BYTES_PER_KB);
    let mut guard = BUCKET.lock().unwrap_or_else(|e| e.into_inner());

    if rate == 0 {
        if guard.take().is_some() {
            log_info!("Ограничение скорости скачивания отключено");
        }
        return;
    }

    match guard.as_mut() {
        Some(bucket) => {
            bucket.rate_bytes_per_sec = rate;
            bucket.tokens = bucket.tokens.min(rate as f64);
        }
        None => {
            *guard = Some(TokenBucket {
                rate_bytes_per_sec: rate,
                tokens: rate as f64,
                last_refill: Instant::now(),
            });
            log_info!("Ограничение скорости скачивания: {} КБ/с", kbps.unwrap_or(0));
        }
    }
}

pub async fn acquire(bytes: u64) {
    if bytes == 0 {
        return;
    }

    loop {
        let wait_secs = {
            let mut guard = BUCKET.lock().unwrap_or_else(|e| e.into_inner());
            let Some(bucket) = guard.as_mut() else {
                return;
            };

            let now = Instant::now();
            let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
            if elapsed > 0.0 {
                bucket.tokens =
                    (bucket.tokens + elapsed * bucket.rate_bytes_per_sec as f64).min(bucket.rate_bytes_per_sec as f64);
                bucket.last_refill = now;
            }

            if bucket.tokens >= bytes as f64 {
                bucket.tokens -= bytes as f64;
                0.0
            } else {
                ((bytes as f64 - bucket.tokens) / bucket.rate_bytes_per_sec as f64).max(0.001)
            }
        };

        if wait_secs == 0.0 {
            return;
        }

        sleep(Duration::from_secs_f64(wait_secs)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    static TEST_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

    async fn lock_tests() -> tokio::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .get_or_init(|| tokio::sync::Mutex::new(()))
            .lock()
            .await
    }

    #[tokio::test]
    async fn unlimited_acquire_is_instant() {
        let _guard = lock_tests().await;
        set_limit(None);

        let start = Instant::now();
        acquire(100_000_000).await;
        assert!(start.elapsed() < Duration::from_secs(1));

        set_limit(None);
    }

    #[tokio::test]
    async fn acquire_blocks_after_bucket_drained() {
        let _guard = lock_tests().await;
        set_limit(Some(8192));

        acquire(8192 * BYTES_PER_KB).await;

        let start = Instant::now();
        acquire(1024 * BYTES_PER_KB).await;
        assert!(start.elapsed() >= Duration::from_millis(100));

        set_limit(None);
    }

    #[tokio::test]
    async fn zero_limit_disables_throttling() {
        let _guard = lock_tests().await;
        set_limit(Some(1024));
        set_limit(Some(0));

        let start = Instant::now();
        acquire(50_000_000).await;
        assert!(start.elapsed() < Duration::from_secs(1));

        set_limit(None);
    }
}
