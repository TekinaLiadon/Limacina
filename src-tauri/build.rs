use std::path::Path;

fn load_env() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let env_path = Path::new(&manifest_dir).join(".env");
    let example_path = Path::new(&manifest_dir).join(".env.example");

    let env_content = std::fs::read_to_string(&env_path)
        .or_else(|_| std::fs::read_to_string(&example_path))
        .unwrap_or_default();

    for line in env_content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            println!("cargo:rustc-env={}={}", key.trim(), value.trim());
        }
    }
}

fn main() {
    load_env();
    tauri_build::build()
}
