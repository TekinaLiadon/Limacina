use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::de::DeserializeOwned;

use super::structs::{ModrinthProject, ModrinthVersion, SearchResponse};
use crate::log_err;
use crate::utils::errors::LauncherError;

pub const USER_AGENT: &str = concat!(
    "TekinaLiadon/Limacina/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/TekinaLiadon/Limacina)"
);
const API_BASE_PROD: &str = "https://api.modrinth.com/v2";

static API_BASE_OVERRIDE: OnceLock<std::sync::RwLock<Option<String>>> = OnceLock::new();

pub(crate) fn api_base() -> String {
    API_BASE_OVERRIDE
        .get_or_init(|| std::sync::RwLock::new(None))
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or_else(|| API_BASE_PROD.to_string())
}

#[cfg(test)]
pub(crate) fn override_api_base_for_tests(base: String) {
    *API_BASE_OVERRIDE
        .get_or_init(|| std::sync::RwLock::new(None))
        .write()
        .unwrap_or_else(|e| e.into_inner()) = Some(base);
}

#[cfg(test)]
pub(crate) fn clear_response_cache_for_tests() {
    if let Some(mut guard) = response_cache_guard() {
        guard.clear();
    }
}

static MODRINTH_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

pub fn modrinth_client() -> Result<&'static Client> {
    MODRINTH_CLIENT
        .get_or_init(|| {
            crate::utils::http::base_client_builder()
                .user_agent(USER_AGENT)
                .build()
                .map_err(|e| format!("Не удалось создать HTTP клиент Modrinth: {e:#}"))
        })
        .as_ref()
        .map_err(|e| anyhow!(e.clone()))
}

fn json_param(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string())
}

const CACHE_TTL: Duration = Duration::from_secs(300);
const CACHE_MAX_ENTRIES: usize = 256;
const CACHE_MAX_TOTAL_BYTES: usize = 4 * 1024 * 1024;

type ResponseCache = HashMap<String, (std::time::Instant, serde_json::Value, usize)>;

fn response_cache() -> &'static std::sync::Mutex<ResponseCache> {
    static CACHE: OnceLock<std::sync::Mutex<ResponseCache>> = OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn response_cache_guard() -> Option<std::sync::MutexGuard<'static, ResponseCache>> {
    match response_cache().lock() {
        Ok(guard) => Some(guard),
        Err(e) => {
            log_err!(
                "[modrinth] Не удалось получить доступ к кешу ответов: {}",
                e
            );
            None
        }
    }
}

fn json_size(value: &serde_json::Value) -> usize {
    match value {
        serde_json::Value::Null => 4,
        serde_json::Value::Bool(_) => 4,
        serde_json::Value::Number(n) => n.to_string().len(),
        serde_json::Value::String(s) => s.len() + 2,
        serde_json::Value::Array(items) => {
            2 + items.len() + items.iter().map(json_size).sum::<usize>()
        }
        serde_json::Value::Object(map) => {
            2 + map
                .iter()
                .map(|(key, value)| key.len() + 4 + json_size(value))
                .sum::<usize>()
        }
    }
}

fn cache_insert(cache_key: String, value: serde_json::Value) {
    let Some(mut guard) = response_cache_guard() else {
        return;
    };
    let size = json_size(&value);
    if size > CACHE_MAX_TOTAL_BYTES {
        return;
    }
    guard.retain(|_, (stored_at, _, _)| stored_at.elapsed() < CACHE_TTL);
    let mut total_bytes: usize = guard.values().map(|(_, _, s)| *s).sum();
    while guard.len() >= CACHE_MAX_ENTRIES || total_bytes + size > CACHE_MAX_TOTAL_BYTES {
        let Some(oldest) = guard
            .iter()
            .min_by_key(|(_, (stored_at, _, _))| *stored_at)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        if let Some((_, _, removed_size)) = guard.remove(&oldest) {
            total_bytes = total_bytes.saturating_sub(removed_size);
        }
    }
    guard.insert(cache_key, (std::time::Instant::now(), value, size));
}

async fn send_and_check(request: reqwest::RequestBuilder, url: &str) -> Result<reqwest::Response> {
    let response = request.send().await.map_err(|e| {
        LauncherError::Modrinth(format!("Не удалось отправить запрос на {url}: {e:#}"))
    })?;
    let response = response
        .error_for_status()
        .map_err(|e| LauncherError::Modrinth(format!("Modrinth вернул ошибку для {url}: {e:#}")))?;
    Ok(response)
}
async fn get_json<T: DeserializeOwned>(path: &str, query: &[(&str, String)]) -> Result<T> {
    let url = format!("{}{}", api_base(), path);
    let cache_key = build_cache_key(path, query);

    if let Some(guard) = response_cache_guard() {
        if let Some((stored_at, value, _)) = guard.get(&cache_key).cloned() {
            if stored_at.elapsed() < CACHE_TTL {
                return serde_json::from_value(value).map_err(|e| {
                    LauncherError::Modrinth(format!(
                        "Не удалось разобрать кешированный ответ от {url}: {e:#}"
                    ))
                    .into()
                });
            }
        }
    }

    let client = modrinth_client()?;
    let response = send_and_check(client.get(&url).query(query), &url).await?;
    let value: serde_json::Value = response.json().await.map_err(|e| {
        LauncherError::Modrinth(format!("Не удалось прочитать ответ от {url}: {e:#}"))
    })?;

    cache_insert(cache_key, value.clone());

    serde_json::from_value(value).map_err(|e| {
        LauncherError::Modrinth(format!("Не удалось разобрать ответ от {url}: {e:#}")).into()
    })
}

