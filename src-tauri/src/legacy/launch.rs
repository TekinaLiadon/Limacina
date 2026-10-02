use std::io::Read;
use std::path::Path;

use anyhow::{bail, Context, Result};

use crate::legacy::protocol::HWriter;
use crate::legacy::requests::{LegacyClient, LegacySession};
use crate::legacy::types::{write_player_profile, PlayerProfile};
use crate::legacy::update::{
    ensure_launcher_jar, load_auth_cache, read_hdir_blobs, refresh_hdir_blobs, LegacyPaths,
};
use crate::log_info;
use crate::minecraft::structs::GameConfig;
use crate::state::dto::{LegacyProfile, ProjectConfig};
use crate::utils::blocking;

const CLIENT_LAUNCHER_MARKER: &[u8] = b"ClientLauncherParams";

pub async fn build_game_config(
    project: &ProjectConfig,
    profile: &LegacyProfile,
    username: &str,
    uuid: &str,
    access_token: &str,
) -> Result<GameConfig> {
    let base_url = legacy_base_url(project)?;
    let client = LegacyClient::new(&base_url)?;
    let paths = LegacyPaths::new(&project.project_name)?;
    let (launcher_jar, jar_sign, _) = ensure_launcher_jar(&client, &paths).await?;

    let session = LegacySession {
        username,
        access_token,
    };
    refresh_hdir_blobs(&client, session, profile, &paths).await?;
    let (jvm_blob, asset_blob, client_blob) = read_hdir_blobs(&paths).await?;
    let profile_signed = tokio::fs::read(paths.profile_signed())
        .await
        .context("Не удалось прочитать подписанный профиль")?;

    let player = load_auth_cache(&paths).unwrap_or_else(|| PlayerProfile {
        uuid: uuid.to_string(),
        username: username.to_string(),
        skin: None,
        cloak: None,
    });

    let java_path = paths.java_executable(profile);
    if !java_path.exists() {
        bail!(
            "JVM «{}» не установлена — запустите обновление файлов",
            paths.jvm_dir_name(profile)
        );
    }
    let client_dir = paths.client_dir(profile);
    let asset_dir = paths.asset_dir(profile);

    let ram_mb = parse_ram_mb(&project.max_memory);
    let mut params = write_params(
        &jar_sign,
        &asset_dir,
        &client_dir,
        &player,
        access_token,
        project.auto_join_server,
        ram_mb,
    );
    params.extend_from_slice(&profile_signed);
    params.extend_from_slice(&jvm_blob);
    params.extend_from_slice(&asset_blob);
    params.extend_from_slice(&client_blob);
    let params_path = paths.client_params();
    crate::utils::download_file::write_atomic(&params_path, &params).await?;

    let launcher_class = {
        let jar_for_scan = launcher_jar.clone();
        blocking(
            "Не удалось найти бутстрап лаунчера",
            move || find_client_launcher_class(&jar_for_scan),
        )
        .await??
    };
    log_info!("[legacy] Бутстрап клиента: {launcher_class}");

    let mut jvm_args: Vec<String> = Vec::new();
    if ram_mb > 0 {
        jvm_args.push(format!("-Xms{ram_mb}M"));
        jvm_args.push(format!("-Xmx{ram_mb}M"));
    }
    if cfg!(target_os = "windows") {
        jvm_args.push("-Dos.name=Windows 10".to_string());
        jvm_args.push("-Dos.version=10.0".to_string());
    }
    jvm_args.push(format!(
        "-Djava.library.path={}",
        client_dir.join("natives").display()
    ));
    jvm_args.extend(
        profile
            .jvm_args
            .iter()
            .filter(|arg| !arg.is_empty())
            .cloned(),
    );

    Ok(GameConfig::new(
        java_path,
        jvm_args,
        vec![params_path.to_string_lossy().into_owned()],
        vec![launcher_jar.to_string_lossy().into_owned()],
        launcher_class,
        client_dir,
    ))
}

fn write_params(
    jar_sign: &[u8],
    asset_dir: &Path,
    client_dir: &Path,
    player: &PlayerProfile,
    access_token: &str,
    auto_enter: bool,
    ram_mb: u32,
) -> Vec<u8> {
    let mut writer = HWriter::new();
    writer.write_fixed(jar_sign);
    writer.write_string(&asset_dir.to_string_lossy());
    writer.write_string(&client_dir.to_string_lossy());
    write_player_profile(&mut writer, player);
    writer.write_int(access_token.len() as i32);
    writer.write_fixed(access_token.as_bytes());
    writer.write_bool(auto_enter);
    writer.write_bool(false);
    writer.write_varint(ram_mb);
    writer.write_varint(0);
    writer.write_varint(0);
    writer.into_inner()
}

