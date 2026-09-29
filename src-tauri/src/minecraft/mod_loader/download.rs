use anyhow::Result;
use std::path::PathBuf;

use crate::minecraft::mod_loader::utils::library_rel_path;
use crate::minecraft::structs::LibraryMod;
use crate::utils::integrity::{HashKind, IntegrityTarget, TargetDownload};

pub fn library_targets(libraries: &[LibraryMod]) -> Result<Vec<IntegrityTarget>> {
    libraries
        .iter()
        .map(|lib| {
            Ok(IntegrityTarget {
                rel_path: PathBuf::from("libraries").join(library_rel_path(lib)?),
                hash: lib.hash.clone(),
                hash_kind: HashKind::Sha1,
                download: TargetDownload::Url(lib.url.clone()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib(name: &str, url: &str, hash: &str) -> LibraryMod {
        LibraryMod {
            name: name.to_string(),
            path: String::new(),
            url: url.to_string(),
            hash: hash.to_string(),
            size: 1,
        }
    }

    fn lib_with_path(name: &str, path: &str, url: &str) -> LibraryMod {
        LibraryMod {
            name: name.to_string(),
            path: path.to_string(),
            url: url.to_string(),
            hash: "abc".to_string(),
            size: 1,
        }
    }

    #[test]
    fn targets_map_maven_coordinates_to_rel_paths() {
        let targets = library_targets(&[lib(
            "net.fabricmc:fabric-loader:0.16.9",
            "https://maven.fabricmc.net",
            "abc",
        )])
        .expect("валидные библиотеки");

        assert_eq!(targets.len(), 1);
        assert_eq!(
            targets[0].rel_path,
            std::path::PathBuf::from(
                "libraries/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"
            )
        );
        assert_eq!(targets[0].hash, "abc");
    }

    #[test]
    fn targets_prefer_manifest_path_over_name() {
        let targets = library_targets(&[lib_with_path(
            "org.ow2.asm:asm-util:9.7@jar",
            "org/ow2/asm/asm-util/9.7/asm-util-9.7.jar",
            "https://maven.neoforged.net/release/org/ow2/asm/asm-util/9.7/asm-util-9.7.jar",
        )])
        .expect("валидные библиотеки");

        assert_eq!(
            targets[0].rel_path,
            std::path::PathBuf::from("libraries/org/ow2/asm/asm-util/9.7/asm-util-9.7.jar")
        );
    }

    #[test]
    fn targets_support_classifier_names_without_manifest_path() {
        let targets = library_targets(&[lib(
            "net.minecraftforge:mergetool:1.1.5:api",
            "https://maven.minecraftforge.net",
            "abc",
        )])
        .expect("валидные библиотеки");

        assert_eq!(
            targets[0].rel_path,
            std::path::PathBuf::from(
                "libraries/net/minecraftforge/mergetool/1.1.5/mergetool-1.1.5-api.jar"
            )
        );
    }

    #[test]
    fn targets_reject_malformed_library_names() {
        let targets = library_targets(&[lib("fabric-loader", "https://maven.fabricmc.net", "abc")]);
        assert!(targets.is_err());
    }

    #[test]
    fn targets_reject_unsafe_manifest_paths() {
        let targets = library_targets(&[lib_with_path(
            "net.fabricmc:fabric-loader:0.16.9",
            "../escape.jar",
            "https://maven.fabricmc.net",
        )]);
        assert!(targets.is_err());
    }
}
