use sha2::{Digest, Sha256};
use std::sync::OnceLock;

use crate::utils::env_info::get_current_os;
use crate::utils::hex::to_hex;

pub const LAUNCHER_ID_HEADER: &str = "X-Launcher-Id";

const ID_VERSION: &str = "v1";
const ID_SALT: &[u8] = b"limacina-install-id-v1";
const ID_HEX_LEN: usize = 32;
const BY_ID_DIR: &str = "/dev/disk/by-id";
const MACHINE_ID_PATHS: [&str; 2] = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

static INSTALL_ID: OnceLock<Option<String>> = OnceLock::new();

pub fn install_id() -> Option<&'static str> {
    INSTALL_ID.get().and_then(|id| id.as_deref())
}

pub fn set_install_id(id: &str) {
    let _ = INSTALL_ID.set(Some(id.to_string()));
}

pub fn compute_install_id_blocking() -> String {
    install_id_from_sources(
        collect_hostname().as_deref(),
        collect_hardware_serial().as_deref(),
        collect_os_install_id().as_deref(),
        &collect_fallback_anchor(),
    )
}

pub fn install_id_from_sources(
    hostname: Option<&str>,
    hardware_serial: Option<&str>,
    os_install_id: Option<&str>,
    fallback_anchor: &str,
) -> String {
    let hostname = clean(hostname);
    let base = clean(hardware_serial)
        .or_else(|| clean(os_install_id))
        .unwrap_or(fallback_anchor);

    let mut hasher = Sha256::new();
    hasher.update(ID_SALT);
    hasher.update([0]);
    if let Some(hostname) = hostname {
        hasher.update(hostname.as_bytes());
    }
    hasher.update([0]);
    hasher.update(base.as_bytes());

    let mut hex = to_hex(&hasher.finalize());
    hex.truncate(ID_HEX_LEN);
    format!("{ID_VERSION}-{hex}")
}

fn clean(raw: Option<&str>) -> Option<&str> {
    let raw = raw?.trim();
    if is_placeholder(raw) {
        return None;
    }
    Some(raw)
}

fn is_placeholder(raw: &str) -> bool {
    let raw = raw.trim();
    raw.is_empty()
        || raw == "0"
        || raw.chars().all(|c| c == '0' || c == '-')
        || raw.eq_ignore_ascii_case("to be filled by o.e.m.")
        || raw.eq_ignore_ascii_case("to be filled by o.e.m")
        || raw.eq_ignore_ascii_case("default string")
        || raw.eq_ignore_ascii_case("not set")
        || raw.eq_ignore_ascii_case("none")
        || raw.eq_ignore_ascii_case("string")
        || raw.eq_ignore_ascii_case("no serial number")
        || raw.eq_ignore_ascii_case("system serial number")
        || raw.eq_ignore_ascii_case("03000000-0400-0500-0006-000700080009")
}

fn collect_hostname() -> Option<String> {
    sysinfo::System::host_name()
}

#[cfg(target_os = "windows")]
fn collect_hardware_serial() -> Option<String> {
    sysinfo::Motherboard::new()
        .and_then(|board| board.serial_number())
        .or_else(sysinfo::Product::serial_number)
}

#[cfg(not(target_os = "windows"))]
fn collect_hardware_serial() -> Option<String> {
    system_disk_by_id_name()
}

#[cfg(not(target_os = "windows"))]
fn system_disk_by_id_name() -> Option<String> {
    use std::os::unix::fs::MetadataExt;

    let root_dev = std::fs::metadata("/").ok()?.dev();
    let entries = std::fs::read_dir(BY_ID_DIR).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if partition_suffix(&name).is_none() {
            continue;
        }
        let Ok(target) = std::fs::canonicalize(entry.path()) else {
            continue;
        };
        let Ok(dev) = std::fs::metadata(&target) else {
            continue;
        };
        if dev.dev() != root_dev {
            continue;
        }
        return Some(disk_name_from_partition(&name).to_string());
    }
    None
}

fn partition_suffix(name: &str) -> Option<&str> {
    name.rfind("-part").map(|pos| &name[pos..])
}

fn disk_name_from_partition(name: &str) -> &str {
    match partition_suffix(name) {
        Some(suffix) => &name[..name.len() - suffix.len()],
        None => name,
    }
}

#[cfg(target_os = "windows")]
fn collect_os_install_id() -> Option<String> {
    crate::utils::winreg::machine_guid()
}

#[cfg(not(target_os = "windows"))]
fn collect_os_install_id() -> Option<String> {
    MACHINE_ID_PATHS
        .iter()
        .find_map(|path| read_machine_id(path))
}

fn read_machine_id(path: &str) -> Option<String> {
    Some(std::fs::read_to_string(path).ok()?.trim().to_string())
}

fn collect_fallback_anchor() -> String {
    let config_dir = dirs::config_dir()
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default();
    format!("{config_dir}|{}", get_current_os())
}

