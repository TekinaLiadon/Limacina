use std::collections::HashMap;

use ::anyhow::Result;

use crate::{
    minecraft::{
        structs::LaunchConfig,
        mod_loader::utils::maven_to_path,
        vanilla::structs::{ArgumentValue, Library, Rule, StringOrVec, VersionDetailsManifest},
    },
    utils::{env_info::get_current_os, get_classpath_separator},
};

pub struct ArgumentsMap {
    pub map: HashMap<&'static str, String>,
}

impl ArgumentsMap {
    pub fn new(config: &LaunchConfig, assets_index: &str) -> Self {
        let map = [
            ("${auth_player_name}", config.username.clone()),
            (
                "${version_name}",
                config.loader_version.clone().unwrap_or("1".to_string()),
            ),
            (
                "${game_directory}",
                config.game_dir.to_string_lossy().to_string(),
            ),
            (
                "${assets_root}",
                config.assets_dir.to_string_lossy().to_string(),
            ),
            ("${assets_index_name}", assets_index.to_string()),
            ("${auth_uuid}", config.uuid.clone()),
            ("${auth_access_token}", config.access_token.clone()),
            ("${user_type}", "mojang".to_string()),
            ("${version_type}", "release".to_string()),
            (
                "${natives_directory}",
                config.natives_dir.to_string_lossy().to_string(),
            ),
            ("${launcher_name}", "Lumacina".to_string()),
            ("${launcher_version}", "1.0".to_string()),
            ("${width}", config.window_width.to_string()),
            ("${height}", config.window_height.to_string()),
            ("${clientid}", "1".to_string()),  // TODO
            ("${auth_xuid}", "1".to_string()), // TODO
            //("${classpath}", classpath.to_string()),
            (
                "${library_directory}",
                config.libraries_dir.to_string_lossy().to_string(),
            ),
            (
                "${classpath_separator}",
                get_classpath_separator().to_string(),
            ),
        ]
        .into_iter()
        .collect();
        ArgumentsMap { map }
    }
    fn get_value_by_key(&self, arg: &str) -> String {
        let mut result = arg.replace("${classpath}", "");
        for (placeholder, value) in &self.map {
            result = result.replace(placeholder, value);
        }
        result
    }
    fn get_value(&self, arg: &ArgumentValue) -> Vec<String> {
        match arg {
            ArgumentValue::Simple(s) => vec![self.get_value_by_key(&s)],
            ArgumentValue::Conditional { value, rules } => {
                if is_rule_allowed(&rules) {
                    match value {
                        StringOrVec::Single(s) => vec![self.get_value_by_key(&s)],
                        StringOrVec::Multiple(vec) => {
                            vec.iter().map(|s| self.get_value_by_key(&s)).collect()
                        }
                    }
                } else {
                    Vec::new()
                }
            }
        }
    }
}

pub fn get_classpath(libraries: &[Library], config: &LaunchConfig) -> Result<Vec<String>> {
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

    Ok(paths)
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
    args_map: &ArgumentsMap,
) -> Vec<String> {
    let mut jvm_args = Vec::new();
    if let Some(arguments) = &manifest.arguments {
        jvm_args.extend(config.jvm_sub_arg.clone());
        for arg in &arguments.jvm {
            jvm_args.extend(args_map.get_value(arg));
        }
    }
    jvm_args
}

pub fn get_game_args(manifest: &VersionDetailsManifest, args_map: &ArgumentsMap) -> Vec<String> {
    let mut game_args = Vec::new();

    if let Some(arguments) = &manifest.arguments {
        for arg in &arguments.game {
            game_args.extend(args_map.get_value(arg));
        }
    }
    // OLd (minecraftArguments)
    if let Some(mc_args) = &manifest.minecraft_arguments {
        for arg in mc_args.split_whitespace() {
            game_args.push(args_map.get_value_by_key(arg));
        }
    }
    game_args
}