fn build_cache_key(path: &str, query: &[(&str, String)]) -> String {
    let query_json = serde_json::to_string(query).unwrap_or_default();
    format!("GET {}{} {}", api_base(), path, query_json)
}

pub async fn search(
    query: &str,
    facets: &[Vec<String>],
    index: &str,
    offset: u32,
    limit: u32,
) -> Result<SearchResponse> {
    let facets_json = serde_json::to_string(facets)
        .map_err(|e| LauncherError::Modrinth(format!("Не удалось сериализовать фильтры: {e:#}")))?;
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

fn loaders_game_versions_query(
    loaders: &[String],
    game_versions: &[String],
) -> Vec<(&'static str, String)> {
    let mut query: Vec<(&'static str, String)> = Vec::new();
    if !loaders.is_empty() {
        query.push(("loaders", json_param(loaders)));
    }
    if !game_versions.is_empty() {
        query.push(("game_versions", json_param(game_versions)));
    }
    query
}

pub async fn get_project_versions(
    id_or_slug: &str,
    loaders: &[String],
    game_versions: &[String],
) -> Result<Vec<ModrinthVersion>> {
    let query = loaders_game_versions_query(loaders, game_versions);
    get_json(&format!("/project/{}/version", id_or_slug), &query).await
}

pub async fn get_version(version_id: &str) -> Result<ModrinthVersion> {
    get_json(&format!("/version/{}", version_id), &[]).await
}

pub async fn get_versions(version_ids: &[String]) -> Result<Vec<ModrinthVersion>> {
    get_json("/versions", &[("ids", json_param(version_ids))]).await
}

async fn post_version_files(
    path: &str,
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
    let url = format!("{}{}", api_base(), path);
    let client = modrinth_client()?;
    let response = send_and_check(client.post(&url).json(&body), &url).await?;
    response.json().await.map_err(|e| {
        LauncherError::Modrinth(format!("Не удалось прочитать ответ от {url}: {e:#}")).into()
    })
}

pub async fn get_versions_from_hashes(
    hashes: &[String],
    loaders: &[String],
    game_versions: &[String],
) -> Result<HashMap<String, ModrinthVersion>> {
    post_version_files("/version_files", hashes, loaders, game_versions).await
}

pub async fn get_version_updates_from_hashes(
    hashes: &[String],
    loaders: &[String],
    game_versions: &[String],
) -> Result<HashMap<String, ModrinthVersion>> {
    post_version_files("/version_files/update", hashes, loaders, game_versions).await
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

    #[test]
    fn user_agent_contains_package_version() {
        assert!(USER_AGENT.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn cache_keys_isolate_queries_with_special_characters() {
        let with_special = build_cache_key("/search", &[("query", "a&facets=b".to_string())]);
        let split = build_cache_key(
            "/search",
            &[("query", "a".to_string()), ("facets", "b".to_string())],
        );

        assert_ne!(
            with_special, split,
            "значение с &/= не должно давать чужой ключ кеша"
        );
        assert_eq!(
            with_special,
            build_cache_key("/search", &[("query", "a&facets=b".to_string())]),
            "одинаковые запросы дают одинаковый ключ"
        );
    }

    #[test]
    fn response_cache_caps_size_and_drops_expired() {
        clear_cache();
        {
            let mut guard = response_cache_guard().expect("кеш ответов");
            guard.insert(
                "cache-evict-expired".to_string(),
                (std::time::Instant::now() - 2 * CACHE_TTL, json!("old"), 1),
            );
        }
        for i in 0..CACHE_MAX_ENTRIES {
            cache_insert(format!("cache-evict-{i}"), json!(i));
        }

        let guard = response_cache_guard().expect("кеш ответов");
        assert!(
            !guard.contains_key("cache-evict-expired"),
            "просроченная запись должна вытесняться при вставке"
        );
        assert!(
            guard.len() <= CACHE_MAX_ENTRIES,
            "кеш не должен расти неограниченно: {}",
            guard.len()
        );
    }

    #[test]
    fn response_cache_caps_total_byte_budget() {
        clear_cache();

        let oversized = serde_json::Value::String("x".repeat(CACHE_MAX_TOTAL_BYTES + 1));
        cache_insert("cache-oversized".to_string(), oversized);
        {
            let guard = response_cache_guard().expect("кеш ответов");
            assert!(
                !guard.contains_key("cache-oversized"),
                "ответ крупнее всего бюджета не кешируется"
            );
        }

        let entry = serde_json::Value::String("y".repeat(CACHE_MAX_TOTAL_BYTES / 4));
        for i in 0..20 {
            cache_insert(format!("cache-budget-{i}"), entry.clone());
        }

        let guard = response_cache_guard().expect("кеш ответов");
        let total_bytes: usize = guard.values().map(|(_, _, size)| *size).sum();
        assert!(
            total_bytes <= CACHE_MAX_TOTAL_BYTES,
            "суммарный размер кеша {total_bytes} превышает бюджет {CACHE_MAX_TOTAL_BYTES}"
        );
        assert!(
            guard.len() >= 3,
            "бюджет не должен выметать кеш целиком: {}",
            guard.len()
        );
    }
}
