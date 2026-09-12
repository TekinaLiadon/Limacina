use anyhow::{anyhow, Context, Result};
use md5::{Digest, Md5};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use std::{
    process::{Command, Stdio},
    thread,
};
use tauri::{AppHandle, Emitter};
use uuid::{Builder, Variant, Version};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::utils::logger_utils::send_game_output;
use crate::utils::{compare_versions, get_classpath_separator};
use crate::{log_err, log_info, minecraft::structs::GameConfig};


pub fn generate_offline_uuid(nickname: &str) -> String {
    log_info!("Генерация офлайн uuid");
    let data = format!("OfflinePlayer:{}", nickname);

    let hash = Md5::digest(data.as_bytes());

    let mut builder = Builder::from_bytes(hash.into());

    builder
        .set_variant(Variant::RFC4122)
        .set_version(Version::Md5);

    builder.into_uuid().to_string().replace("-", "")
}

fn parse_maven(coord: &str) -> Result<(String, String, String)> {
    let parts: Vec<&str> = coord.split(':').collect();
    let [group_id, artifact_id, version] = parts[..] else {
        anyhow::bail!("Некорректная Maven-координата: {}", coord);
    };
    if group_id.is_empty() || artifact_id.is_empty() || version.is_empty() {
        anyhow::bail!("Некорректная Maven-координата: {}", coord);
    }
    Ok((
        group_id.replace('.', "/"),
        artifact_id.to_string(),
        version.to_string(),
    ))
}

pub fn maven_to_path(name: &str) -> Result<PathBuf> {
    let (group_path, artifact_id, version) = parse_maven(name)?;
    let file_name = format!("{}-{}.jar", artifact_id, version);

    Ok(PathBuf::new()
        .join(&group_path)
        .join(&artifact_id)
        .join(&version)
        .join(&file_name))
}

pub fn maven_to_url(coord: &str, url: &str) -> Result<String> {
    let (group, artifact_id, version) = parse_maven(coord)?;

    Ok(format!(
        "{}/{}/{}/{}/{}-{}.jar",
        url, group, artifact_id, version, artifact_id, version
    ))
}

pub fn filter_classpath(classpath: Vec<String>) -> Vec<String> {
    let mut latest_versions: HashMap<String, String> = HashMap::new();
    for path_str in &classpath {
        if let Some((coord, version)) = extract_maven_info(path_str) {
            if let Some(existing_version) = latest_versions.get(&coord) {
                if compare_versions(&version, existing_version) == Ordering::Greater {
                    latest_versions.insert(coord, version);
                }
            } else {
                latest_versions.insert(coord, version);
            }
        }
    }

    let mut final_classpath = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for path_str in classpath {
        let normalized = path_str.replace('\\', "/");
        if !seen.contains(&normalized) {
            if let Some((coord, version)) = extract_maven_info(&path_str) {
                if let Some(latest) = latest_versions.get(&coord) {
                    if &version == latest {
                        final_classpath.push(path_str.clone());
                        seen.insert(normalized);
                    }
                }
            } else {
                final_classpath.push(path_str.clone());
                seen.insert(normalized);
            }
        }
    }

    final_classpath
}



pub fn strip_classpath_args(args: Vec<String>) -> Vec<String> {
    let mut result = Vec::with_capacity(args.len());
    let mut skip_next = false;

    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if arg == "-cp" {
            skip_next = true;
            continue;
        }
        if arg.contains("${classpath}") {
            continue;
        }
        result.push(arg);
    }

    result
}

fn extract_maven_info(path_str: &str) -> Option<(String, String)> {
    let normalized = path_str.replace('\\', "/");
    let path = Path::new(&normalized);
    let file_name = path.file_name()?.to_str()?;
    let version_dir = path.parent()?;
    let version = version_dir.file_name()?.to_str()?;
    let artifact_dir = version_dir.parent()?;
    let artifact_id = artifact_dir.file_name()?.to_str()?;

    if !file_name.starts_with(artifact_id) || !file_name.contains(version) {
        return None;
    }

    let mut group_segments: Vec<&str> = Vec::new();
    let mut current = artifact_dir.parent()?;
    while let Some(segment) = current.file_name().and_then(|n| n.to_str()) {
        group_segments.push(segment);
        current = current.parent()?;
    }
    group_segments.reverse();

    Some((
        format!("{}:{}", group_segments.join("."), artifact_id),
        version.to_string(),
    ))
}

