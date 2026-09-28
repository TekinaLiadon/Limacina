use std::path::Path;

use crate::utils::errors::LauncherError;
use crate::{
    minecraft::{
        mod_loader::{manifest::Manifest, utils::library_rel_path},
        structs::LibraryMod,
        vanilla::config::{strip_classpath_args, ArgumentsMap},
    },
    state::dto::ProjectConfig,
    utils::env_info::launcher_path,
};
use anyhow::Result;

pub fn loader_version_jar_name(version_id: &str) -> String {
    format!("{}.jar", version_id)
}

pub fn loader_args_map(state: &ProjectConfig) -> Result<ArgumentsMap> {
    Ok(
        ArgumentsMap::for_loader(state)
            .map_err(|e| LauncherError::LoaderSetup(format!("{e:#}")))?,
    )
}

pub fn loader_jvm_args(args_map: &ArgumentsMap, manifest: &Manifest) -> Vec<String> {
    strip_classpath_args(args_map.substitute_all(manifest.arguments.jvm_strings()))
}

pub fn loader_game_args(args_map: &ArgumentsMap, manifest: &Manifest) -> Vec<String> {
    let mut args = args_map.substitute_all(manifest.arguments.game_strings());
    if let Some(mc_args) = &manifest.minecraft_arguments {
        args.extend(
            args_map.substitute_all(mc_args.split_whitespace().map(str::to_string).collect()),
        );
    }
    args
}

pub fn merge_game_args(mut game_args: Vec<String>, loader_game: Vec<String>) -> Vec<String> {
    let mut i = 0;
    while i < loader_game.len() {
        let arg = &loader_game[i];
        if arg.starts_with("--") {
            let flag = arg.clone();
            let Some(value) = loader_game.get(i + 1).cloned() else {
                i += 1;
                continue;
            };
            if value.starts_with("${") {
                i += 1;
                continue;
            }
            if !game_args.iter().any(|a| a == &flag) {
                game_args.push(flag);
                game_args.push(value);
                i += 1;
            }
        }
        i += 1;
    }
    game_args
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

#[cfg(test)]
mod loader_args_tests {
    use super::{loader_args_map, loader_game_args, loader_jvm_args, merge_game_args};
    use crate::minecraft::mod_loader::manifest::Manifest;
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;

    fn project(name: &str, mc_version: &str) -> ProjectConfig {
        ProjectConfig {
            project_name: name.to_string(),
            mc_version: mc_version.to_string(),
            ..ProjectConfig::default()
        }
    }

    fn loader_manifest(jvm: &[&str], game: &[&str], mc_arguments: Option<&str>) -> Manifest {
        Manifest {
            id: "1.20.1-forge-47.2.0".to_string(),
            arguments: serde_json::from_value(serde_json::json!({
                "game": game,
                "jvm": jvm
            }))
            .expect("аргументы манифеста"),
            minecraft_arguments: mc_arguments.map(str::to_string),
            ..Manifest::default()
        }
    }

    #[tokio::test]
    async fn jvm_args_substitute_placeholders_and_strip_classpath() {
        let dir = LauncherDirGuard::acquire("loader_args_jvm").await;
        let args_map = loader_args_map(&project("ArgsJvm", "1.20.1")).expect("карта аргументов");
        let manifest = loader_manifest(
            &[
                "-DlibraryDirectory=${library_directory}",
                "-DignoreList=client-extra,${version_name}.jar",
                "-cp",
                "${classpath}",
            ],
            &[],
            None,
        );

        let jvm = loader_jvm_args(&args_map, &manifest);

        assert_eq!(
            jvm[0],
            format!(
                "-DlibraryDirectory={}",
                dir.project_dir("ArgsJvm").join("libraries").display()
            )
        );
        assert!(jvm.contains(&"-DignoreList=client-extra,1.20.1.jar".to_string()));
        assert!(!jvm.contains(&"-cp".to_string()));
        assert!(!jvm.iter().any(|arg| arg.contains("${")));
    }

    #[tokio::test]
    async fn game_args_use_arguments_and_legacy_minecraft_arguments() {
        let dir = LauncherDirGuard::acquire("loader_args_game").await;
        let args_map = loader_args_map(&project("ArgsGame", "1.12.2")).expect("карта аргументов");
        let manifest = loader_manifest(
            &[],
            &["--launchTarget", "fmlclient"],
            Some(
                "--tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --gameDir ${game_directory}",
            ),
        );

        let game = loader_game_args(&args_map, &manifest);

        assert!(game.contains(&"--launchTarget".to_string()));
        assert!(game.contains(&"fmlclient".to_string()));
        assert!(game.contains(&"--tweakClass".to_string()));
        assert!(game.contains(&"net.minecraftforge.fml.common.launcher.FMLTweaker".to_string()));
        let game_dir_pos = game
            .iter()
            .position(|arg| arg == "--gameDir")
            .expect("gameDir должен быть добавлен из minecraftArguments");
        assert_eq!(
            game[game_dir_pos + 1],
            dir.project_dir("ArgsGame").display().to_string()
        );
        assert!(!game.iter().any(|arg| arg.contains("${")));
    }

    #[tokio::test]
    async fn session_placeholders_stay_literal_in_loader_map() {
        let _dir = LauncherDirGuard::acquire("loader_args_session").await;
        let args_map =
            loader_args_map(&project("ArgsSession", "1.12.2")).expect("карта аргументов");

        assert_eq!(
            args_map.substitute_all(vec!["--username ${auth_player_name}".to_string()]),
            vec!["--username ${auth_player_name}".to_string()]
        );
    }

    #[test]
    fn merges_flag_with_value() {
        let game_args = merge_game_args(
            vec!["--existing".to_string()],
            vec!["--fml.forgeVersion".to_string(), "47.0.1".to_string()],
        );

        assert_eq!(
            game_args,
            vec![
                "--existing".to_string(),
                "--fml.forgeVersion".to_string(),
                "47.0.1".to_string()
            ]
        );
    }

    #[test]
    fn trailing_flag_without_value_is_dropped() {
        let game_args = merge_game_args(vec![], vec!["--fml.forgeVersion".to_string()]);

        assert!(
            game_args.is_empty(),
            "флаг без значения не должен добавляться"
        );
    }

    #[test]
    fn duplicate_flag_is_not_added_twice() {
        let game_args = merge_game_args(
            vec!["--flag".to_string(), "old".to_string()],
            vec!["--flag".to_string(), "new".to_string()],
        );

        assert_eq!(game_args, vec!["--flag".to_string(), "old".to_string()]);
    }

    #[test]
    fn flag_with_placeholder_value_is_skipped() {
        let game_args = merge_game_args(
            vec![],
            vec![
                "--flag".to_string(),
                "${placeholder}".to_string(),
                "--after".to_string(),
                "value".to_string(),
            ],
        );

        assert_eq!(game_args, vec!["--after".to_string(), "value".to_string()]);
    }
}
