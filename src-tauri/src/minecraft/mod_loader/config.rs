use std::path::Path;

use crate::utils::errors::LauncherError;
use crate::{
    minecraft::{mod_loader::utils::maven_to_path, structs::LibraryMod},
    utils::env_info::launcher_path,
};
use anyhow::Result;

pub fn loader_version_jar_name(version_id: &str) -> String {
    format!("{}.jar", version_id)
}

pub fn merge_classpath(
    project_name: &str,
    version_id: &str,
    libraries: &[LibraryMod],
    vanilla_classpath: &[String],
) -> Result<Vec<String>> {
    let base_path = launcher_path(Some(project_name)).map_err(|e| {
        LauncherError::LoaderSetup(format!(
            "Не удалось определить путь к файлам проекта: {e:#}"
        ))
    })?;
    let version_jar = base_path.join(loader_version_jar_name(version_id));
    let libraries_path = base_path.join("libraries");

    let mut classpath = build_mod_classpath(libraries, &libraries_path).map_err(|e| {
        LauncherError::LoaderSetup(format!("Не удалось собрать classpath модов: {e:#}"))
    })?;
    classpath.push(version_jar.to_string_lossy().to_string());

    let mut result_classpath = vanilla_classpath.to_vec();
    result_classpath.extend(classpath);
    Ok(result_classpath)
}

fn build_mod_classpath(libraries: &[LibraryMod], libraries_dir: &Path) -> Result<Vec<String>> {
    let mut paths: Vec<String> = Vec::new();

    for lib in libraries {
        let lib_path = libraries_dir.join(maven_to_path(&lib.name).map_err(|e| {
            LauncherError::LoaderSetup(format!("Не удалось разобрать координату библиотеки: {e:#}"))
        })?);

        if lib_path.exists() {
            paths.push(lib_path.to_string_lossy().to_string());
        } else {
            return Err(
                LauncherError::LoaderSetup(format!("Библиотека не найдена: {lib_path:?}")).into(),
            );
        }
    }

    Ok(paths)
}
