use anyhow::Result;
use std::path::PathBuf;

use crate::minecraft::structs::LibraryMod;
use crate::utils::env_info::is_safe_relative_path;
use crate::utils::errors::LauncherError;

struct MavenCoord {
    group_path: String,
    artifact_id: String,
    version: String,
    classifier: Option<String>,
    extension: String,
}

impl MavenCoord {
    fn file_name(&self) -> String {
        let base = format!("{}-{}", self.artifact_id, self.version);
        match &self.classifier {
            Some(classifier) => format!("{base}-{classifier}.{}", self.extension),
            None => format!("{base}.{}", self.extension),
        }
    }

    fn rel_path(&self) -> PathBuf {
        PathBuf::from(format!(
            "{}/{}/{}/{}",
            self.group_path,
            self.artifact_id,
            self.version,
            self.file_name()
        ))
    }
}

fn parse_maven(coord: &str) -> Result<MavenCoord> {
    let invalid =
        || LauncherError::LoaderSetup(format!("Некорректная Maven-координата: {coord}")).into();

    let (body, extension) = match coord.split_once('@') {
        Some((body, ext)) if !ext.is_empty() => (body, ext.to_string()),
        Some(_) => return Err(invalid()),
        None => (coord, "jar".to_string()),
    };

    let parts: Vec<&str> = body.split(':').collect();
    if parts.len() < 3 || parts.len() > 4 {
        return Err(invalid());
    }
    let (group_id, artifact_id, version, classifier) =
        (parts[0], parts[1], parts[2], parts.get(3).copied());
    if group_id.is_empty() || artifact_id.is_empty() || version.is_empty() {
        return Err(invalid());
    }
    if classifier.is_some_and(str::is_empty) {
        return Err(invalid());
    }

    let coord = MavenCoord {
        group_path: group_id.replace('.', "/"),
        artifact_id: artifact_id.to_string(),
        version: version.to_string(),
        classifier: classifier.map(str::to_string),
        extension,
    };
    if !coord.rel_path().to_str().is_some_and(is_safe_relative_path) {
        return Err(invalid());
    }

    Ok(coord)
}

pub fn maven_to_path(name: &str) -> Result<PathBuf> {
    let coord = parse_maven(name).map_err(|e| {
        LauncherError::LoaderSetup(format!("Не удалось разобрать Maven-координату: {e:#}"))
    })?;
    Ok(coord.rel_path())
}

pub fn maven_to_url(coord: &str, url: &str) -> Result<String> {
    let parsed = parse_maven(coord).map_err(|e| {
        LauncherError::LoaderSetup(format!("Не удалось разобрать Maven-координату: {e:#}"))
    })?;

    Ok(format!(
        "{url}/{}/{}/{}/{}",
        parsed.group_path,
        parsed.artifact_id,
        parsed.version,
        parsed.file_name()
    ))
}

pub fn library_rel_path(lib: &LibraryMod) -> Result<PathBuf> {
    if !lib.path.is_empty() {
        if !is_safe_relative_path(&lib.path) {
            return Err(LauncherError::LoaderSetup(format!(
                "Недопустимый путь библиотеки из манифеста: {}",
                lib.path
            ))
            .into());
        }
        return Ok(PathBuf::from(&lib.path));
    }
    let path = maven_to_path(&lib.name).map_err(|e| {
        LauncherError::LoaderSetup(format!("Не удалось разобрать координату библиотеки: {e:#}"))
    })?;
    Ok(path)
}

#[cfg(test)]
mod maven_coords_tests {
    use super::{library_rel_path, maven_to_path, maven_to_url};
    use crate::test_support::library_mod;
    use crate::utils::errors::LauncherError;

    #[test]
    fn path_for_valid_coordinate() {
        let path = maven_to_path("net.fabricmc:fabric-loader:0.16.9").expect("валидная координата");
        assert_eq!(
            path,
            std::path::PathBuf::from("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar")
        );
    }

    #[test]
    fn url_for_valid_coordinate() {
        let url = maven_to_url(
            "net.fabricmc:fabric-loader:0.16.9",
            "https://maven.fabricmc.net",
        )
        .expect("валидная координата");
        assert_eq!(
            url,
            "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"
        );
    }

    #[test]
    fn path_supports_classifier() {
        let path = maven_to_path("net.minecraftforge:mergetool:1.1.5:api")
            .expect("валидная координата с классификатором");
        assert_eq!(
            path,
            std::path::PathBuf::from("net/minecraftforge/mergetool/1.1.5/mergetool-1.1.5-api.jar")
        );
    }

    #[test]
    fn path_supports_classifier_and_extension_suffix() {
        let path = maven_to_path("net.neoforged:mergetool:2.0.3:api@jar")
            .expect("валидная координата с классификатором и @jar");
        assert_eq!(
            path,
            std::path::PathBuf::from("net/neoforged/mergetool/2.0.3/mergetool-2.0.3-api.jar")
        );
    }

