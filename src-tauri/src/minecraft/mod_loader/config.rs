use std::path::Path;

use crate::{
    minecraft::{structs::LibraryMod, mod_loader::utils::maven_to_path},
    utils::env_info::launcher_patch,
};
use ::anyhow::Result;

pub fn merge_classpath(
    project_name: &str,
    version: &str,
    libraries: &Vec<LibraryMod>,
    vanilla_classpath: &Vec<String>,
) -> Result<Vec<String>> {
    let base_path = launcher_patch(Some(project_name))?;
    let version_jar = base_path.join(format!("{}.jar", version));
    let libraries_path = base_path.join("libraries");

    let mut classpath = build_mod_classpath(&libraries, &libraries_path)?;
    classpath.push(version_jar.to_string_lossy().to_string());

    let mut result_classpath = vanilla_classpath.clone();
    result_classpath.extend(classpath);
    Ok(result_classpath)
}

fn build_mod_classpath(libraries: &[LibraryMod], libraries_dir: &Path) -> Result<Vec<String>> {
    let mut paths: Vec<String> = Vec::new();

    for lib in libraries {
        let lib_path = libraries_dir.join(maven_to_path(&lib.name).unwrap());

        if lib_path.exists() {
            paths.push(lib_path.to_string_lossy().to_string());
        } else {
            eprintln!("⚠ Библиотека не найдена: {:?}", lib_path);
        }
    }

    Ok(paths)
}
