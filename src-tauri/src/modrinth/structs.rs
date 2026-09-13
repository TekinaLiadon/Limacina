use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub offset: u32,
    pub limit: u32,
    #[serde(rename = "total_hits")]
    pub total: u32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SearchHit {
    pub project_id: String,
    pub project_type: String,
    pub slug: Option<String>,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub display_categories: Vec<String>,
    #[serde(default)]
    pub versions: Vec<String>,
    pub downloads: u64,
    pub follows: u64,
    pub icon_url: Option<String>,
    pub date_created: Option<String>,
    pub date_modified: Option<String>,
    pub latest_version: Option<String>,
    pub license: Option<String>,
    pub client_side: Option<String>,
    pub server_side: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModrinthProject {
    pub id: String,
    pub slug: Option<String>,
    pub project_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub follows: u64,
    pub icon_url: Option<String>,
    #[serde(rename(deserialize = "published"))]
    pub date_created: Option<String>,
    #[serde(rename(deserialize = "updated"))]
    pub date_modified: Option<String>,
    pub license: Option<License>,
    pub client_side: Option<String>,
    pub server_side: Option<String>,
    pub source_url: Option<String>,
    pub issues_url: Option<String>,
    pub wiki_url: Option<String>,
    pub discord_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct License {
    pub id: String,
    pub name: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModrinthVersion {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version_number: String,
    pub changelog: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub version_type: String,
    pub date_published: Option<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub files: Vec<ModrinthFile>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Dependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModrinthFile {
    #[serde(default)]
    pub hashes: HashMap<String, String>,
    pub url: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub size: u64,
    pub file_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModrinthManifest {
    #[serde(default)]
    pub mods: HashMap<String, ManifestEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestEntry {
    pub project_id: String,
    pub slug: Option<String>,
    #[serde(default)]
    pub title: String,
    pub icon_url: Option<String>,
    pub filename: String,
    pub sha1: String,
    pub version_id: String,
    pub version_number: String,
}
