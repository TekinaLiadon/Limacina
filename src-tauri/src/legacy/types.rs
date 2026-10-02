use anyhow::{bail, Result};

use crate::legacy::protocol::{HReader, HWriter};
use crate::state::dto::LegacyProfile;

pub const PUBLIC_KEY_DER: &[u8] = &[
    0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00, 0x30, 0x82, 0x01, 0x0a, 0x02, 0x82, 0x01, 0x01,
    0x00, 0x83, 0xfa, 0xd8, 0x97, 0xd8, 0x2c, 0x26, 0x7b, 0x3a, 0xa4, 0xa4, 0x88, 0xcd, 0x4b, 0x9f,
    0x92, 0xe9, 0x87, 0x30, 0x30, 0x12, 0x30, 0xd4, 0x86, 0xea, 0xde, 0xb9, 0xaa, 0xb0, 0x5d, 0xd0,
    0x47, 0xc7, 0x4c, 0xe6, 0xc8, 0x40, 0x63, 0x03, 0x8e, 0x2e, 0xc5, 0x80, 0x3a, 0xcc, 0x39, 0xe9,
    0x50, 0x7d, 0x7e, 0xc4, 0xbc, 0xb5, 0x91, 0xdc, 0x6b, 0x1e, 0x0a, 0x78, 0x30, 0x22, 0x39, 0x25,
    0xfb, 0x66, 0x06, 0x84, 0x65, 0x22, 0x2b, 0xad, 0xd9, 0xe3, 0xfe, 0xa2, 0x9e, 0x05, 0x61, 0xea,
    0xd9, 0xcd, 0xb4, 0xae, 0x6e, 0x20, 0x15, 0x49, 0xac, 0x5d, 0xc0, 0xe7, 0xbe, 0x3e, 0x43, 0x5a,
    0x33, 0xf7, 0xcf, 0xb2, 0xf6, 0xa1, 0x36, 0x8a, 0xdb, 0x81, 0xd2, 0xa1, 0xbc, 0xe1, 0xf0, 0x8c,
    0xf2, 0x1d, 0x0d, 0x8e, 0x9a, 0xe8, 0x89, 0x5f, 0x02, 0x9b, 0xba, 0xd1, 0xdc, 0xb3, 0x66, 0x9d,
    0x8c, 0x00, 0x85, 0xba, 0x9b, 0xdc, 0x56, 0x50, 0x21, 0xed, 0x9f, 0x84, 0xa0, 0x58, 0x9f, 0xff,
    0x29, 0xb2, 0x69, 0x05, 0x76, 0xd0, 0x79, 0x75, 0xda, 0x2e, 0xcb, 0xf3, 0xfc, 0xbb, 0x28, 0x25,
    0x55, 0x99, 0x95, 0x69, 0xab, 0x3b, 0xbb, 0x55, 0xf8, 0x6b, 0x20, 0x63, 0xb6, 0x93, 0xaf, 0x04,
    0xc0, 0xc9, 0xf3, 0x30, 0x6c, 0x96, 0xbf, 0x86, 0xeb, 0x88, 0xa1, 0xa2, 0x8a, 0x5e, 0xf9, 0x09,
    0xb6, 0x75, 0x1f, 0x38, 0xea, 0x1d, 0x18, 0x85, 0x86, 0x62, 0xa6, 0xac, 0xee, 0xd1, 0x95, 0x73,
    0xc0, 0xa6, 0xe3, 0x2f, 0x9b, 0x49, 0x05, 0xf1, 0x26, 0x96, 0xf0, 0x79, 0xf0, 0xd1, 0x57, 0xfa,
    0x31, 0x54, 0xa8, 0x3d, 0xfe, 0x18, 0xd8, 0x77, 0x96, 0xef, 0x76, 0x51, 0x66, 0x40, 0x1f, 0x3f,
    0xe1, 0xc5, 0x1c, 0xce, 0x67, 0x3d, 0x0f, 0xaa, 0x58, 0x3b, 0xb3, 0x8e, 0x6d, 0x83, 0x9e, 0xd2,
    0x1b, 0x02, 0x03, 0x01, 0x00, 0x01,
];

const ENTRY_BLOCK: u32 = 1;
const ENTRY_BOOLEAN: u32 = 2;
const ENTRY_INTEGER: u32 = 3;
const ENTRY_STRING: u32 = 4;
const ENTRY_LIST: u32 = 5;

