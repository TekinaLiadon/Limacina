
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::env;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::fs;
use walkdir::WalkDir;

use md5::{Digest, Md5};
use uuid::{Builder, Variant, Version};


#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    #[serde(default)]
    pub id: String,

    #[serde(default)]
    pub inherits_from: Option<String>,

    #[serde(rename = "mainClass", default)]
    pub main_class: String,

    #[serde(default)]
    pub libraries: Vec<Library>,

    #[serde(default)]
    pub arguments: Option<Arguments>,

    #[serde(default)]
    pub minecraft_arguments: Option<String>,

    #[serde(default)]
    pub asset_index: Option<AssetIndex>,

    #[serde(default)]
    pub assets: Option<String>,

    #[serde(rename = "type", default)]
    pub version_type: Option<String>,

    #[serde(default)]
    pub time: Option<String>,

    #[serde(default)]
    pub release_time: Option<String>,

    #[serde(default)]
    pub minimum_launcher_version: Option<i32>,

    #[serde(default)]
    pub compliance_level: Option<i32>,

    #[serde(default)]
    pub java_version: Option<JavaVersion>,

    #[serde(default)]
    pub logging: Option<serde_json::Value>,

    #[serde(default)]
    pub downloads: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JavaVersion {
    pub component: Option<String>,
    #[serde(rename = "majorVersion")]
    pub major_version: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<ArgumentValue>,
    #[serde(default)]
    pub jvm: Vec<ArgumentValue>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ArgumentValue {
    Simple(String),
    Conditional {
        rules: Vec<Rule>,
        value: StringOrVec,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum StringOrVec {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Rule {
    pub action: String,
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OsRule {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Library {
    pub name: String,

    #[serde(default)]
    pub downloads: Option<Downloads>,

    #[serde(default)]
    pub rules: Option<Vec<Rule>>,

    #[serde(default)]
    pub natives: Option<HashMap<String, String>>,

    // Для Forge
    #[serde(default)]
    pub url: Option<String>,

    #[serde(default)]
    pub checksums: Option<Vec<String>>,

    #[serde(default)]
    pub serverreq: Option<bool>,

    #[serde(default)]
    pub clientreq: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Downloads {
    #[serde(default)]
    pub artifact: Option<Artifact>,

    #[serde(default)]
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Artifact {
    pub path: String,

    #[serde(default)]
    pub sha1: Option<String>,

    #[serde(default)]
    pub size: Option<u64>,

    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssetIndex {
    pub id: String,

    #[serde(default)]
    pub sha1: Option<String>,

    #[serde(default)]
    pub size: Option<u64>,

    #[serde(default)]
    pub total_size: Option<u64>,

    #[serde(default)]
    pub url: Option<String>,
}



#[derive(Debug, Clone)]
pub struct LaunchConfig {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub mc_version: String,
    pub loader_version: String,
    pub game_dir: PathBuf,
    pub assets_dir: PathBuf,
    pub libraries_dir: PathBuf,
    pub natives_dir: PathBuf,
    pub min_memory: String,
    pub max_memory: String,
    pub window_width: u32,
    pub window_height: u32,
}

impl LaunchConfig {
    pub async fn new(
        username: String,
        uuid: String,
        access_token: String,
        mc_version: String,
        loader_version: String,
    ) -> Result<Self> {
        let base_dir = get_launcher_dir()?;
        let natives_dir = base_dir.join("natives").join(&mc_version);

        fs::create_dir_all(&natives_dir).await?;

        Ok(Self {
            username,
            uuid,
            access_token,
            mc_version: mc_version.clone(),
            loader_version,
            game_dir: base_dir.clone(),
            assets_dir: base_dir.join("assets"),
            libraries_dir: base_dir.join("libraries"),
            natives_dir,
            min_memory: "512M".to_string(),
            max_memory: "4G".to_string(),
            window_width: 1280,
            window_height: 720,
        })
    }

    fn base_jvm_args(&self) -> Vec<String> {
        vec![
            format!("-Xms{}", self.min_memory),
            format!("-Xmx{}", self.max_memory),
            format!("-Djava.library.path={}", self.natives_dir.display()),
            "-Dminecraft.launcher.brand=CustomLauncher".to_string(),
            "-Dminecraft.launcher.version=1.0".to_string(),
        ]
    }
}

// UTILS

fn get_classpath_separator() -> &'static str {
    if cfg!(windows) { ";" } else { ":" }
}

fn get_current_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn os_check() -> Option<PathBuf> {
#[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
   }

fn get_launcher_dir() -> Result<PathBuf> {
    let home = os_check()
        .ok_or_else(|| anyhow::anyhow!("Home directory not found"))?;

    let launcher_name = env::var("LAUNCHER_NAME")
        .unwrap_or_else(|_| "minecraft_launcher".to_string());

    Ok(home.join(launcher_name))
}

fn find_java() -> Result<PathBuf> {
    if let Ok(java_home) = env::var("JAVA_HOME") {
        let java_bin = if cfg!(windows) { "java.exe" } else { "java" };
        let java_path = PathBuf::from(java_home).join("bin").join(java_bin);
        if java_path.exists() {
            return Ok(java_path);
        }
    }

    #[cfg(unix)]
    if let Ok(output) = Command::new("which").arg("java").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    #[cfg(windows)]
    if let Ok(output) = Command::new("where").arg("java").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    Ok(PathBuf::from("java"))
}

fn is_rule_allowed(rules: &[Rule]) -> bool {
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

fn maven_to_path(name: &str) -> Option<String> {
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

fn find_all_jar_files(root: &Path) -> Result<Vec<String>> {
    let mut jar_files = Vec::new();

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension() {
                if ext.to_ascii_lowercase() == "jar" {
                    if let Some(path_str) = entry.path().to_str() {
                        jar_files.push(path_str.to_string());
                    }
                }
            }
        }
    }

    Ok(jar_files)
}

async fn load_version_json(path: &Path) -> Result<VersionJson> {
    let content = fs::read_to_string(path)
        .await
        .with_context(|| format!("Не удалось прочитать {:?}", path))?;

    serde_json::from_str(&content)
        .with_context(|| format!("Не удалось распарсить {:?}", path))
}

fn build_classpath(
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

fn substitute_variables(
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
        .replace("${natives_directory}", &config.natives_dir.to_string_lossy())
        .replace("${launcher_name}", "CustomLauncher")
        .replace("${launcher_version}", "1.0")
        .replace("${classpath}", classpath)
        .replace("${library_directory}", &config.libraries_dir.to_string_lossy())
        .replace("${classpath_separator}", get_classpath_separator())
}

fn process_argument_value(
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
                    StringOrVec::Multiple(vec) => {
                        vec.iter()
                            .map(|s| substitute_variables(s, config, classpath, assets_index))
                            .collect()
                    }
                }
            } else {
                Vec::new()
            }
        }
    }
}

fn extract_arguments(
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

fn spawn_game_process(java_path: &Path, args: &[String], game_dir: &Path) -> Result<()> {
    println!("\n▶ Запуск Minecraft...\n");

    let mut child = Command::new(java_path)
        .args(args)
        .current_dir(game_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .context("Не удалось запустить Java процесс")?;

    thread::spawn(move || {
        match child.wait() {
            Ok(status) => println!("✓ Minecraft завершился: {:?}", status),
            Err(e) => eprintln!("✗ Ошибка ожидания процесса: {}", e),
        }
    });

    Ok(())
}

fn build_launch_args(
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

// FABRIC

pub async fn fabric_start(
    username: String,
    uuid: String,
    access_token: String,
    mc_version: String,
) -> Result<()> {
    println!("🎮 Запуск Minecraft {} с Fabric...", mc_version);

    let config = LaunchConfig::new(
        username.clone(),
        uuid.clone(),
        access_token.clone(),
        mc_version.clone(),
        format!("fabric-{}", mc_version),
    ).await?;

    let base_dir = get_launcher_dir()?;

    let mut jar_files = find_all_jar_files(&config.libraries_dir)?;

    let game_jar_path = base_dir
        .join("versions")
        .join(&mc_version)
        .join(format!("{}.jar", mc_version));

    jar_files.push(game_jar_path.to_string_lossy().to_string());

    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let classpath = jar_files.join(separator);

    let mut args = vec![
        format!("-Xms{}", config.min_memory),
        format!("-Xmx{}", config.max_memory),

        format!("-Djava.library.path={}", config.natives_dir.to_string_lossy()),

        "-XX:+UnlockExperimentalVMOptions".to_string(),
        "-XX:+UseG1GC".to_string(),
        "-Duser.language=ru".to_string(),

        "-cp".to_string(),
        classpath,

        format!("-Dfabric.gameJarPath={}", game_jar_path.display()),

        "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string(),

        "--username".to_string(), username,
        "--uuid".to_string(), uuid,
        "--accessToken".to_string(), access_token,
        "--userProperties".to_string(), "{}".to_string(),
        "--assetsDir".to_string(), config.assets_dir.to_string_lossy().to_string(),
        "--assetIndex".to_string(), mc_version,
        "--gameDir".to_string(), config.game_dir.to_string_lossy().to_string(),
        "--width".to_string(), "1280".to_string(),
        "--height".to_string(), "720".to_string(),
        "--versionType".to_string(), "release".to_string(),
    ];

    let java_path = find_java()?;
    println!("☕ Java: {:?}", java_path);
    println!("Natives: {:?}", config.natives_dir);

    spawn_game_process(&java_path, &args, &config.game_dir)
}

// FORGE

fn find_forge_version_dir(versions_dir: &Path, mc_version: &str) -> Result<PathBuf> {
    if !versions_dir.exists() {
        bail!("Директория versions не существует: {:?}", versions_dir);
    }

    let forge_version = "47.4.10"; // TODO

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

async fn merge_version_jsons(
    forge_json: &VersionJson,
    versions_dir: &Path,
) -> Result<(VersionJson, String)> {
    let mut all_libraries = forge_json.libraries.clone();
    let mut assets_index_id = forge_json.assets.clone()
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
    username: String,
    uuid: String,
    access_token: String,
    mc_version: String,
) -> Result<()> {
    println!("🎮 Запуск Minecraft {} с Forge...", mc_version);

    let base_dir = get_launcher_dir()?;
    let versions_dir = base_dir.join("versions");
    let forge_version_dir = find_forge_version_dir(&versions_dir, &mc_version)?;
    let forge_version = forge_version_dir
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();

    println!("Используется: {}", forge_version);

    let forge_json_path = forge_version_dir.join(format!("{}.json", forge_version));
    let forge_version_json = load_version_json(&forge_json_path).await?;

    let (merged_version, assets_index_id) = merge_version_jsons(
        &forge_version_json,
        &versions_dir,
    ).await?;

    let config = LaunchConfig::new(
        username.clone(),
        uuid.clone(),
        access_token.clone(),
        mc_version.clone(),
        forge_version.clone(),
    ).await?;

    let client_jar = if let Some(inherits) = &forge_version_json.inherits_from {
        versions_dir.join(inherits).join(format!("{}.jar", inherits))
    } else {
        forge_version_dir.join(format!("{}.jar", forge_version))
    };

    let java_path = find_java()?;
    println!("☕ Java: {:?}", java_path);

    let classpath = build_forge_classpath(
        &merged_version.libraries,
        &config.libraries_dir,
        &client_jar,
    )?;

    let (mut jvm_args, game_args) = extract_forge_arguments(
        &merged_version,
        &config,
        &classpath,
        &assets_index_id,
    );

    let mut full_args = Vec::new();

    full_args.push(format!("-Xms{}", config.min_memory));
    full_args.push(format!("-Xmx{}", config.max_memory));

    let ignore_list = format!(
        "asm-9.7.1.jar,asm-commons-9.7.1.jar,asm-util-9.7.1.jar,asm-tree-9.7.1.jar,asm-analysis-9.7.1.jar,client-{}.jar",
        mc_version
    );

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

    println!("Main class: {}", merged_version.main_class);
    println!("Game dir: {:?}", config.game_dir);

    println!("=== JVM Arguments ===");
    for (i, arg) in full_args.iter().enumerate() {
        println!("  [{}]: {}", i, arg);
    }

    spawn_game_process(&java_path, &full_args, &config.game_dir)
}

fn build_forge_classpath(
    libraries: &[Library],
    libraries_dir: &Path,
    client_jar: &Path,
) -> Result<String> {
    let separator = get_classpath_separator();
    let mut paths: Vec<String> = Vec::new();
    let mut seen_artifacts: HashSet<String> = HashSet::new();

    let client_jar_canonical = client_jar.canonicalize()
        .unwrap_or_else(|_| client_jar.to_path_buf());

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

        let canonical = lib_path.canonicalize()
            .unwrap_or_else(|_| lib_path.clone());


        if canonical == client_jar_canonical {
            continue;
        }

        let artifact_name = extract_artifact_name(&lib.name);

        if seen_artifacts.contains(&artifact_name) {
            continue;
        }
        seen_artifacts.insert(artifact_name);

        let path_str = lib_path.to_string_lossy().to_string();
        if !paths.contains(&path_str) {
            paths.push(path_str);
        }
    }

    Ok(paths.join(separator))
}

fn extract_artifact_name(maven_name: &str) -> String {
    let parts: Vec<&str> = maven_name.split(':').collect();
    if parts.len() >= 2 {
        parts[1].to_string()
    } else {
        maven_name.to_string()
    }
}

fn extract_forge_arguments(
    version: &VersionJson,
    config: &LaunchConfig,
    classpath: &str,
    assets_index: &str,
) -> (Vec<String>, Vec<String>) {
    let mut jvm_args = Vec::new();
    let mut game_args = Vec::new();

        let essential_jvm_args = vec![
            "--add-modules=ALL-MODULE-PATH".to_string(),
            "--add-opens=java.base/java.util.jar=cpw.mods.securejarhandler".to_string(),
            "--add-opens=java.base/java.lang.invoke=cpw.mods.securejarhandler".to_string(),
            "--add-exports=java.base/sun.security.util=cpw.mods.securejarhandler".to_string(),
            "--add-exports=jdk.naming.dns/com.sun.jndi.dns=java.naming".to_string(),
        ];

        jvm_args.extend(essential_jvm_args);

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
            game_args.push(substitute_forge_variables(arg, config, classpath, assets_index));
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
            vec![substitute_forge_variables(s, config, classpath, assets_index)]
        }
        ArgumentValue::Conditional { value, rules } => {
            if is_rule_allowed(rules) {
                match value {
                    StringOrVec::Single(s) => {
                        vec![substitute_forge_variables(s, config, classpath, assets_index)]
                    }
                    StringOrVec::Multiple(vec) => {
                        vec.iter()
                            .map(|s| substitute_forge_variables(s, config, classpath, assets_index))
                            .collect()
                    }
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
        .replace("${natives_directory}", &config.natives_dir.to_string_lossy())
        .replace("${launcher_name}", "CustomLauncher")
        .replace("${launcher_version}", "1.0")
        .replace("${classpath}", classpath)
        .replace("${library_directory}", &config.libraries_dir.to_string_lossy())
        .replace("${classpath_separator}", get_classpath_separator())
        // Forge
        .replace("${primary_jar_name}", "client.jar")
        .replace("${resolution_width}", "1280")
        .replace("${resolution_height}", "720")
        .replace("${clientid}", "")
        .replace("${auth_xuid}", "")  // оффлайн ?
        .replace("${quickPlayPath}", "")
        .replace("${quickPlaySingleplayer}", "")
        .replace("${quickPlayMultiplayer}", "")
        .replace("${quickPlayRealms}", "")
}

fn find_library_manually(libraries_dir: &Path, name_pattern: &str) -> Option<PathBuf> {
    use walkdir::WalkDir;

    for entry in WalkDir::new(libraries_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && path.extension().map(|e| e == "jar").unwrap_or(false) {
            if let Some(file_name) = path.file_name() {
                if file_name.to_string_lossy().contains(name_pattern) {
                    return Some(path.to_path_buf());
                }
            }
        }
    }
    None
}

// VANILLA

pub async fn vanilla_start(
    username: String,
    uuid: String,
    access_token: String,
    mc_version: String,
) -> Result<()> {
    println!("🎮 Запуск Vanilla Minecraft {}...", mc_version);

    let base_dir = get_launcher_dir()?;
    let versions_dir = base_dir.join("versions");
    let version_dir = versions_dir.join(&mc_version);
    let version_json_path = version_dir.join(format!("{}.json", mc_version));

    let version_json = load_version_json(&version_json_path).await?;

    let config = LaunchConfig::new(
        username,
        uuid,
        access_token,
        mc_version.clone(),
        mc_version.clone(),
    ).await?;

    let client_jar = version_dir.join(format!("{}.jar", mc_version));
    let assets_index_id = version_json.assets
        .clone()
        .unwrap_or_else(|| mc_version.clone());

    let classpath = build_classpath(
        &version_json.libraries,
        &config.libraries_dir,
        &client_jar,
    )?;

    let (jvm_args, game_args) = extract_arguments(
        &version_json,
        &config,
        &classpath,
        &assets_index_id,
    );

    let java_path = find_java()?;
    println!("☕ Java: {:?}", java_path);

    let full_args = build_launch_args(
        &config,
        jvm_args,
        game_args,
        &classpath,
        &version_json.main_class,
    );

    println!("Main class: {}", version_json.main_class);
    println!("Game dir: {:?}", config.game_dir);

    spawn_game_process(&java_path, &full_args, &config.game_dir)
}

fn generate_offline_uuid(nickname: &str) -> String {
    let data = format!("OfflinePlayer:{}", nickname);

    let hash = Md5::digest(data.as_bytes());

    let mut builder = Builder::from_bytes(hash.into());

    builder
        .set_variant(Variant::RFC4122)
        .set_version(Version::Md5);

    builder.into_uuid().to_string()
}

#[tauri::command]
pub async fn start_jvm(
    username: String,
    access_token: String,
    type_minecraft: String,
    mc_version: Option<String>,
) -> Result<String, String> {
    let version = mc_version.unwrap_or_else(|| "1.20.1".to_string());
    let uuid = generate_offline_uuid(&username);

    match type_minecraft.as_str() {
        "forge" => {
            forge_start(username, uuid, access_token, version)
                .await
                .map_err(|e| e.to_string())?;
            Ok("Forge запущен успешно".to_string())
        }
        "fabric" => {
            fabric_start(username, uuid, access_token, version)
                .await
                .map_err(|e| e.to_string())?;
            Ok("Fabric запущен успешно".to_string())
        }
        "vanilla" => {
            vanilla_start(username, uuid, access_token, version)
                .await
                .map_err(|e| e.to_string())?;
            Ok("Vanilla запущен успешно".to_string())
        }
        _ => Err(format!("Неизвестный тип: {}", type_minecraft)),
    }
}

/*
use std::process::{Command, Stdio};
use std::path::{Path, PathBuf};
use std::error::Error;
use std::thread;
use std::env;
use walkdir::{WalkDir, DirEntry};

fn find_all_jar_files(root: &str) -> Result<Vec<String>, Box<dyn Error>> {
    let root_path = Path::new(root);
    let mut jar_files = Vec::new();

    for entry in WalkDir::new(root_path).into_iter().filter_map(|e| e.ok()) {

        if entry.file_type().is_file() {
            let path = entry.path();

            if let Some(ext) = path.extension() {
                if ext.to_str()
                    .map(|e| e.to_lowercase())
                    == Some("jar".to_string())
                {
                    if let Some(path_str) = path.to_str() {
                        jar_files.push(path_str.to_string());
                    }
                }
            }
        }
    }

    Ok(jar_files)
}

fn fabric_start(
    username: String,
    uuid: String,
    access_token: String
) -> Result<(), Box<dyn Error>> {
    let home_dir: PathBuf = env::home_dir().ok_or("Home directory not found")?;
    let launcher_name: String = env::var("LAUNCHER_NAME")
        .unwrap_or_else(|_| "default_launcher".to_string());
    let dir: PathBuf = home_dir.join(&launcher_name); // TODO

    let libraries_path = dir.join("libraries");
    let jar_files = find_all_jar_files(&libraries_path.to_string_lossy())?;

    let classpath = std::env::join_paths(jar_files)?
        .into_string()
        .map_err(|_| "Invalid characters in path")?;

    let mut args = vec![
        "-Xmx4G".to_string(),
        "-XX:+UnlockExperimentalVMOptions".to_string(),
        "-XX:+UseG1GC".to_string(),
        "-cp".to_string(),
        classpath,
        format!("-Dfabric.gameJarPath={}",
            dir.join("versions/1.20.1/1.20.1.jar").display())
    ];

    let minecraft_args = vec![
        "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string(),
        "--username".to_string(), username,
        "--uuid".to_string(), uuid,
        "--accessToken".to_string(), access_token,
        "--userProperties".to_string(), r#"{"skinURL":["..."]}"#.to_string(),
        "--assetsDir".to_string(), dir.join("assets").to_string_lossy().into(),
        "--assetIndex".to_string(), "1.20.1".to_string(),
        "--gameDir".to_string(), dir.join("resourcepacks").to_string_lossy().into(),
        "--width".to_string(), "1280".to_string(),
        "--height".to_string(), "720".to_string(),
        "--versionType".to_string(), "release".to_string(),
    ];

    /*
    На новые версии
    -Dminecraft.api.auth.host=https://сервер/authserver \
        -Dminecraft.api.account.host=https://сервер/api \
        -Dminecraft.api.session.host=https://сервер/sessionserver \
        -Dminecraft.api.services.host=https://сервер/minecraftservices \
        -Dauthlibinjector.side=client
        -jar minecraft.jar
        -add-opens java.base/java.lang=ALL-UNNAMED 1.20.5+ version
    */

    /*
    java -javaagent:authlib-injector-1.2.5.jar=https://сервер \
         -jar paper-1.20.1.jar nogui
    */
    args.extend(minecraft_args);

    let mut child = Command::new("java")
        .args(&args)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Не удалось запустить игру: {}", e))?;

    thread::spawn(move || {
        match child.wait() {
            Ok(status) => println!("Процесс завершен: {}", status),
            Err(e) => eprintln!("Ошибка процесса: {}", e),
        }
    });

    Ok(())
}
*/