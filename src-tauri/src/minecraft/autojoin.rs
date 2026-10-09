use anyhow::Result;
use std::cmp::Ordering;
use std::io::Read;
use std::path::Path;

use crate::utils::compare_versions;
use crate::utils::errors::LauncherError;

fn split_server_address(address: &str) -> (&str, Option<&str>) {
    let trimmed = address.trim();

    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some((host, tail)) = rest.split_once(']') {
            let port = tail
                .strip_prefix(':')
                .filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
            return (host, port);
        }
        return (trimmed, None);
    }

    if trimmed.matches(':').count() > 1 {
        return (trimmed, None);
    }

    let trimmed = trimmed.trim_end_matches(':');
    match trimmed.rsplit_once(':') {
        Some((host, port))
            if !host.is_empty() && !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) =>
        {
            (host, Some(port))
        }
        _ => (trimmed, None),
    }
}

pub fn auto_join_args(address: &str, mc_version: &str) -> Vec<String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let (host, port) = split_server_address(trimmed);
    let base_version = mc_version.split('-').next().unwrap_or(mc_version);

    if compare_versions(base_version, "1.20.3") != Ordering::Less {
        match port {
            Some(port) if host.contains(':') => vec![
                "--quickPlayMultiplayer".to_string(),
                format!("[{host}]:{port}"),
            ],
            Some(port) => vec![
                "--quickPlayMultiplayer".to_string(),
                format!("{host}:{port}"),
            ],
            None => vec!["--quickPlayMultiplayer".to_string(), host.to_string()],
        }
    } else {
        let mut args = vec!["--server".to_string(), host.to_string()];
        if let Some(port) = port {
            args.push("--port".to_string());
            args.push(port.to_string());
        }
        args
    }
}

#[derive(serde::Deserialize)]
struct ServersDatRoot {
    #[serde(default)]
    servers: Vec<ServerEntry>,
}

#[derive(serde::Deserialize)]
struct ServerEntry {
    #[serde(default)]
    ip: Option<String>,
}

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

fn is_zlib_header(raw: &[u8]) -> bool {
    if raw.len() < 2 {
        return false;
    }
    let cmf = raw[0] as u16;
    let flg = raw[1] as u16;
    cmf & 0x0f == 8 && (cmf << 8 | flg).is_multiple_of(31)
}

fn decode_nbt_container(raw: Vec<u8>, path: &Path) -> Result<Vec<u8>> {
    if raw.starts_with(&GZIP_MAGIC) {
        let mut data = Vec::new();
        flate2::read::GzDecoder::new(raw.as_slice())
            .read_to_end(&mut data)
            .map_err(|e| {
                LauncherError::ManifestParse(format!("Не удалось распаковать {path:?}: {e:#}"))
            })?;
        Ok(data)
    } else if is_zlib_header(&raw) {
        let mut data = Vec::new();
        flate2::read::ZlibDecoder::new(raw.as_slice())
            .read_to_end(&mut data)
            .map_err(|e| {
                LauncherError::ManifestParse(format!("Не удалось распаковать {path:?}: {e:#}"))
            })?;
        Ok(data)
    } else if raw.first().is_some_and(|byte| *byte <= 12) {
        Ok(raw)
    } else {
        Err(LauncherError::ManifestParse(format!(
            "Неизвестный формат NBT файла {path:?} (первые байты: {:02x?})",
            &raw[..raw.len().min(4)]
        ))
        .into())
    }
}

