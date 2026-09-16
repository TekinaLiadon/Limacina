use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::Client;
use serde::de::DeserializeOwned;

use super::structs::{ModrinthProject, ModrinthVersion, SearchResponse};
use crate::log_err;

pub const USER_AGENT: &str =
    "TekinaLiadon/Limacina/1.4.0 (https://github.com/TekinaLiadon/Limacina)";
const API_BASE_PROD: &str = "https://api.modrinth.com/v2";

static API_BASE_OVERRIDE: OnceLock<std::sync::RwLock<Option<String>>> = OnceLock::new();

pub(crate) fn api_base() -> String {
    API_BASE_OVERRIDE
        .get_or_init(|| std::sync::RwLock::new(None))
        .read()
        .unwrap()
        .clone()
        .unwrap_or_else(|| API_BASE_PROD.to_string())
}

#[cfg(test)]
pub(crate) fn override_api_base_for_tests(base: String) {
    *API_BASE_OVERRIDE
        .get_or_init(|| std::sync::RwLock::new(None))
        .write()
        .unwrap() = Some(base);
}

#[cfg(test)]
pub(crate) fn clear_response_cache_for_tests() {
    response_cache().lock().unwrap().clear();
}

static MODRINTH_CLIENT: OnceLock<Client> = OnceLock::new();

pub fn modrinth_client() -> &'static Client {
    MODRINTH_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .user_agent(USER_AGENT)
            .build()
            .expect("Не удалось создать HTTP клиент Modrinth")
    })
}

fn json_param(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string())
}

const CACHE_TTL: Duration = Duration::from_secs(300);

type ResponseCache = HashMap<String, (std::time::Instant, serde_json::Value)>;

fn response_cache() -> &'static std::sync::Mutex<ResponseCache> {
    static CACHE: OnceLock<std::sync::Mutex<ResponseCache>> = OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn response_cache_guard() -> Option<std::sync::MutexGuard<'static, ResponseCache>> {
    match response_cache().lock() {
        Ok(guard) => Some(guard),
        Err(e) => {
            log_err!("[modrinth] Не удалось получить доступ к кешу ответов: {}", e);
            None
        }
    }
}

async fn get_json<T: DeserializeOwned>(path: &str, query: &[(&str, String)]) -> Result<T> {
    let url = format!("{}{}", api_base(), path);
    let cache_key = format!("GET {url} {}", json_param_str(query));

    if let Some(guard) = response_cache_guard() {
        if let Some((stored_at, value)) = guard.get(&cache_key).cloned() {
            if stored_at.elapsed() < CACHE_TTL {
                return serde_json::from_value(value)
                    .with_context(|| format!("Не удалось разобрать кешированный ответ от {}", url));
            }
        }
    }

    let response = modrinth_client()
        .get(&url)
        .query(query)
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}", url))?;
    let response = response
        .error_for_status()
        .with_context(|| format!("Modrinth вернул ошибку для {}", url))?;
    let value: serde_json::Value = response
        .json()
        .await
        .with_context(|| format!("Не удалось прочитать ответ от {}", url))?;

    if let Some(mut guard) = response_cache_guard() {
        guard.insert(cache_key, (std::time::Instant::now(), value.clone()));
    }

    serde_json::from_value(value).with_context(|| format!("Не удалось разобрать ответ от {}", url))
}

