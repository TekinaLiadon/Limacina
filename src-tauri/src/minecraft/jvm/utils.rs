use std::{
    path::Path,
    process::{Command, Stdio},
    thread::{self},
};

use anyhow::{ Context, Result};
use md5::{Digest, Md5};
use std::io::{BufRead, BufReader};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use uuid::{Builder, Variant, Version};

use crate::{
    log_info,
    minecraft::jvm::jvm::{ ConsolePayload, Rule, VersionJson,
    },
    utils::{env_info::get_current_os,},
};

pub fn generate_offline_uuid(nickname: &str) -> String {
    let data = format!("OfflinePlayer:{}", nickname);

    let hash = Md5::digest(data.as_bytes());

    let mut builder = Builder::from_bytes(hash.into());

    builder
        .set_variant(Variant::RFC4122)
        .set_version(Version::Md5);

    builder.into_uuid().to_string()
}

pub fn is_rule_allowed(rules: &[Rule]) -> bool {
    let current_os = get_current_os();
    let mut allowed = false;

    for rule in rules {
        let os_matches = match &rule.os {
            Some(os) => os.name.as_ref().map_or(true, |n| n == current_os),
            None => true,
        };

        if os_matches {
            allowed = rule.action == "allow";
        }
    }

    allowed
}

pub fn maven_to_path(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];

    let filename = if parts.len() > 3 {
        format!("{}-{}-{}.jar", artifact, version, parts[3])
    } else {
        format!("{}-{}.jar", artifact, version)
    };

    Some(format!("{}/{}/{}/{}", group, artifact, version, filename))
}

pub async fn load_version_json(path: &Path) -> Result<VersionJson> {
    let content = fs::read_to_string(path)
        .await
        .with_context(|| format!("Не удалось прочитать {:?}: ", path))?;

    serde_json::from_str(&content).with_context(|| format!("Не удалось распарсить {:?}: ", path))
}

pub fn spawn_game_process(
    app: AppHandle,
    java_path: &Path,
    args: &[String],
    game_dir: &Path,
) -> Result<()> {
    log_info!("\n▶ Запуск Minecraft...\n");
    let mut command = Command::new(java_path);

    command
        .args(args)
        .current_dir(game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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
