pub mod manifest;

use crate::utils::errors::LauncherError;
use crate::{
    log_info,
    minecraft::{
        mod_loader::{
            config::merge_classpath,
            installer::setup_loader,
            manifest::{
                apply_installed_manifest, current_loader_version, latest_list_version,
                loader_libraries, loader_version_or_err, Manifest,
            },
            neoforge::manifest::{
                get_manifest_index, transform_neoforge_manifest, MANIFEST_PREFIX, MAVEN_BASE,
            },
        },
        structs::{GameConfig, ModLoader, VersionMod},
        vanilla::config::{filter_classpath, strip_classpath_args},
    },
    state::dto::ProjectConfig,
    utils::{
        download_file::download_json,
        env_info::{get_launcher_name, launcher_path},
        get_classpath_separator,
    },
};
use anyhow::Result;
use async_trait::async_trait;

pub struct NeoForge;
#[async_trait]
impl ModLoader for NeoForge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let mut manifest =
            transform_neoforge_manifest(get_manifest_index().await.map_err(|e| {
                LauncherError::LoaderSetup(format!("Не удалось получить индекс NeoForge: {e:#}"))
            })?);
        apply_installed_manifest(state, MANIFEST_PREFIX, MAVEN_BASE, &mut manifest)
            .await
            .map_err(|e| {
                LauncherError::LoaderSetup(format!(
                    "Не удалось применить установленный манифест NeoForge: {e:#}"
                ))
            })?;
        Ok(manifest)
    }
    async fn version_current(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<VersionMod> {
        current_loader_version(state, versions)
    }
    async fn latest_version(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String> {
        latest_list_version(versions, &state.mc_version, "NeoForge")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader("NeoForge", MANIFEST_PREFIX, state, manifest, MAVEN_BASE).await
    }
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        log_info!("Соединение classpath NeoForge");
        let target_version = loader_version_or_err(state)?;

        let neoforge_manifest = launcher_path(None)
            .map_err(|e| {
                LauncherError::LoaderSetup(format!(
                    "Не удалось определить путь к файлам лаунчера: {e:#}"
                ))
            })?
            .join("manifest")
            .join(format!("neoforge_{}.json", target_version));
        let manifest = download_json::<Manifest>(None, &neoforge_manifest)
            .await
            .map_err(|e| {
                LauncherError::LoaderSetup(format!("Не удалось скачать манифест NeoForge: {e:#}"))
            })?;

        let base_path = launcher_path(Some(&state.project_name)).map_err(|e| {
            LauncherError::LoaderSetup(format!(
                "Не удалось определить путь к файлам проекта: {e:#}"
            ))
        })?;
        let natives_dir = base_path.join("natives").to_string_lossy().to_string();
        let libraries_dir = base_path.join("libraries").to_string_lossy().to_string();

        let neoforge_libraries = if version.library.is_empty() {
            loader_libraries(manifest.libraries.clone(), MAVEN_BASE).map_err(|e| {
                LauncherError::LoaderSetup(format!("Не удалось собрать библиотеки NeoForge: {e:#}"))
            })?
        } else {
            version.library.clone()
        };
        let mut classpath = merge_classpath(
            &state.project_name,
            &version.id,
            &neoforge_libraries,
            &Vec::new(),
        )
        .map_err(|e| {
            LauncherError::LoaderSetup(format!("Не удалось собрать classpath NeoForge: {e:#}"))
        })?;
        let vanilla_client_jar = format!("{}.jar", state.mc_version);
        let vanilla_filtered: Vec<String> = vanilla_config
            .classpath
            .iter()
            .filter(|p| !p.ends_with(&vanilla_client_jar))
            .cloned()
            .collect();
        classpath.extend(vanilla_filtered);
        let clean_classpath = filter_classpath(classpath);
        let launcher_name = get_launcher_name();

        let neoforge_jvm: Vec<String> = strip_classpath_args(
            manifest
                .arguments
                .jvm_strings()
                .into_iter()
                .map(|arg| {
                    let mut result = arg.replace("${natives_directory}", &natives_dir);
                    result = result.replace("${library_directory}", &libraries_dir);
                    result = result.replace("${classpath_separator}", get_classpath_separator());
                    result = result.replace("${launcher_name}", &launcher_name);
                    result = result.replace("${launcher_version}", env!("CARGO_PKG_VERSION"));
                    result
                })
                .collect(),
        );
        let jvm_args = [&vanilla_config.jvm_args[..], &neoforge_jvm[..]].concat();

        let mut game_args = vanilla_config.game_args.clone();
        game_args = merge_game_args(game_args, manifest.arguments.game_strings());

        Ok(vanilla_config
            .with_args(jvm_args, game_args)
            .with_loader(clean_classpath, manifest.main_class.clone()))
    }
}

fn merge_game_args(mut game_args: Vec<String>, neoforge_game: Vec<String>) -> Vec<String> {
    let mut i = 0;
    while i < neoforge_game.len() {
        let arg = &neoforge_game[i];
        if arg.starts_with("--") {
            let flag = arg.clone();
            let Some(value) = neoforge_game.get(i + 1).cloned() else {
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

#[cfg(test)]
mod tests {
    use super::merge_game_args;

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
