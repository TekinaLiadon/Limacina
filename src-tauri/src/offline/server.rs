use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use crate::log_err;

const PROFILE_PREFIX: &str = "/sessionserver/session/minecraft/profile/";
const TEXTURE_PATH: &str = "/textures/skin.png";
const PRIVILEGES_PATH: &str = "/privileges";
const BLOCKLIST_PATH: &str = "/privacy/blocklist";
const NOT_FOUND_BODY: &[u8] = br#"{"error":"NotFoundException","errorMessage":"Not found"}"#;
const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

type Skin = Option<(Vec<u8>, Option<String>)>;

struct SkinState {
    skin: Skin,
    uuid: String,
    username: String,
    base_url: String,
}

pub struct SkinServer {
    url: String,
    shutdown: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl SkinServer {
    pub fn start(skin: Skin, uuid: String, username: String) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .context("Не удалось занять порт для локального Yggdrasil-шима")?;
        let port = listener.local_addr()?.port();
        let url = format!("http://127.0.0.1:{port}");
        let state = Arc::new(SkinState {
            skin,
            uuid: normalize_uuid(&uuid),
            username,
            base_url: url.clone(),
        });
        let shutdown = Arc::new(AtomicBool::new(false));
        let worker_shutdown = Arc::clone(&shutdown);
        let worker = thread::spawn(move || run_server(listener, state, worker_shutdown));
        Ok(Self {
            url,
            shutdown,
            worker: Some(worker),
        })
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn stop(mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for SkinServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run_server(listener: TcpListener, state: Arc<SkinState>, shutdown: Arc<AtomicBool>) {
    if let Err(e) = listener.set_nonblocking(true) {
        log_err!("Офлайн-шим: не удалось включить nonblocking: {}", e);
        return;
    }
    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Err(e) = handle_connection(stream, &state) {
                    log_err!("Офлайн-шим: ошибка обработки запроса: {}", e);
                }
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                log_err!("Офлайн-шим: ошибка accept: {}", e);
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

fn handle_connection(mut stream: TcpStream, state: &SkinState) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    let Some(path) = read_request_path(&mut stream) else {
        return Ok(());
    };
    let path = path.split('?').next().unwrap_or_default();

    if path == "/" {
        return respond(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            &metadata_body(),
        );
    }
    if path == PRIVILEGES_PATH {
        return respond(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            &privileges_body(),
        );
    }
    if path == BLOCKLIST_PATH {
        return respond(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            br#"{"blocked":[]}"#,
        );
    }
    if path == TEXTURE_PATH {
        return match state.skin.as_ref().map(|(bytes, _)| bytes.as_slice()) {
            Some(bytes) => respond(&mut stream, "200 OK", "image/png", bytes),
            None => respond_not_found(&mut stream),
        };
    }
    if profile_uuid(path).as_deref() == Some(state.uuid.as_str()) {
        return respond(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            &profile_body(state),
        );
    }
    respond_not_found(&mut stream)
}

fn respond_not_found(stream: &mut TcpStream) -> std::io::Result<()> {
    respond(
        stream,
        "404 Not Found",
        "application/json; charset=utf-8",
        NOT_FOUND_BODY,
    )
}

fn read_request_path(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = [0u8; 2048];
    let mut request = Vec::new();
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                request.extend_from_slice(&buffer[..n]);
                if request.windows(4).any(|w| w == b"\r\n\r\n") || request.len() > 8192 {
                    break;
                }
            }
            Err(_) => return None,
        }
    }
    let head = String::from_utf8_lossy(&request);
    let request_line = head.lines().next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?;
    if method != "GET" {
        return None;
    }
    parts.next().map(|path| path.to_string())
}

fn respond(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()?;
    stream.shutdown(Shutdown::Both)
}

fn metadata_body() -> Vec<u8> {
    serde_json::json!({
        "skinDomains": ["127.0.0.1", "localhost"],
        "meta": { "serverName": "Limacina" }
    })
    .to_string()
    .into_bytes()
}

fn privileges_body() -> Vec<u8> {
    serde_json::json!({
        "privileges": {
            "onlineChat": { "enabled": true },
            "multiplayerServer": { "enabled": true },
            "multiplayerRealms": { "enabled": true }
        }
    })
    .to_string()
    .into_bytes()
}

