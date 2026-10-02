use anyhow::{anyhow, bail, Context, Result};
use futures::{Stream, StreamExt};
use rsa::RsaPublicKey;

use crate::legacy::crypto;
use crate::legacy::hashed::HashedDir;
use crate::legacy::protocol::{HReader, HWriter};
use crate::legacy::types::{
    profile_from_block, read_entry, read_player_profile, PlayerProfile, PUBLIC_KEY_DER,
};
use crate::state::dto::LegacyProfile;
use crate::utils::bandwidth;
use crate::utils::errors::LauncherError;
use crate::utils::http::http_client;

const MAX_PROFILE_PROFILES: usize = 4096;
const MAX_UPDATE_FILES_BATCH: usize = 50;
const MAX_FILE_NAME: usize = 1024;
const STREAM_CHUNK: usize = 64 * 1024;

pub struct LegacyClient {
    base_url: String,
    public_key: RsaPublicKey,
}

pub struct LegacyAuth {
    pub profile: PlayerProfile,
    pub access_token: String,
    pub password_blob: Vec<u8>,
}

pub struct LegacySession<'a> {
    pub username: &'a str,
    pub access_token: &'a str,
}

impl Copy for LegacySession<'_> {}

impl Clone for LegacySession<'_> {
    fn clone(&self) -> Self {
        *self
    }
}

#[derive(Debug)]
pub struct LegacyProfileRecord {
    pub profile: LegacyProfile,
    pub signed: Vec<u8>,
}

pub struct SignedTree {
    pub dir: HashedDir,
    pub signed: Vec<u8>,
}

pub fn choose_profile_record(records: Vec<LegacyProfileRecord>) -> Result<LegacyProfileRecord> {
    let mut candidates = records.into_iter();
    let mut chosen = candidates
        .next()
        .ok_or_else(|| anyhow::Error::msg("Легаси-сервер не вернул ни одного профиля"))?;
    for candidate in candidates {
        if candidate.profile.sort_index < chosen.profile.sort_index {
            chosen = candidate;
        }
    }
    Ok(chosen)
}

impl LegacyClient {
    pub fn new(base_url: &str) -> Result<Self> {
        Ok(Self {
            base_url: base_url.trim().trim_end_matches('/').to_string(),
            public_key: crypto::parse_public_key(PUBLIC_KEY_DER)?,
        })
    }

    #[cfg(test)]
    pub fn with_test_key(base_url: &str, public_key: RsaPublicKey) -> Self {
        Self {
            base_url: base_url.trim().trim_end_matches('/').to_string(),
            public_key,
        }
    }

