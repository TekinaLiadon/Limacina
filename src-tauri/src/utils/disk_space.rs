use std::path::Path;

use sysinfo::Disks;

pub fn available_bytes(path: &Path) -> Option<u64> {
    let target = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let disks = Disks::new_with_refreshed_list();
    let mut best: Option<(usize, u64)> = None;
    for disk in disks.list() {
        let mount_point = disk.mount_point();
        if target.starts_with(mount_point) {
            let mount_len = mount_point.as_os_str().len();
            if best.as_ref().is_none_or(|(len, _)| mount_len >= *len) {
                best = Some((mount_len, disk.available_space()));
            }
        }
    }
    best.map(|(_, available)| available)
}

pub fn format_bytes(bytes: u64) -> String {
    let gib = bytes as f64 / 1_073_741_824.0;
    if gib >= 1.0 {
        return format!("{gib:.2} ГБ");
    }
    let mib = bytes as f64 / 1_048_576.0;
    format!("{mib:.0} МБ")
}

#[cfg(test)]
mod tests {
    use super::{available_bytes, format_bytes};
    use std::path::PathBuf;

    #[test]
    fn available_bytes_reports_disk_of_existing_dir() {
        let existing = std::env::temp_dir();
        let available = available_bytes(&existing).expect("диск для временной папки");
        assert!(available > 0, "на реальном диске должно быть место");
    }

    #[test]
    fn format_bytes_uses_units() {
        assert_eq!(format_bytes(512 * 1_048_576), "512 МБ");
        assert_eq!(format_bytes(2 * 1_073_741_824), "2.00 ГБ");
    }

    #[test]
    fn available_bytes_handles_missing_path() {
        let missing = PathBuf::from("/nonexistent-launcher-path/definitely-missing");
        let _ = available_bytes(&missing);
    }
}
