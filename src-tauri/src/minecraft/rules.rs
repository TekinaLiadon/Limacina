use crate::minecraft::vanilla::structs::Rule;
use crate::utils::env_info::{get_arch, get_current_os};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleAction {
    Allow,
    Disallow,
}

#[derive(Debug, Clone)]
pub struct RuleCore {
    pub action: RuleAction,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub features: Option<HashMap<String, bool>>,
}

impl RuleCore {
    fn matches_os(&self) -> bool {
        let name_ok = self
            .os
            .as_deref()
            .is_none_or(|name| name == get_current_os());
        let arch_ok = self.arch.as_deref().is_none_or(|arch| arch == get_arch());
        name_ok && arch_ok
    }

    fn has_features(&self) -> bool {
        self.features.is_some()
    }
}

fn evaluate(rules: &[RuleCore]) -> bool {
    let mut allowed = false;
    for rule in rules {
        if rule.matches_os() && !rule.has_features() {
            allowed = rule.action == RuleAction::Allow;
        }
    }
    allowed
}

pub fn is_core_rules_allowed(rules: Option<&[RuleCore]>) -> bool {
    rules.is_none_or(evaluate)
}

pub fn is_typed_rule_allowed(rules: Option<&[Rule]>) -> bool {
    let cores: Option<Vec<RuleCore>> = rules.map(|rules| rules.iter().map(rule_to_core).collect());
    is_core_rules_allowed(cores.as_deref())
}

fn rule_to_core(rule: &Rule) -> RuleCore {
    RuleCore {
        action: match rule.action.as_str() {
            "allow" => RuleAction::Allow,
            _ => RuleAction::Disallow,
        },
        os: rule.os.as_ref().and_then(|os| os.name.clone()),
        arch: rule.os.as_ref().and_then(|os| os.arch.clone()),
        features: rule.features.clone(),
    }
}

pub fn is_json_rules_allowed(rules: &[Value]) -> bool {
    let cores: Vec<RuleCore> = rules.iter().map(json_rule_to_core).collect();
    evaluate(&cores)
}

fn json_rule_to_core(rule: &Value) -> RuleCore {
    RuleCore {
        action: match rule.get("action").and_then(|a| a.as_str()) {
            Some("allow") => RuleAction::Allow,
            _ => RuleAction::Disallow,
        },
        os: rule
            .get("os")
            .and_then(|os| os.get("name"))
            .and_then(|n| n.as_str())
            .map(String::from),
        arch: rule
            .get("os")
            .and_then(|os| os.get("arch"))
            .and_then(|a| a.as_str())
            .map(String::from),
        features: rule.get("features").and_then(|f| {
            f.as_object().map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_bool().map(|b| (k.clone(), b)))
                    .collect()
            })
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::is_json_rules_allowed;
    use crate::utils::env_info::get_arch;
    use serde_json::json;

    fn allow_with_os(os: serde_json::Value) -> bool {
        is_json_rules_allowed(&[json!({ "action": "allow", "os": os })])
    }

    #[test]
    fn matching_arch_is_allowed() {
        assert!(allow_with_os(json!({ "arch": get_arch() })));
    }

    #[test]
    fn mismatched_arch_is_ignored() {
        let other = if get_arch() == "x86" { "x86_64" } else { "x86" };
        assert!(
            !allow_with_os(json!({ "arch": other })),
            "правило с чужой архитектурой не должно пропускаться"
        );
    }

    #[test]
    fn rules_without_arch_are_unaffected() {
        assert!(allow_with_os(json!({})));
        assert_eq!(
            allow_with_os(json!({ "name": "osx" })),
            cfg!(target_os = "macos")
        );
    }
}