fn parse_ram_mb(value: &str) -> u32 {
    let trimmed = value.trim().to_ascii_lowercase();
    let number = trimmed.strip_prefix("-xmx").unwrap_or(&trimmed);
    let (digits, multiplier) = if let Some(rest) = number.strip_suffix('g') {
        (rest, 1024u32)
    } else if let Some(rest) = number.strip_suffix('m') {
        (rest, 1u32)
    } else if let Some(rest) = number.strip_suffix('k') {
        (rest, 0u32)
    } else {
        (number, 1u32)
    };
    let parsed: u32 = digits.trim().parse().unwrap_or(0);
    (parsed.saturating_mul(multiplier) / 256) * 256
}

pub fn find_client_launcher_class(jar: &Path) -> Result<String> {
    let file = std::fs::File::open(jar)
        .with_context(|| format!("Не удалось открыть {}", jar.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("Не удалось прочитать {}", jar.display()))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if !entry.name().ends_with(".class") {
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        if contains_marker(&bytes, CLIENT_LAUNCHER_MARKER) {
            let name = entry.name().trim_end_matches(".class").replace('/', ".");
            return Ok(name);
        }
    }
    bail!("Не удалось найти бутстрап-класс клиента в launcher.jar")
}

fn contains_marker(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

pub fn legacy_base_url(project: &ProjectConfig) -> Result<String> {
    project
        .resolved_server_url()
        .ok_or_else(|| anyhow::anyhow!("Легаси-сервер не настроен в сборке"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ram_mb_understands_memory_args() {
        assert_eq!(parse_ram_mb("-Xmx4G"), 4096);
        assert_eq!(parse_ram_mb("-Xmx4096M"), 4096);
        assert_eq!(parse_ram_mb("-Xmx3500M"), 3328, "округление вниз до 256");
        assert_eq!(parse_ram_mb("-Xmx512M"), 512);
        assert_eq!(parse_ram_mb("мусор"), 0);
        assert_eq!(parse_ram_mb("-Xms512M"), 0, "не -Xmx аргумент даёт ноль");
    }

    #[test]
    fn params_binary_matches_client_launcher_layout() {
        let player = PlayerProfile {
            uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5".to_string(),
            username: "TechSherl".to_string(),
            skin: Some(crate::legacy::types::LegacyTextures {
                url: "https://example.com/skin.png".to_string(),
                digest: [3u8; 32],
            }),
            cloak: None,
        };
        let jar_sign = vec![0xABu8; 256];
        let params = write_params(
            &jar_sign,
            Path::new("C:/game/assets"),
            Path::new("C:/game/client"),
            &player,
            "token123",
            true,
            4096,
        );

        use crate::legacy::protocol::HReader;
        let mut reader = HReader::new(&params);
        assert_eq!(
            reader.read_fixed(256).expect("подпись jar"),
            jar_sign.as_slice()
        );
        assert_eq!(reader.read_string(0).expect("assetDir"), "C:/game/assets");
        assert_eq!(reader.read_string(0).expect("clientDir"), "C:/game/client");
        let parsed = crate::legacy::types::read_player_profile(&mut reader).expect("профиль");
        assert_eq!(parsed, player);
        let token_len = reader.read_int().expect("длина токена");
        assert_eq!(token_len, 8);
        assert_eq!(reader.read_fixed(8).expect("токен"), b"token123");
        assert!(reader.read_bool().expect("autoEnter"));
        assert!(!reader.read_bool().expect("fullScreen"));
        assert_eq!(reader.read_varint().expect("ram"), 4096);
        assert_eq!(reader.read_varint().expect("width"), 0);
        assert_eq!(reader.read_varint().expect("height"), 0);
        assert_eq!(reader.remaining(), 0, "params исчерпаны полностью");
    }

    #[test]
    fn find_client_launcher_class_scans_jar_entries() {
        use crate::test_support::TempDir;

        let root = TempDir::new("legacy_class_scan");
        let jar = root.0.join("launcher.jar");
        crate::test_support::write_test_zip(
            &jar,
            &[
                ("launcher/Other.class", b"unrelated bytes" as &[u8]),
                (
                    "launcher/bjongsV.class",
                    b"....ClientLauncherParams....meta",
                ),
            ],
        );

        let found = find_client_launcher_class(&jar).expect("класс находится");
        assert_eq!(found, "launcher.bjongsV");
    }

    #[test]
    fn find_client_launcher_class_errors_without_marker() {
        use crate::test_support::TempDir;

        let root = TempDir::new("legacy_class_scan_empty");
        let jar = root.0.join("launcher.jar");
        crate::test_support::write_test_zip(&jar, &[("launcher/Other.class", b"nothing")]);

        let error = find_client_launcher_class(&jar).expect_err("маркер не найден");
        assert!(error.to_string().contains("бутстрап-класс"), "{error}");
    }
}
