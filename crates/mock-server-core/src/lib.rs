use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn default_true() -> bool {
    true
}

fn default_project_key() -> String {
    "default-project".into()
}

fn default_service_key() -> String {
    "default".into()
}

fn default_rule_source() -> String {
    "custom".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MockMatchConditions {
    #[serde(default)]
    pub query: HashMap<String, String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub cookies: HashMap<String, String>,
    #[serde(default)]
    pub body_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockRule {
    pub id: Uuid,
    #[serde(default = "default_rule_source")]
    pub source: String,
    #[serde(default = "default_project_key")]
    pub project_key: String,
    #[serde(default = "default_service_key")]
    pub service_key: String,
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub response_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub name: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub match_conditions: MockMatchConditions,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default)]
    pub error_every: Option<u64>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub ws_messages: Vec<String>,
    #[serde(default)]
    pub ws_echo: bool,
    #[serde(default)]
    pub ws_interval_ms: u64,
}

#[derive(Debug, Clone)]
pub struct RequestFacts<'a> {
    pub project_key: &'a str,
    pub service_key: &'a str,
    pub method: &'a str,
    pub path: Option<&'a str>,
    pub operation_id: Option<&'a str>,
    pub response_id: Option<&'a str>,
    pub scenario_id: Option<Uuid>,
    pub query: &'a HashMap<String, String>,
    pub headers: &'a HashMap<String, String>,
    pub cookies: &'a HashMap<String, String>,
    pub body: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchResult {
    NotFound,
    Matched(Uuid),
    Conflict(Vec<Uuid>),
}

pub fn normalize_mock_path(value: &str) -> String {
    format!("/{}", value.trim().trim_start_matches('/'))
}

fn conditions_match(rule: &MockRule, request: &RequestFacts<'_>) -> bool {
    rule.match_conditions
        .query
        .iter()
        .all(|(name, value)| request.query.get(name) == Some(value))
        && rule.match_conditions.headers.iter().all(|(name, value)| {
            request
                .headers
                .get(&name.to_ascii_lowercase())
                .is_some_and(|actual| actual == value)
        })
        && rule
            .match_conditions
            .cookies
            .iter()
            .all(|(name, value)| request.cookies.get(name) == Some(value))
        && rule
            .match_conditions
            .body_contains
            .as_ref()
            .is_none_or(|needle| request.body.contains(needle))
}