#[derive(Debug, Clone, PartialEq)]
pub enum ConfigEntry {
    Block(Vec<(String, ConfigEntry)>),
    Boolean(bool),
    Integer(u64),
    String(String),
    List(Vec<ConfigEntry>),
}

pub fn read_entry(reader: &mut HReader) -> Result<ConfigEntry> {
    match reader.read_varint()? {
        ENTRY_BOOLEAN => Ok(ConfigEntry::Boolean(reader.read_bool()?)),
        ENTRY_INTEGER => Ok(ConfigEntry::Integer(reader.read_varlong()?)),
        ENTRY_STRING => Ok(ConfigEntry::String(reader.read_string(0)?)),
        ENTRY_LIST => {
            let count = reader.read_varint()? as usize;
            let mut items = Vec::with_capacity(count.min(1024));
            for _ in 0..count {
                items.push(read_entry(reader)?);
            }
            Ok(ConfigEntry::List(items))
        }
        ENTRY_BLOCK => {
            let count = reader.read_varint()? as usize;
            let mut entries = Vec::with_capacity(count.min(1024));
            for _ in 0..count {
                let name = reader.read_string(255)?;
                entries.push((name, read_entry(reader)?));
            }
            Ok(ConfigEntry::Block(entries))
        }
        other => bail!("Неизвестный тип конфиг-записи: {other}"),
    }
}

fn require_string<'a>(entries: &'a [(String, ConfigEntry)], key: &str) -> Result<&'a str> {
    match entries.iter().find(|(name, _)| name == key) {
        Some((_, ConfigEntry::String(value))) => Ok(value),
        Some((name, _)) => bail!("Запись «{name}» должна быть строкой"),
        None => bail!("В профиле отсутствует запись «{key}»"),
    }
}

fn require_integer(entries: &[(String, ConfigEntry)], key: &str) -> Result<u64> {
    match entries.iter().find(|(name, _)| name == key) {
        Some((_, ConfigEntry::Integer(value))) => Ok(*value),
        Some((name, _)) => bail!("Запись «{name}» должна быть числом"),
        None => bail!("В профиле отсутствует запись «{key}»"),
    }
}

fn require_boolean(entries: &[(String, ConfigEntry)], key: &str) -> Result<bool> {
    match entries.iter().find(|(name, _)| name == key) {
        Some((_, ConfigEntry::Boolean(value))) => Ok(*value),
        Some((name, _)) => bail!("Запись «{name}» должна быть булевым значением"),
        None => bail!("В профиле отсутствует запись «{key}»"),
    }
}

fn require_string_list(entries: &[(String, ConfigEntry)], key: &str) -> Result<Vec<String>> {
    match entries.iter().find(|(name, _)| name == key) {
        Some((_, ConfigEntry::List(items))) => {
            let mut values = Vec::with_capacity(items.len());
            for item in items {
                match item {
                    ConfigEntry::String(value) => values.push(value.clone()),
                    other => bail!("Запись «{key}» должна быть списком строк, найдено {other:?}"),
                }
            }
            Ok(values)
        }
        Some((name, _)) => bail!("Запись «{name}» должна быть списком"),
        None => bail!("В профиле отсутствует запись «{key}»"),
    }
}

