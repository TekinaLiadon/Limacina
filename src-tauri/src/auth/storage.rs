use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::{
    log_err, log_info,
    utils::download_file::write_atomic_sync,
    utils::env_info::{get_launcher_name, launcher_path},
    utils::errors::LauncherError,
    utils::hex::{from_hex, to_hex},
};

const FALLBACK_ALLOWED_SUFFIXES: &[&str] = &["refresh_token", "uuid"];

static FALLBACK_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn fallback_store_lock() -> &'static Mutex<()> {
    FALLBACK_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Serialize, Deserialize)]
struct EncryptedEntry {
    username: String,
    #[serde(alias = "ciphertext")]
    obfuscated: String,
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
                "Хранилище credentials повреждено: {:?} — битый файл сохранён в {:?} ({})",
                path,
                backup_path,
                e
            );
            let _ = fs::rename(path, &backup_path);
            CredentialStore::default()
        }
    }
}

fn derive_key(project: &str, username: &str, key_suffix: &str) -> [u8; 8] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    format!("{}_{}_{}", project, username, key_suffix).hash(&mut hasher);
    hasher.finish().to_le_bytes()
}

fn xor_crypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .zip(key.iter().cycle())
        .map(|(d, k)| d ^ k)
        .collect()
}

pub(crate) fn save_fallback(
    project: &str,
    username: &str,
    key_suffix: &str,
    value: &str,
) -> Result<()> {
    let _guard = fallback_store_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let path = fallback_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Не удалось создать каталог {parent:?}"))?;
    }

    let mut store: CredentialStore = if path.exists() {
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Не удалось прочитать {:?}", path))?;
        read_fallback_store(&path, &content)
    } else {
        CredentialStore::default()
    };

    store.entries.retain(|e| !e.username.ends_with("_password"));

    let key_name = fallback_entry_key(project, username, key_suffix);
    store.entries.retain(|e| e.username != key_name);
    let key = derive_key(project, username, key_suffix);
    let encrypted = xor_crypt(value.as_bytes(), &key);

    store.entries.insert(
        0,
        EncryptedEntry {
            username: key_name,
            obfuscated: to_hex(&encrypted),
        },
    );

    let content = serde_json::to_string_pretty(&store)
        .context("Не удалось сериализовать хранилище credentials")?;
    write_atomic_sync(&path, content.as_bytes())
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

pub(crate) fn load_fallback(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    let path = fallback_path()?;
    if !path.exists() {
        anyhow::bail!("Файл хранилища credentials не найден");
    }

    let content =
        fs::read_to_string(&path).with_context(|| format!("Не удалось прочитать {:?}", path))?;
    let store: CredentialStore =
        serde_json::from_str(&content).context("Неверный формат хранилища credentials")?;
    let key_name = fallback_entry_key(project, username, key_suffix);
    let legacy_name = legacy_fallback_entry_key(username, key_suffix);
    let entry = store
        .entries
        .iter()
        .find(|e| e.username == key_name)
        .or_else(|| store.entries.iter().find(|e| e.username == legacy_name))
        .context("Credentials не найдены в хранилище")?;

    let key = derive_key(project, username, key_suffix);
    let ciphertext = from_hex(&entry.obfuscated)
        .context("Не удалось декодировать запись хранилища credentials")?;
    let decrypted = xor_crypt(&ciphertext, &key);
    String::from_utf8(decrypted).context("Не удалось расшифровать credentials")
}

