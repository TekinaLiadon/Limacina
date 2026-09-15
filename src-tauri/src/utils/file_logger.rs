use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::state::launcher_config::LauncherConfig;
use crate::utils::env_info::{get_arch, get_current_os};

const LOGS_DIR_NAME: &str = "logs";
const RETENTION_DAYS: i64 = 30;

static FILE_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static SESSION_HEADER_WRITTEN: AtomicBool = AtomicBool::new(false);

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
        get_arch()
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
        let Some(date_part) = name.strip_suffix(".log") else {
            continue;
        };
        let Some((year, month, day)) = parse_date(date_part) else {
            continue;
        };
        let age = today - days_from_civil(&CivilDate { year, month, day });
        if age > RETENTION_DAYS {
            let _ = fs::remove_file(entry.path());
        }
    }
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

fn append_line(line: &str) {
    let lock = FILE_LOG_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let Some(dir) = logs_dir() else {
        return;
    };
    cleanup_old_logs(&dir);
    let path = dir.join(format!("{}.log", date_string(&today_date())));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
        let _ = file.write_all(b"\n");
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
mod tests {
    use super::{civil_from_days, days_from_civil, parse_date, CivilDate};

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
}