pub fn first_server_address(game_dir: &Path) -> Result<Option<String>> {
    let path = game_dir.join("servers.dat");
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read(&path)
        .map_err(|e| LauncherError::DiskIo(format!("Не удалось открыть {path:?}: {e:#}")))?;
    let data = decode_nbt_container(raw, &path)?;

    let root: ServersDatRoot = fastnbt::from_bytes(data.as_slice()).map_err(|e| {
        LauncherError::ManifestParse(format!("Не удалось разобрать {path:?}: {e:#}"))
    })?;

    Ok(root
        .servers
        .first()
        .and_then(|entry| entry.ip.clone())
        .map(|ip| ip.trim().to_string())
        .filter(|ip| !ip.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::auto_join_args;

    #[test]
    fn quick_play_for_modern_versions() {
        assert_eq!(
            auto_join_args("play.example.com", "1.21.1"),
            vec![
                "--quickPlayMultiplayer".to_string(),
                "play.example.com".to_string()
            ]
        );
        assert_eq!(
            auto_join_args("play.example.com:25577", "1.20.3"),
            vec![
                "--quickPlayMultiplayer".to_string(),
                "play.example.com:25577".to_string()
            ]
        );
    }

    #[test]
    fn legacy_server_args_for_old_versions() {
        assert_eq!(
            auto_join_args("play.example.com", "1.19.4"),
            vec!["--server".to_string(), "play.example.com".to_string()]
        );
        assert_eq!(
            auto_join_args("play.example.com:25577", "1.12.2"),
            vec![
                "--server".to_string(),
                "play.example.com".to_string(),
                "--port".to_string(),
                "25577".to_string()
            ]
        );
    }

    #[test]
    fn quick_play_boundary_is_1_20_3() {
        assert_eq!(
            auto_join_args("play.example.com:25565", "1.20.2"),
            vec![
                "--server".to_string(),
                "play.example.com".to_string(),
                "--port".to_string(),
                "25565".to_string()
            ],
            "quick play появился только в 1.20.3 (снапшот 23w41a)"
        );
        assert_eq!(
            auto_join_args("play.example.com", "1.20"),
            vec!["--server".to_string(), "play.example.com".to_string()]
        );
        assert_eq!(
            auto_join_args("play.example.com", "1.20.3"),
            vec![
                "--quickPlayMultiplayer".to_string(),
                "play.example.com".to_string()
            ]
        );
    }

    #[test]
    fn suffixed_versions_use_base_version_for_boundary() {
        assert_eq!(
            auto_join_args("play.example.com", "1.20.1-forge"),
            vec!["--server".to_string(), "play.example.com".to_string()]
        );
        assert_eq!(
            auto_join_args("play.example.com", "1.21.1-fabric0.16.9"),
            vec![
                "--quickPlayMultiplayer".to_string(),
                "play.example.com".to_string()
            ]
        );
    }

    #[test]
    fn empty_address_produces_no_args() {
        assert!(auto_join_args("", "1.21.1").is_empty());
        assert!(auto_join_args("   ", "1.19.4").is_empty());
    }

    #[test]
    fn address_with_empty_port_strips_trailing_colon() {
        assert_eq!(
            auto_join_args("play.example.com:", "1.21.1"),
            vec![
                "--quickPlayMultiplayer".to_string(),
                "play.example.com".to_string()
            ]
        );
        assert_eq!(
            auto_join_args("play.example.com:", "1.12.2"),
            vec!["--server".to_string(), "play.example.com".to_string()]
        );
    }

    #[test]
    fn ipv6_with_brackets_splits_host_and_port() {
        assert_eq!(
            auto_join_args("[::1]:25565", "1.21.1"),
            vec![
                "--quickPlayMultiplayer".to_string(),
                "[::1]:25565".to_string()
            ]
        );
        assert_eq!(
            auto_join_args("[2001:db8::1]", "1.12.2"),
            vec!["--server".to_string(), "2001:db8::1".to_string()]
        );
        assert_eq!(
            auto_join_args("[::1]:25565", "1.12.2"),
            vec![
                "--server".to_string(),
                "::1".to_string(),
                "--port".to_string(),
                "25565".to_string()
            ]
        );
    }

    #[test]
    fn bare_ipv6_is_passed_verbatim_without_port() {
        assert_eq!(
            auto_join_args("::1", "1.21.1"),
            vec!["--quickPlayMultiplayer".to_string(), "::1".to_string()]
        );
        assert_eq!(
            auto_join_args("2001:db8::1:25565", "1.19.4"),
            vec!["--server".to_string(), "2001:db8::1:25565".to_string()]
        );
    }
}

#[cfg(test)]
mod servers_dat_tests {
    use super::first_server_address;
    use crate::test_support::{write_servers_dat, ServersDatContainer, TempDir};

    #[test]
    fn reads_first_server_ip() {
        let dir = TempDir::new("servers_dat_ok");
        write_servers_dat(&dir.0, "play.example.com:25565", ServersDatContainer::Raw);

        assert_eq!(
            first_server_address(&dir.0).expect("чтение servers.dat"),
            Some("play.example.com:25565".to_string())
        );
    }

    #[test]
    fn reads_first_server_ip_from_gzip() {
        let dir = TempDir::new("servers_dat_gzip");
        write_servers_dat(&dir.0, "play.example.com:25565", ServersDatContainer::Gzip);

        assert_eq!(
            first_server_address(&dir.0).expect("чтение servers.dat"),
            Some("play.example.com:25565".to_string())
        );
    }

    #[test]
    fn reads_first_server_ip_from_zlib() {
        let dir = TempDir::new("servers_dat_zlib");
        write_servers_dat(&dir.0, "play.example.com:25565", ServersDatContainer::Zlib);

        assert_eq!(
            first_server_address(&dir.0).expect("чтение servers.dat"),
            Some("play.example.com:25565".to_string())
        );
    }

    #[test]
    fn garbage_file_is_error() {
        let dir = TempDir::new("servers_dat_garbage");
        std::fs::write(dir.0.join("servers.dat"), b"PK\x03\x04fake zip").expect("запись мусора");

        let err = first_server_address(&dir.0).expect_err("мусор должен дать ошибку");
        assert!(err.to_string().contains("Неизвестный формат"));
    }

    #[test]
    fn missing_servers_dat_is_none() {
        let dir = TempDir::new("servers_dat_missing");

        assert_eq!(first_server_address(&dir.0).expect("нет файла"), None);
    }
}
