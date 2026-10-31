use std::cell::Cell;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::state::launcher_config::LauncherConfig;
use crate::utils::env_info::{get_arch_label, get_current_os};

const LOGS_DIR_NAME: &str = "logs";
const RETENTION_DAYS: i64 = 30;
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

static FILE_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static SESSION_HEADER_WRITTEN: AtomicBool = AtomicBool::new(false);
static LOG_CLEANUP_DONE: AtomicBool = AtomicBool::new(false);
static OPEN_LOG_FILE: Mutex<Option<OpenLog>> = Mutex::new(None);

thread_local! {
    static LOG_WRITE_ENTERED: Cell<bool> = const { Cell::new(false) };
}

struct LogWriteGuard;

impl LogWriteGuard {
    fn enter() -> Option<Self> {
        LOG_WRITE_ENTERED.with(|entered| {
            if entered.get() {
                return None;
            }
            entered.set(true);
            Some(Self)
        })
    }
}

impl Drop for LogWriteGuard {
    fn drop(&mut self) {
        LOG_WRITE_ENTERED.with(|entered| entered.set(false));
    }
}

struct OpenLog {
    date: String,
    dir: std::path::PathBuf,
    file: std::fs::File,
    written: u64,
}

struct CivilDate {
    year: i64,
    month: u32,
    day: u32,
}

fn civil_from_days(z: i64) -> CivilDate {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if month <= 2 { year + 1 } else { year };
    CivilDate { year, month, day }
}

