use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

pub const MODEL_HEADER: u8 = 0x53;
pub const SKIN_TYPE_SLIM: u8 = 0;
pub const SKIN_TYPE_DEFAULT: u8 = 1;

const PART_END: u8 = 0;
const PART_SKIN_TYPE: u8 = 11;
const PART_DEFINITION_LINK: u8 = 4;
const LINK_MAX_LEN: usize = 255;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CpmModelEntry {
    pub id: Option<i64>,
    pub file: String,
    pub name: String,
    pub url: Option<String>,
    pub skin_type: Option<u8>,
    pub offline: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CpmModelManifest {
    #[serde(default)]
    pub models: Vec<CpmModelEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RebindDecision {
    Keep,
    Select(String),
    Clear,
}

fn write_varint(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push(((value & 0x7F) as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn write_utf(out: &mut Vec<u8>, s: &str) {
    write_varint(out, s.len() as u32);
    out.extend_from_slice(s.as_bytes());
}

fn with_checksum(body: &[u8]) -> Vec<u8> {
    let mut sum: u32 = 0;
    for &b in body {
        sum = (sum + b as u32) & 0xFFFF;
    }
    let mut out = Vec::with_capacity(body.len() + 3);
    out.push(MODEL_HEADER);
    out.extend_from_slice(body);
    out.push((sum >> 8) as u8);
    out.push((sum & 0xFF) as u8);
    out
}

pub fn build_link_definition(url: &str, skin_type: u8) -> Result<Vec<u8>> {
    let link = format!("raw:{url}");
    let link_bytes = link.as_bytes();
    if link_bytes.len() > LINK_MAX_LEN {
        bail!(
            "Слишком длинная ссылка на модель: {} байт, максимум {}",
            link_bytes.len(),
            LINK_MAX_LEN
        );
    }

    let mut body = Vec::new();
    body.push(PART_SKIN_TYPE);
    write_varint(&mut body, 1);
    body.push(skin_type);
    body.push(PART_DEFINITION_LINK);
    write_varint(&mut body, link_bytes.len() as u32 + 1);
    body.push(link_bytes.len() as u8);
    body.extend_from_slice(link_bytes);
    body.push(PART_END);
    write_varint(&mut body, 0);
    Ok(with_checksum(&body))
}

pub fn build_player_model_file(name: &str, data_block: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    write_utf(&mut body, name);
    write_utf(&mut body, "");
    write_varint(&mut body, data_block.len() as u32);
    body.extend_from_slice(data_block);
    write_varint(&mut body, 0);
    write_varint(&mut body, 0);
    with_checksum(&body)
}

pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed: String = cleaned.trim().chars().take(48).collect();
    let trimmed = trimmed.trim_end().to_string();
    if trimmed.is_empty() {
        "model".to_string()
    } else {
        trimmed
    }
}

pub fn parse_cpm_config(content: Option<&str>) -> serde_json::Map<String, serde_json::Value> {
    match content {
        Some(content) => serde_json::from_str(content).unwrap_or_default(),
        None => Default::default(),
    }
}

pub fn merge_selected_model(content: Option<&str>, file_name: &str) -> Result<Option<String>> {
    let mut root = parse_cpm_config(content);
    if root.get("selectedModel").and_then(|v| v.as_str()) == Some(file_name) {
        return Ok(None);
    }
    root.insert(
        "selectedModel".to_string(),
        serde_json::Value::String(file_name.to_string()),
    );
    Ok(Some(serde_json::to_string_pretty(&root)?))
}

pub fn remove_selected_model(content: Option<&str>) -> Result<Option<String>> {
    let Some(content) = content else {
        return Ok(None);
    };
    let mut root = parse_cpm_config(Some(content));
    if !root.contains_key("selectedModel") {
        return Ok(None);
    }
    root.remove("selectedModel");
    Ok(Some(serde_json::to_string_pretty(&root)?))
}

pub fn pick_eviction_index(manifest: &CpmModelManifest, selected: Option<&str>) -> Option<usize> {
    let is_protected = |entry: &CpmModelEntry| selected.is_some_and(|file| entry.file == file);
    manifest
        .models
        .iter()
        .enumerate()
        .find(|(_, entry)| !entry.offline && !is_protected(entry))
        .map(|(index, _)| index)
        .or_else(|| {
            manifest
                .models
                .iter()
                .enumerate()
                .find(|(_, entry)| !is_protected(entry))
                .map(|(index, _)| index)
        })
}

pub fn rebind_selection(
    manifest: &CpmModelManifest,
    selected: Option<&str>,
    selected_exists: bool,
    added_new: bool,
) -> RebindDecision {
    let stale = selected.is_some() && !selected_exists;
    let needs_rebind = stale || (selected.is_none() && added_new);
    if !needs_rebind {
        return RebindDecision::Keep;
    }
    match manifest
        .models
        .iter()
        .filter(|model| !model.offline)
        .next_back()
    {
        Some(entry) => RebindDecision::Select(entry.file.clone()),
        None if stale => RebindDecision::Clear,
        None => RebindDecision::Keep,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::cpm_model_entry;

    #[test]
    fn merge_creates_config_with_selection_when_missing() {
        let merged = merge_selected_model(None, "limacina_local_test.cpmmodel")
            .unwrap()
            .unwrap();
        let root: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&merged).unwrap();
        assert_eq!(root["selectedModel"], "limacina_local_test.cpmmodel");
    }

    #[test]
    fn merge_preserves_existing_keys() {
        let existing = r#"{"keybinds": {"glide": "KEY_G"}, "selectedModel": "old.cpmmodel"}"#;
        let merged = merge_selected_model(Some(existing), "new.cpmmodel")
            .unwrap()
            .unwrap();
        let root: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&merged).unwrap();
        assert_eq!(root["selectedModel"], "new.cpmmodel");
        assert_eq!(root["keybinds"]["glide"], "KEY_G");
    }

    #[test]
    fn merge_skips_write_when_selection_unchanged() {
        let existing = r#"{"selectedModel": "same.cpmmodel"}"#;
        assert!(merge_selected_model(Some(existing), "same.cpmmodel")
            .unwrap()
            .is_none());
    }

    #[test]
    fn merge_recovers_from_corrupt_config() {
        let merged = merge_selected_model(Some("{ not json"), "new.cpmmodel")
            .unwrap()
            .unwrap();
        let root: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&merged).unwrap();
        assert_eq!(root["selectedModel"], "new.cpmmodel");
    }

    #[test]
    fn remove_selected_model_keeps_other_keys() {
        let existing = r#"{"keybinds": {"glide": "KEY_G"}, "selectedModel": "old.cpmmodel"}"#;
        let updated = remove_selected_model(Some(existing)).unwrap().unwrap();
        let root: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&updated).unwrap();
        assert!(root.get("selectedModel").is_none());
        assert!(root.get("keybinds").is_some());
    }

    #[test]
    fn remove_selected_model_is_noop_without_key_or_content() {
        assert!(remove_selected_model(Some(r#"{"keybinds": {}}"#))
            .unwrap()
            .is_none());
        assert!(remove_selected_model(None).unwrap().is_none());
        assert!(remove_selected_model(Some("{ not json")).unwrap().is_none());
    }

    #[test]
    fn manifest_limit_defaults_to_unlimited() {
        let manifest: CpmModelManifest = serde_json::from_str("{}").unwrap();
        assert_eq!(manifest.limit, None);
        let manifest: CpmModelManifest = serde_json::from_str(r#"{"limit": 3}"#).unwrap();
        assert_eq!(manifest.limit, Some(3));
    }

    fn eviction_of(models: Vec<CpmModelEntry>, selected: Option<&str>) -> Option<usize> {
        let manifest = CpmModelManifest {
            models,
            limit: None,
        };
        pick_eviction_index(&manifest, selected)
    }

    #[test]
    fn eviction_prefers_oldest_online_entry() {
        let models = vec![
            cpm_model_entry(Some(1), "a.cpmmodel", false),
            cpm_model_entry(None, "local.cpmmodel", true),
            cpm_model_entry(Some(2), "c.cpmmodel", false),
        ];
        assert_eq!(eviction_of(models, Some("c.cpmmodel")), Some(0));
    }

    #[test]
    fn eviction_skips_selected_and_falls_back_to_offline() {
        let models = vec![
            cpm_model_entry(None, "local.cpmmodel", true),
            cpm_model_entry(Some(2), "c.cpmmodel", false),
        ];
        assert_eq!(eviction_of(models, Some("c.cpmmodel")), Some(0));
    }

    #[test]
    fn eviction_returns_none_when_only_selected_remains() {
        let models = vec![cpm_model_entry(Some(1), "only.cpmmodel", false)];
        assert_eq!(eviction_of(models, Some("only.cpmmodel")), None);
    }

    #[test]
    fn rebind_keeps_existing_valid_selection() {
        let manifest = CpmModelManifest {
            models: vec![
                cpm_model_entry(Some(1), "a.cpmmodel", false),
                cpm_model_entry(Some(2), "b.cpmmodel", false),
            ],
            limit: None,
        };
        assert_eq!(
            rebind_selection(&manifest, Some("a.cpmmodel"), true, true),
            RebindDecision::Keep
        );
        assert_eq!(
            rebind_selection(&manifest, Some("a.cpmmodel"), true, false),
            RebindDecision::Keep
        );
    }

    #[test]
    fn rebind_selects_newest_when_nothing_selected_and_models_added() {
        let manifest = CpmModelManifest {
            models: vec![
                cpm_model_entry(Some(1), "a.cpmmodel", false),
                cpm_model_entry(Some(2), "b.cpmmodel", false),
            ],
            limit: None,
        };
        assert_eq!(
            rebind_selection(&manifest, None, false, true),
            RebindDecision::Select("b.cpmmodel".to_string())
        );
    }

    #[test]
    fn rebind_ignores_offline_entries_when_reselecting() {
        let manifest = CpmModelManifest {
            models: vec![cpm_model_entry(None, "local.cpmmodel", true)],
            limit: None,
        };
        assert_eq!(
            rebind_selection(&manifest, None, false, true),
            RebindDecision::Keep
        );
    }

    #[test]
    fn rebind_selects_newest_when_selection_stale() {
        let manifest = CpmModelManifest {
            models: vec![
                cpm_model_entry(Some(1), "a.cpmmodel", false),
                cpm_model_entry(Some(2), "b.cpmmodel", false),
            ],
            limit: None,
        };
        assert_eq!(
            rebind_selection(&manifest, Some("gone.cpmmodel"), false, false),
            RebindDecision::Select("b.cpmmodel".to_string())
        );
    }

    #[test]
    fn rebind_clears_stale_selection_without_candidates() {
        let manifest = CpmModelManifest::default();
        assert_eq!(
            rebind_selection(&manifest, Some("gone.cpmmodel"), false, false),
            RebindDecision::Clear
        );
    }

    #[test]
    fn link_definition_encodes_stub_block() {
        let data = build_link_definition("https://example.com/m/1", SKIN_TYPE_SLIM).unwrap();
        assert_eq!(
            PART_DEFINITION_LINK, 4,
            "ModelPartType.DEFINITION_LINK ordinal"
        );
        assert_eq!(data[0], MODEL_HEADER);
        assert_eq!(&data[1..4], &[PART_SKIN_TYPE, 1, SKIN_TYPE_SLIM]);
        let link = b"raw:https://example.com/m/1";
        assert_eq!(data[4], PART_DEFINITION_LINK);
        assert_eq!(data[5] as usize, link.len() + 1);
        assert_eq!(data[6] as usize, link.len());
        assert_eq!(&data[7..7 + link.len()], link);
        assert_eq!(&data[7 + link.len()..7 + link.len() + 2], &[PART_END, 0]);
    }

    #[test]
    fn link_definition_rejects_oversized_url() {
        let url = format!("https://example.com/{}", "a".repeat(300));
        assert!(build_link_definition(&url, SKIN_TYPE_DEFAULT).is_err());
    }

    #[test]
    fn player_model_file_checksum_covers_body_without_header() {
        let container = build_player_model_file("Test", &[1, 2, 3]);
        assert_eq!(container[0], MODEL_HEADER);
        let body = &container[1..container.len() - 2];
        let mut sum: u32 = 0;
        for &b in body {
            sum = (sum + b as u32) & 0xFFFF;
        }
        assert_eq!(container[container.len() - 2], (sum >> 8) as u8);
        assert_eq!(container[container.len() - 1], (sum & 0xFF) as u8);
    }
}
