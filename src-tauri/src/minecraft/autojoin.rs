use anyhow::{Context, Result};
use std::cmp::Ordering;
use std::io::Read;
use std::path::Path;

use crate::utils::compare_versions;

fn split_server_address(address: &str) -> (&str, Option<&str>) {
    let address = address.trim_end_matches(':');
    match address.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => {
            (host, Some(port))
        }
        _ => (address, None),
    }
}

pub fn auto_join_args(address: &str, mc_version: &str) -> Vec<String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let (host, port) = split_server_address(trimmed);
    let base_version = mc_version.split('-').next().unwrap_or(mc_version);

    if compare_versions(base_version, "1.20") != Ordering::Less {
        match port {
            Some(port) => vec![
                "--quickPlayMultiplayer".to_string(),
                format!("{}:{}", host, port),
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
            .with_context(|| format!("Не удалось распаковать {:?}", path))?;
        Ok(data)
    } else if is_zlib_header(&raw) {
        let mut data = Vec::new();
        flate2::read::ZlibDecoder::new(raw.as_slice())
            .read_to_end(&mut data)
            .with_context(|| format!("Не удалось распаковать {:?}", path))?;
        Ok(data)
    } else if raw.first().is_some_and(|byte| *byte <= 12) {
        Ok(raw)
    } else {
        anyhow::bail!(
            "Неизвестный формат NBT файла {:?} (первые байты: {:02x?})",
            path,
            &raw[..raw.len().min(4)]
        )
    }
}

pub fn first_server_address(game_dir: &Path) -> Result<Option<String>> {
    let path = game_dir.join("servers.dat");
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read(&path).with_context(|| format!("Не удалось открыть {:?}", path))?;
    let data = decode_nbt_container(raw, &path)?;

    let root: ServersDatRoot = fastnbt::from_bytes(data.as_slice())
        .with_context(|| format!("Не удалось разобрать {:?}", path))?;

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
            auto_join_args("play.example.com:25577", "1.20"),
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
}

#[cfg(test)]
mod servers_dat_tests {
    use super::first_server_address;
    use std::io::Write;
    use std::path::Path;

    enum Container {
        Raw,
        Gzip,
        Zlib,
    }

    fn write_servers_dat(dir: &Path, ip: &str, container: Container) {
        let mut nbt = Vec::new();
        nbt.push(0x0A);
        nbt.extend_from_slice(&0u16.to_be_bytes());
        nbt.push(0x09);
        nbt.extend_from_slice(&7u16.to_be_bytes());
        nbt.extend_from_slice(b"servers");
        nbt.push(0x0A);
        nbt.extend_from_slice(&1u32.to_be_bytes());
        nbt.push(0x08);
        nbt.extend_from_slice(&2u16.to_be_bytes());
        nbt.extend_from_slice(b"ip");
        nbt.extend_from_slice(&(ip.len() as u16).to_be_bytes());
        nbt.extend_from_slice(ip.as_bytes());
        nbt.push(0x00);
        nbt.push(0x00);

        let bytes = match container {
            Container::Raw => nbt,
            Container::Gzip => {
                let mut encoder =
                    flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
                encoder.write_all(&nbt).expect("gzip сжатие");
                encoder.finish().expect("завершение gzip")
            }
            Container::Zlib => {
                let mut encoder =
                    flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
                encoder.write_all(&nbt).expect("zlib сжатие");
                encoder.finish().expect("завершение zlib")
            }
        };
        std::fs::write(dir.join("servers.dat"), bytes).expect("запись servers.dat");
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("создание временной папки");
        dir
    }

    #[test]
    fn reads_first_server_ip() {
        let dir = temp_dir("limacina_servers_dat_ok");
        write_servers_dat(&dir, "play.example.com:25565", Container::Raw);

        assert_eq!(
            first_server_address(&dir).expect("чтение servers.dat"),
            Some("play.example.com:25565".to_string())
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_first_server_ip_from_gzip() {
        let dir = temp_dir("limacina_servers_dat_gzip");
        write_servers_dat(&dir, "play.example.com:25565", Container::Gzip);

        assert_eq!(
            first_server_address(&dir).expect("чтение servers.dat"),
            Some("play.example.com:25565".to_string())
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_first_server_ip_from_zlib() {
        let dir = temp_dir("limacina_servers_dat_zlib");
        write_servers_dat(&dir, "play.example.com:25565", Container::Zlib);

        assert_eq!(
            first_server_address(&dir).expect("чтение servers.dat"),
            Some("play.example.com:25565".to_string())
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn garbage_file_is_error() {
        let dir = temp_dir("limacina_servers_dat_garbage");
        std::fs::write(dir.join("servers.dat"), b"PK\x03\x04fake zip").expect("запись мусора");

        let err = first_server_address(&dir).expect_err("мусор должен дать ошибку");
        assert!(err.to_string().contains("Неизвестный формат"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_servers_dat_is_none() {
        let dir = temp_dir("limacina_servers_dat_missing");

        assert_eq!(first_server_address(&dir).expect("нет файла"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
