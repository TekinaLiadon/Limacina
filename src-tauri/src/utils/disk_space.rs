use std::path::Path;

use sysinfo::Disks;

pub fn available_bytes(path: &Path) -> Option<u64> {
    let target = crate::utils::env_info::strip_verbatim_prefix(
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf()),
    );
    let disks = Disks::new_with_refreshed_list();
    let mounts: Vec<(&Path, u64)> = disks
        .list()
        .iter()
        .map(|disk| (disk.mount_point(), disk.available_space()))
        .collect();
    best_available(&target, &mounts)
}

fn best_available(target: &Path, disks: &[(&Path, u64)]) -> Option<u64> {
    let mut best: Option<(usize, u64)> = None;
    for (mount_point, available) in disks {
        if target.starts_with(mount_point) {
            let mount_len = mount_point.as_os_str().len();
            if best.as_ref().is_none_or(|(len, _)| mount_len >= *len) {
                best = Some((mount_len, *available));
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
    use super::{available_bytes, best_available, format_bytes};
    use std::path::{Path, PathBuf};

    #[test]
    fn best_available_picks_longest_mount_prefix() {
        let mounts = vec![
            (Path::new("/home/user"), 300),
            (Path::new("/"), 100),
            (Path::new("/home"), 200),
        ];
        assert_eq!(
            best_available(Path::new("/home/user/mc"), &mounts),
            Some(300)
        );
        assert_eq!(best_available(Path::new("/tmp/x"), &mounts), Some(100));
    }

    #[test]
    fn best_available_returns_none_without_matching_mount() {
        let mounts = vec![(Path::new("/"), 100), (Path::new("/home"), 200)];
        assert_eq!(best_available(Path::new("relative/path"), &mounts), None);
    }

    #[cfg(windows)]
    #[test]
    fn strip_verbatim_prefix_unwraps_windows_forms() {
        assert_eq!(
            crate::utils::env_info::strip_verbatim_prefix(PathBuf::from(r"\\?\C:\Users\x")),
            PathBuf::from(r"C:\Users\x")
        );
        assert_eq!(
            crate::utils::env_info::strip_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\server\share")
        );
        assert_eq!(
            crate::utils::env_info::strip_verbatim_prefix(PathBuf::from(r"C:\Users\x")),
            PathBuf::from(r"C:\Users\x")
        );
    }

    #[cfg(windows)]
    #[test]
    fn available_bytes_matches_explicit_verbatim_path() {
        let verbatim = PathBuf::from(format!(r"\\?\{}", std::env::temp_dir().display()));
        let available = available_bytes(&verbatim).expect("диск для verbatim-пути временной папки");
        assert!(available > 0, "на реальном диске должно быть место");
    }

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
