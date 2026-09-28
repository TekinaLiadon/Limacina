use crate::utils::errors::LauncherError;
use crate::{
    log_info,
    minecraft::{
        mod_loader::{
            config::{
                loader_args_map, loader_game_args, loader_jvm_args, merge_classpath,
                merge_game_args,
            },
            installer::setup_loader,
            manifest::{
                latest_list_version, loader_manifest_path, loader_version_or_err,
                versions_with_installed, Manifest, FORGE,
            },
        },
        structs::{GameConfig, ModLoader, VersionMod},
        vanilla::config::filter_classpath,
    },
    state::dto::ProjectConfig,
    utils::download_file::download_json,
};
use anyhow::Result;
use async_trait::async_trait;

pub struct Forge;
#[async_trait]
impl ModLoader for Forge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        versions_with_installed(&FORGE, state).await
    }
    async fn latest_version(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String> {
        latest_list_version(versions, &state.mc_version, "Forge")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader(
            FORGE.name,
            FORGE.manifest_prefix,
            state,
            manifest,
            FORGE.maven_base,
        )
        .await
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
        .await
        .map_err(|e| {
            LauncherError::LoaderSetup(format!("Не удалось собрать classpath Forge: {e:#}"))
        })?;
        let clean_classpath = filter_classpath(classpath);

        let forge_manifest =
            loader_manifest_path(FORGE.manifest_prefix, target_version).map_err(|e| {
                LauncherError::LoaderSetup(format!(
                    "Не удалось определить путь к файлам лаунчера: {e:#}"
                ))
            })?;
        let manifest = download_json::<Manifest>(None, &forge_manifest)
            .await
            .map_err(|e| {
                LauncherError::LoaderSetup(format!("Не удалось скачать манифест Forge: {e:#}"))
            })?;
        let args_map = loader_args_map(state)?;
        let game_args = merge_game_args(
            vanilla_config.game_args.clone(),
            loader_game_args(&args_map, &manifest),
        );
        let jvm_args = [
            &vanilla_config.jvm_args[..],
            &loader_jvm_args(&args_map, &manifest)[..],
        ]
        .concat();

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
    use crate::utils::get_classpath_separator;
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
                path: String::new(),
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
        assert!(config.classpath.contains(
            &game_root
                .join("1.20.1-0.16.9.jar")
                .to_string_lossy()
                .into_owned()
        ));
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

        setup_loader(
            "Forge",
            "forge",
            &state,
            std::slice::from_ref(&version),
            &maven_base,
        )
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

    #[tokio::test]
    async fn forge_config_expands_loader_placeholders() {
        let dir = LauncherDirGuard::acquire("forge_config_placeholders").await;

        let manifest_json = json!({
            "id": "1.20.1-forge-47.2.0",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "inheritsFrom": "1.20.1",
            "arguments": {
                "game": ["--launchTarget", "forgeclient", "--fml.forgeVersion", "47.2.0"],
                "jvm": [
                    "-Djava.net.preferIPv6Addresses=system",
                    "-DignoreList=bootstraplauncher,securejarhandler,client-extra,forge-,${version_name}.jar",
                    "-DmergeModules=jna-5.10.0.jar,jna-platform-5.10.0.jar",
                    "-DlibraryDirectory=${library_directory}",
                    "-p",
                    "${library_directory}/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar${classpath_separator}${library_directory}/cpw/mods/securejarhandler/2.1.10/securejarhandler-2.1.10.jar",
                    "-cp",
                    "${classpath}"
                ]
            },
            "libraries": []
        });
        let manifest_path = dir.root().join("manifest").join("forge_47.2.0.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, manifest_json.to_string()).unwrap();

        let state = ProjectConfig {
            project_name: "ForgePlaceholders".to_string(),
            mc_version: "1.20.1".to_string(),
            loader_version: Some("47.2.0".to_string()),
            ..ProjectConfig::default()
        };
        let version = VersionMod {
            url: String::new(),
            id: "1.20.1-47.2.0".to_string(),
            main_class: "LoaderMain".to_string(),
            library: Vec::new(),
        };
        let game_root = dir.project_dir("ForgePlaceholders");
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

        let libraries_dir = game_root.join("libraries");
        let sep = get_classpath_separator();
        assert!(config.jvm_args.contains(
            &"-DignoreList=bootstraplauncher,securejarhandler,client-extra,forge-,1.20.1.jar"
                .to_string()
        ));
        assert!(config
            .jvm_args
            .contains(&format!("-DlibraryDirectory={}", libraries_dir.display())));
        assert!(config.jvm_args.contains(&format!(
            "{}/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar{sep}{}/cpw/mods/securejarhandler/2.1.10/securejarhandler-2.1.10.jar",
            libraries_dir.display(),
            libraries_dir.display()
        )));
        assert!(config
            .jvm_args
            .contains(&"-Djava.net.preferIPv6Addresses=system".to_string()));
        assert!(!config.jvm_args.contains(&"-cp".to_string()));
        assert!(config.game_args.contains(&"--launchTarget".to_string()));
        assert!(config.game_args.contains(&"forgeclient".to_string()));
        assert!(config.game_args.contains(&"--fml.forgeVersion".to_string()));
        assert!(config.game_args.contains(&"47.2.0".to_string()));
        assert!(!config
            .jvm_args
            .iter()
            .chain(config.game_args.iter())
            .any(|arg| arg.contains("${")));
        assert_eq!(config.main_class, "LoaderMain");
    }

    #[tokio::test]
    async fn forge_config_merges_legacy_minecraft_arguments() {
        let dir = LauncherDirGuard::acquire("forge_config_legacy").await;

        let manifest_json = json!({
            "id": "1.12.2-forge-14.23.5.2859",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "net.minecraft.launchwrapper.Launch",
            "inheritsFrom": "1.12.2",
            "minecraftArguments": "--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --versionType Forge",
            "libraries": []
        });
        let manifest_path = dir.root().join("manifest").join("forge_14.23.5.2859.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, manifest_json.to_string()).unwrap();

        let state = ProjectConfig {
            project_name: "ForgeLegacy".to_string(),
            mc_version: "1.12.2".to_string(),
            loader_version: Some("14.23.5.2859".to_string()),
            ..ProjectConfig::default()
        };
        let version = VersionMod {
            url: String::new(),
            id: "1.12.2-14.23.5.2859".to_string(),
            main_class: "net.minecraft.launchwrapper.Launch".to_string(),
            library: Vec::new(),
        };
        let game_root = dir.project_dir("ForgeLegacy");
        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Djava.library.path=natives".to_string()],
            vec![
                "--username".to_string(),
                "Cordelia".to_string(),
                "--version".to_string(),
                "1.12.2".to_string(),
                "--gameDir".to_string(),
                game_root.display().to_string(),
                "--assetsDir".to_string(),
                game_root.join("assets").display().to_string(),
                "--assetIndex".to_string(),
                "1.12".to_string(),
                "--uuid".to_string(),
                "uuid-1".to_string(),
                "--accessToken".to_string(),
                "token-1".to_string(),
                "--userType".to_string(),
                "mojang".to_string(),
                "--versionType".to_string(),
                "release".to_string(),
            ],
            vec![game_root.join("1.12.2.jar").to_string_lossy().to_string()],
            "net.minecraft.client.main.Main".to_string(),
            game_root.clone(),
        );

        let config = Forge
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг Forge");

        let tweak_pos = config
            .game_args
            .iter()
            .position(|arg| arg == "--tweakClass")
            .expect("твик-класс должен быть добавлен из minecraftArguments");
        assert_eq!(
            config.game_args[tweak_pos + 1],
            "net.minecraftforge.fml.common.launcher.FMLTweaker"
        );
        assert_eq!(
            config
                .game_args
                .iter()
                .filter(|arg| *arg == "--username")
                .count(),
            1,
            "флаги, уже есть в ванильных аргументах, не должны дублироваться"
        );
        assert_eq!(
            config
                .game_args
                .iter()
                .filter(|arg| *arg == "--accessToken")
                .count(),
            1
        );
        assert!(!config.game_args.iter().any(|arg| arg.contains("${")));
        assert_eq!(config.main_class, "net.minecraft.launchwrapper.Launch");
    }
}
