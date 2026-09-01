use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::utils::env_info::get_current_os;

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub time: String,
    pub release_time: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub main_class: String,
    #[serde(default)]
    pub inherits_from: String,
    #[serde(default)]
    pub logging: Logging,
    #[serde(default)]
    pub arguments: Arguments,
    pub libraries: Vec<Library>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Logging {
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<Value>,
    #[serde(default)]
    pub jvm: Vec<Value>,
}

impl Arguments {
    pub fn game_strings(&self) -> Vec<String> {
        extract_value_strings(&self.game)
    }

    pub fn jvm_strings(&self) -> Vec<String> {
        extract_value_strings(&self.jvm)
    }
}

fn extract_value_strings(values: &[Value]) -> Vec<String> {
    let mut result = Vec::new();
    for v in values {
        match v {
            Value::String(s) => result.push(s.clone()),
            Value::Object(obj) => {
                if let Some(rules) = obj.get("rules").and_then(|r| r.as_array()) {
                    if !is_rules_allowed(rules) {
                        continue;
                    }
                }
                if let Some(value) = obj.get("value") {
                    match value {
                        Value::String(s) => result.push(s.clone()),
                        Value::Array(arr) => {
                            for item in arr {
                                if let Value::String(s) = item {
                                    result.push(s.clone());
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    result
}

fn is_rules_allowed(rules: &[Value]) -> bool {
    let current_os = get_current_os();
    let mut allowed = false;

    for rule in rules {
        let os_matches = rule
            .get("os")
            .and_then(|os| os.get("name"))
            .and_then(|n| n.as_str())
            .is_none_or(|n| n == current_os);

        let features_match = rule
            .get("features")
            .is_none_or(|_| false);

        if os_matches && features_match {
            allowed = rule.get("action").and_then(|a| a.as_str()) == Some("allow");
        }
    }

    allowed
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub name: String,
    pub downloads: Downloads,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloads {
    pub artifact: Artifact,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub path: String,
    pub url: String,
    pub sha1: String,
    pub size: i64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Metadata {
    pub versioning: Versioning,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Versioning {
    pub latest: String,
    pub release: String,
    pub versions: Versions,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Versions {
    #[serde(rename = "version")]
    pub version_list: Vec<String>,
}