    #[test]
    fn path_supports_extension_suffix_without_classifier() {
        let path =
            maven_to_path("org.ow2.asm:asm-util:9.7@jar").expect("валидная координата с @jar");
        assert_eq!(
            path,
            std::path::PathBuf::from("org/ow2/asm/asm-util/9.7/asm-util-9.7.jar")
        );
    }

    #[test]
    fn url_supports_classifier() {
        let url = maven_to_url(
            "net.minecraftforge:mergetool:1.1.5:api",
            "https://maven.minecraftforge.net",
        )
        .expect("валидная координата с классификатором");
        assert_eq!(
            url,
            "https://maven.minecraftforge.net/net/minecraftforge/mergetool/1.1.5/mergetool-1.1.5-api.jar"
        );
    }

    #[test]
    fn path_rejects_malformed_coordinates() {
        assert!(maven_to_path("fabric-loader").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:0.16.9:extra:more").is_err());
        assert!(maven_to_path("").is_err());
        assert!(maven_to_path(":fabric-loader:0.16.9").is_err());
        assert!(maven_to_path("net.fabricmc::0.16.9").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:0.16.9:").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:0.16.9@").is_err());
    }

    #[test]
    fn url_rejects_malformed_coordinates() {
        assert!(maven_to_url("fabric-loader", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc:fabric-loader", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url(":fabric-loader:0.16.9", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc::0.16.9", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc:fabric-loader:", "https://maven.fabricmc.net").is_err());
    }

    #[test]
    fn path_accepts_live_loader_coordinates() {
        for name in [
            "net.minecraftforge:forge:1.20.1-47.3.0:universal",
            "cpw.mods:securejarhandler:2.1.10",
            "net.neoforged.fancymodloader:loader:2.0.4",
            "net.fabricmc:intermediary:1.20.1",
            "net.fabricmc:fabric-loader:0.16.9",
            "org.ow2.asm:asm:9.7",
        ] {
            assert!(
                maven_to_path(name).is_ok(),
                "живая координата из манифеста не должна отклоняться: {name}"
            );
        }
    }

    #[test]
    fn path_rejects_unsafe_coordinates() {
        for name in [
            "..:evil:1.0",
            "../..:evil:1.0",
            "/etc:passwd:1.0",
            "C::evil:1.0",
            "..\\..:evil:1.0",
            "net.fabricmc:..:1.0",
            "net.fabricmc:fabric-loader:..",
            "net.fabricmc:fabric-loader:0.16.9@../../evil.jar",
        ] {
            assert!(
                maven_to_path(name).is_err(),
                "небезопасная координата должна отклоняться: {name}"
            );
        }
    }

    #[test]
    fn url_rejects_unsafe_coordinates() {
        assert!(maven_to_url("..:evil:1.0", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("/etc:passwd:1.0", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("C::evil:1.0", "https://maven.fabricmc.net").is_err());
    }

    #[test]
    fn library_rel_path_rejects_unsafe_name_derived_path() {
        let lib = library_mod("../..:evil:1.0", "");

        let error = library_rel_path(&lib).expect_err("враждебная координата должна отклоняться");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::LoaderSetup(_))
            ),
            "ошибка должна быть LoaderSetup: {error}"
        );
    }

    #[test]
    fn library_rel_path_prefers_manifest_path() {
        let lib = library_mod(
            "org.ow2.asm:asm-util:9.7@jar",
            "org/ow2/asm/asm-util/9.7/asm-util-9.7.jar",
        );

        let path = library_rel_path(&lib).expect("путь библиотеки");

        assert_eq!(
            path,
            std::path::PathBuf::from("org/ow2/asm/asm-util/9.7/asm-util-9.7.jar")
        );
    }

    #[test]
    fn library_rel_path_falls_back_to_name() {
        let lib = library_mod("net.minecraftforge:mergetool:1.1.5:api", "");

        let path = library_rel_path(&lib).expect("путь библиотеки");

        assert_eq!(
            path,
            std::path::PathBuf::from("net/minecraftforge/mergetool/1.1.5/mergetool-1.1.5-api.jar")
        );
    }

    #[test]
    fn library_rel_path_rejects_unsafe_manifest_path() {
        let lib = library_mod("net.fabricmc:fabric-loader:0.16.9", "../escape.jar");

        assert!(
            library_rel_path(&lib).is_err(),
            "путь с выходом за пределы каталога должен отклоняться"
        );
    }

    #[test]
    fn library_rel_path_errors_when_name_unparseable_and_path_empty() {
        let lib = library_mod("fabric-loader", "");

        assert!(library_rel_path(&lib).is_err());
    }
}
