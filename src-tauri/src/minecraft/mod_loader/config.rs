use std::path::Path;

use crate::utils::errors::LauncherError;
use crate::{
    minecraft::{mod_loader::utils::library_rel_path, structs::LibraryMod},
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
        let lib_path = libraries_dir.join(library_rel_path(lib)?);

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

#[cfg(test)]
mod tests {
    use super::merge_classpath;
    use crate::test_support::{library_mod, LauncherDirGuard};
    use std::fs;

    #[tokio::test]
    async fn merge_classpath_uses_manifest_path_for_classified_library() {
        let dir = LauncherDirGuard::acquire("merge_classpath").await;
        let project = dir.project_dir("CpProj");
        let lib_path = project.join("libraries/org/ow2/asm/asm-util/9.7/asm-util-9.7.jar");
        fs::create_dir_all(lib_path.parent().unwrap()).unwrap();
        fs::write(&lib_path, b"jar").unwrap();
        fs::write(project.join("1.20.1-21.1.80.jar"), b"loader").unwrap();

        let libraries = vec![library_mod(
            "org.ow2.asm:asm-util:9.7@jar",
            "org/ow2/asm/asm-util/9.7/asm-util-9.7.jar",
        )];

        let classpath =
            merge_classpath("CpProj", "1.20.1-21.1.80", &libraries, &[]).expect("classpath");

        assert!(
            classpath.contains(&lib_path.to_string_lossy().into_owned()),
            "classpath должен указывать на путь из манифеста: {:?}",
            classpath
        );
        assert!(
            !classpath.iter().any(|p| p.contains("@jar")),
            "путь не должен содержать суффикс @jar: {:?}",
            classpath
        );
    }

    #[tokio::test]
    async fn merge_classpath_errors_when_library_missing() {
        let _dir = LauncherDirGuard::acquire("merge_classpath_missing").await;

        let libraries = vec![library_mod(
            "org.ow2.asm:asm-util:9.7@jar",
            "org/ow2/asm/asm-util/9.7/asm-util-9.7.jar",
        )];

        let result = merge_classpath("CpProjMissing", "1.20.1-21.1.80", &libraries, &[]);

        assert!(result.is_err(), "отсутствующая библиотека — ошибка");
    }
}
