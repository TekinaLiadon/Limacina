use crate::minecraft::rules::is_typed_rule_allowed;
use crate::minecraft::vanilla::structs::Rule;

pub fn is_rule_allowed(rules: Option<&[Rule]>) -> bool {
    is_typed_rule_allowed(rules)
}

#[cfg(test)]
mod tests {
    use super::is_rule_allowed;
    use crate::minecraft::vanilla::structs::{OsRule, Rule};
    use crate::utils::env_info::get_current_os;
    use std::collections::HashMap;

    fn rule(action: &str, os: Option<OsRule>, features: Option<HashMap<String, bool>>) -> Rule {
        Rule {
            action: action.to_string(),
            os,
            features,
        }
    }

    fn os_rule(name: &str) -> OsRule {
        OsRule {
            name: Some(name.to_string()),
            arch: None,
        }
    }

    fn other_os() -> String {
        let current = get_current_os();
        if current == "windows" {
            "linux".to_string()
        } else {
            "windows".to_string()
        }
    }

    #[test]
    fn no_rules_is_allowed() {
        assert!(is_rule_allowed(None));
    }

    #[test]
    fn os_specific_rule_excludes_other_os() {
        let rules = vec![rule("allow", Some(os_rule(&other_os())), None)];
        assert!(!is_rule_allowed(Some(&rules)));
    }

    #[test]
    fn os_specific_rule_includes_current_os() {
        let current = get_current_os().to_string();
        let rules = vec![rule("allow", Some(os_rule(&current)), None)];
        assert!(is_rule_allowed(Some(&rules)));
    }

    #[test]
    fn last_matching_rule_wins() {
        let current = get_current_os().to_string();
        let allow_then_disallow = vec![
            rule("allow", None, None),
            rule("disallow", Some(os_rule(&current)), None),
        ];
        assert!(!is_rule_allowed(Some(&allow_then_disallow)));

        let disallow_then_allow = vec![
            rule("disallow", Some(os_rule(&current)), None),
            rule("allow", None, None),
        ];
        assert!(is_rule_allowed(Some(&disallow_then_allow)));
    }

    #[test]
    fn feature_rules_never_match() {
        let mut features = HashMap::new();
        features.insert("is_demo_user".to_string(), true);
        let rules = vec![rule("allow", None, Some(features))];
        assert!(!is_rule_allowed(Some(&rules)));
    }
}
