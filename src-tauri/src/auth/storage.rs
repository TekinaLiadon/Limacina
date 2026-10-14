use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::{
    log_err, log_info,
    utils::download_file::write_atomic_sync_private,
    utils::env_info::{get_launcher_name, launcher_path},
    utils::errors::LauncherError,
    utils::hex::{from_hex, to_hex},
};

const FALLBACK_ALLOWED_SUFFIXES: &[&str] = &["refresh_token", "uuid"];
#[cfg(not(test))]
const SECRET_ACCOUNT: &str = "fallback_obfuscation_secret";

static FALLBACK_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn fallback_store_lock() -> &'static Mutex<()> {
    FALLBACK_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
enum EntryScheme {
    #[default]
    XorSecret,
    Plain,
}

#[derive(Serialize, Deserialize)]
struct EncryptedEntry {
    username: String,
    obfuscated: String,
    #[serde(default)]
    scheme: EntryScheme,
}

#[derive(Serialize, Deserialize, Default)]
struct CredentialStore {
    entries: Vec<EncryptedEntry>,
}

fn fallback_path() -> Result<PathBuf> {
    let base = launcher_path(None)?;
    Ok(base.join("credentials.json"))
}

fn read_fallback_store(path: &std::path::Path, content: &str) -> CredentialStore {
    match serde_json::from_str(content) {
        Ok(store) => store,
        Err(e) => {
            let backup_path = path.with_extension("json.bak");
            log_err!(
                "Хранилище credentials повреждено: {:?}, битый файл сохранён в {:?} ({})",
                path,
                backup_path,
                e
            );
            let _ = fs::rename(path, &backup_path);
            CredentialStore::default()
        }
    }
}

fn secret_entry_key(secret: &[u8], key_name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(secret);
    hasher.update(key_name.as_bytes());
    let digest = hasher.finalize();
    let mut key = [0u8; 8];
    key.copy_from_slice(&digest[..8]);
    key
}

fn xor_crypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .zip(key.iter().cycle())
        .map(|(d, k)| d ^ k)
        .collect()
}

#[cfg(test)]
static TEST_SECRET_UNAVAILABLE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
static TEST_TRANSIENT_READ_FAILURE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
pub(crate) fn arm_transient_read_failure() {
    TEST_TRANSIENT_READ_FAILURE.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(test)]
struct SecretUnavailableGuard;

#[cfg(test)]
impl SecretUnavailableGuard {
    fn acquire() -> Self {
        TEST_SECRET_UNAVAILABLE.store(true, std::sync::atomic::Ordering::Relaxed);
        Self
    }
}