    async fn post(&self, path: &str, body: Vec<u8>, context: &str) -> Result<reqwest::Response> {
        let response = http_client()
            .post(format!("{}{path}", self.base_url))
            .header("Content-Type", "application/octet-stream")
            .body(body)
            .send()
            .await
            .with_context(|| format!("{context}: не удалось подключиться к {}", self.base_url))?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();
            return Err(LauncherError::HttpStatus {
                status,
                message: text,
            }
            .into());
        }
        Ok(response)
    }

    async fn post_bytes(&self, path: &str, body: Vec<u8>, context: &str) -> Result<Vec<u8>> {
        let response = self.post(path, body, context).await?;
        let bytes = response
            .bytes()
            .await
            .with_context(|| format!("{context}: не удалось прочитать ответ"))?;
        Ok(bytes.to_vec())
    }

    async fn read_error(reader: &mut HReader<'_>) -> Result<()> {
        let error = reader.read_string(0)?;
        if error.is_empty() {
            return Ok(());
        }
        Err(LauncherError::LauncherServer(error).into())
    }

    pub async fn fetch_profiles(&self) -> Result<(Vec<u8>, Vec<LegacyProfileRecord>)> {
        let mut writer = HWriter::new();
        writer.write_bool(false);
        let body = writer.into_inner();

        let bytes = self
            .post_bytes("/api/launcher", body, "Не удалось получить список профилей")
            .await?;
        let mut reader = HReader::new(&bytes);
        Self::read_error(&mut reader).await?;
        let sign = reader.read_fixed(crypto::RSA_KEY_LENGTH)?.to_vec();
        let count = reader.read_varint()? as usize;
        if count > MAX_PROFILE_PROFILES {
            return Err(anyhow!("Слишком много профилей в ответе: {count}"));
        }
        let mut profiles = Vec::with_capacity(count);
        for _ in 0..count {
            let data = reader.read_prefixed(usize::MAX, "профиля")?.to_vec();
            let signature = reader.read_fixed(crypto::RSA_KEY_LENGTH)?;
            crypto::verify_sha256_with_rsa(&self.public_key, &data, signature)
                .context("Подпись профиля не сошлась")?;
            let mut signed = HWriter::new();
            signed.write_prefixed(&data);
            signed.write_fixed(signature);
            profiles.push(LegacyProfileRecord {
                profile: Self::parse_profile(&data)?,
                signed: signed.into_inner(),
            });
        }
        Ok((sign, profiles))
    }

    fn parse_profile(data: &[u8]) -> Result<LegacyProfile> {
        let mut reader = HReader::new(data);
        let count = reader.read_varint()? as usize;
        let mut entries = Vec::with_capacity(count.min(1024));
        for _ in 0..count {
            let name = reader.read_string(255)?;
            entries.push((name, read_entry(&mut reader)?));
        }
        profile_from_block(&entries)
    }

    pub async fn fetch_launcher_jar(&self) -> Result<(Vec<u8>, Vec<u8>)> {
        let mut writer = HWriter::new();
        writer.write_bool(false);
        let body = writer.into_inner();

        let bytes = self
            .post_bytes(
                "/api/launcher/binary",
                body,
                "Не удалось скачать launcher.jar",
            )
            .await?;
        let mut reader = HReader::new(&bytes);
        Self::read_error(&mut reader).await?;
        let sign = reader.read_fixed(crypto::RSA_KEY_LENGTH)?.to_vec();
        let binary = reader.read_prefixed(usize::MAX, "бинарника")?.to_vec();
        crypto::verify_sha256_with_rsa(&self.public_key, &binary, &sign)
            .context("Подпись launcher.jar не сошлась")?;
        Ok((sign, binary))
    }

    async fn auth_request(&self, username: &str, password_blob: Vec<u8>) -> Result<LegacyAuth> {
        let mut writer = HWriter::new();
        writer.write_string(username);
        writer.write_prefixed(&password_blob);
        let body = writer.into_inner();

        let bytes = self
            .post_bytes("/api/auth", body, "Не удалось авторизоваться")
            .await?;
        let mut reader = HReader::new(&bytes);
        Self::read_error(&mut reader).await?;
        let profile = read_player_profile(&mut reader)?;
        let token_len = reader.read_int()?;
        if !(0..=4096).contains(&token_len) {
            return Err(anyhow!(
                "Некорректная длина токена авторизации: {token_len}"
            ));
        }
        let access_token = String::from_utf8(reader.read_fixed(token_len as usize)?.to_vec())
            .context("Некорректный токен авторизации")?;
        Ok(LegacyAuth {
            profile,
            access_token,
            password_blob,
        })
    }

    pub async fn auth(&self, username: &str, password: &str) -> Result<LegacyAuth> {
        let blob = crypto::encrypt_password(&self.public_key, password)?;
        self.auth_request(username, blob).await
    }

    pub async fn auth_with_blob(&self, username: &str, blob: &[u8]) -> Result<LegacyAuth> {
        self.auth_request(username, blob.to_vec()).await
    }

    pub async fn update_list(
        &self,
        session: LegacySession<'_>,
        dir_name: &str,
    ) -> Result<SignedTree> {
        let mut writer = HWriter::new();
        writer.write_string(session.username);
        writer.write_string(session.access_token);
        writer.write_string(dir_name);
        let body = writer.into_inner();

        let bytes = self
            .post_bytes(
                "/api/update/list",
                body,
                format!("Не удалось получить список обновлений «{dir_name}»").as_str(),
            )
            .await?;
        let mut reader = HReader::new(&bytes);
        Self::read_error(&mut reader).await?;
        let data = reader
            .read_prefixed(usize::MAX, "дерева обновления")?
            .to_vec();
        let signature = reader.read_fixed(crypto::RSA_KEY_LENGTH)?;
        crypto::verify_sha256_with_rsa(&self.public_key, &data, signature)
            .with_context(|| format!("Подпись списка обновлений «{dir_name}» не сошлась"))?;
        let mut tree_reader = HReader::new(&data);
        let dir = HashedDir::read(&mut tree_reader)?;
        let mut signed = HWriter::new();
        signed.write_prefixed(&data);
        signed.write_fixed(signature);
        Ok(SignedTree {
            dir,
            signed: signed.into_inner(),
        })
    }

    pub async fn update_files(
        &self,
        session: LegacySession<'_>,
        dir_name: &str,
        base_dir: &std::path::Path,
        files: &[String],
        on_progress: &mut impl FnMut(&str, u64, u64),
    ) -> Result<()> {
        for batch in files.chunks(MAX_UPDATE_FILES_BATCH) {
            self.update_files_batch(session, dir_name, base_dir, batch, on_progress)
                .await?;
        }
        Ok(())
    }

    async fn update_files_batch(
        &self,
        session: LegacySession<'_>,
        dir_name: &str,
        base_dir: &std::path::Path,
        batch: &[String],
        on_progress: &mut impl FnMut(&str, u64, u64),
    ) -> Result<()> {
        let mut writer = HWriter::new();
        writer.write_string(session.username);
        writer.write_string(session.access_token);
        writer.write_string(dir_name);
        writer.write_varint(batch.len() as u32);
        for path in batch {
            writer.write_string(path);
        }
        let body = writer.into_inner();

        let context = format!("Не удалось скачать файлы обновления «{dir_name}»");
        let response = self.post("/api/update/files", body, &context).await?;
        let mut stream = response.bytes_stream();
        let mut buffer = StreamBuffer::new();
        let error = buffer.read_error_string(&mut stream).await?;
        if !error.is_empty() {
            return Err(LauncherError::LauncherServer(error).into());
        }

        for path in batch {
            if path.len() > MAX_FILE_NAME {
                return Err(anyhow!("Слишком длинный путь файла обновления: {path}"));
            }
            let status = buffer.read_u8(&mut stream).await?;
            if status != 0xFF {
                let rest = buffer.drain_up_to(&mut stream, 200).await;
                let preview = String::from_utf8_lossy(&rest).replace(|c: char| c.is_control(), " ");
                return Err(anyhow!(
                    "Не удалось скачать файл '{path}' из обновления «{dir_name}»: статус {status}, ответ сервера: {preview}"
                ));
            }
            let size = buffer.read_long(&mut stream).await?;
            if size < 0 {
                return Err(anyhow!("Некорректный размер файла '{path}': {size}"));
            }
            let size = size as u64;
            let dest = base_dir.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .with_context(|| format!("Не удалось создать папку {}", parent.display()))?;
            }
            let written = buffer
                .copy_to_file(&mut stream, size, &dest, |chunk_done| {
                    on_progress(path, chunk_done, size)
                })
                .await
                .with_context(|| format!("Не удалось скачать файл '{path}'"))?;
            if written != size {
                return Err(anyhow!(
                    "Файл '{path}' получен не полностью: {written} из {size}"
                ));
            }
        }
        Ok(())
    }
}