fn days_from_civil(date: &CivilDate) -> i64 {
    let year = if date.month <= 2 {
        date.year - 1
    } else {
        date.year
    };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = if date.month > 2 {
        date.month - 3
    } else {
        date.month + 9
    } as i64;
    let doy = (153 * mp + 2) / 5 + date.day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn today_date() -> CivilDate {
    civil_from_days((epoch_seconds() / 86_400) as i64)
}

fn date_string(date: &CivilDate) -> String {
    format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
}

fn timestamp_string() -> String {
    let secs = epoch_seconds();
    let date = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{} {:02}:{:02}:{:02} UTC",
        date_string(&date),
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn launcher_label() -> String {
    format!(
        "v{} {}-{}",
        env!("CARGO_PKG_VERSION"),
        get_current_os(),
        get_arch_label()
    )
}

fn logs_dir() -> Option<std::path::PathBuf> {
    let dir = LauncherConfig::resolved_launcher_path().join(LOGS_DIR_NAME);
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn cleanup_old_logs(dir: &std::path::Path) {
    let today = days_from_civil(&today_date());
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(age) = log_age_days(&name, today) else {
            continue;
        };
        if age > RETENTION_DAYS {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn log_age_days(file_name: &str, today: i64) -> Option<i64> {
    let base = file_name.strip_suffix(".log")?;
    let base = base.strip_suffix(".old").unwrap_or(base);
    let (year, month, day) = parse_date(base)?;
    Some(today - days_from_civil(&CivilDate { year, month, day }))
}

fn parse_date(s: &str) -> Option<(i64, u32, u32)> {
    let mut parts = s.split('-');
    let year = parts.next()?.parse::<i64>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    let day = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

fn rotate_full_log(dir: &std::path::Path, date: &str) {
    let path = dir.join(format!("{date}.log"));
    if !path.exists() {
        return;
    }
    let _ = fs::remove_file(dir.join(format!("{date}.old.log")));
    let _ = fs::rename(path, dir.join(format!("{date}.old.log")));
}

fn open_log_file(dir: &std::path::Path, date: &str) -> Option<OpenLog> {
    let path = dir.join(format!("{date}.log"));
    if fs::metadata(&path)
        .map(|meta| meta.len() > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        rotate_full_log(dir, date);
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()?;
    let written = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    Some(OpenLog {
        date: date.to_string(),
        dir: dir.to_path_buf(),
        file,
        written,
    })
}

fn append_line(line: &str) {
    let Some(_reentry) = LogWriteGuard::enter() else {
        return;
    };
    let lock = FILE_LOG_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let date = date_string(&today_date());
    let mut cached = OPEN_LOG_FILE.lock().unwrap_or_else(|e| e.into_inner());
    let needs_reopen = match cached.as_ref() {
        Some(open) => open.date != date,
        None => true,
    };
    if needs_reopen {
        let Some(dir) = logs_dir() else {
            *cached = None;
            return;
        };
        if !LOG_CLEANUP_DONE.swap(true, Ordering::Relaxed) {
            cleanup_old_logs(&dir);
        }
        *cached = open_log_file(&dir, &date);
    }
    let Some(open) = cached.as_mut() else {
        return;
    };
    if open.written > 0 && open.written + (line.len() as u64) + 1 > MAX_LOG_BYTES {
        rotate_full_log(&open.dir, &open.date);
        match open_log_file(&open.dir, &open.date) {
            Some(fresh) => *open = fresh,
            None => {
                *cached = None;
                return;
            }
        }
    }
    if open.file.write_all(line.as_bytes()).is_ok() && open.file.write_all(b"\n").is_ok() {
        open.written += line.len() as u64 + 1;
    }
}

fn write_session_header() {
    if SESSION_HEADER_WRITTEN.swap(true, Ordering::Relaxed) {
        return;
    }
    let line = format!(
        "=== {} | запуск {} ===",
        launcher_label(),
        timestamp_string()
    );
    append_line(&line);
}

pub fn write_error(message: &str) {
    write_session_header();
    let line = format!(
        "[{}] [{}] {}",
        timestamp_string(),
        launcher_label(),
        message
    );
    append_line(&line);
}

pub fn write_panic(info: &std::panic::PanicHookInfo<'_>, backtrace: &str) {
    write_session_header();
    let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "неизвестная паника".to_string()
    };
    let location = match info.location() {
        Some(location) => format!(
            "{}:{}:{}",
            location.file(),
            location.line(),
            location.column()
        ),
        None => "unknown".to_string(),
    };
    let line = format!(
        "[{}] [{}] ПАНИКА: {} ({})\nстек:\n{}",
        timestamp_string(),
        launcher_label(),
        payload,
        location,
        backtrace
    );
    append_line(&line);
}

#[cfg(test)]
pub(crate) fn reset_for_tests() {
    *OPEN_LOG_FILE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    SESSION_HEADER_WRITTEN.store(false, Ordering::Relaxed);
    LOG_CLEANUP_DONE.store(false, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::{
        civil_from_days, days_from_civil, parse_date, CivilDate, MAX_LOG_BYTES, RETENTION_DAYS,
    };
    use crate::test_support::LauncherDirGuard;

    #[test]
    fn civil_date_roundtrip() {
        for days in [-25567i64, 0, 1, 19_900, 20_624] {
            let date = civil_from_days(days);
            assert_eq!(days_from_civil(&date), days);
        }
        let epoch = civil_from_days(0);
        assert_eq!((epoch.year, epoch.month, epoch.day), (1970, 1, 1));
    }

    #[test]
    fn date_string_pads() {
        let date = CivilDate {
            year: 2026,
            month: 9,
            day: 5,
        };
        assert_eq!(super::date_string(&date), "2026-09-05");
    }

    #[test]
    fn parse_date_rejects_garbage() {
        assert_eq!(parse_date("2026-09-15"), Some((2026, 9, 15)));
        assert_eq!(parse_date("not-a-date"), None);
        assert_eq!(parse_date("2026-13-15"), None);
        assert_eq!(parse_date("0.log"), None);
    }

    #[test]
    fn log_age_parses_rotated_names() {
        let today = days_from_civil(&super::today_date());
        assert_eq!(
            super::log_age_days("1999-01-01.log", today),
            Some(
                today
                    - days_from_civil(&CivilDate {
                        year: 1999,
                        month: 1,
                        day: 1
                    })
            )
        );
        assert_eq!(
            super::log_age_days("1999-01-01.old.log", today),
            super::log_age_days("1999-01-01.log", today),
            "ротированный файл считается по той же дате"
        );
        assert_eq!(super::log_age_days("random.txt", today), None);
        assert_eq!(super::log_age_days("1999-01-01", today), None);
    }

    #[tokio::test]
    async fn oversized_daily_log_rotates_on_open() {
        let guard = LauncherDirGuard::acquire("file_log_oversize").await;
        super::reset_for_tests();
        let logs_dir = guard.root().join("logs");
        std::fs::create_dir_all(&logs_dir).expect("создание каталога логов");
        let today = super::date_string(&super::today_date());
        let oversized = vec![b'x'; (MAX_LOG_BYTES + 16) as usize];
        std::fs::write(logs_dir.join(format!("{today}.log")), &oversized)
            .expect("запись раздутого лога");

        super::append_line("ротация-при-открытии");

        let rotated_path = logs_dir.join(format!("{today}.old.log"));
        assert_eq!(
            std::fs::metadata(&rotated_path)
                .expect("ротированный файл существует")
                .len(),
            oversized.len() as u64,
        );
        let fresh = std::fs::read_to_string(logs_dir.join(format!("{today}.log")))
            .expect("свежий лог существует");
        assert!(fresh.contains("ротация-при-открытии"));
        assert!(
            !fresh.contains("xxxx"),
            "раздутое содержимое не попадает в свежий файл"
        );
    }

    #[tokio::test]
    async fn append_rotates_when_cap_reached_mid_session() {
        let guard = LauncherDirGuard::acquire("file_log_cap").await;
        super::reset_for_tests();
        let logs_dir = guard.root().join("logs");
        let today = super::date_string(&super::today_date());

        super::append_line("cap-первая");

        {
            let file_lock = super::FILE_LOG_LOCK.get_or_init(|| std::sync::Mutex::new(()));
            let _io_guard = file_lock.lock().unwrap_or_else(|e| e.into_inner());
            let mut cached = super::OPEN_LOG_FILE
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(open) = cached.as_mut() {
                open.written = MAX_LOG_BYTES;
            }
        }

        super::append_line("cap-вторая");

        let rotated = std::fs::read_to_string(logs_dir.join(format!("{today}.old.log")))
            .expect("ротированный лог существует");
        assert!(rotated.contains("cap-первая"));
        assert!(
            !rotated.contains("cap-вторая"),
            "строка после переполнения не попадает в старый файл"
        );
        let fresh = std::fs::read_to_string(logs_dir.join(format!("{today}.log")))
            .expect("свежий лог существует");
        assert!(fresh.contains("cap-вторая"));
    }

    #[tokio::test]
    async fn append_line_skips_reentrant_call() {
        let guard = LauncherDirGuard::acquire("file_log_reentrant").await;
        super::reset_for_tests();
        let logs_dir = guard.root().join("logs");

        {
            let _reentry = super::LogWriteGuard::enter().expect("первый вход в запись лога");
            super::append_line("рекурсивный-вызов");
        }

        assert!(
            !logs_dir.exists(),
            "рекурсивный вызов не создаёт лог и не должен зависать на блокировке"
        );

        super::append_line("обычный-вызов");
        let today = super::date_string(&super::today_date());
        let fresh = std::fs::read_to_string(logs_dir.join(format!("{today}.log")))
            .expect("свежий лог существует");
        assert!(fresh.contains("обычный-вызов"));
    }

    #[tokio::test]
    async fn retention_removes_stale_logs_including_rotated() {
        let guard = LauncherDirGuard::acquire("file_log_retention").await;
        let logs_dir = guard.root().join("logs");
        std::fs::create_dir_all(&logs_dir).expect("создание каталога логов");
        let today = days_from_civil(&super::today_date());
        let stale = super::date_string(&civil_from_days(today - RETENTION_DAYS - 10));
        let fresh = super::date_string(&civil_from_days(today));
        std::fs::write(logs_dir.join(format!("{stale}.log")), "старый").expect("запись лога");
        std::fs::write(
            logs_dir.join(format!("{stale}.old.log")),
            "старый ротированный",
        )
        .expect("запись ротированного лога");
        std::fs::write(logs_dir.join(format!("{fresh}.log")), "свежий").expect("запись лога");

        super::cleanup_old_logs(&logs_dir);

        assert!(!logs_dir.join(format!("{stale}.log")).exists());
        assert!(
            !logs_dir.join(format!("{stale}.old.log")).exists(),
            "ротированный файл удаляется по тому же ретеншену"
        );
        assert!(logs_dir.join(format!("{fresh}.log")).exists());
    }
}
