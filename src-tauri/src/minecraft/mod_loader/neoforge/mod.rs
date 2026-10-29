pub mod manifest;

use crate::minecraft::mod_loader::{config::VanillaClientJar, manifest::InstallerLoader};

pub(crate) static LOADER: InstallerLoader = InstallerLoader {
    def: &manifest::NEOFORGE,
    client_jar: VanillaClientJar::Drop,
};

#[cfg(test)]
mod tests {
    use super::LOADER;
    use crate::minecraft::process::validate_jvm_args;
    use crate::minecraft::structs::{GameConfig, ModLoader};
    use crate::test_support::{
        assert_loader_config_common, loader_manifest, loader_project, loader_vanilla_config,
        loader_version_mod, write_loader_manifest, LauncherDirGuard,
    };
    use crate::utils::get_classpath_separator;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    #[tokio::test]
    async fn neoforge_config_expands_jvm_placeholders() {
        let dir = LauncherDirGuard::acquire("neoforge_config").await;

        let manifest_json = loader_manifest(
            "neoforge-20.4.237",
            "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "1.20.4",
            json!({
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
            }),
            json!([]),
        );
        write_loader_manifest(dir.root(), "neoforge_20.4.237", &manifest_json);

        let state = loader_project("NeoPlaceholders", "1.20.4", "20.4.237");
        let version = loader_version_mod("1.20.4-20.4.237", "");
        let game_root = dir.project_dir("NeoPlaceholders");
        let vanilla_config =
            loader_vanilla_config(&game_root, &game_root.join("1.20.4.jar").to_string_lossy());

        let config = LOADER
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг NeoForge");

        let libraries_dir = game_root.join("libraries");
        let sep = get_classpath_separator();
        assert!(config.jvm_args.contains(
            &"-DignoreList=securejarhandler-2.1.24.jar,bootstraplauncher-1.1.2.jar,client-extra,neoforge-,1.20.4.jar".to_string()
        ));
        assert_loader_config_common(&config, &libraries_dir);
        assert!(config.jvm_args.contains(&format!(
            "{}/cpw/mods/securejarhandler/2.1.24/securejarhandler-2.1.24.jar{sep}{}/org/ow2/asm/asm/9.5/asm-9.5.jar",
            libraries_dir.display(),
            libraries_dir.display()
        )));
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

        let manifest_json = loader_manifest(
            "neoforge-20.4.237",
            "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "1.20.4",
            json!({
                "game": ["--launchTarget", "forgeclient"],
                "jvm": ["-cp", "${classpath}"]
            }),
            json!([
                {
                    "name": "org.ow2.asm:asm:9.5",
                    "downloads": { "artifact": { "path": "", "url": "", "sha1": "0", "size": 1 } }
                }
            ]),
        );
        write_loader_manifest(dir.root(), "neoforge_20.4.237", &manifest_json);

        let state = loader_project("NeoFilter", "1.20.4", "20.4.237");
        let version = loader_version_mod("1.20.4-20.4.237", "");

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

        let config = LOADER
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
    async fn neoforge_config_keeps_library_whose_name_ends_with_mc_version() {
        let dir = LauncherDirGuard::acquire("neoforge_suffix_lib").await;

        let manifest_json = loader_manifest(
            "neoforge-20.4.237",
            "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "1.20.4",
            json!({
                "game": ["--launchTarget", "forgeclient"],
                "jvm": ["-cp", "${classpath}"]
            }),
            json!([]),
        );
        write_loader_manifest(dir.root(), "neoforge_20.4.237", &manifest_json);

        let state = loader_project("NeoSuffix", "1.20.4", "20.4.237");
        let version = loader_version_mod("1.20.4-20.4.237", "");

        let game_root = dir.project_dir("NeoSuffix");
        let suffixed_lib = game_root.join("libraries/com/example/oldlib/1.20.4/oldlib-1.20.4.jar");
        fs::create_dir_all(suffixed_lib.parent().unwrap()).unwrap();
        fs::write(&suffixed_lib, b"lib").unwrap();
        let client_jar = game_root.join("1.20.4.jar");
        fs::write(&client_jar, b"client").unwrap();

        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec![],
            vec![],
            vec![
                client_jar.to_string_lossy().into_owned(),
                suffixed_lib.to_string_lossy().into_owned(),
            ],
            "net.minecraft.client.main.Main".to_string(),
            game_root.clone(),
        );

        let config = LOADER
            .config(&state, vanilla_config, &version)
            .await
            .expect("конфиг NeoForge");

        assert!(
            !config
                .classpath
                .contains(&client_jar.to_string_lossy().into_owned()),
            "ванильный клиентский jar должен отфильтровываться: {:?}",
            config.classpath
        );
        assert!(
            config
                .classpath
                .contains(&suffixed_lib.to_string_lossy().into_owned()),
            "библиотека, чей файл оканчивается на версию MC, не должна выпадать из classpath: {:?}",
            config.classpath
        );
    }

    #[tokio::test]
    async fn neoforge_config_keeps_user_jvm_args_on_validated_spawn_path() {
        let dir = LauncherDirGuard::acquire("neoforge_args_guard").await;

        let manifest_json = loader_manifest(
            "neoforge-20.4.237",
            "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "1.20.4",
            json!({
                "game": ["--launchTarget", "forgeclient"],
                "jvm": ["-Dneoforge.keep=1", "-cp", "${classpath}"]
            }),
            json!([]),
        );
        write_loader_manifest(dir.root(), "neoforge_20.4.237", &manifest_json);

        let state = loader_project("NeoGuard", "1.20.4", "20.4.237");
        let version = loader_version_mod("1.20.4-20.4.237", "");
        let game_root = dir.project_dir("NeoGuard");
        let vanilla_config = GameConfig::new(
            PathBuf::from("java"),
            vec!["-Xmx4G".to_string(), "-Xdebug".to_string()],
            vec![],
            vec![],
            "net.minecraft.client.main.Main".to_string(),
            game_root,
        );

        let config = LOADER
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
