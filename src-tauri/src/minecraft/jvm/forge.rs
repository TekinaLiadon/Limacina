use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use tauri::AppHandle;

use crate::{
    log_info,
    minecraft::jvm::{
        jvm::{ArgumentValue, LaunchConfig, Library, StringOrVec, VersionJson},
        utils::{is_rule_allowed, load_version_json, maven_to_path, spawn_game_process},
    },
    utils::{env_info::launcher_patch, java::find_java, os::get_classpath_separator},
};

fn find_forge_version_dir(versions_dir: &Path, mc_version: &str) -> Result<PathBuf> {
    if !versions_dir.exists() {
        bail!("Директория versions не существует: {:?}", versions_dir);
    }

    let forge_version = "36.2.34"; // TODO "47.4.10"

    let pattern = format!("{}-forge-{}", mc_version, forge_version);
    let alt_pattern = format!("forge-{}-{}", mc_version, forge_version);

    let entries: Vec<_> = std::fs::read_dir(versions_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            (name.starts_with(&pattern) || name.contains(&alt_pattern)) && e.path().is_dir()
        })
        .collect();

    if entries.is_empty() {
        bail!(
            "Forge для MC {} не найден. Сначала установите его через get_forge()",
            mc_version
        );
    }

    let mut paths: Vec<_> = entries.iter().map(|e| e.path()).collect();
    paths.sort();

    Ok(paths.last().unwrap().clone())
}

#[derive(Deserialize)]
struct VersionManifest {
    versions: Vec<VersionInfo>,
}

#[derive(Deserialize, Clone)]
struct VersionInfo {
    id: String,
    url: String,
}

async fn ensure_vanilla_version_installed(mc_version: &str, versions_dir: &Path) -> Result<()> {
    let version_dir = versions_dir.join(mc_version);
    let json_path = version_dir.join(format!("{}.json", mc_version));

    if json_path.exists() {
        return Ok(());
    }

    log_info!("⚠ Ванильная версия {} не найдена. Скачиваю...", mc_version);

    let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let manifest: VersionManifest = reqwest::get(manifest_url)
        .await
        .context("Ошибка в получении json")?
        .json()
        .await
        .context("Ошибка в чтении json")?;

    let version_info = manifest
        .versions
        .into_iter()
        .find(|v| v.id == mc_version)
        .ok_or_else(|| anyhow::anyhow!("Версия {} не найдена в манифесте Mojang", mc_version))
        .context("Ошибка манифеста Mojang")?;

    let version_json_content = reqwest::get(version_info.url)
        .await
        .context("Ошибка в получении версии")?
        .text()
        .await
        .context("Ошибка в чтении версии")?;

    std::fs::create_dir_all(&version_dir).context("Ошибка в создании папки")?;
    std::fs::write(&json_path, version_json_content).context("Ошибка в чтении json")?;

    log_info!("✓ Ванильная версия {} успешно скачана.", mc_version);

    Ok(())
}

async fn merge_version_jsons(
    forge_json: &VersionJson,
    versions_dir: &Path,
) -> Result<(VersionJson, String)> {
    let mut all_libraries = forge_json.libraries.clone();
    let mut assets_index_id = forge_json
        .assets
        .clone()
        .unwrap_or_else(|| forge_json.id.clone());
    let mut combined_arguments = forge_json.arguments.clone();
    let mut minecraft_arguments = forge_json.minecraft_arguments.clone();

    if let Some(inherits) = &forge_json.inherits_from {
        let vanilla_json_path = versions_dir
            .join(inherits)
            .join(format!("{}.json", inherits));

        if vanilla_json_path.exists() {
            let vanilla_json = load_version_json(&vanilla_json_path).await?;

            all_libraries.extend(vanilla_json.libraries);

            if forge_json.assets.is_none() {
                if let Some(assets) = &vanilla_json.assets {
                    assets_index_id = assets.clone();
                }
            }

            if let Some(vanilla_args) = vanilla_json.arguments {
                if let Some(ref mut forge_args) = combined_arguments {
                    forge_args.game.extend(vanilla_args.game);
                    let mut new_jvm = vanilla_args.jvm;
                    new_jvm.extend(forge_args.jvm.clone());
                    forge_args.jvm = new_jvm;
                } else {
                    combined_arguments = Some(vanilla_args);
                }
            }

            if minecraft_arguments.is_none() {
                minecraft_arguments = vanilla_json.minecraft_arguments;
            }
        } else {
            eprintln!("⚠ Vanilla version.json не найден: {:?}", vanilla_json_path);
        }
    }

    let merged = VersionJson {
        id: forge_json.id.clone(),
        inherits_from: None,
        main_class: forge_json.main_class.clone(),
        libraries: all_libraries,
        arguments: combined_arguments,
        minecraft_arguments,
        assets: Some(assets_index_id.clone()),
        version_type: Some("release".to_string()),
        ..Default::default()
    };

    Ok((merged, assets_index_id))
}