pub fn find_authlib_jar(game_dir: &Path) -> Option<PathBuf> {
    let jar = game_dir.join("authlib-injector.jar");
    if jar.exists() {
        log_info!("Найден authlib-injector: authlib-injector.jar");
        Some(jar)
    } else {
        None
    }
}

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

    let raw = std::fs::read(&path)
        .with_context(|| format!("Не удалось открыть {:?}", path))?;
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


const WINDOW_OPEN_MARKERS: &[&str] = &[
    "Reloading ResourceManager",
    "Sound engine started",
    "OpenAL initialized",
    "Backend library: LWJGL",
    "LWJGL Version:",
];


const OUTPUT_TAIL_LIMIT: usize = 20;
const ERROR_TAIL_LINES: usize = 5;

#[derive(Clone, Serialize)]
pub struct GameExitPayload {
    pub success: bool,
    pub code: Option<i32>,
}

pub struct GameProcess {
    window_opened: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    exit_status: Arc<StdMutex<Option<String>>>,
    last_output: Arc<StdMutex<VecDeque<String>>>,
}

impl GameProcess {
    pub fn exited_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.exited)
    }



    pub async fn wait_for_window(&self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            if self.window_opened.load(AtomicOrdering::Relaxed) {
                log_info!("Окно игры открыто");
                return Ok(());
            }
            if self.exited.load(AtomicOrdering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let status = self
                    .exit_status
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
                    .unwrap_or_else(|| "неизвестный статус".to_string());
                let tail = self.output_tail();
                let details = if tail.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", tail)
                };
                anyhow::bail!("Игра завершилась до открытия окна ({}){}", status, details);
            }
            if Instant::now() >= deadline {
                log_info!(
                    "Окно игры не обнаружено по логам за {} сек, ожидание прекращено",
                    timeout.as_secs()
                );
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    fn output_tail(&self) -> String {
        let log = self.last_output.lock().unwrap_or_else(|e| e.into_inner());
        let len = log.len();
        log.iter()
            .skip(len.saturating_sub(ERROR_TAIL_LINES))
            .cloned()
            .collect::<Vec<String>>()
            .join("\n")
    }

    pub fn has_exited(&self) -> bool {
        self.exited.load(AtomicOrdering::Relaxed)
    }

    pub fn window_opened(&self) -> bool {
        self.window_opened.load(AtomicOrdering::Relaxed)
    }
}

fn is_window_open_marker(line: &str) -> bool {
    WINDOW_OPEN_MARKERS.iter().any(|marker| line.contains(marker))
}

fn track_output(last_output: &StdMutex<VecDeque<String>>, line: &str) {
    let truncated: String = line.chars().take(300).collect();
    let mut log = last_output.lock().unwrap_or_else(|e| e.into_inner());
    if log.len() >= OUTPUT_TAIL_LIMIT {
        log.pop_front();
    }
    log.push_back(truncated);
}



fn spawn_output_reader(
    stream: impl Read + Send + 'static,
    last_output: Arc<StdMutex<VecDeque<String>>>,
    window_opened: Arc<AtomicBool>,
    is_error: bool,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            send_game_output(format!("[MC] {}", line), is_error);
            track_output(&last_output, &line);
            if !window_opened.load(AtomicOrdering::Relaxed) && is_window_open_marker(&line) {
                log_info!("Обнаружено открытие окна игры");
                window_opened.store(true, AtomicOrdering::Relaxed);
            }
        }
    });
}