struct StreamBuffer {
    buf: Vec<u8>,
    pos: usize,
}

type ByteStream = dyn Stream<Item = reqwest::Result<bytes::Bytes>> + Send + Unpin;

impl StreamBuffer {
    fn new() -> Self {
        Self {
            buf: Vec::new(),
            pos: 0,
        }
    }

    fn available(&self) -> usize {
        self.buf.len() - self.pos
    }

    fn compact(&mut self) {
        if self.pos > 0 {
            self.buf.drain(..self.pos);
            self.pos = 0;
        }
    }

    async fn fill(&mut self, stream: &mut ByteStream) -> Result<bool> {
        match stream.next().await {
            Some(Ok(chunk)) => {
                self.compact();
                self.buf.extend_from_slice(&chunk);
                Ok(true)
            }
            Some(Err(e)) => Err(anyhow::Error::new(e).context("Ошибка сети при получении файла")),
            None => Ok(false),
        }
    }

    async fn drain_up_to(&mut self, stream: &mut ByteStream, limit: usize) -> Vec<u8> {
        while self.available() < limit {
            match self.fill(stream).await {
                Ok(true) => {}
                _ => break,
            }
        }
        let take = self.available().min(limit);
        let data = self.buf[self.pos..self.pos + take].to_vec();
        self.pos += take;
        data
    }