fn profile_body(state: &SkinState) -> Vec<u8> {
    let model = state.skin.as_ref().and_then(|(_, model)| model.clone());
    if state.skin.is_none() {
        return serde_json::json!({
            "id": state.uuid,
            "name": state.username,
            "properties": []
        })
        .to_string()
        .into_bytes();
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);

    let mut skin = serde_json::json!({
        "url": format!("{}/textures/skin.png", state.base_url),
    });
    if model.as_deref() == Some("slim") {
        skin["metadata"] = serde_json::json!({ "model": "slim" });
    }

    let texture_payload = serde_json::json!({
        "timestamp": timestamp,
        "profileId": state.uuid,
        "profileName": state.username,
        "isPublic": true,
        "textures": { "SKIN": skin },
    });

    serde_json::json!({
        "id": state.uuid,
        "name": state.username,
        "properties": [
            { "name": "textures", "value": base64_encode(texture_payload.to_string().as_bytes()) }
        ]
    })
    .to_string()
    .into_bytes()
}

fn profile_uuid(path: &str) -> Option<String> {
    let uuid = path.strip_prefix(PROFILE_PREFIX)?;
    if uuid.is_empty() {
        return None;
    }
    Some(normalize_uuid(uuid))
}

fn normalize_uuid(uuid: &str) -> String {
    uuid.trim()
        .trim_end_matches('/')
        .replace('-', "")
        .to_ascii_lowercase()
}

