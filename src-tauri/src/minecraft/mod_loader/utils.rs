use anyhow::{Context, Result};
use md5::{Digest, Md5};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::path::PathBuf;
use std::{
    process::{Command, Stdio},
    thread,
};
use tauri::{AppHandle, Emitter};
use uuid::{Builder, Variant, Version};

use crate::utils::{compare_versions, get_classpath_separator};
use crate::{log_info, minecraft::structs::GameConfig};

#[derive(Clone, serde::Serialize)]
pub struct ConsolePayload {
    pub line: String,
    pub is_error: bool,
}

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

pub fn maven_to_path(name: &str) -> Result<PathBuf> {
    let parts: Vec<&str> = name.split(':').collect();
    let group_id = parts[0];
    let artifact_id = parts[1];
    let version = parts[2];

    let group_path = group_id.replace('.', "/");
    let file_name = format!("{}-{}.jar", artifact_id, version);

    let mut local_path = PathBuf::new();
    local_path = local_path
        .join(&group_path)
        .join(artifact_id)
        .join(version)
        .join(&file_name);

    Ok(local_path)
}

pub fn maven_to_url(coord: &str, url: &str) -> String {
    let parts: Vec<&str> = coord.split(':').collect();
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    format!(
        "{}/{}/{}/{}/{}-{}.jar",
        url, group, artifact, version, artifact, version
    )
}

pub fn filter_classpath(classpath: Vec<String>) -> Vec<String> {
    let mut latest_versions: HashMap<String, String> = HashMap::new();
    for path_str in &classpath {
        if let Some((artifact_id, version)) = extract_maven_info(path_str) {
            if let Some(existing_version) = latest_versions.get(&artifact_id) {
                if compare_versions(&version, existing_version) == Ordering::Greater {
                    latest_versions.insert(artifact_id, version);
                }
            } else {
                latest_versions.insert(artifact_id, version);
            }
        }
    }

    let mut final_classpath = Vec::new();
    let mut seen = HashSet::new();
    for path_str in classpath {
        if !seen.contains(&path_str) {
            if let Some((artifact_id, version)) = extract_maven_info(&path_str) {
                if let Some(latest) = latest_versions.get(&artifact_id) {
                    if &version == latest {
                        final_classpath.push(path_str.clone());
                        seen.insert(path_str);
                    }
                }
            } else {
                final_classpath.push(path_str.clone());
                seen.insert(path_str);
            }
        }
    }

    final_classpath
}

fn extract_maven_info(path_str: &str) -> Option<(String, String)> {
    let path = Path::new(path_str);
    let file_name = path.file_name()?.to_str()?;
    let version = path.parent()?.file_name()?.to_str()?;
    let artifact_id = path.parent()?.parent()?.file_name()?.to_str()?;

    if file_name.starts_with(artifact_id) && file_name.contains(version) {
        return Some((artifact_id.to_string(), version.to_string()));
    }
    None
}

pub fn spawn_game_process(app: AppHandle, config: GameConfig) -> Result<()> {
    log_info!("\n▶ Запуск Minecraft...\n");
    let mut command = Command::new(config.java_path);
    let separator = get_classpath_separator();
    let classpath = &config.classpath.join(separator);
    let jvm_args: Vec<String> = config
        .jvm_args
        .iter()
        .cloned()
        .filter(|arg| arg != "-cp" && !arg.is_empty())
        .collect();

    //log_info!("{}", config.classpath);
    //log_info!("{}", config.jvm_args.join(" "));
    command
        .args(jvm_args)
        .arg("-cp")
        .arg(&classpath)
        .arg(&config.main_class)
        .args(config.game_args)
        .current_dir(&config.game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    //eprintln!("Аргументы: {:?}", command.get_args().collect::<Vec<_>>());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .context("Не удалось запустить Java процесс")?;

    let stdout = child.stdout.take().expect("Failed to open stdout");
    let stderr = child.stderr.take().expect("Failed to open stderr");

    let app_out = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_out.emit(
                    "game-console",
                    ConsolePayload {
                        line,
                        is_error: false,
                    },
                );
            }
        }
    });

    let app_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                println!("{}", line);
                let _ = app_err.emit(
                    "game-console",
                    ConsolePayload {
                        line,
                        is_error: true,
                    },
                );
            }
        }
    });

    thread::spawn(move || match child.wait() {
        Ok(status) => println!("✓ Minecraft завершился: {:?}", status),
        Err(e) => eprintln!("✗ Ошибка ожидания процесса: {}", e),
    });

    Ok(())
}