pub async fn forge_start(
    app: AppHandle,
    username: String,
    uuid: String,
    access_token: String,
    mc_version: String,
) -> Result<()> {
    log_info!("🎮 Запуск Minecraft {} с Forge...", mc_version);

    let base_dir = launcher_patch(Some("libra"))?;
    let versions_dir = base_dir.join("versions");
    ensure_vanilla_version_installed(&mc_version, &versions_dir).await?;
    let forge_version_dir = find_forge_version_dir(&versions_dir, &mc_version)?;
    let forge_version = forge_version_dir
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();

    log_info!("Используется: {}", forge_version);

    let forge_json_path = forge_version_dir.join(format!("{}.json", forge_version));
    let forge_version_json = load_version_json(&forge_json_path).await?;

    let (merged_version, assets_index_id) =
        merge_version_jsons(&forge_version_json, &versions_dir).await?;

    let config = LaunchConfig::new(
        username.clone(),
        uuid.clone(),
        access_token.clone(),
        mc_version.clone(),
        forge_version.clone(),
    )
    .await
    .context("Ошибка в создании конфига")?;

    let java_path = find_java()?;
    log_info!("☕ Java: {:?}", java_path);

    let classpath = build_forge_classpath(&merged_version.libraries, &config.libraries_dir)?;

    let (jvm_args, game_args) =
        extract_forge_arguments(&merged_version, &config, &classpath, &assets_index_id);

    let mut full_args = Vec::new();

    full_args.push(format!("-Xms{}", config.min_memory));
    full_args.push(format!("-Xmx{}", config.max_memory));

    for arg in &jvm_args {
        if !arg.contains("${") {
            full_args.push(arg.clone());
        }
    }

    full_args.push(merged_version.main_class.clone());

    for arg in &game_args {
        if !arg.contains("${") {
            full_args.push(arg.clone());
        }
    }

    log_info!("Main class: {}", merged_version.main_class);
    log_info!("Game dir: {:?}", config.game_dir);

    log_info!("=== JVM Arguments ===");
    for (i, arg) in full_args.iter().enumerate() {
        log_info!("  [{}]: {}", i, arg);
    }

    spawn_game_process(app, &java_path, &full_args, &config.game_dir)?;

    Ok(())
}

fn build_forge_classpath(libraries: &[Library], libraries_dir: &Path) -> Result<String> {
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

        if !lib_path.exists() {
            eprintln!("⚠ Библиотека не найдена: {:?}", lib_path);
            continue;
        }

        let path_str = lib_path.to_string_lossy().to_string();
        if !paths.contains(&path_str) {
            paths.push(path_str);
        }
    }

    Ok(paths.join(separator))
}

fn extract_forge_arguments(
    version: &VersionJson,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> (Vec<String>, Vec<String>) {
    let mut jvm_args = Vec::new();
    let mut game_args = Vec::new();

    if let Some(arguments) = &version.arguments {
        for arg in &arguments.jvm {
            let processed = process_forge_argument(arg, config, classpath, assets_index);
            jvm_args.extend(processed);
        }

        for arg in &arguments.game {
            let processed = process_forge_argument(arg, config, classpath, assets_index);
            game_args.extend(processed);
        }
    }

    if let Some(mc_args) = &version.minecraft_arguments {
        for arg in mc_args.split_whitespace() {
            game_args.push(substitute_forge_variables(
                arg,
                config,
                classpath,
                assets_index,
            ));
        }
    }

    (jvm_args, game_args)
}

fn process_forge_argument(
    arg: &ArgumentValue,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> Vec<String> {
    match arg {
        ArgumentValue::Simple(s) => {
            vec![substitute_forge_variables(
                s,
                config,
                classpath,
                assets_index,
            )]
        }
        ArgumentValue::Conditional { value, rules } => {
            if is_rule_allowed(rules) {
                match value {
                    StringOrVec::Single(s) => {
                        vec![substitute_forge_variables(
                            s,
                            config,
                            classpath,
                            assets_index,
                        )]
                    }
                    StringOrVec::Multiple(vec) => vec
                        .iter()
                        .map(|s| substitute_forge_variables(s, config, classpath, assets_index))
                        .collect(),
                }
            } else {
                Vec::new()
            }
        }
    }
}

fn substitute_forge_variables(
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
        // Forge
        .replace("${primary_jar_name}", "client.jar")
        .replace("${resolution_width}", "1280")
        .replace("${resolution_height}", "720")
        .replace("${clientid}", "")
        .replace("${auth_xuid}", "") // оффлайн ?
        .replace("${quickPlayPath}", "")
        .replace("${quickPlaySingleplayer}", "")
        .replace("${quickPlayMultiplayer}", "")
        .replace("${quickPlayRealms}", "")
}