pub fn profile_from_block(block: &[(String, ConfigEntry)]) -> Result<LegacyProfile> {
    let port = require_integer(block, "serverPort")?;
    if port > u16::MAX as u64 {
        bail!("Некорректный порт сервера: {port}");
    }
    let sort_index = require_integer(block, "sortIndex")?;
    if sort_index > u32::MAX as u64 {
        bail!("Некорректный sortIndex профиля: {sort_index}");
    }
    Ok(LegacyProfile {
        version: require_string(block, "version")?.to_string(),
        asset_index: require_string(block, "assetIndex")?.to_string(),
        dir_name: require_string(block, "dir")?.to_string(),
        asset_dir: require_string(block, "assetDir")?.to_string(),
        sort_index: sort_index as u32,
        server_address: require_string(block, "serverAddress")?.to_string(),
        server_port: port as u16,
        jvm_version: require_string(block, "jvmVersion")?.to_string(),
        update_fast_check: require_boolean(block, "updateFastCheck")?,
        update: require_string_list(block, "update")?,
        update_verify: require_string_list(block, "updateVerify")?,
        update_exclusions: require_string_list(block, "updateExclusions")?,
        main_class: require_string(block, "mainClass")?.to_string(),
        class_path: require_string_list(block, "classPath")?,
        jvm_args: require_string_list(block, "jvmArgs")?,
        client_args: require_string_list(block, "clientArgs")?,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct LegacyTextures {
    pub url: String,
    pub digest: [u8; 32],
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerProfile {
    pub uuid: String,
    pub username: String,
    pub skin: Option<LegacyTextures>,
    pub cloak: Option<LegacyTextures>,
}

fn read_textures(reader: &mut HReader) -> Result<LegacyTextures> {
    let url = reader.read_string(2048)?;
    let digest: [u8; 32] = reader
        .read_fixed(32)?
        .try_into()
        .expect("фиксированные 32 байта дайджеста");
    Ok(LegacyTextures { url, digest })
}

pub fn read_player_profile(reader: &mut HReader) -> Result<PlayerProfile> {
    let uuid = reader.read_fixed(16)?;
    let uuid = format_uuid(uuid);
    let username = reader.read_string(64)?;
    let skin = if reader.read_bool()? {
        Some(read_textures(reader)?)
    } else {
        None
    };
    let cloak = if reader.read_bool()? {
        Some(read_textures(reader)?)
    } else {
        None
    };
    Ok(PlayerProfile {
        uuid,
        username,
        skin,
        cloak,
    })
}

pub fn write_player_profile(writer: &mut HWriter, profile: &PlayerProfile) {
    writer.write_fixed(&parse_uuid(&profile.uuid));
    writer.write_string(&profile.username);
    write_textures(writer, &profile.skin);
    write_textures(writer, &profile.cloak);
}

fn write_textures(writer: &mut HWriter, textures: &Option<LegacyTextures>) {
    match textures {
        Some(textures) => {
            writer.write_bool(true);
            writer.write_string(&textures.url);
            writer.write_fixed(&textures.digest);
        }
        None => writer.write_bool(false),
    }
}

pub fn format_uuid(bytes: &[u8]) -> String {
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

pub fn parse_uuid(uuid: &str) -> [u8; 16] {
    let hex: String = uuid.chars().filter(|c| *c != '-').collect();
    let mut bytes = [0u8; 16];
    for (index, chunk) in hex.as_bytes().chunks(2).enumerate() {
        if index >= 16 {
            break;
        }
        let high = (chunk.first().copied().unwrap_or(b'0') as char)
            .to_digit(16)
            .unwrap_or(0) as u8;
        let low = chunk
            .get(1)
            .map(|b| *b as char)
            .unwrap_or('0')
            .to_digit(16)
            .unwrap_or(0) as u8;
        bytes[index] = (high << 4) | low;
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    mod hex_test_helper {
        pub fn decode(input: &str) -> Vec<u8> {
            let cleaned: String = input
                .chars()
                .filter(|c| !c.is_whitespace() && *c != '"')
                .collect();
            (0..cleaned.len() / 2)
                .map(|index| {
                    u8::from_str_radix(&cleaned[index * 2..index * 2 + 2], 16)
                        .expect("корректный hex в фикстуре")
                })
                .collect()
        }
    }

    use hex_test_helper::decode;

    const REAL_PROFILE_HEX: &str = concat!(
        "110776657273696f6e0406312e31362e350a6173736574496e6465780406312e31362e350364697204115374617267617a657250726f6c6f67756508",
        "6173736574446972040b6173736574312e31362e3509736f7274496e6465780300057469746c6504115374617267617a657250726f6c6f6775650d73",
        "657276657241646472657373040a6e6f6e616d65732e73750a736572766572506f727403c9c7010a6a766d56657273696f6e040a677261616c766d2d",
        "31310f75706461746546617374436865636b0201067570646174650501040c736572766572735c2e6461740c75706461746556657269667905060409",
        "6c696272617269657304076e61746976657304046d6f6473040a6f70656e6c6f6164657204097265736f7572636573040e6d696e6563726166745c2e",
        "6a6172107570646174654578636c7573696f6e73050104116f70656e6c6f616465722f2e6361636865096d61696e436c617373041d6370772e6d6f64",
        "732e6d6f646c61756e636865722e4c61756e6368657209636c6173735061746805030409666f7267652e6a6172040d6d696e6563726166742e6a6172",
        "04096c6962726172696573076a766d417267730502042a2d446c61756e636865722e646972776174636865722e69676e6f72654f766572666c6f7773",
        "3d74727565042c2d446d6f6465726e6669782e756e737570706f727465642e616c6c6f774f766572726964696e673d747275650a636c69656e744172",
        "6773050a040e2d2d6c61756e63685461726765740409666d6c636c69656e7404122d2d666d6c2e666f72676556657273696f6e040733362e322e3339",
        "040f2d2d666d6c2e6d6356657273696f6e0406312e31362e3504102d2d666d6c2e666f72676547726f757004126e65742e6d696e656372616674666f",
        "72676504102d2d666d6c2e6d637056657273696f6e040f32303231303131352e313131353530",
    );

    const REAL_PROFILE_SIGN_HEX: &str = concat!(
        "8285463d7a1d83c12eca2fbb99eaff256509fb204cf5e6f46dae190c61ff5dc09c8d68505955f00d250eca90a977faf11b7c9f41bdb6f5f11e803b69",
        "2d562c9ddf3242c19566408c9ca16343b9756101f93aa94f354a90d03a9dc56dab7918365daf3df8ec596628fe0d07013a4d8a235e500d05e48f68d4",
        "682c605e7b805a6cefe10dba38c2379616c6b725f648f89a9dbc41104b8f19dfb70244036002e7291a5f5830aa64835bc7795e9caba6a197fde376bc",
        "966e63f27aaf10c7031d5ef4c0f610845a241184ba1e4a6e09e1abc2228f951ab041b1669d68bb4da5e46d843d016f44d10ee18485cdeb081befe93d",
        "f273ed2aeb0fa6c144d23e7045720046",
    );

    fn parse_real_profile_block() -> Vec<(String, ConfigEntry)> {
        let bytes = decode(REAL_PROFILE_HEX);
        let mut reader = HReader::new(&bytes);
        let count = reader.read_varint().expect("счётчик записей");
        let mut entries = Vec::new();
        for _ in 0..count {
            let name = reader.read_string(255).expect("имя записи");
            entries.push((name, read_entry(&mut reader).expect("значение записи")));
        }
        assert_eq!(reader.remaining(), 0, "профиль должен читаться без остатка");
        entries
    }

    #[test]
    fn real_server_profile_parses_fully() {
        let entries = parse_real_profile_block();

        let profile = profile_from_block(&entries).expect("профиль разбирается");
        assert_eq!(profile.version, "1.16.5");
        assert_eq!(profile.dir_name, "StargazerPrologue");
        assert_eq!(profile.asset_dir, "asset1.16.5");
        assert_eq!(profile.sort_index, 0);
        assert_eq!(profile.server_address, "nonames.su");
        assert_eq!(profile.server_port, 25545);
        assert_eq!(profile.jvm_version, "graalvm-11");
        assert!(profile.update_fast_check);
        assert_eq!(profile.update, vec!["servers\\.dat"]);
        assert_eq!(profile.main_class, "cpw.mods.modlauncher.Launcher");
        assert_eq!(
            profile.class_path,
            vec!["forge.jar", "minecraft.jar", "libraries"]
        );
        assert!(profile.client_args.contains(&"--launchTarget".to_string()));
    }

    #[test]
    fn real_profile_signature_verifies_with_pinned_key() {
        let entries = parse_real_profile_block();
        let mut writer = HWriter::new();
        writer.write_varint(entries.len() as u32);
        for (name, entry) in entries {
            writer.write_string(&name);
            write_entry(&mut writer, &entry);
        }
        let serialized = writer.into_inner();
        assert_eq!(
            serialized,
            decode(REAL_PROFILE_HEX),
            "обратная сериализация совпадает с серверной"
        );

        let key = crate::legacy::crypto::parse_public_key(PUBLIC_KEY_DER).expect("ключ");
        crate::legacy::crypto::verify_sha256_with_rsa(
            &key,
            &serialized,
            &decode(REAL_PROFILE_SIGN_HEX),
        )
        .expect("реальная подпись профиля должна сходиться");
    }

    fn write_entry(writer: &mut HWriter, entry: &ConfigEntry) {
        match entry {
            ConfigEntry::Block(items) => {
                writer.write_varint(ENTRY_BLOCK);
                writer.write_varint(items.len() as u32);
                for (name, value) in items {
                    writer.write_string(name);
                    write_entry(writer, value);
                }
            }
            ConfigEntry::Boolean(value) => {
                writer.write_varint(ENTRY_BOOLEAN);
                writer.write_bool(*value);
            }
            ConfigEntry::Integer(value) => {
                writer.write_varint(ENTRY_INTEGER);
                writer.write_varlong(*value);
            }
            ConfigEntry::String(value) => {
                writer.write_varint(ENTRY_STRING);
                writer.write_string(value);
            }
            ConfigEntry::List(items) => {
                writer.write_varint(ENTRY_LIST);
                writer.write_varint(items.len() as u32);
                for item in items {
                    write_entry(writer, item);
                }
            }
        }
    }

    #[test]
    fn missing_profile_entry_reports_clear_error() {
        let entries = vec![(
            "version".to_string(),
            ConfigEntry::String("1.16.5".to_string()),
        )];
        let error = profile_from_block(&entries).expect_err("пустой профиль должен пасть");
        assert!(error.to_string().contains("serverPort"), "{error}");
    }

    #[test]
    fn wrong_entry_type_reports_clear_error() {
        let entries = vec![(
            "serverPort".to_string(),
            ConfigEntry::String("25545".to_string()),
        )];
        let error = profile_from_block(&entries).expect_err("строка вместо порта должна пасть");
        assert!(error.to_string().contains("числом"), "{error}");
    }

    #[test]
    fn unknown_entry_type_is_rejected() {
        let bytes = [17u8];
        let mut reader = HReader::new(&bytes);
        let error = read_entry(&mut reader).expect_err("тип 17 неизвестен");
        assert!(error.to_string().contains("Неизвестный тип"), "{error}");
    }

    #[test]
    fn player_profile_round_trip_with_textures() {
        let profile = PlayerProfile {
            uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5".to_string(),
            username: "TechSherl".to_string(),
            skin: Some(LegacyTextures {
                url: "https://example.com/skin.png".to_string(),
                digest: [7u8; 32],
            }),
            cloak: None,
        };
        let mut writer = HWriter::new();
        write_player_profile(&mut writer, &profile);
        let bytes = writer.into_inner();

        let mut reader = HReader::new(&bytes);
        let parsed = read_player_profile(&mut reader).expect("профиль читается");
        assert_eq!(parsed, profile);
        assert_eq!(reader.remaining(), 0);
    }

    #[test]
    fn player_profile_without_textures_round_trips() {
        let profile = PlayerProfile {
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            username: "NoSkin".to_string(),
            skin: None,
            cloak: None,
        };
        let mut writer = HWriter::new();
        write_player_profile(&mut writer, &profile);
        let bytes = writer.into_inner();

        let mut reader = HReader::new(&bytes);
        let parsed = read_player_profile(&mut reader).expect("профиль читается");
        assert_eq!(parsed.skin, None);
        assert_eq!(parsed.cloak, None);
    }

    #[test]
    fn uuid_formatting_matches_java_layout() {
        let bytes = [
            0x06, 0x9a, 0x79, 0xf4, 0x44, 0xe9, 0x47, 0x26, 0xa5, 0xbe, 0xfc, 0xa9, 0x0e, 0x38,
            0xaa, 0xf5,
        ];
        assert_eq!(format_uuid(&bytes), "069a79f4-44e9-4726-a5be-fca90e38aaf5");
        assert_eq!(parse_uuid("069a79f4-44e9-4726-a5be-fca90e38aaf5"), bytes);
    }

    #[test]
    fn texture_digest_is_fixed_32_bytes_without_prefix() {
        let url = "https://skin.example.com/steve.png";
        let mut bytes: Vec<u8> = Vec::new();
        bytes.extend_from_slice(&[16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        bytes.push(b"Steve".len() as u8);
        bytes.extend_from_slice(b"Steve");
        bytes.push(1);
        bytes.push(url.len() as u8);
        bytes.extend_from_slice(url.as_bytes());
        bytes.extend_from_slice(&[7u8; 32]);
        bytes.push(0);

        let mut reader = HReader::new(&bytes);
        let profile = read_player_profile(&mut reader).expect("профиль читается");
        assert_eq!(reader.remaining(), 0, "дайджест без префикса длины");
        let skin = profile.skin.expect("скин распознан");
        assert_eq!(skin.url, url);
        assert_eq!(skin.digest, [7u8; 32]);
    }
}