fn base64_encode(data: &[u8]) -> String {
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let packed = (b0 << 16) | (b1 << 8) | b2;
        result.push(BASE64_ALPHABET[(packed >> 18) as usize & 63] as char);
        result.push(BASE64_ALPHABET[(packed >> 12) as usize & 63] as char);
        result.push(if chunk.len() > 1 {
            BASE64_ALPHABET[(packed >> 6) as usize & 63] as char
        } else {
            '='
        });
        result.push(if chunk.len() > 2 {
            BASE64_ALPHABET[packed as usize & 63] as char
        } else {
            '='
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::SkinServer;
    use super::{base64_encode, normalize_uuid, profile_uuid};
    use std::io::{Read, Write};
    use std::net::TcpStream;

    #[test]
    fn base64_encodes_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn normalize_uuid_strips_dashes_and_case() {
        assert_eq!(
            normalize_uuid("069A79F4-44E9-4726-A5BE-FCA90E38ABAF"),
            "069a79f444e94726a5befca90e38abaf"
        );
        assert_eq!(
            normalize_uuid("069a79f444e94726a5befca90e38abaf"),
            "069a79f444e94726a5befca90e38abaf"
        );
    }

    #[test]
    fn profile_uuid_parses_route() {
        assert_eq!(
            profile_uuid(
                "/sessionserver/session/minecraft/profile/069a79f444e94726a5befca90e38abaf"
            ),
            Some("069a79f444e94726a5befca90e38abaf".to_string())
        );
        assert_eq!(
            profile_uuid(
                "/sessionserver/session/minecraft/profile/069A79F4-44E9-4726-A5BE-FCA90E38ABAF"
            ),
            Some("069a79f444e94726a5befca90e38abaf".to_string())
        );
        assert_eq!(
            profile_uuid("/sessionserver/session/minecraft/profile/"),
            None
        );
        assert_eq!(profile_uuid("/textures/skin.png"), None);
    }

    fn send_request(port: u16, path: &str) -> Vec<u8> {
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .expect("шим должен принимать соединения на 127.0.0.1");
        stream
            .write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .expect("запрос должен отправиться");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .expect("ответ должен дочитаться");
        response
    }

    fn split_response(response: &[u8]) -> (String, Vec<u8>) {
        let head_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("в ответе должен быть заголовок");
        (
            String::from_utf8_lossy(&response[..head_end]).to_string(),
            response[head_end + 4..].to_vec(),
        )
    }

    fn base64_decode(data: &str) -> Vec<u8> {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let trimmed: Vec<u8> = data.bytes().filter(|b| *b != b'=').collect();
        let mut result = Vec::new();
        for chunk in trimmed.chunks(4) {
            let index = |b: &u8| ALPHABET.iter().position(|a| a == b).unwrap();
            let packed = (index(&chunk[0]) << 18)
                | (chunk.get(1).map(|b| index(b)).unwrap_or(0) << 12)
                | (chunk.get(2).map(|b| index(b)).unwrap_or(0) << 6)
                | chunk.get(3).map(|b| index(b)).unwrap_or(0);
            result.push((packed >> 16) as u8);
            if chunk.len() > 2 {
                result.push((packed >> 8) as u8);
            }
            if chunk.len() > 3 {
                result.push(packed as u8);
            }
        }
        result
    }

    #[test]
    fn skin_server_serves_skin_endpoints() {
        let server = SkinServer::start(
            Some((b"png-bytes".to_vec(), Some("slim".to_string()))),
            "069A79F4-44E9-4726-A5BE-FCA90E38ABAF".to_string(),
            "Steve".to_string(),
        )
        .expect("шим должен стартовать");
        assert!(server.url().starts_with("http://127.0.0.1:"));
        let port: u16 = server.url().rsplit(':').next().unwrap().parse().unwrap();

        let (head, body) = split_response(&send_request(port, "/"));
        assert!(head.contains("200 OK"));
        assert!(head.contains("Connection: close"));
        assert!(String::from_utf8_lossy(&body).contains("skinDomains"));

        let profile_path =
            "/sessionserver/session/minecraft/profile/069a79f444e94726a5befca90e38abaf";
        let (head, body) = split_response(&send_request(port, profile_path));
        assert!(head.contains("200 OK"));
        let profile: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(profile["name"], "Steve");
        assert_eq!(profile["properties"][0]["name"], "textures");
        let texture_payload: serde_json::Value = serde_json::from_slice(&base64_decode(
            profile["properties"][0]["value"].as_str().unwrap(),
        ))
        .unwrap();
        assert_eq!(
            texture_payload["textures"]["SKIN"]["url"],
            format!("{}/textures/skin.png", server.url())
        );
        assert_eq!(
            texture_payload["textures"]["SKIN"]["metadata"]["model"],
            "slim"
        );

        let (head, body) = split_response(&send_request(port, "/textures/skin.png"));
        assert!(head.contains("200 OK"));
        assert!(head.contains("Content-Type: image/png"));
        assert_eq!(body, b"png-bytes");

        let (head, _) = split_response(&send_request(
            port,
            "/sessionserver/session/minecraft/profile/ffffffffffffffffffffffffffffffff",
        ));
        assert!(head.contains("404"));

        server.stop();
    }

    #[test]
    fn skin_server_serves_privileges_and_blocklist() {
        let server = SkinServer::start(
            None,
            "069a79f444e94726a5befca90e38abaf".to_string(),
            "Steve".to_string(),
        )
        .expect("шим должен стартовать");
        let port: u16 = server.url().rsplit(':').next().unwrap().parse().unwrap();

        let (head, body) = split_response(&send_request(port, "/privileges"));
        assert!(head.contains("200 OK"));
        let privileges: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            privileges["privileges"]["multiplayerServer"]["enabled"],
            true
        );
        assert_eq!(
            privileges["privileges"]["multiplayerRealms"]["enabled"],
            true
        );
        assert_eq!(privileges["privileges"]["onlineChat"]["enabled"], true);

        let (head, body) = split_response(&send_request(port, "/privacy/blocklist"));
        assert!(head.contains("200 OK"));
        let blocklist: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(blocklist["blocked"], serde_json::json!([]));

        server.stop();
    }

    #[test]
    fn skin_server_without_skin_serves_default_profile() {
        let server = SkinServer::start(
            None,
            "069a79f444e94726a5befca90e38abaf".to_string(),
            "Alex".to_string(),
        )
        .expect("шим должен стартовать");
        let port: u16 = server.url().rsplit(':').next().unwrap().parse().unwrap();

        let profile_path =
            "/sessionserver/session/minecraft/profile/069a79f444e94726a5befca90e38abaf";
        let (head, body) = split_response(&send_request(port, profile_path));
        assert!(head.contains("200 OK"));
        let profile: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(profile["name"], "Alex");
        assert_eq!(profile["properties"], serde_json::json!([]));

        let (head, _) = split_response(&send_request(port, "/textures/skin.png"));
        assert!(head.contains("404"));

        server.stop();
    }
}
