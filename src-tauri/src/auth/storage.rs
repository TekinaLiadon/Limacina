use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::{
    log_err, log_info,
    utils::download_file::write_atomic_sync_private,
    utils::env_info::launcher_path,
    utils::errors::LauncherError,
    utils::hex::{from_hex, to_hex},
};

#[cfg(not(test))]
use crate::utils::env_info::get_launcher_name;

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
            ensure_private_mode(&backup_path);
            CredentialStore::default()
        }
    }
}

fn secret_entry_key(secret: &[u8], key_name: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(secret);
    hasher.update(key_name.as_bytes());
    hasher.finalize().into()
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
fn stub_key(key_name: &str) -> String {
    #[cfg(windows)]
    {
        key_name.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        key_name.to_string()
    }
}

#[cfg(test)]
fn test_keyring() -> &'static Mutex<std::collections::HashMap<String, String>> {
    static TEST_KEYRING: OnceLock<Mutex<std::collections::HashMap<String, String>>> =
        OnceLock::new();
    TEST_KEYRING.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

#[cfg(test)]
pub(crate) fn clear_test_keyring() {
    test_keyring()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
}

#[cfg(test)]
pub(crate) fn test_keyring_contains(key_name: &str) -> bool {
    test_keyring()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains_key(&stub_key(key_name))
}

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

fn ensure_fallback_suffix_allowed(key_suffix: &str) -> Result<()> {
    if !FALLBACK_ALLOWED_SUFFIXES.contains(&key_suffix) {
        anyhow::bail!("\"{key_suffix}\" не сохраняется в fallback-хранилище");
    }
    Ok(())
}

fn save_fallback_key(key_name: &str, value: &str) -> Result<()> {
    let entry = encrypt_entry_value(obfuscation_secret().as_deref(), key_name, value);
    mutate_fallback_store(true, |store| {
        store.entries.retain(|e| e.username != key_name);
        store.entries.insert(0, entry);
    })
}

#[cfg(test)]
pub(crate) fn save_fallback(
    project: &str,
    username: &str,
    key_suffix: &str,
    value: &str,
) -> Result<()> {
    ensure_fallback_suffix_allowed(key_suffix)?;
    save_fallback_key(&keyring_key(project, username, key_suffix), value)
}

fn find_fallback_key(key_name: &str) -> Result<Option<String>> {
    let path = fallback_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&path).with_context(|| format!("Не удалось прочитать {:?}", path))?;
    ensure_private_mode(&path);
    let store = read_fallback_store(&path, &content);
    let entry = match store.entries.iter().find(|e| e.username == key_name) {
        Some(entry) => entry,
        None => return Ok(None),
    };

    let secret = obfuscation_secret();
    if entry.scheme == EntryScheme::XorSecret && secret.is_none() {
        anyhow::bail!(
            "Секрет обфускации недоступен, запись \"{key_name}\" не может быть расшифрована"
        );
    }

    match decrypt_entry_value(entry, secret.as_deref()) {
        Some(value) => Ok(Some(value)),
        None => {
            log_info!(
                "Fallback-хранилище: запись \"{key_name}\" не расшифрована (алгоритм ключа обновлён), запись сброшена, потребуется повторный вход"
            );
            let _ = delete_fallback_key(key_name);
            anyhow::bail!("Не удалось расшифровать credentials")
        }
    }
}

#[cfg(test)]
fn load_fallback_key(key_name: &str) -> Result<String> {
    find_fallback_key(key_name)?
        .ok_or_else(|| anyhow::anyhow!("Credentials не найдены в хранилище"))
}

#[cfg(test)]
pub(crate) fn load_fallback(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    load_fallback_key(&keyring_key(project, username, key_suffix))
}

fn delete_fallback_key(key_name: &str) -> Result<()> {
    mutate_fallback_store(false, |store| {
        store.entries.retain(|e| e.username != key_name);
    })
}

#[cfg(test)]
pub(crate) fn delete_fallback(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    delete_fallback_key(&keyring_key(project, username, key_suffix))
}

