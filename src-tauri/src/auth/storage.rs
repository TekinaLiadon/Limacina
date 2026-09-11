use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::{
    log_err,
    utils::env_info::{get_launcher_name, launcher_patch},
    utils::hex::{from_hex, to_hex},
};




const FALLBACK_ALLOWED_SUFFIXES: &[&str] = &["refresh_token", "uuid"];

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
    let base = launcher_patch(None)?;
    Ok(base.join("credentials.json"))
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

fn save_fallback(project: &str, username: &str, key_suffix: &str, value: &str) -> Result<()> {
    let path = fallback_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut store: CredentialStore = if path.exists() {
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Не удалось прочитать {:?}", path))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        CredentialStore::default()
    };


    store.entries.retain(|e| !e.username.ends_with("_password"));

    let entry_key = format!("{}_{}", username, key_suffix);
    store.entries.retain(|e| e.username != entry_key);
    let key = derive_key(project, username, key_suffix);
    let encrypted = xor_crypt(value.as_bytes(), &key);

    store.entries.insert(
        0,
        EncryptedEntry {
            username: entry_key,
            obfuscated: to_hex(&encrypted),
        },
    );

    let content = serde_json::to_string_pretty(&store)
        .context("Не удалось сериализовать хранилище credentials")?;
    fs::write(&path, content)
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

fn load_fallback(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    let path = fallback_path()?;
    if !path.exists() {
        anyhow::bail!("Файл хранилища credentials не найден");
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Не удалось прочитать {:?}", path))?;
    let store: CredentialStore =
        serde_json::from_str(&content).context("Неверный формат хранилища credentials")?;
    let entry_key = format!("{}_{}", username, key_suffix);
    let entry = store
        .entries
        .iter()
        .find(|e| e.username == entry_key)
        .context("Credentials не найдены в хранилище")?;

    let key = derive_key(project, username, key_suffix);
    let ciphertext = from_hex(&entry.obfuscated)?;
    let decrypted = xor_crypt(&ciphertext, &key);
    String::from_utf8(decrypted).context("Не удалось расшифровать credentials")
}

fn delete_fallback(_project: &str, username: &str, key_suffix: &str) -> Result<()> {
    let path = fallback_path()?;
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&path)?;
    let mut store: CredentialStore = serde_json::from_str(&content).unwrap_or_default();
    let entry_key = format!("{}_{}", username, key_suffix);
    store.entries.retain(|e| e.username != entry_key);
    let content = serde_json::to_string_pretty(&store)?;
    fs::write(&path, content)?;
    Ok(())
}

fn keyring_key(project: &str, username: &str, key_suffix: &str) -> String {
    format!("{}_{}_{}", project, username, key_suffix)
}



pub async fn save_credential(project: &str, username: &str, key_suffix: &str, value: &str) -> Result<()> {
    let (project, username, key_suffix, value) = (
        project.to_string(),
        username.to_string(),
        key_suffix.to_string(),
        value.to_string(),
    );
    tokio::task::spawn_blocking(move || {
        save_credential_sync(&project, &username, &key_suffix, &value)
    })
    .await
    .context("Не удалось выполнить задачу сохранения credentials")?
}

fn save_credential_sync(project: &str, username: &str, key_suffix: &str, value: &str) -> Result<()> {
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
    tokio::task::spawn_blocking(move || {
        get_credential_sync(&project, &username, &key_suffix)
    })
    .await
    .context("Не удалось выполнить задачу чтения credentials")?
}

fn get_credential_sync(project: &str, username: &str, key_suffix: &str) -> Result<String> {
    let key = keyring_key(project, username, key_suffix);
    let service = get_launcher_name();

    let keyring_result = (|| -> Result<String> {
        let entry = keyring::Entry::new(&service, &key)
            .context("Не удалось получить доступ к хранилищу")?;
        entry
            .get_password()
            .context(format!("Не найден {} в keyring", key_suffix))
    })();

    match keyring_result {
        Ok(val) => Ok(val),
        Err(e) => {
            log_err!("Keyring load {}: ОШИБКА — {:?}", key_suffix, e);
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
    tokio::task::spawn_blocking(move || {
        delete_credential_sync(&project, &username, &key_suffix)
    })
    .await
    .context("Не удалось выполнить задачу удаления credentials")?
}

fn delete_credential_sync(project: &str, username: &str, key_suffix: &str) -> Result<()> {
    let key = keyring_key(project, username, key_suffix);
    let service = get_launcher_name();

    let keyring_result = (|| -> Result<()> {
        let entry = keyring::Entry::new(&service, &key)?;
        entry.delete_credential()?;
        Ok(())
    })();

    if let Err(e) = &keyring_result {
        log_err!("Keyring delete {}: ОШИБКА — {}", key_suffix, e);
    }

    let _ = delete_fallback(project, username, key_suffix);

    Ok(())
}
