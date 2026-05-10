use std::{
    path::Path,
    process::{Command, Stdio},
    thread::{self},
};

use anyhow::{Context, Result};
use md5::{Digest, Md5};
use std::io::{BufRead, BufReader};
use tauri::{AppHandle, Emitter};
use tokio::fs;
use uuid::{Builder, Variant, Version};

use crate::{
    log_info,
    minecraft::jvm::jvm::{
        ArgumentValue, ConsolePayload, LaunchConfig, Library, Rule, StringOrVec, VersionJson,
    },
    utils::{env_info::get_current_os, os::get_classpath_separator},
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

pub fn find_all_jar_files(libraries_dir: &Path) -> Result<Vec<String>, String> {
    let mut jar_files = Vec::new();

    let libraries_dir = if libraries_dir.exists() {
        dunce::canonicalize(libraries_dir).unwrap_or_else(|_| libraries_dir.to_path_buf())
    } else {
        libraries_dir.to_path_buf()
    };

    log_info!("Поиск JAR файлов в: {:?}", libraries_dir);

    if !libraries_dir.exists() {
        log_info!("Директория библиотек не существует: {:?}", libraries_dir);
        let err = "Директория библиотек не существует";
        return Err(err.to_string());
    }

    fn visit_dirs(dir: &Path, jar_files: &mut Vec<String>) -> Result<(), String> {
        if dir.is_dir() {
            for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();

                if path.is_dir() {
                    visit_dirs(&path, jar_files)?;
                } else if path.extension().and_then(|s| s.to_str()) == Some("jar") {
                    let clean_path = dunce::canonicalize(&path).unwrap_or_else(|_| path.clone());
                    jar_files.push(clean_path.to_string_lossy().to_string());
                }
            }
        }
        Ok(())
    }

    visit_dirs(&libraries_dir, &mut jar_files)?;

    log_info!("Найдено JAR файлов: {}", jar_files.len());

    Ok(jar_files)
}

pub async fn load_version_json(path: &Path) -> Result<VersionJson, String> {
    let content = fs::read_to_string(path)
        .await
        .map_err(|e| format!("Не удалось прочитать {:?}: {}", path, e))?;

    serde_json::from_str(&content).map_err(|e| format!("Не удалось распарсить {:?}: {}", path, e))
}

pub fn build_classpath(
    libraries: &[Library],
    libraries_dir: &Path,
    client_jar: &Path,
) -> Result<String, String> {
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
        .replace("${user_type}", "msa")
        .replace("${version_type}", "release")
        .replace(
            "${natives_directory}",
            &config.natives_dir.to_string_lossy(),
        )
        .replace("${launcher_name}", "CustomLauncher")
        .replace("${launcher_version}", "1.0")
        .replace("${classpath}", classpath)
        .replace(
            "${library_directory}",
            &config.libraries_dir.to_string_lossy(),
        )
        .replace("${classpath_separator}", get_classpath_separator())
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

pub fn extract_arguments(
    version: &VersionJson,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> (Vec<String>, Vec<String>) {
    let mut jvm_args = Vec::new();
    let mut game_args = Vec::new();

    if let Some(arguments) = &version.arguments {
        for arg in &arguments.jvm {
            jvm_args.extend(process_argument_value(arg, config, classpath, assets_index));
        }

        for arg in &arguments.game {
            game_args.extend(process_argument_value(arg, config, classpath, assets_index));
        }
    }

    // OLd (minecraftArguments)
    if let Some(mc_args) = &version.minecraft_arguments {
        for arg in mc_args.split_whitespace() {
            game_args.push(substitute_variables(arg, config, classpath, assets_index));
        }
    }

    (jvm_args, game_args)
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

pub fn build_launch_args(
    config: &LaunchConfig,
    jvm_args: Vec<String>,
    game_args: Vec<String>,
    classpath: &str,
    main_class: &str,
) -> Vec<String> {
    let mut full_args = config.base_jvm_args();
    full_args.extend(jvm_args);

    if !full_args.iter().any(|a| a == "-cp" || a == "-classpath") {
        full_args.push("-cp".to_string());
        full_args.push(classpath.to_string());
    }

    full_args.push(main_class.to_string());
    full_args.extend(game_args);

    full_args
}