fn keyring_key(project: &str, username: &str, key_suffix: &str) -> String {
    format!("{}_{}_{}", project, username, key_suffix)
}

fn normalized_username(username: &str) -> String {
    username.trim().to_lowercase()
}

fn credential_key_names(project: &str, username: &str, key_suffix: &str) -> Vec<String> {
    let canonical = keyring_key(project, &normalized_username(username), key_suffix);
    let legacy = keyring_key(project, username.trim(), key_suffix);
    if canonical == legacy {
        vec![canonical]
    } else {
        vec![canonical, legacy]
    }
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

#[cfg(not(test))]
fn open_keyring_entry(key_name: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(&get_launcher_name(), key_name)
        .context("Не удалось получить доступ к хранилищу")
}

#[cfg(test)]
fn keyring_save(key_name: &str, _key_suffix: &str, value: &str) -> Result<()> {
    test_keyring()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(stub_key(key_name), value.to_string());
    Ok(())
}

#[cfg(not(test))]
fn keyring_save(key_name: &str, key_suffix: &str, value: &str) -> Result<()> {
    open_keyring_entry(key_name)?
        .set_password(value)
        .with_context(|| format!("Не удалось сохранить {key_suffix} в keyring"))
}

#[cfg(test)]
fn keyring_load(key_name: &str, _key_suffix: &str) -> Result<Option<String>> {
    Ok(test_keyring()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&stub_key(key_name))
        .cloned())
}

#[cfg(not(test))]
fn keyring_load(key_name: &str, key_suffix: &str) -> Result<Option<String>> {
    match open_keyring_entry(key_name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            Err(anyhow::Error::new(e)
                .context(format!("Не удалось прочитать {key_suffix} из keyring")))
        }
    }
}

#[cfg(test)]
fn keyring_delete(key_name: &str, _key_suffix: &str) -> Result<()> {
    test_keyring()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&stub_key(key_name));
    Ok(())
}

#[cfg(not(test))]
fn keyring_delete(key_name: &str, key_suffix: &str) -> Result<()> {
    match open_keyring_entry(key_name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => {
            Err(anyhow::Error::new(e)
                .context(format!("Не удалось удалить {key_suffix} из keyring")))
        }
    }
}

#[cfg(test)]
fn is_keyring_unavailable(_error: &anyhow::Error) -> bool {
    false
}

#[cfg(not(test))]
fn is_keyring_unavailable(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause.downcast_ref::<keyring::Error>().is_some_and(|err| {
            matches!(
                err,
                keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_)
            )
        })
    })
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
    let key_names = credential_key_names(project, username, key_suffix);
    let canonical_key = &key_names[0];

    if let Err(e) = keyring_save(canonical_key, key_suffix, value) {
        log_err!("Keyring save {}: ошибка {:?}", key_suffix, e);
        ensure_fallback_suffix_allowed(key_suffix)?;
        save_fallback_key(canonical_key, value)?;
    }

    remove_legacy_credentials(canonical_key, &key_names[1..], key_suffix);
    Ok(())
}

