use anyhow::Result;
use std::path::PathBuf;

fn parse_maven(coord: &str) -> Result<(String, String, String)> {
    let parts: Vec<&str> = coord.split(':').collect();
    let [group_id, artifact_id, version] = parts[..] else {
        anyhow::bail!("Некорректная Maven-координата: {}", coord);
    };
    if group_id.is_empty() || artifact_id.is_empty() || version.is_empty() {
        anyhow::bail!("Некорректная Maven-координата: {}", coord);
    }
    Ok((
        group_id.replace('.', "/"),
        artifact_id.to_string(),
        version.to_string(),
    ))
}

pub fn maven_to_path(name: &str) -> Result<PathBuf> {
    let (group_path, artifact_id, version) = parse_maven(name)?;
    let file_name = format!("{}-{}.jar", artifact_id, version);

    Ok(PathBuf::new()
        .join(&group_path)
        .join(&artifact_id)
        .join(&version)
        .join(&file_name))
}

pub fn maven_to_url(coord: &str, url: &str) -> Result<String> {
    let (group, artifact_id, version) = parse_maven(coord)?;

    Ok(format!(
        "{}/{}/{}/{}/{}-{}.jar",
        url, group, artifact_id, version, artifact_id, version
    ))
}

#[cfg(test)]
mod maven_coords_tests {
    use super::{maven_to_path, maven_to_url};

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
    fn path_rejects_malformed_coordinates() {
        assert!(maven_to_path("fabric-loader").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:0.16.9:extra").is_err());
        assert!(maven_to_path("").is_err());
        assert!(maven_to_path(":fabric-loader:0.16.9").is_err());
        assert!(maven_to_path("net.fabricmc::0.16.9").is_err());
        assert!(maven_to_path("net.fabricmc:fabric-loader:").is_err());
    }

    #[test]
    fn url_rejects_malformed_coordinates() {
        assert!(maven_to_url("fabric-loader", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc:fabric-loader", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url(":fabric-loader:0.16.9", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc::0.16.9", "https://maven.fabricmc.net").is_err());
        assert!(maven_to_url("net.fabricmc:fabric-loader:", "https://maven.fabricmc.net").is_err());
    }
}
