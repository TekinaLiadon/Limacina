pub mod manifest;

use crate::{
    log_info,
    minecraft::{
        mod_loader::{
            config::merge_classpath,
            forge::manifest::{
                get_manifest_index, transform_forge_manifest, MANIFEST_PREFIX, MAVEN_BASE,
            },
            installer::setup_loader,
            manifest::{
                apply_installed_manifest, current_loader_version, latest_list_version,
                loader_version_or_err, Manifest,
            },
        },
        structs::{GameConfig, ModLoader, VersionMod},
        vanilla::config::{filter_classpath, strip_classpath_args},
    },
    state::dto::ProjectConfig,
    utils::{download_file::download_json, env_info::launcher_path},
};
use anyhow::{Context, Result};
use async_trait::async_trait;

pub struct Forge;
#[async_trait]
impl ModLoader for Forge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        let mut manifest = transform_forge_manifest(
            get_manifest_index()
                .await
                .context("Не удалось получить индекс Forge")?,
        );
        apply_installed_manifest(state, MANIFEST_PREFIX, MAVEN_BASE, &mut manifest)
            .await
            .context("Не удалось применить установленный манифест Forge")?;
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
        latest_list_version(versions, &state.mc_version, "Forge")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader("Forge", MANIFEST_PREFIX, state, manifest, MAVEN_BASE).await
    }
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        log_info!("Соединение classpath");
        let target_version = loader_version_or_err(state)?;
        let classpath = merge_classpath(
            &state.project_name,
            &version.id,
            &version.library,
            &vanilla_config.classpath,
        )
        .context("Не удалось собрать classpath Forge")?;
        let clean_classpath = filter_classpath(classpath);

        let forge_manifest = launcher_path(None)
            .context("Не удалось определить путь к файлам лаунчера")?
            .join("manifest")
            .join(format!("forge_{}.json", target_version));
        let manifest = download_json::<Manifest>(None, &forge_manifest)
            .await
            .context("Не удалось скачать манифест Forge")?;
        let loader_game_args = manifest.arguments.game_strings();
        let jvm_args = [
            &vanilla_config.jvm_args[..],
            &strip_classpath_args(manifest.arguments.jvm_strings())[..],
        ]
        .concat();
        let game_args = [&vanilla_config.game_args[..], &loader_game_args[..]].concat();

        Ok(vanilla_config
            .with_args(jvm_args, game_args)
            .with_loader(clean_classpath, version.main_class.clone()))
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;
    use crate::minecraft::mod_loader::installer::setup_loader;
    use crate::minecraft::structs::LibraryMod;
    use crate::test_support::{sha1_hex, LauncherDirGuard};
    use mockito::Server;
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};

    #[tokio::test]
    async fn forge_config_merges_classpath_and_strips_cp_args() {
        let dir = LauncherDirGuard::acquire("forge_config").await;

        let manifest_json = json!({
            "id": "1.20.1-forge-0.16.9",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "net.minecraftforge.bootstrap.Bootstrap",
            "inheritsFrom": "1.20.1",
            "arguments": {
                "game": ["--fml.forgeVersion", "0.16.9"],
                "jvm": ["-Dforge.keep=1", "-cp", "${classpath}"]
            },
            "libraries": []
        });
        let manifest_path = dir.root().join("manifest").join("forge_0.16.9.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, manifest_json.to_string()).unwrap();

        let state = ProjectConfig {
            project_name: "ForgeProj".to_string(),
            mc_version: "1.20.1".to_string(),
            loader_version: Some("0.16.9".to_string()),
            ..ProjectConfig::default()
        };

        let game_root = dir.project_dir("ForgeProj");
        let lib_path = game_root
            .join("libraries")
            .join("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar");
        fs::create_dir_all(lib_path.parent().unwrap()).unwrap();
        fs::write(&lib_path, b"lib").unwrap();
        fs::write(game_root.join("1.20.1-0.16.9.jar"), b"jar").unwrap();

        let version = VersionMod {
            url: String::new(),
            id: "1.20.1-0.16.9".to_string(),
            main_class: "LoaderMain".to_string(),
            library: vec![LibraryMod {
                name: "net.fabricmc:fabric-loader:0.16.9".to_string(),
                url: "http://unused.test/lib.jar".to_string(),
                hash: String::new(),
                size: 0,
            }],
        };

        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xms512M".to_string()],
            vec!["--username".to_string(), "Cordelia".to_string()],
            vec!["/game/libraries/vanilla.jar".to_string()],
            "net.minecraft.client.main.Main".to_string(),
            game_root.clone(),
        );

        let config = Forge
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг Forge");

        assert!(config
            .classpath
            .contains(&"/game/libraries/vanilla.jar".to_string()));
        assert!(config
            .classpath
            .contains(&lib_path.to_string_lossy().into_owned()));
        assert!(config
            .classpath
            .contains(&game_root.join("1.20.1-0.16.9.jar").to_string_lossy().into_owned()));
        assert!(!config
            .classpath
            .contains(&game_root.join("0.16.9.jar").to_string_lossy().into_owned()));
        assert!(config.jvm_args.contains(&"-Xms512M".to_string()));
        assert!(config.jvm_args.contains(&"-Dforge.keep=1".to_string()));
        assert!(!config.jvm_args.contains(&"-cp".to_string()));
        assert!(!config
            .jvm_args
            .iter()
            .any(|arg| arg.contains("${classpath}")));
        assert!(config.game_args.contains(&"--username".to_string()));
        assert!(config.game_args.contains(&"Cordelia".to_string()));
        assert!(config.game_args.contains(&"--fml.forgeVersion".to_string()));
        assert_eq!(config.main_class, "LoaderMain");
    }

    #[tokio::test]
    async fn classpath_after_install_has_no_missing_entries() {
        let dir = LauncherDirGuard::acquire("forge_classpath_install").await;
        let mut server = Server::new_async().await;

        server
            .mock(
                "GET",
                "/maven/net/fabricmc/fabric-loader/47.2.0/fabric-loader-47.2.0.jar",
            )
            .with_status(200)
            .with_body(b"loader jar bytes")
            .create_async()
            .await;
        server
            .mock("GET", "/maven/org/ow2/asm/asm/9.7/asm-9.7.jar")
            .with_status(200)
            .with_body(b"asm lib bytes")
            .create_async()
            .await;
        server
            .mock("GET", "/installer/1.20.1-47.2.0.jar")
            .with_status(200)
            .with_body(b"installer bytes")
            .create_async()
            .await;

        let manifest_json = json!({
            "id": "1.20.1-forge-47.2.0",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "net.minecraftforge.bootstrap.Bootstrap",
            "inheritsFrom": "1.20.1",
            "arguments": {
                "game": ["--fml.forgeVersion", "47.2.0"],
                "jvm": ["-cp", "${classpath}"]
            },
            "libraries": [
                {
                    "name": "net.fabricmc:fabric-loader:47.2.0",
                    "downloads": { "artifact": { "path": "", "url": "", "sha1": sha1_hex(b"loader jar bytes"), "size": 15 } }
                },
                {
                    "name": "org.ow2.asm:asm:9.7",
                    "downloads": { "artifact": { "path": "", "url": "", "sha1": sha1_hex(b"asm lib bytes"), "size": 13 } }
                }
            ]
        });
        let manifest_path = dir.root().join("manifest").join("forge_47.2.0.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, manifest_json.to_string()).unwrap();

        let state = ProjectConfig {
            project_name: "ForgeInstallProj".to_string(),
            mc_version: "1.20.1".to_string(),
            loader_version: Some("47.2.0".to_string()),
            ..ProjectConfig::default()
        };
        let version = VersionMod {
            url: format!("{}/installer/1.20.1-47.2.0.jar", server.url()),
            id: "1.20.1-47.2.0".to_string(),
            main_class: "net.minecraftforge.bootstrap.Bootstrap".to_string(),
            library: Vec::new(),
        };
        let maven_base = format!("{}/maven", server.url());

        setup_loader("Forge", "forge", &state, std::slice::from_ref(&version), &maven_base)
            .await
            .expect("установка Forge");

        let game_root = dir.project_dir("ForgeInstallProj");
        fs::write(game_root.join("1.20.1.jar"), b"client").unwrap();
        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xms512M".to_string()],
            vec!["--username".to_string(), "Cordelia".to_string()],
            vec![game_root.join("1.20.1.jar").to_string_lossy().to_string()],
            "net.minecraft.client.main.Main".to_string(),
            game_root.clone(),
        );

        let config = Forge
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг Forge");

        let loader_jar = game_root.join("1.20.1-47.2.0.jar");
        assert_eq!(fs::read(&loader_jar).unwrap(), b"installer bytes");
        assert!(config
            .classpath
            .contains(&loader_jar.to_string_lossy().into_owned()));
        assert!(!game_root.join("47.2.0.jar").exists());
        assert!(
            config.classpath.iter().all(|p| Path::new(p).exists()),
            "несуществующие записи classpath: {:?}",
            config.classpath
        );
    }
}
