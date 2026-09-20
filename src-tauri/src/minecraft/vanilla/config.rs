use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::{bail, Result};

use crate::utils::errors::LauncherError;
use crate::{
    log_err,
    minecraft::{
        mod_loader::utils::maven_to_path,
        structs::LaunchConfig,
        vanilla::rules::is_rule_allowed,
        vanilla::structs::{ArgumentValue, Library, StringOrVec, VersionDetailsManifest},
    },
    utils::{compare_versions, env_info::get_launcher_name, get_classpath_separator},
};

pub struct ArgumentsMap {
    pub map: HashMap<&'static str, String>,
}

impl ArgumentsMap {
    pub fn new(config: &LaunchConfig, assets_index: &str) -> Self {
        let map = [
            ("${auth_player_name}", config.username.clone()),
            ("${version_name}", config.mc_version.clone()),
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
            ("${launcher_name}", get_launcher_name()),
            ("${launcher_version}", env!("CARGO_PKG_VERSION").to_string()),
            ("${width}", config.window_width.to_string()),
            ("${height}", config.window_height.to_string()),
            ("${clientid}", "1".to_string()),
            ("${auth_xuid}", "1".to_string()),
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
        let mut result = String::with_capacity(arg.len());
        let mut remaining = arg;
        while let Some(start) = remaining.find("${") {
            result.push_str(&remaining[..start]);
            let rest = &remaining[start..];
            match rest.find('}') {
                Some(end) => {
                    let placeholder = &rest[..=end];
                    match self.map.get(placeholder) {
                        Some(value) => result.push_str(value),
                        None => result.push_str(placeholder),
                    }
                    remaining = &rest[end + 1..];
                }
                None => {
                    result.push_str(rest);
                    return result;
                }
            }
        }
        result.push_str(remaining);
        result
    }
    fn get_value(&self, arg: &ArgumentValue) -> Vec<String> {
        match arg {
            ArgumentValue::Simple(s) => vec![self.get_value_by_key(s)],
            ArgumentValue::Conditional { value, rules } => {
                if is_rule_allowed(Some(rules)) {
                    match value {
                        StringOrVec::Single(s) => vec![self.get_value_by_key(s)],
                        StringOrVec::Multiple(vec) => {
                            vec.iter().map(|s| self.get_value_by_key(s)).collect()
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
    let mut missing: Vec<String> = Vec::new();

    for lib in libraries {
        if !is_rule_allowed(lib.rules.as_deref()) {
            continue;
        }

        let (lib_path, rel_path, required) = if let Some(downloads) = &lib.downloads {
            if let Some(artifact) = &downloads.artifact {
                (
                    config.libraries_dir.join(&artifact.path),
                    artifact.path.clone(),
                    !artifact.url.is_empty(),
                )
            } else {
                continue;
            }
        } else {
            let local_path = maven_to_path(&lib.name).map_err(|e| {
                LauncherError::ManifestParse(format!(
                    "Не удалось определить путь библиотеки: {e:#}"
                ))
            })?;
            (
                config.libraries_dir.join(&local_path),
                local_path.to_string_lossy().to_string(),
                true,
            )
        };

        if lib_path.exists() {
            paths.push(lib_path.to_string_lossy().to_string());
        } else if required {
            missing.push(rel_path);
        } else {
            log_err!(
                "Библиотека без ссылки для скачивания не найдена: {:?}",
                lib_path
            );
        }
    }

    if !missing.is_empty() {
        bail!(LauncherError::GameProcess(format!(
            "Библиотеки не найдены: {}. Запустите проверку целостности в настройках проекта",
            missing.join(", ")
        )));
    }

    Ok(paths)
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
        let jvm_args = strip_classpath_args(jvm_args);
        return jvm_args;
    }

    jvm_args.extend(config.jvm_sub_arg.clone());
    jvm_args.push(format!(
        "-Djava.library.path={}",
        config.natives_dir.to_string_lossy()
    ));
    jvm_args
}

pub fn get_game_args(manifest: &VersionDetailsManifest, args_map: &ArgumentsMap) -> Vec<String> {
    let mut game_args = Vec::new();

    if let Some(arguments) = &manifest.arguments {
        for arg in &arguments.game {
            game_args.extend(args_map.get_value(arg));
        }
    }

    if let Some(mc_args) = &manifest.minecraft_arguments {
        for arg in mc_args.split_whitespace() {
            game_args.push(args_map.get_value_by_key(arg));
        }
    }
    game_args
}

pub fn filter_classpath(classpath: Vec<String>) -> Vec<String> {
    let mut latest_versions: HashMap<String, String> = HashMap::new();
    for path_str in &classpath {
        if let Some((coord, version)) = extract_maven_info(path_str) {
            if let Some(existing_version) = latest_versions.get(&coord) {
                if compare_versions(&version, existing_version) == Ordering::Greater {
                    latest_versions.insert(coord, version);
                }
            } else {
                latest_versions.insert(coord, version);
            }
        }
    }

    let mut final_classpath = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for path_str in classpath {
        let normalized = path_str.replace('\\', "/");
        if !seen.contains(&normalized) {
            if let Some((coord, version)) = extract_maven_info(&path_str) {
                if let Some(latest) = latest_versions.get(&coord) {
                    if &version == latest {
                        final_classpath.push(path_str.clone());
                        seen.insert(normalized);
                    }
                }
            } else {
                final_classpath.push(path_str.clone());
                seen.insert(normalized);
            }
        }
    }

    final_classpath
}

pub fn strip_classpath_args(args: Vec<String>) -> Vec<String> {
    let mut result = Vec::with_capacity(args.len());
    let mut skip_next = false;

    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if arg == "-cp" {
            skip_next = true;
            continue;
        }
        if arg.contains("${classpath}") {
            continue;
        }
        result.push(arg);
    }

    result
}

fn extract_maven_info(path_str: &str) -> Option<(String, String)> {
    let normalized = path_str.replace('\\', "/");
    let path = Path::new(&normalized);
    let file_name = path.file_name()?.to_str()?;
    let version_dir = path.parent()?;
    let version = version_dir.file_name()?.to_str()?;
    let artifact_dir = version_dir.parent()?;
    let artifact_id = artifact_dir.file_name()?.to_str()?;

    if !file_name.starts_with(artifact_id) || !file_name.contains(version) {
        return None;
    }

    let mut group_segments: Vec<&str> = Vec::new();
    let mut current = artifact_dir.parent()?;
    while let Some(segment) = current.file_name().and_then(|n| n.to_str()) {
        group_segments.push(segment);
        current = current.parent()?;
    }
    group_segments.reverse();

    Some((
        format!("{}:{}", group_segments.join("."), artifact_id),
        version.to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::get_classpath;
    use crate::minecraft::vanilla::structs::Library;
    use crate::test_support::{
        gson_library, gson_library_no_url, jopt_simple_library, logging_library,
        test_launch_config, TempDir,
    };
    use std::fs;

    fn libs_with_one_missing_url() -> Vec<Library> {
        serde_json::from_value(serde_json::json!([
            logging_library(),
            gson_library_no_url()
        ]))
        .unwrap()
    }

    #[test]
    fn get_classpath_includes_existing_libraries() {
        let libs: Vec<Library> = serde_json::from_value(serde_json::json!([
            logging_library(),
            jopt_simple_library(),
            gson_library(),
        ]))
        .unwrap();

        let dir = TempDir::new("classpath_ok");
        let root = dir.0.clone();
        let libraries_dir = root.join("libraries");
        let created = [
            "com/mojang/logging/1.0.0/logging-1.0.0.jar",
            "net/sf/jopt-simple/jopt-simple/5.0.4/jopt-simple-5.0.4.jar",
            "com/google/code/gson/gson/2.8.9/gson-2.8.9.jar",
        ];
        for rel in created {
            let path = libraries_dir.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"jar").unwrap();
        }

        let config = test_launch_config(&root);

        let paths = get_classpath(&libs, &config).unwrap();

        assert_eq!(paths.len(), 3);
        for rel in created {
            let expected = libraries_dir.join(rel).to_string_lossy().into_owned();
            assert!(paths.contains(&expected), "{} нет в {:?}", expected, paths);
        }

        drop(dir);
        assert!(!root.exists(), "временная директория не удалена");
    }

    #[test]
    fn get_classpath_errors_for_missing_library() {
        let libs: Vec<Library> =
            serde_json::from_value(serde_json::json!([logging_library(), gson_library()])).unwrap();

        let dir = TempDir::new("classpath_missing");
        let root = dir.0.clone();
        let libraries_dir = root.join("libraries");
        let path = libraries_dir.join("com/mojang/logging/1.0.0/logging-1.0.0.jar");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"jar").unwrap();

        let config = test_launch_config(&root);

        let error = get_classpath(&libs, &config).expect_err("отсутствующая библиотека — ошибка");

        let message = error.to_string();
        assert!(
            message.contains("com/google/code/gson/gson/2.8.9/gson-2.8.9.jar"),
            "ошибка должна называть файл библиотеки: {message}"
        );
        assert!(
            message.contains("проверку целостности"),
            "ошибка должна подсказать проверку целостности: {message}"
        );

        drop(dir);
        assert!(!root.exists(), "временная директория не удалена");
    }

    #[test]
    fn get_classpath_allows_missing_library_without_download_url() {
        let libs = libs_with_one_missing_url();

        let dir = TempDir::new("classpath_no_url");
        let root = dir.0.clone();
        let libraries_dir = root.join("libraries");
        let path = libraries_dir.join("com/mojang/logging/1.0.0/logging-1.0.0.jar");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"jar").unwrap();

        let config = test_launch_config(&root);

        let paths = get_classpath(&libs, &config).expect("библиотека без url не требует файла");

        assert_eq!(paths.len(), 1);
        assert!(
            !paths.iter().any(|p| p.contains("gson")),
            "отсутствующая библиотека без url не должна попадать в classpath: {:?}",
            paths
        );

        drop(dir);
        assert!(!root.exists(), "временная директория не удалена");
    }
}

#[cfg(test)]
mod filter_classpath_tests {
    use super::filter_classpath;

    const WIN_SEP: bool = cfg!(windows);

    fn maven_path(group: &str, artifact: &str, version: &str) -> String {
        let sep = if WIN_SEP { "\\" } else { "/" };
        let group_path = group.replace('.', sep);
        format!(
            "{p}libraries{p}{g}{p}{a}{p}{v}{p}{a}-{v}.jar",
            p = sep,
            g = group_path,
            a = artifact,
            v = version
        )
    }

    fn to_os(input: &str) -> String {
        if WIN_SEP {
            input.replace('/', "\\")
        } else {
            input.to_string()
        }
    }

    #[test]
    fn keeps_latest_version_of_same_artifact() {
        let classpath = vec![
            maven_path("org.ow2.asm", "asm", "9.1"),
            maven_path("org.ow2.asm", "asm", "9.7"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(result, vec![maven_path("org.ow2.asm", "asm", "9.7")]);
    }

    #[test]
    fn keeps_both_artifacts_with_same_id_in_different_groups() {
        let classpath = vec![
            maven_path("com.example.one", "library", "1.0"),
            maven_path("com.example.two", "library", "2.0"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn keeps_non_maven_entries_as_is() {
        let jar = to_os("game/1.20.1.jar");
        let classpath = vec![jar.clone(), jar.clone()];
        let result = filter_classpath(classpath);
        assert_eq!(result, vec![jar]);
    }

    #[test]
    fn deduplicates_identical_paths() {
        let classpath = vec![
            maven_path("org.lwjgl", "lwjgl", "3.3.1"),
            maven_path("org.lwjgl", "lwjgl", "3.3.1"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn preserves_input_order_of_kept_entries() {
        let classpath = vec![
            maven_path("net.fabricmc", "fabric-loader", "0.16.9"),
            maven_path("org.ow2.asm", "asm", "9.1"),
            maven_path("org.ow2.asm", "asm", "9.7"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(
            result,
            vec![
                maven_path("net.fabricmc", "fabric-loader", "0.16.9"),
                maven_path("org.ow2.asm", "asm", "9.7"),
            ]
        );
    }

    #[test]
    fn version_jar_with_dashed_version_still_recognized() {
        let path = to_os(
            "project/libraries/net/neoforged/neoforge/20.4.80-beta/neoforge-20.4.80-beta.jar",
        );
        let result = filter_classpath(vec![path.clone()]);
        assert_eq!(result, vec![path]);
    }

    #[test]
    fn keeps_base_and_natives_classifier_of_same_version() {
        let natives = format!(
            "{p}libraries{p}org{p}lwjgl{p}lwjgl{p}3.3.3{p}lwjgl-3.3.3-natives-linux.jar",
            p = if WIN_SEP { "\\" } else { "/" }
        );
        let result = filter_classpath(vec![
            maven_path("org.lwjgl", "lwjgl", "3.3.3"),
            natives.clone(),
        ]);
        assert_eq!(
            result,
            vec![maven_path("org.lwjgl", "lwjgl", "3.3.3"), natives]
        );
    }

    #[test]
    fn keeps_classifier_variants_of_netty_style_artifact() {
        let base = if WIN_SEP { "\\" } else { "/" };
        let epoll = |classifier: &str| {
            format!(
                "project{p}libraries{p}io{p}netty{p}netty-transport-native-epoll{p}4.1.97.Final{p}netty-transport-native-epoll-4.1.97.Final-{c}.jar",
                p = base,
                c = classifier
            )
        };
        let classpath = vec![epoll("linux-aarch_64"), epoll("linux-x86_64")];
        let result = filter_classpath(classpath.clone());
        assert_eq!(result, classpath);
    }

    #[test]
    fn windows_separators_are_normalized() {
        let classpath = vec![
            to_os("project/libraries/org/ow2/asm/asm/9.1/asm-9.1.jar"),
            to_os("project\\libraries\\org\\ow2\\asm\\asm\\9.7\\asm-9.7.jar"),
        ];
        let result = filter_classpath(classpath);
        assert_eq!(
            result,
            vec![to_os(
                "project\\libraries\\org\\ow2\\asm\\asm\\9.7\\asm-9.7.jar"
            )]
        );
    }
}

#[cfg(test)]
mod args_pipeline_tests {
    use super::{get_game_args, get_jvm_args, strip_classpath_args, ArgumentsMap};
    use crate::minecraft::structs::LaunchConfig;
    use crate::minecraft::vanilla::structs::VersionDetailsManifest;
    use std::path::PathBuf;

    fn launch_config() -> LaunchConfig {
        LaunchConfig {
            username: "Cordelia".to_string(),
            uuid: "uuid-1".to_string(),
            access_token: "token-1".to_string(),
            mc_version: "1.20.1".to_string(),
            game_dir: PathBuf::from("/game"),
            assets_dir: PathBuf::from("/game/assets"),
            libraries_dir: PathBuf::from("/game/libraries"),
            natives_dir: PathBuf::from("/game/natives"),
            jvm_sub_arg: vec!["-Xms512M".to_string(), "-Xmx4G".to_string()],
            window_width: 1280,
            window_height: 720,
        }
    }

    fn modern_manifest() -> VersionDetailsManifest {
        serde_json::from_str(
            r#"{
                "id": "1.20.1",
                "downloads": {
                    "client": { "sha1": "abc", "size": 1, "url": "https://example.test/client.jar" }
                },
                "libraries": [],
                "assetIndex": { "id": "5", "sha1": "def", "size": 1, "url": "https://example.test/5.json", "totalSize": 1 },
                "assets": "5",
                "mainClass": "net.minecraft.client.main.Main",
                "minecraftArguments": null,
                "arguments": {
                    "game": ["--username", "${auth_player_name}", "--version", "${version_name}"],
                    "jvm": [
                        "-Djava.io.tmpdir=${natives_directory}",
                        { "rules": [{ "action": "allow", "os": { "name": "limacina-never" } }], "value": "-Dnever.allowed=true" },
                        "-cp",
                        "${classpath}"
                    ]
                },
                "javaVersion": { "component": "java-runtime-gamma", "majorVersion": 17 }
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn jvm_args_expand_placeholders_and_strip_classpath() {
        let config = launch_config();
        let args_map = ArgumentsMap::new(&config, "5");
        let manifest = modern_manifest();

        let jvm_args = get_jvm_args(&manifest, &config, &args_map);

        assert!(jvm_args.contains(&"-Xms512M".to_string()));
        assert!(jvm_args.contains(&"-Xmx4G".to_string()));
        assert!(jvm_args.contains(&"-Djava.io.tmpdir=/game/natives".to_string()));
        assert!(!jvm_args.contains(&"-cp".to_string()));
        assert!(!jvm_args.iter().any(|arg| arg.contains("${classpath}")));
        assert!(!jvm_args.iter().any(|arg| arg.contains("never.allowed")));
    }

    #[test]
    fn game_args_expand_user_placeholders() {
        let config = launch_config();
        let args_map = ArgumentsMap::new(&config, "5");
        let manifest = modern_manifest();

        let game_args = get_game_args(&manifest, &args_map);

        assert!(game_args.contains(&"--username".to_string()));
        assert!(game_args.contains(&"Cordelia".to_string()));
        assert!(game_args.contains(&"--version".to_string()));
        assert!(game_args.contains(&"1.20.1".to_string()));
    }

    #[test]
    fn jvm_args_fall_back_to_library_path_without_arguments() {
        let manifest: VersionDetailsManifest = serde_json::from_str(
            r#"{
                "id": "1.8.9",
                "downloads": {
                    "client": { "sha1": "abc", "size": 1, "url": "https://example.test/client.jar" }
                },
                "libraries": [],
                "assetIndex": { "id": "1.8", "sha1": "def", "size": 1, "url": "https://example.test/1.8.json", "totalSize": 1 },
                "assets": "1.8",
                "mainClass": "net.minecraft.client.main.Main",
                "minecraftArguments": "--username ${auth_player_name} --version ${version_name}"
            }"#,
        )
        .unwrap();
        let config = launch_config();
        let args_map = ArgumentsMap::new(&config, "1.8");

        let jvm_args = get_jvm_args(&manifest, &config, &args_map);
        assert_eq!(
            jvm_args,
            vec![
                "-Xms512M".to_string(),
                "-Xmx4G".to_string(),
                "-Djava.library.path=/game/natives".to_string(),
            ]
        );

        let game_args = get_game_args(&manifest, &args_map);
        assert!(game_args.contains(&"Cordelia".to_string()));
        assert!(game_args.contains(&"1.20.1".to_string()));
    }

    #[test]
    fn placeholder_value_is_not_rescanned() {
        let mut config = launch_config();
        config.username = "${auth_access_token}".to_string();
        let args_map = ArgumentsMap::new(&config, "5");

        let value = args_map.get_value_by_key("${auth_player_name}");

        assert_eq!(value, "${auth_access_token}");
    }

    #[test]
    fn unknown_placeholder_is_left_as_is() {
        let config = launch_config();
        let args_map = ArgumentsMap::new(&config, "5");

        assert_eq!(
            args_map.get_value_by_key("--unknown${nope} --after"),
            "--unknown${nope} --after"
        );
    }

    #[test]
    fn launcher_version_uses_cargo_package_version() {
        let config = launch_config();
        let args_map = ArgumentsMap::new(&config, "5");

        assert_eq!(
            args_map.get_value_by_key("${launcher_version}"),
            env!("CARGO_PKG_VERSION")
        );
    }

    #[test]
    fn strip_classpath_args_removes_pairs_and_placeholders() {
        let args = vec![
            "-Xmx4G".to_string(),
            "-cp".to_string(),
            "libs.jar".to_string(),
            "-Dkeep=1".to_string(),
            "${classpath}".to_string(),
        ];

        assert_eq!(
            strip_classpath_args(args),
            vec!["-Xmx4G".to_string(), "-Dkeep=1".to_string()]
        );
    }
}