#[cfg(test)]
pub(crate) fn override_install_id_for_tests(id: &str) {
    let _ = INSTALL_ID.set(Some(id.to_string()));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(hardware: &str) -> (Option<&str>, Option<&str>, Option<&str>, &str) {
        (
            Some("gaming-pc"),
            Some(hardware),
            Some("machine-guid-1111"),
            "/home/player/.config/Limacina|linux",
        )
    }

    #[test]
    fn same_sources_give_same_id() {
        let (host, hw, os_id, fallback) = sources("W1KS427111E");

        let first = install_id_from_sources(host, hw, os_id, fallback);
        let second = install_id_from_sources(host, hw, os_id, fallback);

        assert_eq!(first, second);
    }

    #[test]
    fn different_hardware_changes_id() {
        let (host, _, os_id, fallback) = sources("W1KS427111E");

        let first = install_id_from_sources(host, Some("W1KS427111E"), os_id, fallback);
        let second = install_id_from_sources(host, Some("W9YY22900KF"), os_id, fallback);

        assert_ne!(first, second);
    }

    #[test]
    fn different_hostname_changes_id() {
        let (_, hw, os_id, fallback) = sources("W1KS427111E");

        let first = install_id_from_sources(Some("gaming-pc"), hw, os_id, fallback);
        let second = install_id_from_sources(Some("laptop"), hw, os_id, fallback);

        assert_ne!(first, second);
    }

    #[test]
    fn different_machine_id_changes_id_when_hardware_missing() {
        let fallback = "/home/player/.config/Limacina|linux";

        let first = install_id_from_sources(Some("pc"), None, Some("machine-1"), fallback);
        let second = install_id_from_sources(Some("pc"), None, Some("machine-2"), fallback);

        assert_ne!(first, second);
    }

    #[test]
    fn placeholder_hardware_falls_back_to_machine_id() {
        let fallback = "/home/player/.config/Limacina|linux";
        let placeholders = [
            "To be filled by O.E.M.",
            "Default string",
            "Not Set",
            "00000000-0000-0000-0000-000000000000",
            "0",
            "",
            "   ",
        ];

        for placeholder in placeholders {
            let with_placeholder =
                install_id_from_sources(Some("pc"), Some(placeholder), Some("machine-1"), fallback);
            let with_machine =
                install_id_from_sources(Some("pc"), None, Some("machine-1"), fallback);

            assert_eq!(
                with_placeholder, with_machine,
                "плейсхолдер {placeholder:?} должен отбрасываться"
            );
        }
    }

    #[test]
    fn missing_sources_give_deterministic_fallback_id() {
        let fallback = "/home/player/.config/Limacina|linux";

        let first = install_id_from_sources(None, None, None, fallback);
        let second = install_id_from_sources(None, None, None, fallback);

        assert_eq!(first, second);
        assert!(!first.is_empty());
        assert!(first.starts_with("v1-"));
    }

    #[test]
    fn id_has_version_prefix_and_hex_body() {
        let id = install_id_from_sources(Some("pc"), Some("W1KS427111E"), None, "fallback");

        assert!(id.starts_with("v1-"));
        let body = &id["v1-".len()..];
        assert_eq!(body.len(), ID_HEX_LEN);
        assert!(body.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn partition_suffix_detected_for_ata_and_nvme_names() {
        assert_eq!(partition_suffix("ata-SSD_123-part1"), Some("-part1"));
        assert_eq!(partition_suffix("nvme-eui.002538-part2"), Some("-part2"));
        assert_eq!(partition_suffix("wwn-0x5000-part12"), Some("-part12"));
        assert_eq!(partition_suffix("ata-SSD_123"), None);
    }

    #[test]
    fn disk_name_strips_partition_suffix() {
        assert_eq!(disk_name_from_partition("ata-SSD_123-part1"), "ata-SSD_123");
        assert_eq!(
            disk_name_from_partition("nvme-eui.002538"),
            "nvme-eui.002538"
        );
    }

    #[test]
    fn placeholder_detection_covers_known_garbage() {
        assert!(is_placeholder(""));
        assert!(is_placeholder("  "));
        assert!(is_placeholder("0"));
        assert!(is_placeholder("00000000-0000-0000-0000-000000000000"));
        assert!(is_placeholder("To Be Filled By O.E.M."));
        assert!(is_placeholder("Default string"));
        assert!(is_placeholder("Not Set"));
    }

    #[test]
    fn placeholder_detection_keeps_real_serials() {
        assert!(!is_placeholder("W1KS427111E"));
        assert!(!is_placeholder("ata-SSD_123"));
        assert!(!is_placeholder("machine-guid-abc"));
    }

    #[test]
    fn machine_id_paths_cover_systemd_and_dbus() {
        assert!(MACHINE_ID_PATHS.contains(&"/etc/machine-id"));
        assert!(MACHINE_ID_PATHS.contains(&"/var/lib/dbus/machine-id"));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn fallback_anchor_uses_config_dir_and_os() {
        let anchor = collect_fallback_anchor();

        assert!(!anchor.is_empty());
        assert!(anchor.contains(get_current_os()));
    }
}