#[cfg(test)]
impl Drop for SecretUnavailableGuard {
    fn drop(&mut self) {
        TEST_SECRET_UNAVAILABLE.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}

fn obfuscation_secret() -> Option<Vec<u8>> {
    #[cfg(test)]
    {
        if TEST_SECRET_UNAVAILABLE.load(std::sync::atomic::Ordering::Relaxed) {
            return None;
        }
        Some(b"test-obfuscation-secret".to_vec())
    }
    #[cfg(not(test))]
    {
        keyring_obfuscation_secret()
    }
}

#[cfg(not(test))]
fn keyring_obfuscation_secret() -> Option<Vec<u8>> {
    let entry = match keyring::Entry::new(&get_launcher_name(), SECRET_ACCOUNT) {
        Ok(entry) => entry,
        Err(e) => {
            log_err!("Не удалось открыть keyring-запись секрета обфускации: {e}");
            return None;
        }
    };
    match entry.get_password() {
        Ok(secret_hex) => match from_hex(&secret_hex) {
            Ok(secret) if !secret.is_empty() => Some(secret),
            _ => {
                log_err!("Секрет обфускации в keyring повреждён, fallback-хранилище работает в plaintext");
                None
            }
        },
        Err(keyring::Error::NoEntry) => {
            let secret = uuid::Uuid::new_v4().as_bytes().to_vec();
            match entry.set_password(&to_hex(&secret)) {
                Ok(()) => Some(secret),
                Err(e) => {
                    log_err!("Не удалось сохранить секрет обфускации в keyring: {e}, fallback-хранилище работает в plaintext");
                    None
                }
            }
        }
        Err(e) => {
            log_err!("Keyring недоступен для секрета обфускации: {e}, fallback-хранилище работает в plaintext");
            None
        }
    }
}

fn encrypt_entry_value(secret: Option<&[u8]>, key_name: &str, value: &str) -> EncryptedEntry {
    let scheme = if secret.is_some() {
        EntryScheme::XorSecret
    } else {
        EntryScheme::Plain
    };
    let obfuscated = match secret {
        Some(secret) => to_hex(&xor_crypt(
            value.as_bytes(),
            &secret_entry_key(secret, key_name),
        )),
        None => value.to_string(),
    };
    EncryptedEntry {
        username: key_name.to_string(),
        obfuscated,
        scheme,
    }
}

fn decrypt_entry_value(entry: &EncryptedEntry, secret: Option<&[u8]>) -> Option<String> {
    match entry.scheme {
        EntryScheme::Plain => Some(entry.obfuscated.clone()),
        EntryScheme::XorSecret => {
            let secret = secret?;
            let ciphertext = from_hex(&entry.obfuscated).ok()?;
            let decrypted = xor_crypt(&ciphertext, &secret_entry_key(secret, &entry.username));
            String::from_utf8(decrypted).ok()
        }
    }
}

fn mutate_fallback_store(
    create_if_missing: bool,
    mutate: impl FnOnce(&mut CredentialStore),
) -> Result<()> {
    let _guard = fallback_store_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let path = fallback_path()?;
    if !path.exists() && !create_if_missing {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Не удалось создать каталог {parent:?}"))?;
    }

    let mut store = if path.exists() {
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Не удалось прочитать {:?}", path))?;
        read_fallback_store(&path, &content)
    } else {
        CredentialStore::default()
    };

    mutate(&mut store);

    let content = serde_json::to_string_pretty(&store)
        .context("Не удалось сериализовать хранилище credentials")?;
    write_atomic_sync_private(&path, content.as_bytes())
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

#[cfg(unix)]
fn ensure_private_mode(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = fs::metadata(path) {
        let mode = metadata.permissions().mode();
        if mode & 0o077 != 0 {
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }
    }
}

#[cfg(not(unix))]
fn ensure_private_mode(_path: &std::path::Path) {}

pub(crate) fn save_fallback(
    project: &str,
    username: &str,
    key_suffix: &str,
    value: &str,
) -> Result<()> {
    if !FALLBACK_ALLOWED_SUFFIXES.contains(&key_suffix) {
        anyhow::bail!("\"{key_suffix}\" не сохраняется в fallback-хранилище");
    }
    let key_name = keyring_key(project, username, key_suffix);
    let entry = encrypt_entry_value(obfuscation_secret().as_deref(), &key_name, value);
    mutate_fallback_store(true, |store| {
        store.entries.retain(|e| e.username != key_name);
        store.entries.insert(0, entry);
    })
}

pub(crate) fn load_fallback(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    let path = fallback_path()?;
    if !path.exists() {
        anyhow::bail!("Файл хранилища credentials не найден");
    }

    let content =
        fs::read_to_string(&path).with_context(|| format!("Не удалось прочитать {:?}", path))?;
    ensure_private_mode(&path);
    let store = read_fallback_store(&path, &content);
    let key_name = keyring_key(project, username, key_suffix);
    let entry = store
        .entries
        .iter()
        .find(|e| e.username == key_name)
        .context("Credentials не найдены в хранилище")?;

    let secret = obfuscation_secret();
    if entry.scheme == EntryScheme::XorSecret && secret.is_none() {
        anyhow::bail!(
            "Секрет обфускации недоступен, запись \"{key_name}\" не может быть расшифрована"
        );
    }

    match decrypt_entry_value(entry, secret.as_deref()) {
        Some(value) => Ok(value),
        None => {
            log_info!(
                "Fallback-хранилище: запись \"{key_name}\" не расшифрована (алгоритм ключа обновлён), запись сброшена, потребуется повторный вход"
            );
            let _ = delete_fallback(project, username, key_suffix);
            anyhow::bail!("Не удалось расшифровать credentials")
        }
    }
}

pub(crate) fn delete_fallback(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    let key_name = keyring_key(project, username, key_suffix);
    mutate_fallback_store(false, |store| {
        store.entries.retain(|e| e.username != key_name);
    })
}

fn keyring_key(project: &str, username: &str, key_suffix: &str) -> String {
    format!("{}_{}_{}", project, username, key_suffix)
}

async fn run_credential_task<T>(
    project: &str,
    username: &str,
    key_suffix: &str,
    task_context: &str,
    op: impl FnOnce(&str, &str, &str) -> Result<T> + Send + 'static,
) -> Result<T>
where
    T: Send + 'static,
{
    let (project, username, key_suffix) = (
        project.to_string(),
        username.to_string(),
        key_suffix.to_string(),
    );
    let task_context = task_context.to_string();
    LauncherError::classify(
        tokio::task::spawn_blocking(move || op(&project, &username, &key_suffix))
            .await
            .context(task_context)?,
        LauncherError::CredentialsStorage,
    )
}

fn open_keyring_entry(project: &str, username: &str, key_suffix: &str) -> Result<keyring::Entry> {
    let key = keyring_key(project, username, key_suffix);
    keyring::Entry::new(&get_launcher_name(), &key)
        .context("Не удалось получить доступ к хранилищу")
}

pub async fn save_credential(
    project: &str,
    username: &str,
    key_suffix: &str,
    value: &str,
) -> Result<()> {
    let value = value.to_string();
    run_credential_task(
        project,
        username,
        key_suffix,
        "Не удалось выполнить задачу сохранения credentials",
        move |project, username, key_suffix| {
            save_credential_sync(project, username, key_suffix, &value)
        },
    )
    .await
}

fn save_credential_sync(
    project: &str,
    username: &str,
    key_suffix: &str,
    value: &str,
) -> Result<()> {
    let keyring_result = open_keyring_entry(project, username, key_suffix).and_then(|entry| {
        entry
            .set_password(value)
            .context(format!("Не удалось сохранить {} в keyring", key_suffix))
    });

    if let Err(e) = &keyring_result {
        log_err!("Keyring save {}: ошибка {:?}", key_suffix, e);
        save_fallback(project, username, key_suffix, value)?;
    }

    Ok(())
}

pub async fn get_credential(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    #[cfg(test)]
    {
        if TEST_TRANSIENT_READ_FAILURE.swap(false, std::sync::atomic::Ordering::Relaxed) {
            anyhow::bail!("Тестовая заглушка: транзиентный сбой чтения хранилища");
        }
    }
    run_credential_task(
        project,
        username,
        key_suffix,
        "Не удалось выполнить задачу чтения credentials",
        get_credential_sync,
    )
    .await
}

fn get_credential_sync(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    let entry = match open_keyring_entry(project, username, key_suffix) {
        Ok(entry) => entry,
        Err(e) => {
            log_err!("Keyring load {}: ошибка {}", key_suffix, e);
            return load_fallback(project, username, key_suffix);
        }
    };

    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => {
            log_info!(
                "Keyring load {}: записи нет, читаю fallback-хранилище",
                key_suffix
            );
            load_fallback(project, username, key_suffix)
        }
        Err(e) => {
            log_err!("Keyring load {}: ошибка {}", key_suffix, e);
            load_fallback(project, username, key_suffix)
        }
    }
}

pub async fn delete_credential(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    run_credential_task(
        project,
        username,
        key_suffix,
        "Не удалось выполнить задачу удаления credentials",
        delete_credential_sync,
    )
    .await
}

fn delete_credential_sync(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    let keyring_delete = open_keyring_entry(project, username, key_suffix).and_then(|entry| {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::Error::new(e)
                .context(format!("Не удалось удалить {} из keyring", key_suffix))),
        }
    });

    if let Err(e) = &keyring_delete {
        log_err!("Keyring delete {}: ошибка {}", key_suffix, e);
    }

    let keyring_unavailable = matches!(
        &keyring_delete,
        Err(e) if e.chain().any(|cause| {
            cause
                .downcast_ref::<keyring::Error>()
                .is_some_and(|err| matches!(
                    err,
                    keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_)
                ))
        })
    );

    let fallback_result = delete_fallback(project, username, key_suffix);

    if keyring_unavailable {
        return fallback_result;
    }

    let keyring_err = match keyring_delete {
        Ok(()) => return fallback_result,
        Err(e) => e,
    };

    match fallback_result {
        Ok(()) => Err(keyring_err),
        Err(fallback_err) => Err(keyring_err.context(format!(
            "также не удалось очистить fallback-хранилище: {fallback_err}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        delete_fallback, load_fallback, save_fallback, to_hex, xor_crypt, EntryScheme,
        SecretUnavailableGuard,
    };
    use crate::test_support::LauncherDirGuard;
    use crate::utils::download_file::write_atomic_sync;

    fn store_path(dir: &LauncherDirGuard) -> std::path::PathBuf {
        dir.root().join("credentials.json")
    }

    fn read_store(dir: &LauncherDirGuard) -> String {
        std::fs::read_to_string(store_path(dir)).expect("файл хранилища создан")
    }

    fn write_store(dir: &LauncherDirGuard, content: &str) {
        write_atomic_sync(&store_path(dir), content.as_bytes()).unwrap();
    }

    #[cfg(unix)]
    fn file_mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .expect("файл хранилища")
            .permissions()
            .mode()
    }

    #[tokio::test]
    async fn fallback_roundtrip_without_keyring() {
        let dir = LauncherDirGuard::acquire("credentials_fallback").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "jwt-secret")
            .expect("сохранение в fallback-хранилище");

        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token")
                .expect("чтение из fallback-хранилища"),
            "jwt-secret"
        );

        let stored = read_store(&dir);
        assert!(
            !stored.contains("jwt-secret"),
            "значение должно храниться обфусцированным"
        );
        assert!(
            stored.contains("Steve_refresh_token"),
            "ключ записи должен присутствовать в хранилище"
        );
        assert!(
            stored.contains("\"scheme\": \"xor_secret\""),
            "запись должна помечать схему шифрования: {stored}"
        );
    }

    #[tokio::test]
    async fn fallback_isolates_projects_and_users() {
        let _dir = LauncherDirGuard::acquire("credentials_isolation").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "token-a").unwrap();
        save_fallback("Cordelia", "Alex", "refresh_token", "token-b").unwrap();
        save_fallback("Other", "Steve", "refresh_token", "token-c").unwrap();

        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token").unwrap(),
            "token-a"
        );
        assert_eq!(
            load_fallback("Cordelia", "Alex", "refresh_token").unwrap(),
            "token-b"
        );
        assert_eq!(
            load_fallback("Other", "Steve", "refresh_token").unwrap(),
            "token-c"
        );
    }

    #[tokio::test]
    async fn fallback_overwrites_previous_value_for_same_key() {
        let _dir = LauncherDirGuard::acquire("credentials_overwrite").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "old").unwrap();
        save_fallback("Cordelia", "Steve", "refresh_token", "new").unwrap();

        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token").unwrap(),
            "new"
        );
    }

    #[tokio::test]
    async fn fallback_delete_removes_only_matching_entry() {
        let _dir = LauncherDirGuard::acquire("credentials_delete").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "token-a").unwrap();
        save_fallback("Cordelia", "Alex", "refresh_token", "token-b").unwrap();

        delete_fallback("Cordelia", "Steve", "refresh_token").unwrap();

        assert!(
            load_fallback("Cordelia", "Steve", "refresh_token").is_err(),
            "удалённая запись не должна читаться"
        );
        assert_eq!(
            load_fallback("Cordelia", "Alex", "refresh_token").unwrap(),
            "token-b"
        );
    }

    #[tokio::test]
    async fn fallback_delete_succeeds_without_store_file() {
        let _dir = LauncherDirGuard::acquire("credentials_delete_missing").await;

        delete_fallback("Cordelia", "Steve", "refresh_token")
            .expect("удаление при отсутствии хранилища не ошибка");
    }

    #[tokio::test]
    async fn fallback_missing_entry_is_error() {
        let _dir = LauncherDirGuard::acquire("credentials_missing_entry").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "token").unwrap();

        assert!(
            load_fallback("Cordelia", "Steve", "uuid").is_err(),
            "отсутствующая запись должна давать ошибку"
        );
    }

    #[tokio::test]
    async fn fallback_concurrent_saves_keep_all_entries() {
        let dir = LauncherDirGuard::acquire("credentials_concurrent").await;

        let mut handles = Vec::new();
        for i in 0..40 {
            handles.push(tokio::task::spawn_blocking(move || {
                save_fallback(
                    "Cordelia",
                    &format!("Steve{i}"),
                    "refresh_token",
                    &format!("token-{i}"),
                )
            }));
        }
        for handle in handles {
            handle
                .await
                .expect("задача сохранения credentials")
                .expect("сохранение credentials");
        }

        let stored = read_store(&dir);
        for i in 0..40 {
            assert!(
                stored.contains(&format!("Steve{i}_refresh_token")),
                "запись Steve{i} потеряна при конкурентной записи"
            );
        }
    }

    #[tokio::test]
    async fn corrupt_store_backed_up_on_load() {
        let dir = LauncherDirGuard::acquire("credentials_corrupt_load").await;
        write_store(&dir, "{ broken");

        let error = load_fallback("Cordelia", "Steve", "refresh_token")
            .expect_err("битое хранилище не должно молча читаться");

        assert!(
            error.to_string().contains("Credentials не найдены"),
            "битое хранилище — это отсутствие записей, а не жёсткий сбой: {error}"
        );
        let backup = std::fs::read_to_string(dir.root().join("credentials.json.bak"))
            .expect("битое хранилище должно быть забэкаплено при чтении");
        assert!(backup.contains("broken"));
    }

    #[tokio::test]
    async fn store_with_unknown_scheme_is_reset_with_backup() {
        let dir = LauncherDirGuard::acquire("credentials_unknown_scheme").await;
        write_store(
            &dir,
            "{\"entries\":[{\"username\":\"Cordelia_Steve_refresh_token\",\"obfuscated\":\"ab\",\"scheme\":\"legacy_fnv\"}]}",
        );

        let error = load_fallback("Cordelia", "Steve", "refresh_token")
            .expect_err("запись с неизвестной схемой не должна читаться");

        assert!(
            error.to_string().contains("Credentials не найдены"),
            "неизвестная схема — это отсутствие записей: {error}"
        );
        let backup = std::fs::read_to_string(dir.root().join("credentials.json.bak"))
            .expect("хранилище с неизвестной схемой должно быть забэкаплено");
        assert!(
            backup.contains("legacy_fnv"),
            "исходные данные должны сохраняться в бэкапе: {backup}"
        );
    }

    #[tokio::test]
    async fn corrupt_store_backed_up_before_overwrite() {
        let dir = LauncherDirGuard::acquire("credentials_corrupt_save").await;
        write_store(&dir, "{ broken");

        save_fallback("Cordelia", "Steve", "refresh_token", "token")
            .expect("сохранение после битого хранилища");

        let backup = std::fs::read_to_string(dir.root().join("credentials.json.bak"))
            .expect("битое хранилище должно быть забэкаплено");
        assert!(backup.contains("broken"));
        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token").unwrap(),
            "token"
        );
    }

    #[tokio::test]
    async fn delete_credential_propagates_fallback_failure() {
        let _dir = LauncherDirGuard::acquire("credentials_delete_failure").await;
        std::fs::create_dir(super::fallback_path().expect("путь хранилища"))
            .expect("заглушка недоступного хранилища");

        assert!(
            super::delete_credential("Cordelia", "Steve", "refresh_token")
                .await
                .is_err(),
            "ошибка удаления из fallback-хранилища не должна проглатываться"
        );
    }

    #[tokio::test]
    async fn load_fallback_resets_entry_encrypted_with_foreign_key() {
        let dir = LauncherDirGuard::acquire("credentials_foreign_key").await;

        let obfuscated = to_hex(&xor_crypt(b"refresh-token-old-toolchain", &[0xA5; 8]));
        let store = format!(
            "{{\"entries\":[{{\"username\":\"Cordelia_Steve_refresh_token\",\"obfuscated\":\"{obfuscated}\",\"scheme\":\"xor_secret\"}}]}}"
        );
        write_store(&dir, &store);

        assert!(
            load_fallback("Cordelia", "Steve", "refresh_token").is_err(),
            "запись, зашифрованная чужим ключом, не должна расшифровываться"
        );
        let stored = read_store(&dir);
        assert!(
            !stored.contains("Steve_refresh_token"),
            "нечитаемая запись должна сбрасываться: {stored}"
        );
    }

    #[tokio::test]
    async fn corrupt_store_backed_up_on_delete() {
        let dir = LauncherDirGuard::acquire("credentials_corrupt_delete").await;
        write_store(&dir, "{ broken");

        delete_fallback("Cordelia", "Steve", "refresh_token")
            .expect("удаление после битого хранилища");

        let backup = std::fs::read_to_string(dir.root().join("credentials.json.bak"))
            .expect("битое хранилище должно быть забэкаплено");
        assert!(backup.contains("broken"));
    }

    #[tokio::test]
    async fn save_fallback_rejects_disallowed_suffix() {
        let dir = LauncherDirGuard::acquire("credentials_reject_suffix").await;

        let error = save_fallback("Cordelia", "Steve", "password", "secret")
            .expect_err("запрещённый суффикс должен явно отклоняться");

        assert!(
            error.to_string().contains("не сохраняется"),
            "неожиданная ошибка: {error}"
        );
        assert!(
            !store_path(&dir).exists(),
            "файл хранилища не должен создаваться для запрещённого суффикса"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn credentials_file_gets_owner_only_permissions() {
        let dir = LauncherDirGuard::acquire("credentials_permissions").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "jwt-secret").unwrap();

        assert_eq!(
            file_mode(&store_path(&dir)) & 0o777,
            0o600,
            "credentials.json должен быть доступен только владельцу"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn load_tightens_permissions_of_existing_store_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = LauncherDirGuard::acquire("credentials_permissions_load").await;

        write_store(&dir, "{\"entries\":[]}");
        std::fs::set_permissions(store_path(&dir), std::fs::Permissions::from_mode(0o644)).unwrap();

        let _ = load_fallback("Cordelia", "Steve", "refresh_token");

        assert_eq!(
            file_mode(&store_path(&dir)) & 0o777,
            0o600,
            "чтение должно подтягивать права существующего файла до 0600"
        );
    }

    #[tokio::test]
    async fn fallback_without_secret_stores_documented_plaintext() {
        let dir = LauncherDirGuard::acquire("credentials_plain").await;
        let _unavailable = SecretUnavailableGuard::acquire();

        save_fallback("Cordelia", "Steve", "refresh_token", "plain-token").unwrap();

        let stored = read_store(&dir);
        assert!(
            stored.contains("plain-token"),
            "без keyring запись честно помечается plaintext: {stored}"
        );
        assert!(stored.contains("\"scheme\": \"plain\""));
        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token").unwrap(),
            "plain-token"
        );
    }

    #[tokio::test]
    async fn xor_secret_entry_survives_transient_secret_unavailability() {
        let dir = LauncherDirGuard::acquire("credentials_transient_secret").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "jwt-secret").unwrap();
        {
            let _unavailable = SecretUnavailableGuard::acquire();
            assert!(
                load_fallback("Cordelia", "Steve", "refresh_token").is_err(),
                "без секрета запись не должна расшифровываться"
            );
        }

        let stored = read_store(&dir);
        assert!(
            stored.contains("Steve_refresh_token"),
            "временная недоступность секрета не должна стирать запись: {stored}"
        );
        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token").unwrap(),
            "jwt-secret"
        );
    }

    #[test]
    fn entry_scheme_serializes_snake_case() {
        let json = serde_json::to_string(&EntryScheme::XorSecret).unwrap();
        assert_eq!(json, "\"xor_secret\"");
        assert_eq!(
            serde_json::from_str::<EntryScheme>("\"plain\"").unwrap(),
            EntryScheme::Plain
        );
        assert_eq!(
            serde_json::from_str::<super::EncryptedEntry>(
                "{\"username\":\"a\",\"obfuscated\":\"b\"}"
            )
            .unwrap()
            .scheme,
            EntryScheme::XorSecret,
            "отсутствие поля схемы должно читаться как xor_secret"
        );
    }
}
