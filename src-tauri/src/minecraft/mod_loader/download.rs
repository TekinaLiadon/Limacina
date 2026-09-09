use anyhow::Result;

use crate::minecraft::mod_loader::utils::maven_to_path;
use crate::minecraft::structs::LibraryMod;
use crate::utils::integrity::{HashKind, IntegrityTarget, TargetDownload};

pub fn library_targets(libraries: &[LibraryMod]) -> Result<Vec<IntegrityTarget>> {
    libraries
        .iter()
        .map(|lib| {
            Ok(IntegrityTarget {
                rel_path: maven_to_path(&lib.name)?,
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
            url: url.to_string(),
            hash: hash.to_string(),
            size: 1,
        }
    }

    #[test]
    fn targets_map_maven_coordinates_to_rel_paths() {
        let targets = library_targets(&[
            lib("net.fabricmc:fabric-loader:0.16.9", "https://maven.fabricmc.net", "abc"),
        ])
        .expect("валидные библиотеки");

        assert_eq!(targets.len(), 1);
        assert_eq!(
            targets[0].rel_path,
            std::path::PathBuf::from("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar")
        );
        assert_eq!(targets[0].hash, "abc");
    }

    #[test]
    fn targets_reject_malformed_library_names() {
        let targets = library_targets(&[lib("fabric-loader", "https://maven.fabricmc.net", "abc")]);
        assert!(targets.is_err());
    }
}