fn json_param_str(query: &[(&str, String)]) -> String {
    query
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

pub async fn search(
    query: &str,
    facets: &[Vec<String>],
    index: &str,
    offset: u32,
    limit: u32,
) -> Result<SearchResponse> {
    let facets_json = serde_json::to_string(facets).context("Не удалось сериализовать фильтры")?;
    get_json(
        "/search",
        &[
            ("query", query.to_string()),
            ("facets", facets_json),
            ("index", index.to_string()),
            ("offset", offset.to_string()),
            ("limit", limit.to_string()),
        ],
    )
    .await
}

pub async fn get_project(id_or_slug: &str) -> Result<ModrinthProject> {
    get_json(&format!("/project/{}", id_or_slug), &[]).await
}

pub async fn get_projects(ids: &[String]) -> Result<Vec<ModrinthProject>> {
    get_json("/projects", &[("ids", json_param(ids))]).await
}

pub async fn get_project_versions(
    id_or_slug: &str,
    loaders: &[String],
    game_versions: &[String],
) -> Result<Vec<ModrinthVersion>> {
    let mut query: Vec<(&str, String)> = Vec::new();
    if !loaders.is_empty() {
        query.push(("loaders", json_param(loaders)));
    }
    if !game_versions.is_empty() {
        query.push(("game_versions", json_param(game_versions)));
    }
    get_json(&format!("/project/{}/version", id_or_slug), &query).await
}

pub async fn get_version(version_id: &str) -> Result<ModrinthVersion> {
    get_json(&format!("/version/{}", version_id), &[]).await
}

pub async fn get_versions(version_ids: &[String]) -> Result<Vec<ModrinthVersion>> {
    get_json("/versions", &[("ids", json_param(version_ids))]).await
}

pub async fn get_version_from_hash(
    sha1: &str,
    loaders: &[String],
    game_versions: &[String],
) -> Result<Option<ModrinthVersion>> {
    let mut query: Vec<(&str, String)> = Vec::new();
    if !loaders.is_empty() {
        query.push(("loaders", json_param(loaders)));
    }
    if !game_versions.is_empty() {
        query.push(("game_versions", json_param(game_versions)));
    }
    let url = format!("{}/version_file/{}/update", api_base(), sha1);
    let response = modrinth_client()
        .get(&url)
        .query(&query)
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}", url))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let response = response
        .error_for_status()
        .with_context(|| format!("Modrinth вернул ошибку для {}", url))?;
    let version = response
        .json()
        .await
        .with_context(|| format!("Не удалось прочитать ответ от {}", url))?;
    Ok(Some(version))
}

pub async fn get_versions_from_hashes(
    hashes: &[String],
    loaders: &[String],
    game_versions: &[String],
) -> Result<HashMap<String, ModrinthVersion>> {
    #[derive(serde::Serialize)]
    struct HashesQuery<'a> {
        hashes: &'a [String],
        algorithm: &'a str,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        loaders: Vec<String>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        game_versions: Vec<String>,
    }

    let body = HashesQuery {
        hashes,
        algorithm: "sha1",
        loaders: loaders.to_vec(),
        game_versions: game_versions.to_vec(),
    };
    let url = format!("{}/version_files", api_base());
    let response = modrinth_client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .with_context(|| format!("Не удалось отправить запрос на {}", url))?;
    let response = response
        .error_for_status()
        .with_context(|| format!("Modrinth вернул ошибку для {}", url))?;
    response
        .json()
        .await
        .with_context(|| format!("Не удалось прочитать ответ от {}", url))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modrinth::client::clear_response_cache_for_tests as clear_cache;
    use crate::modrinth::structs::ModrinthProject;
    use crate::test_support::LauncherDirGuard;
    use mockito::Server;
    use serde_json::json;

    #[tokio::test]
    async fn get_project_maps_published_dates() {
        let _dir = LauncherDirGuard::acquire("modrinth_project_dates").await;
        let mut server = Server::new_async().await;
        override_api_base_for_tests(format!("{}/v2", server.url()));
        clear_cache();

        server
            .mock("GET", "/v2/project/AANobbMI")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_body(
                json!({
                    "id": "AANobbMI",
                    "project_type": "mod",
                    "title": "Sodium",
                    "published": "2021-01-03T00:53:34.185936Z",
                    "updated": "2026-09-12T22:49:42.621484Z"
                })
                .to_string(),
            )
            .create_async()
            .await;

        let project: ModrinthProject = get_project("AANobbMI").await.expect("проект");
        assert_eq!(
            project.date_created.as_deref(),
            Some("2021-01-03T00:53:34.185936Z")
        );
        assert_eq!(
            project.date_modified.as_deref(),
            Some("2026-09-12T22:49:42.621484Z")
        );
    }
}