pub(crate) fn delete_fallback(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    let _guard = fallback_store_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let path = fallback_path()?;
    if !path.exists() {
        return Ok(());
    }

    let content =
        fs::read_to_string(&path).with_context(|| format!("Не удалось прочитать {:?}", path))?;
    let mut store: CredentialStore = read_fallback_store(&path, &content);
    let key_name = fallback_entry_key(project, username, key_suffix);
    let legacy_name = legacy_fallback_entry_key(username, key_suffix);
    store
        .entries
        .retain(|e| e.username != key_name && e.username != legacy_name);
    let content = serde_json::to_string_pretty(&store)
        .context("Не удалось сериализовать хранилище credentials")?;
    write_atomic_sync(&path, content.as_bytes())
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

fn fallback_entry_key(project: &str, username: &str, key_suffix: &str) -> String {
    keyring_key(project, username, key_suffix)
}

fn legacy_fallback_entry_key(username: &str, key_suffix: &str) -> String {
    format!("{}_{}", username, key_suffix)
}

fn keyring_key(project: &str, username: &str, key_suffix: &str) -> String {
    format!("{}_{}_{}", project, username, key_suffix)
}

pub async fn save_credential(
    project: &str,
    username: &str,
    key_suffix: &str,
    value: &str,
) -> Result<()> {
    let (project, username, key_suffix, value) = (
        project.to_string(),
        username.to_string(),
        key_suffix.to_string(),
        value.to_string(),
    );
    LauncherError::classify(
        tokio::task::spawn_blocking(move || {
            save_credential_sync(&project, &username, &key_suffix, &value)
        })
        .await
        .context("Не удалось выполнить задачу сохранения credentials")?,
        LauncherError::CredentialsStorage,
    )
}

fn save_credential_sync(
    project: &str,
    username: &str,
    key_suffix: &str,
    value: &str,
) -> Result<()> {
    let key = keyring_key(project, username, key_suffix);
    let service = get_launcher_name();

    let keyring_result = (|| -> Result<()> {
        let entry = keyring::Entry::new(&service, &key)
            .context("Не удалось получить доступ к хранилищу")?;
        entry
            .set_password(value)
            .context(format!("Не удалось сохранить {} в keyring", key_suffix))?;
        Ok(())
    })();

    if let Err(e) = &keyring_result {
        log_err!("Keyring save {}: ОШИБКА — {:?}", key_suffix, e);
        if !FALLBACK_ALLOWED_SUFFIXES.contains(&key_suffix) {
            log_err!(
                "Keyring недоступен, «{}» в fallback-хранилище не сохраняется",
                key_suffix
            );
            return Ok(());
        }
        save_fallback(project, username, key_suffix, value)?;
    }

    Ok(())
}

pub async fn get_credential(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    let (project, username, key_suffix) = (
        project.to_string(),
        username.to_string(),
        key_suffix.to_string(),
    );
    LauncherError::classify(
        tokio::task::spawn_blocking(move || get_credential_sync(&project, &username, &key_suffix))
            .await
            .context("Не удалось выполнить задачу чтения credentials")?,
        LauncherError::CredentialsStorage,
    )
}

fn get_credential_sync(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    let key = keyring_key(project, username, key_suffix);
    let service = get_launcher_name();

    let entry = match keyring::Entry::new(&service, &key) {
        Ok(entry) => entry,
        Err(e) => {
            log_err!("Keyring load {}: ОШИБКА — {}", key_suffix, e);
            return load_fallback(project, username, key_suffix);
        }
    };

    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => {
            log_info!(
                "Keyring load {}: записи нет — читаю fallback-хранилище",
                key_suffix
            );
            load_fallback(project, username, key_suffix)
        }
        Err(e) => {
            log_err!("Keyring load {}: ОШИБКА — {}", key_suffix, e);
            load_fallback(project, username, key_suffix)
        }
    }
}

pub async fn delete_credential(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    let (project, username, key_suffix) = (
        project.to_string(),
        username.to_string(),
        key_suffix.to_string(),
    );
    LauncherError::classify(
        tokio::task::spawn_blocking(move || {
            delete_credential_sync(&project, &username, &key_suffix)
        })
        .await
        .context("Не удалось выполнить задачу удаления credentials")?,
        LauncherError::CredentialsStorage,
    )
}

fn delete_credential_sync(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    let key = keyring_key(project, username, key_suffix);
    let service = get_launcher_name();

    let keyring_delete = (|| -> Result<()> {
        let entry = keyring::Entry::new(&service, &key)
            .context("Не удалось получить доступ к хранилищу")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::Error::new(e)
                .context(format!("Не удалось удалить {} из keyring", key_suffix))),
        }
    })();

    if let Err(e) = &keyring_delete {
        log_err!("Keyring delete {}: ОШИБКА — {}", key_suffix, e);
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
        delete_fallback, derive_key, load_fallback, save_fallback, to_hex, write_atomic_sync,
        xor_crypt,
    };
    use crate::test_support::LauncherDirGuard;

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

        let stored = std::fs::read_to_string(dir.root().join("credentials.json"))
            .expect("файл хранилища создан");
        assert!(
            !stored.contains("jwt-secret"),
            "значение должно храниться обфусцированным"
        );
        assert!(
            stored.contains("Steve_refresh_token"),
            "ключ записи должен присутствовать в хранилище"
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
                    "Steve",
                    &format!("rt{i}"),
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

        let stored = std::fs::read_to_string(dir.root().join("credentials.json"))
            .expect("файл хранилища создан");
        for i in 0..40 {
            assert!(
                stored.contains(&format!("Steve_rt{i}")),
                "запись rt{i} потеряна при конкурентной записи"
            );
        }
    }

    #[tokio::test]
    async fn fallback_reads_legacy_entry_without_project_in_key() {
        let dir = LauncherDirGuard::acquire("credentials_legacy").await;

        let key = derive_key("Cordelia", "Steve", "refresh_token");
        let obfuscated = to_hex(&xor_crypt(b"legacy-token", &key));
        let store = format!(
            "{{\"entries\":[{{\"username\":\"Steve_refresh_token\",\"obfuscated\":\"{}\"}}]}}",
            obfuscated
        );
        write_atomic_sync(&dir.root().join("credentials.json"), store.as_bytes()).unwrap();

        assert_eq!(
            load_fallback("Cordelia", "Steve", "refresh_token").unwrap(),
            "legacy-token"
        );
    }

    #[tokio::test]
    async fn corrupt_store_backed_up_before_overwrite() {
        let dir = LauncherDirGuard::acquire("credentials_corrupt_save").await;
        write_atomic_sync(&dir.root().join("credentials.json"), b"{ broken").unwrap();

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
    async fn corrupt_store_backed_up_on_delete() {
        let dir = LauncherDirGuard::acquire("credentials_corrupt_delete").await;
        write_atomic_sync(&dir.root().join("credentials.json"), b"{ broken").unwrap();

        delete_fallback("Cordelia", "Steve", "refresh_token")
            .expect("удаление после битого хранилища");

        let backup = std::fs::read_to_string(dir.root().join("credentials.json.bak"))
            .expect("битое хранилище должно быть забэкаплено");
        assert!(backup.contains("broken"));
    }
}