pub fn spawn_game_process(
    app: AppHandle,
    config: GameConfig,
    server_url: Option<&str>,
) -> Result<GameProcess> {
    log_info!("\n▶ Запуск Minecraft...");
    log_info!("Main class: {}", &config.main_class);
    log_info!("Java: {:?}", &config.java_path);
    log_info!("Classpath entries: {}", config.classpath.len());

    if !config.java_path.exists() {
        log_err!("Java не найдена: {:?}", config.java_path);
        anyhow::bail!("Файл Java не найден: {:?}", config.java_path);
    }

    let mut command = Command::new(&config.java_path);
    let separator = get_classpath_separator();
    let classpath = &config.classpath.join(separator);
    let mut jvm_args: Vec<String> = config
        .jvm_args
        .iter().filter(|&arg| !arg.is_empty()).cloned()
        .collect();

    if let (Some(server_url), Some(authlib_path)) = (server_url, find_authlib_jar(&config.game_dir)) {
        let agent_arg = format!("-javaagent:{}={}", authlib_path.to_string_lossy(), server_url);
        log_info!("Authlib-injector: {}", agent_arg);
        jvm_args.insert(0, agent_arg);
    }

    log_info!("{}", classpath);
    log_info!("{}", jvm_args.join(" "));
    command
        .args(jvm_args)
        .arg("-cp")
        .arg(classpath)
        .arg(&config.main_class)
        .args(config.game_args)
        .current_dir(&config.game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());



    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .context("Не удалось запустить Java процесс")?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Не удалось получить stdout процесса"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Не удалось получить stderr процесса"))?;

    let process = GameProcess {
        window_opened: Arc::new(AtomicBool::new(false)),
        exited: Arc::new(AtomicBool::new(false)),
        exit_status: Arc::new(StdMutex::new(None)),
        last_output: Arc::new(StdMutex::new(VecDeque::new())),
    };

    spawn_output_reader(
        stdout,
        Arc::clone(&process.last_output),
        Arc::clone(&process.window_opened),
        false,
    );

    spawn_output_reader(
        stderr,
        Arc::clone(&process.last_output),
        Arc::clone(&process.window_opened),
        true,
    );

    let exited = Arc::clone(&process.exited);
    let exit_status = Arc::clone(&process.exit_status);
    thread::spawn(move || {
        let result = match child.wait() {
            Ok(status) => {
                log_info!("Minecraft завершился: {:?}", status);
                let _ = app.emit(
                    "game-exit",
                    GameExitPayload {
                        success: status.success(),
                        code: status.code(),
                    },
                );
                Some(status.to_string())
            }
            Err(e) => {
                log_err!("Ошибка ожидания процесса: {}", e);
                let _ = app.emit(
                    "game-exit",
                    GameExitPayload {
                        success: false,
                        code: None,
                    },
                );
                Some(format!("ошибка ожидания: {}", e))
            }
        };
        *exit_status.lock().unwrap_or_else(|e| e.into_inner()) = result;
        exited.store(true, AtomicOrdering::Relaxed);
        crate::discord::on_game_exit();
    });

    Ok(process)
}

#[cfg(test)]
mod tests {
    use super::auto_join_args;

