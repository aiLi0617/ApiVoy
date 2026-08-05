//! Multi-scope `{{var}}` resolution (P0).
//!
//! Lookup order (later scopes override earlier):
//! global → environment → collection → request.
//! Dynamic tokens: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`.

use std::collections::HashMap;

use chrono::Utc;
use core_domain::{HttpPayload, ProtocolPayload, RequestEnvelope};
use regex::Regex;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ResolveError {
    #[error("unresolved variable `{{{{{0}}}}}`")]
    Unresolved(String),
}

impl ResolveError {
    pub fn reference(&self) -> String {
        match self {
            Self::Unresolved(name) => name.clone(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct VariableScope {
    pub global: HashMap<String, String>,
    pub environment: HashMap<String, String>,
    pub collection: HashMap<String, String>,
    pub request: HashMap<String, String>,
    /// Resolved secret values keyed by `secret_ref` name (never persisted).
    pub secrets: HashMap<String, String>,
}

impl VariableScope {
    pub fn merged(&self) -> HashMap<String, String> {
        let mut out = HashMap::new();
        out.extend(self.global.clone());
        out.extend(self.environment.clone());
        out.extend(self.collection.clone());
        out.extend(self.request.clone());
        out
    }

    pub fn resolve_template(&self, input: &str) -> Result<String, ResolveError> {
        resolve_template(input, &self.merged())
    }
}

/// Replace `{{name}}` placeholders. Unknown names become `ResolveError`.
pub fn resolve_template(
    input: &str,
    vars: &HashMap<String, String>,
) -> Result<String, ResolveError> {
    let re = Regex::new(r"\{\{\s*([^{}]+?)\s*\}\}").expect("static regex");
    let mut unresolved = Vec::new();
    let resolved = re.replace_all(input, |caps: &regex::Captures| {
        let key = caps[1].trim();
        if let Some(value) = resolve_dynamic(key) {
            return value;
        }
        match vars.get(key) {
            Some(v) => v.clone(),
            None => {
                unresolved.push(key.to_string());
                caps[0].to_string()
            }
        }
    });
    if let Some(name) = unresolved.into_iter().next() {
        return Err(ResolveError::Unresolved(name));
    }
    Ok(resolved.into_owned())
}

fn resolve_dynamic(key: &str) -> Option<String> {
    match key {
        "$uuid" => Some(Uuid::new_v4().to_string()),
        "$timestamp" => Some(Utc::now().timestamp().to_string()),
        "$isoTimestamp" => Some(Utc::now().to_rfc3339()),
        _ => None,
    }
}

/// Apply variable resolution to target / headers / body.
pub fn resolve_request(
    mut request: RequestEnvelope,
    scope: &VariableScope,
) -> Result<RequestEnvelope, ResolveError> {
    let vars = {
        let mut merged = scope.merged();
        merged.extend(request.variables.clone());
        merged
    };

    request.target = resolve_template(&request.target, &vars)?;
    if let Some(proxy) = request.proxy.clone() {
        request.proxy = Some(resolve_template(&proxy, &vars)?);
    }

    match &mut request.payload {
        ProtocolPayload::Http(HttpPayload {
            headers,
            body,
            method: _,
            follow_redirects: _,
        }) => {
            for (k, v) in headers.iter_mut() {
                *k = resolve_template(k, &vars)?;
                *v = resolve_template(v, &vars)?;
            }
            if let Some(b) = body.as_mut() {
                *b = resolve_template(b, &vars)?;
            }
        }
        ProtocolPayload::Raw(_) => {}
    }

    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_nested_scopes_and_dynamics() {
        let mut scope = VariableScope::default();
        scope.environment.insert("host".into(), "example.com".into());
        scope.request.insert("path".into(), "users".into());
        let out = scope
            .resolve_template("https://{{host}}/{{path}}?t={{$timestamp}}")
            .expect("resolve");
        assert!(out.starts_with("https://example.com/users?t="));
        assert!(!out.contains("{{"));
    }

    #[test]
    fn unresolved_variable_errors() {
        let scope = VariableScope::default();
        let err = scope.resolve_template("{{missing}}").unwrap_err();
        assert!(matches!(err, ResolveError::Unresolved(name) if name == "missing"));
    }

    #[test]
    fn resolves_http_envelope() {
        let mut req = RequestEnvelope::http_get("t", "https://{{host}}/{{id}}");
        req.variables.insert("host".into(), "api.test".into());
        req.variables.insert("id".into(), "42".into());
        req.payload = ProtocolPayload::Http(HttpPayload {
            method: "GET".into(),
            headers: vec![("X-Token".into(), "{{token}}".into())],
            body: None,
            follow_redirects: true,
        });
        let mut scope = VariableScope::default();
        scope.environment.insert("token".into(), "abc".into());
        let resolved = resolve_request(req, &scope).expect("ok");
        assert_eq!(resolved.target, "https://api.test/42");
        match resolved.payload {
            ProtocolPayload::Http(p) => assert_eq!(p.headers[0].1, "abc"),
            _ => panic!("expected http"),
        }
    }
}
