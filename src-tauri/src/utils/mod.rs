pub mod logger_utils;
pub mod semaphore;
pub mod step_events;
pub mod bandwidth;
pub mod download_file;
pub mod env_info;
pub mod hex;
pub mod http;
pub mod install_manifest;
pub mod integrity;
pub mod java;
pub mod tauri_err;
pub mod zip;

use anyhow::{anyhow, Result};
use std::cmp::Ordering;

pub async fn blocking<T, F>(error_context: &str, task: F) -> Result<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| anyhow!("{}: {}", error_context, e))
}

fn split_numeric_part(version: &str) -> Vec<u32> {
    version
        .split('-')
        .next()
        .unwrap_or(version)
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse::<u32>().ok())
        .collect()
}

fn split_pre_release_part(version: &str) -> Vec<String> {
    match version.split_once('-') {
        Some((_, pre)) => pre
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|p| !p.is_empty())
            .map(String::from)
            .collect(),
        None => Vec::new(),
    }
}

fn compare_pre_release_tags(a: &str, b: &str) -> Ordering {
    let pre_order = |tag: &str| -> u8 {
        if tag.starts_with("pre") {
            0
        } else if tag.starts_with("rc") {
            1
        } else {
            2
        }
    };
    let (pa, pb) = (pre_order(a), pre_order(b));
    if pa != pb {
        return pa.cmp(&pb);
    }
    let version_of = |tag: &str| tag
        .trim_start_matches(|c: char| !c.is_ascii_digit())
        .parse::<u32>()
        .unwrap_or(0);
    let (va, vb) = (version_of(a), version_of(b));
    if va != vb {
        return va.cmp(&vb);
    }
    a.cmp(b)
}

pub fn compare_versions(v1: &str, v2: &str) -> Ordering {
    let (base1, pre1) = (split_numeric_part(v1), split_pre_release_part(v1));
    let (base2, pre2) = (split_numeric_part(v2), split_pre_release_part(v2));

    let max_len = std::cmp::max(base1.len(), base2.len());
    for i in 0..max_len {
        let n1 = base1.get(i).copied().unwrap_or(0);
        let n2 = base2.get(i).copied().unwrap_or(0);
        if n1 != n2 {
            return n1.cmp(&n2);
        }
    }

    if pre1.is_empty() && pre2.is_empty() {
        return Ordering::Equal;
    }
    if pre1.is_empty() {
        return Ordering::Greater;
    }
    if pre2.is_empty() {
        return Ordering::Less;
    }

    let max_pre = std::cmp::max(pre1.len(), pre2.len());
    for i in 0..max_pre {
        match (pre1.get(i), pre2.get(i)) {
            (Some(a), Some(b)) => {
                let ord = compare_pre_release_tags(a, b);
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            (None, None) => {}
        }
    }

    Ordering::Equal
}

pub fn get_classpath_separator() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

#[cfg(test)]
mod tests {
    use super::compare_versions;
    use std::cmp::Ordering;

    #[test]
    fn equal_versions() {
        assert_eq!(compare_versions("1.20.5", "1.20.5"), Ordering::Equal);
        assert_eq!(compare_versions("1.21", "1.21.0"), Ordering::Equal);
    }

    #[test]
    fn numeric_ordering() {
        assert_eq!(compare_versions("1.20.5", "1.20.4"), Ordering::Greater);
        assert_eq!(compare_versions("1.16.5", "1.20.5"), Ordering::Less);
        assert_eq!(compare_versions("21", "17"), Ordering::Greater);
        assert_eq!(compare_versions("2.1", "1.9.9"), Ordering::Greater);
    }

    #[test]
    fn release_is_newer_than_pre_release() {
        assert_eq!(compare_versions("1.20.5-pre1", "1.20.5"), Ordering::Less);
        assert_eq!(compare_versions("1.20.5", "1.20.5-pre1"), Ordering::Greater);
        assert_eq!(compare_versions("1.20.5-rc1", "1.20.5"), Ordering::Less);
    }

    #[test]
    fn pre_release_ordering() {
        assert_eq!(compare_versions("1.20.5-pre2", "1.20.5-pre1"), Ordering::Greater);
        assert_eq!(compare_versions("1.20.5-rc1", "1.20.5-pre1"), Ordering::Greater);
        assert_eq!(compare_versions("1.20.5-rc2", "1.20.5-rc1"), Ordering::Greater);
        assert_eq!(
            compare_versions("1.20.5-pre1", "1.20.5-pre1"),
            Ordering::Equal
        );
        assert_eq!(compare_versions("1.20.5-pre1", "1.20.4-rc2"), Ordering::Greater);
    }

    #[test]
    fn pre_release_of_higher_base_wins() {
        assert_eq!(compare_versions("1.20.6-pre1", "1.20.5"), Ordering::Greater);
        assert_eq!(compare_versions("1.20.5-pre1", "1.20.4"), Ordering::Greater);
    }

    #[test]
    fn longer_pre_release_wins() {
        assert_eq!(compare_versions("1.20.5-pre1-pre", "1.20.5-pre1"), Ordering::Greater);
    }

    #[test]
    fn snapshot_like_suffixes_fall_back_to_string_compare() {
        assert_eq!(compare_versions("1.21.4-alpha.1", "1.21.4-beta.2"), Ordering::Less);
    }

    #[test]
    fn forge_style_versions() {
        assert_eq!(compare_versions("1.20.1", "1.20.1"), Ordering::Equal);
        assert_eq!(compare_versions("47.2.0", "47.1.3"), Ordering::Greater);
    }
}