    #[test]
    fn quick_play_for_modern_versions() {
        assert_eq!(
            auto_join_args("play.example.com", "1.21.1"),
            vec!["--quickPlayMultiplayer".to_string(), "play.example.com".to_string()]
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
            vec!["--quickPlayMultiplayer".to_string(), "play.example.com".to_string()]
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
                let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
                encoder.write_all(&nbt).expect("gzip сжатие");
                encoder.finish().expect("завершение gzip")
            }
            Container::Zlib => {
                let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
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

#[cfg(test)]
mod maven_coords_tests {
    use super::{maven_to_path, maven_to_url};

    #[test]
    fn path_for_valid_coordinate() {
        let path = maven_to_path("net.fabricmc:fabric-loader:0.16.9").expect("валидная координата");
        assert_eq!(
            path,
            std::path::PathBuf::from("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar")
        );
    }

    #[test]
    fn url_for_valid_coordinate() {
        let url = maven_to_url("net.fabricmc:fabric-loader:0.16.9", "https://maven.fabricmc.net")
            .expect("валидная координата");
        assert_eq!(
            url,
            "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"
        );
    }

    #[test]
    fn path_rejects_malformed_coordinates() {
        assert!(maven_to_path("fabric-loader").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:0.16.9:extra").is_err());
        assert!(maven_to_path("").is_err());
        assert!(maven_to_path(":fabric-loader:0.16.9").is_err());
        assert!(maven_to_path("net.fabricmc::0.16.9").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:").is_err());
    }

    #[test]
    fn url_rejects_malformed_coordinates() {
        assert!(maven_to_url("fabric-loader", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc:fabric-loader", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url(":fabric-loader:0.16.9", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc::0.16.9", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc:fabric-loader:", "https://maven.fabricmc.net").is_err());
    }
}

#[cfg(test)]
mod filter_classpath_tests {
    use super::filter_classpath;

    const WIN_SEP: bool = cfg!(windows);

    fn maven_path(group: &str, artifact: &str, version: &str) -> String {
        let sep = if WIN_SEP { "\\" } else { "/" };
        let group_path = group.replace('.', sep);
        format!(
            "{p}libraries{p}{g}{p}{a}{p}{v}{p}{a}-{v}.jar",
            p = sep,
            g = group_path,
            a = artifact,
            v = version
        )
    }

    fn to_os(input: &str) -> String {
        if WIN_SEP {
            input.replace('/', "\\")
        } else {
            input.to_string()
        }
    }

    #[test]
    fn keeps_latest_version_of_same_artifact() {
        let classpath = vec![
            maven_path("org.ow2.asm", "asm", "9.1"),
            maven_path("org.ow2.asm", "asm", "9.7"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(result, vec![maven_path("org.ow2.asm", "asm", "9.7")]);
    }

    #[test]
    fn keeps_both_artifacts_with_same_id_in_different_groups() {
        let classpath = vec![
            maven_path("com.example.one", "library", "1.0"),
            maven_path("com.example.two", "library", "2.0"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn keeps_non_maven_entries_as_is() {
        let jar = to_os("game/1.20.1.jar");
        let classpath = vec![jar.clone(), jar.clone()];
        let result = filter_classpath(classpath);
        assert_eq!(result, vec![jar]);
    }

    #[test]
    fn deduplicates_identical_paths() {
        let classpath = vec![
            maven_path("org.lwjgl", "lwjgl", "3.3.1"),
            maven_path("org.lwjgl", "lwjgl", "3.3.1"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn preserves_input_order_of_kept_entries() {
        let classpath = vec![
            maven_path("net.fabricmc", "fabric-loader", "0.16.9"),
            maven_path("org.ow2.asm", "asm", "9.1"),
            maven_path("org.ow2.asm", "asm", "9.7"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(
            result,
            vec![
                maven_path("net.fabricmc", "fabric-loader", "0.16.9"),
                maven_path("org.ow2.asm", "asm", "9.7"),
            ]
        );
    }

    #[test]
    fn version_jar_with_dashed_version_still_recognized() {
        let path = to_os("project/libraries/net/neoforged/neoforge/20.4.80-beta/neoforge-20.4.80-beta.jar");
        let result = filter_classpath(vec![path.clone()]);
        assert_eq!(result, vec![path]);
    }

    #[test]
    fn keeps_base_and_natives_classifier_of_same_version() {
        let natives = format!(
            "{p}libraries{p}org{p}lwjgl{p}lwjgl{p}3.3.3{p}lwjgl-3.3.3-natives-linux.jar",
            p = if WIN_SEP { "\\" } else { "/" }
        );
        let result = filter_classpath(vec![
            maven_path("org.lwjgl", "lwjgl", "3.3.3"),
            natives.clone(),
        ]);
        assert_eq!(
            result,
            vec![maven_path("org.lwjgl", "lwjgl", "3.3.3"), natives]
        );
    }

    #[test]
    fn keeps_classifier_variants_of_netty_style_artifact() {
        let base = if WIN_SEP { "\\" } else { "/" };
        let epoll = |classifier: &str| {
            format!(
                "project{p}libraries{p}io{p}netty{p}netty-transport-native-epoll{p}4.1.97.Final{p}netty-transport-native-epoll-4.1.97.Final-{c}.jar",
                p = base,
                c = classifier
            )
        };
        let classpath = vec![epoll("linux-aarch_64"), epoll("linux-x86_64")];
        let result = filter_classpath(classpath.clone());
        assert_eq!(result, classpath);
    }

    #[test]
    fn windows_separators_are_normalized() {
        let classpath = vec![
            to_os("project/libraries/org/ow2/asm/asm/9.1/asm-9.1.jar"),
            to_os("project\\libraries\\org\\ow2\\asm\\asm\\9.7\\asm-9.7.jar"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(
            result,
            vec![to_os("project\\libraries\\org\\ow2\\asm\\asm\\9.7\\asm-9.7.jar")]
        );
    }
}