    async fn read_exact(&mut self, stream: &mut ByteStream, len: usize) -> Result<Vec<u8>> {
        while self.available() < len {
            if !self.fill(stream).await? {
                return Err(anyhow!(
                    "Поток оборвался: нужно {len}, получено {}",
                    self.available()
                ));
            }
        }
        let data = self.buf[self.pos..self.pos + len].to_vec();
        self.pos += len;
        Ok(data)
    }

    async fn read_u8(&mut self, stream: &mut ByteStream) -> Result<u8> {
        Ok(self.read_exact(stream, 1).await?[0])
    }

    async fn read_varint(&mut self, stream: &mut ByteStream) -> Result<u32> {
        let mut result: u32 = 0;
        for shift in (0..32).step_by(7) {
            let byte = self.read_u8(stream).await?;
            result |= u32::from(byte & 0x7F) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
        }
        bail!("Varint слишком большой");
    }

    async fn read_error_string(&mut self, stream: &mut ByteStream) -> Result<String> {
        let len = self.read_varint(stream).await? as usize;
        if len > 4096 {
            bail!("Слишком длинная строка ошибки: {len}");
        }
        let bytes = self.read_exact(stream, len).await?;
        String::from_utf8(bytes).context("Некорректная UTF-8 строка ошибки")
    }

    async fn read_long(&mut self, stream: &mut ByteStream) -> Result<i64> {
        let bytes = self.read_exact(stream, 8).await?;
        let mut raw = [0u8; 8];
        raw.copy_from_slice(&bytes);
        Ok(i64::from_be_bytes(raw))
    }