fn is_same_keyring_target(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    {
        a.eq_ignore_ascii_case(b)
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

fn remove_legacy_credentials(canonical_key: &str, key_names: &[String], key_suffix: &str) {
    for key_name in key_names {
        if !is_same_keyring_target(key_name, canonical_key) {
            if let Err(e) = keyring_delete(key_name, key_suffix) {
                log_err!("Keyring delete {}: ошибка {}", key_suffix, e);
            }
        }
        if let Err(e) = delete_fallback_key(key_name) {
            log_err!("Fallback delete {}: ошибка {}", key_suffix, e);
        }
    }
}

fn migrate_legacy_credential(canonical_key: &str, found_key: &str, value: &str, key_suffix: &str) {
    if found_key == canonical_key {
        return;
    }
    match keyring_save(canonical_key, key_suffix, value) {
        Ok(()) => {
            if !is_same_keyring_target(found_key, canonical_key) {
                if let Err(e) = keyring_delete(found_key, key_suffix) {
                    log_err!("Keyring delete {}: ошибка {}", key_suffix, e);
                }
            }
            if let Err(e) = delete_fallback_key(found_key) {
                log_err!("Fallback delete {}: ошибка {}", key_suffix, e);
            }
            log_info!(
                "Хранилище credentials: запись \"{found_key}\" перенесена под нормализованный ключ"
            );
        }
        Err(e) => log_err!(
            "Хранилище credentials: не удалось перенести запись \"{found_key}\" под нормализованный ключ: {e:#}"
        ),
    }
}

pub async fn find_credential(
    project: &str,
    username: &str,
    key_suffix: &str,
) -> Result<Option<String>> {
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
        find_credential_sync,
    )
    .await
}

fn find_credential_sync(project: &str, username: &str, key_suffix: &str) -> Result<Option<String>> {
    let key_names = credential_key_names(project, username, key_suffix);
    let canonical_key = &key_names[0];
    let mut keyring_error: Option<anyhow::Error> = None;

    for key_name in &key_names {
        match keyring_load(key_name, key_suffix) {
            Ok(Some(value)) => {
                migrate_legacy_credential(canonical_key, key_name, &value, key_suffix);
                return Ok(Some(value));
            }
            Ok(None) => {}
            Err(e) => {
                log_err!("Keyring load {}: ошибка {}", key_suffix, e);
                keyring_error.get_or_insert(e);
            }
        }

        if let Some(value) = find_fallback_key(key_name)? {
            migrate_legacy_credential(canonical_key, key_name, &value, key_suffix);
            return Ok(Some(value));
        }
    }

    match keyring_error {
        Some(e) => Err(e.context("Не удалось прочитать сохранённые учётные данные")),
        None => Ok(None),
    }
}

#[cfg(test)]
pub async fn get_credential(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    find_credential(project, username, key_suffix)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Credentials не найдены в хранилище"))
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
    let key_names = credential_key_names(project, username, key_suffix);
    let mut first_error: Option<anyhow::Error> = None;

    for key_name in &key_names {
        if let Err(e) = delete_credential_key(key_name, key_suffix) {
            first_error.get_or_insert(e);
        }
    }

    match first_error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

fn delete_credential_key(key_name: &str, key_suffix: &str) -> Result<()> {
    let keyring_delete = keyring_delete(key_name, key_suffix);

    if let Err(e) = &keyring_delete {
        log_err!("Keyring delete {}: ошибка {}", key_suffix, e);
    }

    let keyring_unavailable = keyring_delete
        .as_ref()
        .err()
        .is_some_and(is_keyring_unavailable);

    let fallback_result = delete_fallback_key(key_name);

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
        delete_credential, delete_fallback, find_credential, load_fallback, save_credential,
        save_fallback, test_keyring_contains, to_hex, xor_crypt, EntryScheme,
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
    async fn credentials_are_found_by_normalized_username() {
        let _dir = LauncherDirGuard::acquire("credentials_username_normalization").await;

        save_credential("Cordelia", "Steve", "refresh_token", "token-normalized")
            .await
            .expect("сохранение credentials");

        for username in ["steve", "STEVE", "  Steve  "] {
            assert_eq!(
                find_credential("Cordelia", username, "refresh_token")
                    .await
                    .expect("чтение credentials"),
                Some("token-normalized".to_string()),
                "ник \"{username}\" должен находить запись"
            );
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn save_credential_survives_legacy_case_cleanup() {
        let _dir = LauncherDirGuard::acquire("credentials_case_cleanup").await;

        save_credential("Cordelia", "Tereya", "refresh_token", "tok-case")
            .await
            .expect("сохранение credentials");

        assert_eq!(
            find_credential("Cordelia", "Tereya", "refresh_token")
                .await
                .expect("чтение credentials"),
            Some("tok-case".to_string()),
            "таргеты keyring на Windows регистронезависимы: legacy-очистка не должна удалять свежую запись"
        );
    }

    #[tokio::test]
    async fn legacy_case_entry_is_migrated_to_normalized_key() {
        let _dir = LauncherDirGuard::acquire("credentials_username_migration").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "legacy-token")
            .expect("сохранение legacy-записи");

        assert_eq!(
            find_credential("Cordelia", "Steve", "refresh_token")
                .await
                .expect("чтение legacy-записи"),
            Some("legacy-token".to_string())
        );
        assert!(
            test_keyring_contains("Cordelia_steve_refresh_token"),
            "запись должна переехать под нормализованный ключ"
        );
        assert!(
            load_fallback("Cordelia", "Steve", "refresh_token").is_err(),
            "legacy-запись должна удаляться после переноса"
        );
        assert_eq!(
            find_credential("Cordelia", "STEVE", "refresh_token")
                .await
                .expect("чтение после переноса"),
            Some("legacy-token".to_string()),
            "после переноса регистр ника не должен влиять на чтение"
        );
    }

    #[tokio::test]
    async fn keyring_path_in_tests_never_writes_fallback_file() {
        let dir = LauncherDirGuard::acquire("credentials_test_keyring").await;

        save_credential("Cordelia", "Steve", "refresh_token", "token")
            .await
            .expect("сохранение в тестовый keyring");

        assert!(test_keyring_contains("Cordelia_steve_refresh_token"));
        assert!(
            !dir.root().join("credentials.json").exists(),
            "keyring-путь не должен создавать fallback-файл"
        );
    }

    #[tokio::test]
    async fn delete_credential_removes_normalized_and_legacy_entries() {
        let _dir = LauncherDirGuard::acquire("credentials_delete_all_keys").await;

        save_fallback("Cordelia", "Steve", "refresh_token", "legacy").expect("legacy-запись");
        save_credential("Cordelia", "STEVE", "refresh_token", "canonical")
            .await
            .expect("canonical-запись");

        delete_credential("Cordelia", "Steve", "refresh_token")
            .await
            .expect("удаление credentials");

        assert_eq!(
            find_credential("Cordelia", "Steve", "refresh_token")
                .await
                .expect("чтение после удаления"),
            None
        );
        assert!(
            load_fallback("Cordelia", "Steve", "refresh_token").is_err(),
            "legacy-запись должна быть удалена"
        );
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

    #[test]
    fn secret_entry_key_uses_full_sha256_digest() {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"test-obfuscation-secret");
        hasher.update(b"Cordelia_Steve_refresh_token");
        let expected: [u8; 32] = hasher.finalize().into();

        let key =
            super::secret_entry_key(b"test-obfuscation-secret", "Cordelia_Steve_refresh_token");

        assert_eq!(key, expected, "ключ должен быть полным дайджестом SHA-256");
    }

    #[test]
    fn xor_keystream_period_exceeds_eight_bytes() {
        let key =
            super::secret_entry_key(b"test-obfuscation-secret", "Cordelia_Steve_refresh_token");
        let zeros = [0u8; 32];

        let encrypted = xor_crypt(&zeros, &key);

        assert_ne!(
            &encrypted[0..8],
            &encrypted[8..16],
            "период гаммы не должен сводиться к 8 байтам"
        );
    }

    #[tokio::test]
    async fn fallback_roundtrip_long_token() {
        let _dir = LauncherDirGuard::acquire("credentials_long_token").await;
        let long_token: String = (0..300)
            .map(|i| char::from(b'a' + (i % 26) as u8))
            .collect();

        save_fallback("Cordelia", "Steve", "refresh_token", &long_token)
            .expect("сохранение длинного токена");

        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token").expect("чтение"),
            long_token,
            "токен длиннее периода ключа должен проходить полный цикл"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn corrupt_store_backup_gets_private_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = LauncherDirGuard::acquire("credentials_bak_permissions").await;
        write_store(&dir, "{ broken");
        std::fs::set_permissions(store_path(&dir), std::fs::Permissions::from_mode(0o644)).unwrap();

        save_fallback("Cordelia", "Steve", "refresh_token", "token")
            .expect("сохранение после битого хранилища");

        assert_eq!(
            file_mode(&dir.root().join("credentials.json.bak")) & 0o777,
            0o600,
            "бэкап битого хранилища не должен наследовать широкие права исходного файла"
        );
    }
}
