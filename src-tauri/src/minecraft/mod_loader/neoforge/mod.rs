use crate::{
    minecraft::{
        mod_loader::{
            config::{build_loader_config, LoaderConfigOptions, LoaderMainClass, VanillaClientJar},
            installer::setup_loader,
            manifest::{latest_list_version, versions_with_installed, NEOFORGE},
        },
        structs::{GameConfig, ModLoader, VersionMod},
    },
    state::dto::ProjectConfig,
};
use anyhow::Result;
use async_trait::async_trait;

pub struct NeoForge;
#[async_trait]
impl ModLoader for NeoForge {
    async fn versions(&self, state: &ProjectConfig) -> Result<Vec<VersionMod>> {
        versions_with_installed(&NEOFORGE, state).await
    }
    async fn latest_version(
        &self,
        state: &ProjectConfig,
        versions: &[VersionMod],
    ) -> Result<String> {
        latest_list_version(versions, &state.mc_version, "NeoForge")
    }
    async fn setup(&self, state: &ProjectConfig, manifest: &[VersionMod]) -> Result<()> {
        setup_loader(
            NEOFORGE.name,
            NEOFORGE.manifest_prefix,
            state,
            manifest,
            NEOFORGE.maven_base,
        )
        .await
    }
    async fn config(
        &self,
        state: &ProjectConfig,
        vanilla_config: GameConfig,
        version: &VersionMod,
    ) -> Result<GameConfig> {
        build_loader_config(
            &NEOFORGE,
            state,
            vanilla_config,
            version,
            LoaderConfigOptions {
                main_class: LoaderMainClass::FromManifest,
                vanilla_client_jar: VanillaClientJar::Drop,
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::NeoForge;
    use crate::minecraft::process::validate_jvm_args;
    use crate::minecraft::structs::{GameConfig, ModLoader, VersionMod};
    use crate::state::dto::ProjectConfig;
    use crate::test_support::LauncherDirGuard;
    use crate::utils::get_classpath_separator;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    #[tokio::test]
    async fn neoforge_config_expands_jvm_placeholders() {
        let dir = LauncherDirGuard::acquire("neoforge_config").await;

        let manifest_json = json!({
            "id": "neoforge-20.4.237",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "inheritsFrom": "1.20.4",
            "arguments": {
                "game": [
                    "--fml.neoForgeVersion", "20.4.237",
                    "--fml.mcVersion", "1.20.4",
                    "--launchTarget", "forgeclient"
                ],
                "jvm": [
                    "-Djava.net.preferIPv6Addresses=system",
                    "-DignoreList=securejarhandler-2.1.24.jar,bootstraplauncher-1.1.2.jar,client-extra,neoforge-,${version_name}.jar",
                    "-DmergeModules=jna-5.10.0.jar,jna-platform-5.10.0.jar",
                    "-DlibraryDirectory=${library_directory}",
                    "-p",
                    "${library_directory}/cpw/mods/securejarhandler/2.1.24/securejarhandler-2.1.24.jar${classpath_separator}${library_directory}/org/ow2/asm/asm/9.5/asm-9.5.jar",
                    "-cp",
                    "${classpath}"
                ]
            },
            "libraries": []
        });
        let manifest_path = dir.root().join("manifest").join("neoforge_20.4.237.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, manifest_json.to_string()).unwrap();

        let state = ProjectConfig {
            project_name: "NeoPlaceholders".to_string(),
            mc_version: "1.20.4".to_string(),
            loader_version: Some("20.4.237".to_string()),
            ..ProjectConfig::default()
        };
        let version = VersionMod {
            url: String::new(),
            id: "1.20.4-20.4.237".to_string(),
            main_class: String::new(),
            library: Vec::new(),
        };
        let game_root = dir.project_dir("NeoPlaceholders");
        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xms512M".to_string()],
            vec!["--username".to_string(), "Cordelia".to_string()],
            vec![game_root.join("1.20.4.jar").to_string_lossy().to_string()],
            "net.minecraft.client.main.Main".to_string(),
            game_root.clone(),
        );

        let config = NeoForge
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг NeoForge");

        let libraries_dir = game_root.join("libraries");
        let sep = get_classpath_separator();
        assert!(config.jvm_args.contains(
            &"-DignoreList=securejarhandler-2.1.24.jar,bootstraplauncher-1.1.2.jar,client-extra,neoforge-,1.20.4.jar".to_string()
        ));
        assert!(config
            .jvm_args
            .contains(&format!("-DlibraryDirectory={}", libraries_dir.display())));
        assert!(config.jvm_args.contains(&format!(
            "{}/cpw/mods/securejarhandler/2.1.24/securejarhandler-2.1.24.jar{sep}{}/org/ow2/asm/asm/9.5/asm-9.5.jar",
            libraries_dir.display(),
            libraries_dir.display()
        )));
        assert!(config
            .jvm_args
            .contains(&"-Djava.net.preferIPv6Addresses=system".to_string()));
        assert!(!config.jvm_args.contains(&"-cp".to_string()));
        assert!(config.game_args.contains(&"--launchTarget".to_string()));
        assert!(config.game_args.contains(&"forgeclient".to_string()));
        assert!(config
            .game_args
            .contains(&"--fml.neoForgeVersion".to_string()));
        assert!(!config
            .jvm_args
            .iter()
            .chain(config.game_args.iter())
            .any(|arg| arg.contains("${")));
        assert_eq!(
            config.main_class,
            "cpw.mods.bootstraplauncher.BootstrapLauncher"
        );
    }

    #[tokio::test]
    async fn neoforge_config_drops_vanilla_client_jar() {
        let dir = LauncherDirGuard::acquire("neoforge_config_filter").await;

        let manifest_json = json!({
            "id": "neoforge-20.4.237",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "inheritsFrom": "1.20.4",
            "arguments": {
                "game": ["--launchTarget", "forgeclient"],
                "jvm": ["-cp", "${classpath}"]
            },
            "libraries": [
                {
                    "name": "org.ow2.asm:asm:9.5",
                    "downloads": { "artifact": { "path": "", "url": "", "sha1": "0", "size": 1 } }
                }
            ]
        });
        let manifest_path = dir.root().join("manifest").join("neoforge_20.4.237.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, manifest_json.to_string()).unwrap();

        let state = ProjectConfig {
            project_name: "NeoFilter".to_string(),
            mc_version: "1.20.4".to_string(),
            loader_version: Some("20.4.237".to_string()),
            ..ProjectConfig::default()
        };
        let version = VersionMod {
            url: String::new(),
            id: "1.20.4-20.4.237".to_string(),
            main_class: String::new(),
            library: Vec::new(),
        };

        let game_root = dir.project_dir("NeoFilter");
        let lib_path = game_root
            .join("libraries")
            .join("org/ow2/asm/asm/9.5/asm-9.5.jar");
        fs::create_dir_all(lib_path.parent().unwrap()).unwrap();
        fs::write(&lib_path, b"asm").unwrap();

        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec![],
            vec![],
            vec![game_root.join("1.20.4.jar").to_string_lossy().to_string()],
            "net.minecraft.client.main.Main".to_string(),
            game_root.clone(),
        );

        let config = NeoForge
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг NeoForge");

        assert!(
            !config
                .classpath
                .contains(&game_root.join("1.20.4.jar").to_string_lossy().into_owned()),
            "ванильный клиентский jar должен отфильтровываться: {:?}",
            config.classpath
        );
        assert!(
            config
                .classpath
                .contains(&lib_path.to_string_lossy().into_owned()),
            "библиотеки из манифеста должны попасть в classpath: {:?}",
            config.classpath
        );
        assert!(config.classpath.contains(
            &game_root
                .join("1.20.4-20.4.237.jar")
                .to_string_lossy()
                .into_owned()
        ));
    }

    #[tokio::test]
    async fn neoforge_config_keeps_user_jvm_args_on_validated_spawn_path() {
        let dir = LauncherDirGuard::acquire("neoforge_args_guard").await;

        let manifest_json = json!({
            "id": "neoforge-20.4.237",
            "time": "2023-01-01T00:00:00+00:00",
            "releaseTime": "2023-01-01T00:00:00+00:00",
            "type": "release",
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "inheritsFrom": "1.20.4",
            "arguments": {
                "game": ["--launchTarget", "forgeclient"],
                "jvm": ["-Dneoforge.keep=1", "-cp", "${classpath}"]
            },
            "libraries": []
        });
        let manifest_path = dir.root().join("manifest").join("neoforge_20.4.237.json");
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, manifest_json.to_string()).unwrap();

        let state = ProjectConfig {
            project_name: "NeoGuard".to_string(),
            mc_version: "1.20.4".to_string(),
            loader_version: Some("20.4.237".to_string()),
            ..ProjectConfig::default()
        };
        let version = VersionMod {
            url: String::new(),
            id: "1.20.4-20.4.237".to_string(),
            main_class: String::new(),
            library: Vec::new(),
        };
        let game_root = dir.project_dir("NeoGuard");
        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xmx4G".to_string(), "-Xdebug".to_string()],
            vec![],
            vec![],
            "net.minecraft.client.main.Main".to_string(),
            game_root,
        );

        let config = NeoForge
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг NeoForge");

        assert!(
            config.jvm_args.contains(&"-Xdebug".to_string()),
            "пользовательский аргумент должен пройти через конфиг лоадера: {:?}",
            config.jvm_args
        );
        let error = validate_jvm_args(&config.jvm_args)
            .expect_err("пользовательский debug-аргумент должен быть отклонён");
        assert!(
            error.to_string().contains("-Xdebug"),
            "ошибка должна называть аргумент: {error}"
        );
    }
}