pub fn select_mock_rule(
    rules: &HashMap<Uuid, MockRule>,
    request: &RequestFacts<'_>,
) -> MatchResult {
    let mut candidates = rules
        .values()
        .filter(|rule| {
            rule.enabled
                && rule.project_key == request.project_key
                && rule.service_key == request.service_key
                && (rule.method == "*" || rule.method.eq_ignore_ascii_case(request.method))
                && request
                    .scenario_id
                    .is_none_or(|scenario_id| rule.id == scenario_id)
                && request
                    .operation_id
                    .is_none_or(|operation_id| rule.operation_id.as_deref() == Some(operation_id))
                && request
                    .response_id
                    .is_none_or(|response_id| rule.response_id.as_deref() == Some(response_id))
                && request
                    .path
                    .is_none_or(|path| rule.path == normalize_mock_path(path))
                && conditions_match(rule, request)
        })
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return MatchResult::NotFound;
    }

    if request.scenario_id.is_none() && request.operation_id.is_none() {
        let operation_ids = candidates
            .iter()
            .filter_map(|rule| rule.operation_id.as_deref())
            .collect::<std::collections::HashSet<_>>();
        if operation_ids.len() > 1 {
            return MatchResult::Conflict(candidates.iter().map(|rule| rule.id).collect());
        }
    }

    let highest_priority = candidates
        .iter()
        .map(|rule| rule.priority)
        .max()
        .unwrap_or_default();
    candidates.retain(|rule| rule.priority == highest_priority);
    candidates.sort_by_key(|rule| rule.id);
    if candidates.len() == 1 {
        MatchResult::Matched(candidates[0].id)
    } else {
        MatchResult::Conflict(candidates.into_iter().map(|rule| rule.id).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(operation_id: &str, priority: i32) -> MockRule {
        MockRule {
            id: Uuid::new_v4(),
            source: "custom".into(),
            project_key: "project".into(),
            service_key: "service".into(),
            operation_id: Some(operation_id.into()),
            response_id: None,
            enabled: true,
            name: operation_id.into(),
            method: "GET".into(),
            path: "/users".into(),
            status: 200,
            headers: HashMap::new(),
            body: String::new(),
            match_conditions: MockMatchConditions::default(),
            delay_ms: 0,
            error_every: None,
            priority,
            ws_messages: vec![],
            ws_echo: false,
            ws_interval_ms: 0,
        }
    }

    fn facts<'a>(query: &'a HashMap<String, String>) -> RequestFacts<'a> {
        RequestFacts {
            project_key: "project",
            service_key: "service",
            method: "GET",
            path: Some("/users"),
            query,
            headers: query,
            cookies: query,
            body: "",
            operation_id: None,
            response_id: None,
            scenario_id: None,
        }
    }

    #[test]
    fn missing_enabled_is_backward_compatible() {
        let value = serde_json::json!({
            "id": Uuid::new_v4(), "name": "legacy", "method": "GET", "path": "/users", "status": 200
        });
        let parsed: MockRule = serde_json::from_value(value).expect("legacy rule");
        assert!(parsed.enabled);
        assert_eq!(parsed.project_key, "default-project");
        assert_eq!(parsed.service_key, "default");
    }

    #[test]
    fn disabled_rules_do_not_match() {
        let mut candidate = rule("users", 0);
        candidate.enabled = false;
        let id = candidate.id;
        let rules = HashMap::from([(id, candidate)]);
        assert_eq!(
            select_mock_rule(&rules, &facts(&HashMap::new())),
            MatchResult::NotFound
        );
    }

    #[test]
    fn duplicate_operations_are_reported_as_conflicts() {
        let first = rule("users-a", 0);
        let second = rule("users-b", 0);
        let rules = HashMap::from([(first.id, first), (second.id, second)]);
        assert!(matches!(
            select_mock_rule(&rules, &facts(&HashMap::new())),
            MatchResult::Conflict(ids) if ids.len() == 2
        ));
    }

    #[test]
    fn operation_id_resolves_duplicate_paths() {
        let first = rule("users-a", 0);
        let first_id = first.id;
        let second = rule("users-b", 0);
        let rules = HashMap::from([(first.id, first), (second.id, second)]);
        let empty = HashMap::new();
        let mut request = facts(&empty);
        request.operation_id = Some("users-a");
        assert_eq!(
            select_mock_rule(&rules, &request),
            MatchResult::Matched(first_id)
        );
    }

    #[test]
    fn project_service_and_conditions_are_isolated() {
        let mut candidate = rule("users", 0);
        candidate
            .match_conditions
            .query
            .insert("page".into(), "1".into());
        candidate
            .match_conditions
            .headers
            .insert("x-mode".into(), "preview".into());
        candidate
            .match_conditions
            .cookies
            .insert("tenant".into(), "alpha".into());
        candidate.match_conditions.body_contains = Some("needle".into());
        let id = candidate.id;
        let rules = HashMap::from([(id, candidate)]);
        let query = HashMap::from([("page".into(), "1".into())]);
        let headers = HashMap::from([("x-mode".into(), "preview".into())]);
        let cookies = HashMap::from([("tenant".into(), "alpha".into())]);
        let matching = RequestFacts {
            project_key: "project",
            service_key: "service",
            method: "GET",
            path: Some("/users"),
            operation_id: None,
            response_id: None,
            scenario_id: None,
            query: &query,
            headers: &headers,
            cookies: &cookies,
            body: "contains needle here",
        };
        assert_eq!(
            select_mock_rule(&rules, &matching),
            MatchResult::Matched(id)
        );
        let wrong_service = RequestFacts {
            service_key: "other",
            ..matching.clone()
        };
        assert_eq!(
            select_mock_rule(&rules, &wrong_service),
            MatchResult::NotFound
        );
        let wrong_body = RequestFacts {
            body: "missing",
            ..matching
        };
        assert_eq!(select_mock_rule(&rules, &wrong_body), MatchResult::NotFound);
    }

    #[test]
    fn response_id_selects_one_saved_design_response() {
        let mut success = rule("users", -1000);
        success.response_id = Some("resp_success".into());
        let success_id = success.id;
        let mut error = rule("users", -1001);
        error.response_id = Some("resp_error".into());
        let rules = HashMap::from([(success.id, success), (error.id, error)]);
        let empty = HashMap::new();
        let mut request = facts(&empty);
        request.response_id = Some("resp_success");
        assert_eq!(
            select_mock_rule(&rules, &request),
            MatchResult::Matched(success_id)
        );
    }
}
