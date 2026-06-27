use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::{
    log_err, log_info,
    utils::env_info::{get_launcher_name, launcher_patch},
};

#[derive(Serialize, Deserialize)]
struct EncryptedEntry {
    username: String,
    ciphertext: String,
}

#[derive(Serialize, Deserialize, Default)]
struct PasswordStore {
    entries: Vec<EncryptedEntry>,
}

fn fallback_path() -> Result<PathBuf> {
    let base = launcher_patch(None)?;
    Ok(base.join("passwords.json"))
}

fn derive_key(project: &str, username: &str) -> [u8; 8] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    format!("{}_{}", project, username).hash(&mut hasher);
    hasher.finish().to_le_bytes()
}

fn xor_crypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .zip(key.iter().cycle())
        .map(|(d, k)| d ^ k)
        .collect()
}

fn to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

fn from_hex(s: &str) -> Result<Vec<u8>> {
    let mut result = Vec::with_capacity(s.len() / 2);
    let mut chars = s.chars();
    while let Some(hi) = chars.next() {
        let lo = chars.next().context("Нечётная длина hex строки")?;
        let byte = u8::from_str_radix(&format!("{}{}", hi, lo), 16)
            .context("Неверный hex символ")?;
        result.push(byte);
    }
    Ok(result)
}

fn save_fallback(project: &str, username: &str, password: &str) -> Result<()> {
    let path = fallback_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut store: PasswordStore = if path.exists() {
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Не удалось прочитать {:?}", path))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        PasswordStore::default()
    };

    store.entries.retain(|e| e.username != username);

    let key = derive_key(project, username);
    let encrypted = xor_crypt(password.as_bytes(), &key);

    store.entries.insert(
        0,
        EncryptedEntry {
            username: username.to_string(),
            ciphertext: to_hex(&encrypted),
        },
    );

    let content = serde_json::to_string_pretty(&store)
        .context("Не удалось сериализовать хранилище паролей")?;
    fs::write(&path, content)
        .with_context(|| format!("Не удалось записать {:?}", path))?;
    Ok(())
}

fn load_fallback(project: &str, username: &str) -> Result<String> {
    let path = fallback_path()?;
    if !path.exists() {
        anyhow::bail!("Файл хранилища паролей не найден");
    }
    let content = fs::read_to_string(&path)
        .with_context(|| format!("Не удалось прочитать {:?}", path))?;
    let store: PasswordStore =
        serde_json::from_str(&content).context("Неверный формат хранилища паролей")?;

    let entry = store
        .entries
        .iter()
        .find(|e| e.username == username)
        .context("Пароль не найден в хранилище")?;

    let key = derive_key(project, username);
    let ciphertext = from_hex(&entry.ciphertext)?;
    let decrypted = xor_crypt(&ciphertext, &key);
    String::from_utf8(decrypted).context("Не удалось расшифровать пароль")
}

fn delete_fallback(_project: &str, username: &str) -> Result<()> {
    let path = fallback_path()?;
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path)?;
    let mut store: PasswordStore = serde_json::from_str(&content).unwrap_or_default();
    store.entries.retain(|e| e.username != username);
    let content = serde_json::to_string_pretty(&store)?;
    fs::write(&path, content)?;
    Ok(())
}

pub fn save_password(project: &str, username: &str, password: &str) -> Result<()> {
    let key = format!("{}_{}", project, username);
    let service = get_launcher_name();

    log_info!("Keyring save: service=\"{}\" key=\"{}\"", service, key);

    let keyring_result = (|| -> Result<()> {
        let entry = keyring::Entry::new(&service, &key)
            .context("Не удалось получить доступ к хранилищу")?;
        entry
            .set_password(password)
            .context("Не удалось сохранить пароль в keyring")?;
        Ok(())
    })();

    match &keyring_result {
        Ok(()) => log_info!("Keyring save: OK"),
        Err(e) => {
            log_err!("Keyring save: ОШИБКА — {:?}", e);
            save_fallback(project, username, password)?;
        },
    }

    Ok(())
}

pub fn get_password(project: &str, username: &str) -> Result<String> {
    let key = format!("{}_{}", project, username);
    let service = get_launcher_name();

    log_info!("Keyring load: service=\"{}\" key=\"{}\"", service, key);

    let keyring_result = (|| -> Result<String> {
        let entry = keyring::Entry::new(&service, &key)
            .context("Не удалось получить доступ к хранилищу")?;
        entry
            .get_password()
            .context("Не найден в keyring")
    })();

    match keyring_result {
        Ok(pw) => {
            log_info!("Keyring load: OK");
            Ok(pw)
        }
        Err(e) => {
            log_err!("Keyring load: ОШИБКА — {:?}", e);
            log_info!("Keyring load: пробуем fallback");
            load_fallback(project, username)
        }
    }
}

pub fn delete_password(project: &str, username: &str) -> Result<()> {
    let key = format!("{}_{}", project, username);
    let service = get_launcher_name();

    let keyring_result = (|| -> Result<()> {
        let entry = keyring::Entry::new(&service, &key)?;
        entry.delete_credential()?;
        Ok(())
    })();

    match &keyring_result {
        Ok(()) => log_info!("Keyring delete: OK"),
        Err(e) => log_err!("Keyring delete: ОШИБКА — {}", e),
    }

    let _ = delete_fallback(project, username);

    Ok(())
}
