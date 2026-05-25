use std::path::Path;

use crate::{
    minecraft::{
        dto::{LaunchConfig, LibraryMod},
        mod_loader::{
            dto::vanilla::{ArgumentValue, Library, Rule, StringOrVec, VersionDetailsManifest},
            utils::maven_to_path,
        },
    },
    utils::{
        env_info::{get_current_os, launcher_patch},
        os::get_classpath_separator,
    },
};
use ::anyhow::Result;

pub fn get_classpath(libraries: &[Library], config: &LaunchConfig) -> Result<String> {
    let base_dir = launcher_patch(Some("libra"))?;
    let client_jar = base_dir.join(format!("{}.jar", config.mc_version));
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
                config.libraries_dir.join(&artifact.path)
            } else {
                continue;
            }
        } else {
            let local_path = maven_to_path(&lib.name)?;
            config.libraries_dir.join(local_path) // Test?
        };

        if lib_path.exists() {
            paths.push(lib_path.to_string_lossy().to_string());
        } else {
            eprintln!("⚠ Библиотека не найдена: {:?}", lib_path);
        }
    }

    paths.push(client_jar.to_string_lossy().to_string());

    Ok(paths.join(separator))
}

fn is_rule_allowed(rules: &[Rule]) -> bool {
    let current_os = get_current_os();
    let mut allowed = false;

    for rule in rules {
        let os_matches = match &rule.os {
            Some(os) => os.name.as_ref().map_or(true, |n| n == current_os),
            None => true,
        };

        let features_match = match &rule.features {
            Some(_) => {
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

pub fn get_jvm_args(
    manifest: &VersionDetailsManifest,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> Vec<String> {
    let mut jvm_args = Vec::new();
    if let Some(arguments) = &manifest.arguments {
        jvm_args.push(format!("-Xms{}", &config.min_memory));
        jvm_args.push(format!("-Xmx{}", &config.max_memory));
        for arg in &arguments.jvm {
            jvm_args.extend(process_argument_value(arg, config, classpath, assets_index));
        }
    }
    jvm_args
}

pub fn get_game_args(
    manifest: &VersionDetailsManifest,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> Vec<String> {
    let mut game_args = Vec::new();
    if let Some(arguments) = &manifest.arguments {
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
    game_args
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

// Mod

pub fn merge_classpath(
    version: &str,
    libraries: &Vec<LibraryMod>,
    vanilla_classpath: &str,
) -> Result<String> {
    let base_path = launcher_patch(Some("libra"))?;
    let libraries_path = base_path.join("libraries");
    let core_jar_path = base_path.join(format!("{}.jar", version));

    let classpath = build_mod_classpath(&libraries, &libraries_path, &core_jar_path, version)?;
    let separator = get_classpath_separator();
    let result_classpath = format!("{}{}{}", vanilla_classpath, separator, classpath);
    Ok(result_classpath)
}

fn build_mod_classpath(
    libraries: &[LibraryMod],
    libraries_dir: &Path,
    client_jar: &Path,
    version: &str,
) -> Result<String> {
    let separator = get_classpath_separator();
    let mut paths: Vec<String> = Vec::new();

    for lib in libraries {
        let lib_path = libraries_dir.join(maven_to_path(&lib.name).unwrap());

        if lib_path.exists() {
            paths.push(lib_path.to_string_lossy().to_string());
        } else {
            eprintln!("⚠ Библиотека не найдена: {:?}", lib_path);
        }
    }

    let minecraft_paths = launcher_patch(Some("libra"))?.join(format!("{}.jar", version));
    paths.push(minecraft_paths.to_string_lossy().to_string());
    paths.push(client_jar.to_string_lossy().to_string());

    Ok(paths.join(separator))
}