    async fn copy_to_file(
        &mut self,
        stream: &mut ByteStream,
        len: u64,
        dest: &std::path::Path,
        mut on_chunk: impl FnMut(u64),
    ) -> Result<u64> {
        use tokio::io::AsyncWriteExt;

        let part = dest.with_extension("part");
        let mut file = tokio::io::BufWriter::new(
            tokio::fs::File::create(&part)
                .await
                .with_context(|| format!("Не удалось создать {}", part.display()))?,
        );
        let mut remaining = len;
        let mut done: u64 = 0;
        while remaining > 0 {
            if self.available() == 0 && !self.fill(stream).await? {
                break;
            }
            let take = self.available().min(remaining as usize).min(STREAM_CHUNK);
            bandwidth::acquire(take as u64).await;
            file.write_all(&self.buf[self.pos..self.pos + take])
                .await
                .with_context(|| format!("Не удалось записать {}", part.display()))?;
            self.pos += take;
            remaining -= take as u64;
            done += take as u64;
            on_chunk(done);
        }
        file.flush()
            .await
            .with_context(|| format!("Не удалось сохранить {}", part.display()))?;
        drop(file);
        tokio::fs::rename(&part, dest).await.with_context(|| {
            format!(
                "Не удалось переименовать {} в {}",
                part.display(),
                dest.display()
            )
        })?;
        Ok(done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legacy::crypto::{generate_test_key, sign_sha256_with_rsa_raw};
    use crate::test_support::legacy_profile_data;
    use rsa::RsaPrivateKey;

    struct TestServer {
        key: RsaPrivateKey,
        client: LegacyClient,
    }

    async fn test_client(url: &str) -> TestServer {
        let key = generate_test_key(2048).expect("тестовый ключ");
        let public_key = RsaPublicKey::from(&key);
        let client = LegacyClient::with_test_key(url, public_key);
        TestServer { key, client }
    }

    fn sign_data(key: &rsa::RsaPrivateKey, data: &[u8]) -> Vec<u8> {
        sign_sha256_with_rsa_raw(key, data).expect("подпись тестовых данных")
    }

    #[tokio::test]
    async fn fetch_profiles_rejects_bad_signature() {
        let mut server = mockito::Server::new_async().await;
        let guard = test_client(&server.url()).await;
        let data = legacy_profile_data("ClientDir", 0);
        let mut body = HWriter::new();
        body.write_string("");
        body.write_fixed(&vec![0u8; 256]);
        body.write_varint(1);
        body.write_prefixed(&data);
        body.write_fixed(&vec![7u8; 256]);

        let mock = server
            .mock("POST", "/api/launcher")
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let error = guard
            .client
            .fetch_profiles()
            .await
            .expect_err("битая подпись должна пасть");
        assert!(error.to_string().contains("Подпись профиля"), "{error}");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn fetch_profiles_parses_signed_profile() {
        let mut server = mockito::Server::new_async().await;
        let guard = test_client(&server.url()).await;

        let data = legacy_profile_data("ClientDir", 3);
        let signature = sign_data(&guard.key, &data);

        let mut body = HWriter::new();
        body.write_string("");
        let jar_sign = sign_data(&guard.key, b"jar");
        body.write_fixed(&jar_sign);
        body.write_varint(1);
        body.write_prefixed(&data);
        body.write_fixed(&signature);

        let mock = server
            .mock("POST", "/api/launcher")
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let (sign, profiles) = guard.client.fetch_profiles().await.expect("профили");
        mock.assert_async().await;
        assert_eq!(sign, jar_sign);
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].profile.dir_name, "ClientDir");
        assert_eq!(profiles[0].profile.sort_index, 3);
        assert_eq!(profiles[0].profile.server_port, 25545);
        assert!(profiles[0].profile.update_fast_check);
    }

    #[tokio::test]
    async fn fetch_profiles_surfaces_server_error_string() {
        let mut server = mockito::Server::new_async().await;
        let guard = test_client(&server.url()).await;
        let mut body = HWriter::new();
        body.write_string("Сервер обслуживется");

        let mock = server
            .mock("POST", "/api/launcher")
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let error = guard
            .client
            .fetch_profiles()
            .await
            .expect_err("ошибка сервера должна пробрасываться");
        mock.assert_async().await;
        assert!(error.to_string().contains("обслуживется"), "{error}");
    }

    #[tokio::test]
    async fn auth_parses_profile_and_token() {
        let mut server = mockito::Server::new_async().await;
        let guard = test_client(&server.url()).await;

        let mut body = HWriter::new();
        body.write_string("");
        body.write_fixed(&crate::legacy::types::parse_uuid(
            "069a79f4-44e9-4726-a5be-fca90e38aaf5",
        ));
        body.write_string("TechSherl");
        body.write_bool(false);
        body.write_bool(false);
        let token = "abcdef0123456789abcdef0123456789";
        body.write_int(token.len() as i32);
        body.write_fixed(token.as_bytes());

        let mock = server
            .mock("POST", "/api/auth")
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let auth = guard
            .client
            .auth("TechSherl", "пароль")
            .await
            .expect("авторизация");
        mock.assert_async().await;
        assert_eq!(auth.access_token, token);
        assert_eq!(auth.profile.username, "TechSherl");
        assert_eq!(auth.profile.uuid, "069a79f4-44e9-4726-a5be-fca90e38aaf5");
        assert_eq!(auth.profile.skin, None);
        assert_eq!(auth.password_blob.len(), 256);
    }

    #[tokio::test]
    async fn update_list_verifies_tree_signature() {
        let mut server = mockito::Server::new_async().await;
        let guard = test_client(&server.url()).await;

        let mut tree = HWriter::new();
        tree.write_varint(1);
        tree.write_string("mods");
        tree.write_varint(crate::legacy::hashed::DIR_ENTRY);
        tree.write_varint(1);
        tree.write_string("a.jar");
        tree.write_varint(crate::legacy::hashed::FILE_ENTRY);
        tree.write_varlong(5);
        tree.write_bool(false);
        let tree_data = tree.into_inner();
        let signature = sign_data(&guard.key, &tree_data);

        let mut body = HWriter::new();
        body.write_string("");
        body.write_prefixed(&tree_data);
        body.write_fixed(&signature);

        let mock = server
            .mock("POST", "/api/update/list")
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let parsed = guard
            .client
            .update_list(
                LegacySession {
                    username: "user",
                    access_token: "token",
                },
                "ClientDir",
            )
            .await
            .expect("дерево");
        mock.assert_async().await;
        assert!(parsed.dir.entries.contains_key("mods"));
    }

    #[tokio::test]
    async fn update_files_streams_batch_into_files() {
        let mut server = mockito::Server::new_async().await;
        let guard = test_client(&server.url()).await;

        let mut body = HWriter::new();
        body.write_string("");
        body.write_u8(0xFF);
        body.write_long(5);
        body.write_fixed(b"hello");
        body.write_u8(0xFF);
        body.write_long(3);
        body.write_fixed(b"abc");

        let expected_files = vec!["mods/a.jar".to_string(), "servers.dat".to_string()];
        let mut expected_body = HWriter::new();
        expected_body.write_string("user");
        expected_body.write_string("token");
        expected_body.write_string("ClientDir");
        expected_body.write_varint(2);
        expected_body.write_string("mods/a.jar");
        expected_body.write_string("servers.dat");

        let mock = server
            .mock("POST", "/api/update/files")
            .match_body(expected_body.into_inner())
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let root =
            std::env::temp_dir().join(format!("limacina_legacy_files_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("корень теста");

        let mut progress: Vec<(String, u64, u64)> = Vec::new();
        guard
            .client
            .update_files(
                LegacySession {
                    username: "user",
                    access_token: "token",
                },
                "ClientDir",
                &root,
                &expected_files,
                &mut |path, done, total| {
                    progress.push((path.to_string(), done, total));
                },
            )
            .await
            .expect("скачивание батча");
        mock.assert_async().await;

        assert_eq!(
            std::fs::read(root.join("mods/a.jar")).expect("файл a.jar"),
            b"hello".to_vec()
        );
        assert_eq!(
            std::fs::read(root.join("servers.dat")).expect("servers.dat"),
            b"abc".to_vec()
        );
        let last_a = progress
            .iter()
            .rev()
            .find(|(path, _, _)| path == "mods/a.jar")
            .expect("прогресс a.jar");
        assert_eq!((last_a.1, last_a.2), (5, 5));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn update_files_fails_on_bad_status_byte() {
        let mut server = mockito::Server::new_async().await;
        let guard = test_client(&server.url()).await;

        let mut body = HWriter::new();
        body.write_string("");
        body.write_u8(0x01);
        let mock = server
            .mock("POST", "/api/update/files")
            .with_status(200)
            .with_body(body.into_inner())
            .create_async()
            .await;

        let root =
            std::env::temp_dir().join(format!("limacina_legacy_files_fail_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("корень теста");

        let error = guard
            .client
            .update_files(
                LegacySession {
                    username: "user",
                    access_token: "token",
                },
                "ClientDir",
                &root,
                &["x.bin".to_string()],
                &mut |_, _, _| {},
            )
            .await
            .expect_err("статус не 0xFF должен пасть");
        mock.assert_async().await;
        assert!(
            error.to_string().contains("Не удалось скачать файл"),
            "{error}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
