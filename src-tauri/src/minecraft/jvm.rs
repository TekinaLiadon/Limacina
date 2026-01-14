
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
        "--gameDir".to_string(), dir.join("resourcepacks").to_string_lossy().into(),
    ];

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

#[tauri::command]
pub fn start_jvm(username: String,
                    uuid: String,
                    access_token: String,
                    type_minecraft: String)-> Result<String, String>  {
        if type_minecraft == "fabric" {
            match fabric_start(username, uuid, access_token) {
                Ok(_) => Ok("Start".to_string()),
                Err(err) => Err(err.to_string()),
            };
        };
        Ok("Forge".to_string())
}