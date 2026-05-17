use anyhow::{Context, Result};
use md5::{Digest, Md5};
use std::io::{BufRead, BufReader};
use std::{
    path::Path,
    process::{Command, Stdio},
    thread,
};
use tauri::{AppHandle, Emitter};
use uuid::{Builder, Variant, Version};

use crate::minecraft::mod_loader::vanilla::{ArgumentValue, StringOrVec};
use crate::{
    log_info,
    minecraft::{
        dto::{GameConfig, LaunchConfig},
        mod_loader::vanilla::{Library, Rule, VersionDetailsManifest},
    },
    utils::{env_info::get_current_os, os::get_classpath_separator},
};

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

pub fn build_classpath(
    libraries: &[Library],
    libraries_dir: &Path,
    client_jar: &Path,
) -> Result<String> {
    let separator = get_classpath_separator();
    let mut paths: Vec<String> = Vec::new();

    for lib in libraries {
        if let Some(rules) = &lib.rules {
            if !is_rule_allowed(rules) {
                continue;
            }
        }

        let lib_path = if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                libraries_dir.join(&artifact.path)
            } else {
                continue;
            }
        } else {
            match maven_to_path(&lib.name) {
                Some(path) => libraries_dir.join(path),
                None => continue,
            }
        };

        if lib_path.exists() {
            paths.push(lib_path.to_string_lossy().to_string());
        } else {
            eprintln!("⚠ Библиотека не найдена: {:?}", lib_path);
        }
    }

    if client_jar.exists() {
        paths.push(client_jar.to_string_lossy().to_string());
    }

    Ok(paths.join(separator))
}

pub fn is_rule_allowed(rules: &[Rule]) -> bool {
    let current_os = get_current_os();
    let mut allowed = false;

    for rule in rules {
        let os_matches = match &rule.os {
            Some(os) => os.name.as_ref().map_or(true, |n| n == current_os),
            None => true,
        };

        let features_match = match &rule.features {
            Some(features) => {
                false // TODO Поддержка фичей, тут просто демо версия игры
            }
            None => true,
        };

        if os_matches && features_match {
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

pub fn extract_arguments(
    manifest: &VersionDetailsManifest,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> (Vec<String>, Vec<String>) {
    let mut jvm_args = Vec::new();
    let mut game_args = Vec::new();

    if let Some(arguments) = &manifest.arguments {
        jvm_args.push(format!("-Xms{}", &config.min_memory));
        jvm_args.push(format!("-Xmx{}", &config.max_memory));
        for arg in &arguments.jvm {
            jvm_args.extend(process_argument_value(arg, config, classpath, assets_index));
        }

        for arg in &arguments.game {
            game_args.extend(process_argument_value(arg, config, classpath, assets_index));
        }
    }

    // OLd (minecraftArguments)
    if let Some(mc_args) = &manifest.minecraft_arguments {
        for arg in mc_args.split_whitespace() {
            game_args.push(substitute_variables(arg, config, classpath, assets_index));
        }
    }

    (jvm_args, game_args)
}

pub fn process_argument_value(
    arg: &ArgumentValue,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> Vec<String> {
    match arg {
        ArgumentValue::Simple(s) => {
            vec![substitute_variables(s, config, classpath, assets_index)]
        }
        ArgumentValue::Conditional { value, rules } => {
            if is_rule_allowed(rules) {
                match value {
                    StringOrVec::Single(s) => {
                        vec![substitute_variables(s, config, classpath, assets_index)]
                    }
                    StringOrVec::Multiple(vec) => vec
                        .iter()
                        .map(|s| substitute_variables(s, config, classpath, assets_index))
                        .collect(),
                }
            } else {
                Vec::new()
            }
        }
    }
}

pub fn substitute_variables(
    arg: &str,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> String {
    arg.replace("${auth_player_name}", &config.username)
        .replace("${version_name}", &config.loader_version)
        .replace("${game_directory}", &config.game_dir.to_string_lossy())
        .replace("${assets_root}", &config.assets_dir.to_string_lossy())
        .replace("${assets_index_name}", assets_index)
        .replace("${auth_uuid}", &config.uuid)
        .replace("${auth_access_token}", &config.access_token)
        .replace("${user_type}", "mojang")
        .replace("${version_type}", "release")
        .replace(
            "${natives_directory}",
            &config.natives_dir.to_string_lossy(),
        )
        .replace("${launcher_name}", "Lumacina")
        .replace("${launcher_version}", "1.0")
        .replace("${width}", &config.window_width.to_string())
        .replace("${height}", &config.window_height.to_string())
        .replace("${classpath}", classpath)
        .replace(
            "${library_directory}",
            &config.libraries_dir.to_string_lossy(),
        )
        .replace("${classpath_separator}", get_classpath_separator())
}

pub fn spawn_game_process(app: AppHandle, config: GameConfig) -> Result<()> {
    log_info!("\n▶ Запуск Minecraft...\n");
    let mut command = Command::new(config.java_path);

    command
        .args(config.jvm_args)
        .arg(config.main_class)
        .args(config.game_args)
        .current_dir(config.game_dir)
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
