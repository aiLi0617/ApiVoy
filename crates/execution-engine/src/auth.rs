//! Apply Basic / Bearer / API Key auth after variable resolution.
//!
//! Plaintext credentials live only in `VariableScope.secrets` (or already-resolved
//! env values). `AuthRef` holds secret names and never stores passwords/tokens.

use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use core_domain::{ErrorKind, HttpPayload, ProtocolPayload, RequestEnvelope};
use thiserror::Error;

use crate::variables::{resolve_template, VariableScope};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AuthError {
    #[error("unsupported auth kind `{0}`")]
    UnsupportedKind(String),
    #[error("auth requires secret_ref")]
    MissingSecretRef,
    #[error("basic auth requires username")]
    MissingUsername,
    #[error("secret `{0}` not found")]
    SecretNotFound(String),
    #[error("auth resolution: {0}")]
    Resolve(String),
}

impl AuthError {
    pub fn code(&self) -> &'static str {
        ErrorKind::Auth.as_str()
    }
}

/// Inject auth headers into an HTTP envelope using secrets from `scope`.
pub fn apply_auth(
    mut request: RequestEnvelope,
    scope: &VariableScope,
) -> Result<RequestEnvelope, AuthError> {
    let Some(auth) = request.auth_ref.clone() else {
        return Ok(request);
    };

    let kind = auth.kind.trim().to_ascii_lowercase();
    if kind.is_empty() || kind == "none" {
        return Ok(request);
    }

    let vars = {
        let mut merged = scope.merged();
        merged.extend(request.variables.clone());
        merged
    };

    match kind.as_str() {
        "bearer" => {
            let name = auth
                .secret_ref
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or(AuthError::MissingSecretRef)?;
            let token = resolve_secret(scope, &vars, name)?;
            inject_header(&mut request, "Authorization", format!("Bearer {token}"));
        }
        "basic" => {
            let username_raw = auth
                .username
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or(AuthError::MissingUsername)?;
            let username = resolve_template(username_raw, &vars)
                .map_err(|e| AuthError::Resolve(e.to_string()))?;
            let name = auth
                .secret_ref
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or(AuthError::MissingSecretRef)?;
            let password = resolve_secret(scope, &vars, name)?;
            let encoded = BASE64.encode(format!("{username}:{password}").as_bytes());
            inject_header(&mut request, "Authorization", format!("Basic {encoded}"));
        }
        "api_key" | "apikey" => {
            let name = auth
                .secret_ref
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or(AuthError::MissingSecretRef)?;
            let value = resolve_secret(scope, &vars, name)?;
            let header_raw = auth
                .header_name
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("X-Api-Key");
            let header = resolve_template(header_raw, &vars)
                .map_err(|e| AuthError::Resolve(e.to_string()))?;
            inject_header(&mut request, &header, value);
        }
        other => return Err(AuthError::UnsupportedKind(other.to_string())),
    }

    Ok(request)
}

fn resolve_secret(
    scope: &VariableScope,
    vars: &HashMap<String, String>,
    name: &str,
) -> Result<String, AuthError> {
    if let Some(v) = scope.secrets.get(name) {
        return Ok(v.clone());
    }
    if let Some(v) = vars.get(name) {
        return Ok(v.clone());
    }
    Err(AuthError::SecretNotFound(name.to_string()))
}

fn inject_header(request: &mut RequestEnvelope, name: &str, value: impl Into<String>) {
    let value = value.into();
    match &mut request.payload {
        ProtocolPayload::Http(HttpPayload { headers, .. }) => {
            headers.retain(|(k, _)| !k.eq_ignore_ascii_case(name));
            headers.push((name.to_string(), value));
        }
        ProtocolPayload::Raw(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_domain::AuthRef;

    fn http_req() -> RequestEnvelope {
        RequestEnvelope::http_get("t", "https://example.com")
    }

    #[test]
    fn applies_bearer() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::bearer("token"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("token".into(), "abc123".into());
        let out = apply_auth(req, &scope).unwrap();
        match out.payload {
            ProtocolPayload::Http(p) => {
                assert_eq!(
                    p.headers
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("Authorization"))
                        .map(|(_, v)| v.as_str()),
                    Some("Bearer abc123")
                );
            }
            _ => panic!("http"),
        }
    }

    #[test]
    fn applies_basic() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::basic("alice", "pass"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("pass".into(), "s3cret".into());
        let out = apply_auth(req, &scope).unwrap();
        match out.payload {
            ProtocolPayload::Http(p) => {
                let auth = p
                    .headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("Authorization"))
                    .map(|(_, v)| v.clone())
                    .unwrap();
                assert_eq!(auth, format!("Basic {}", BASE64.encode(b"alice:s3cret")));
            }
            _ => panic!("http"),
        }
    }

    #[test]
    fn applies_api_key() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::api_key("key", "X-Custom-Key"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("key".into(), "k-value".into());
        let out = apply_auth(req, &scope).unwrap();
        match out.payload {
            ProtocolPayload::Http(p) => {
                assert_eq!(
                    p.headers
                        .iter()
                        .find(|(k, _)| k == "X-Custom-Key")
                        .map(|(_, v)| v.as_str()),
                    Some("k-value")
                );
            }
            _ => panic!("http"),
        }
    }

    #[test]
    fn missing_secret_errors() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::bearer("missing"));
        let err = apply_auth(req, &VariableScope::default()).unwrap_err();
        assert!(matches!(err, AuthError::SecretNotFound(_)));
    }

    #[test]
    fn overwrites_existing_authorization_header() {
        let mut req = http_req();
        req.payload = ProtocolPayload::Http(HttpPayload {
            method: "GET".into(),
            headers: vec![("Authorization".into(), "Bearer stale".into())],
            body: None,
            follow_redirects: true,
        });
        req.auth_ref = Some(AuthRef::bearer("token"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("token".into(), "fresh".into());
        let out = apply_auth(req, &scope).unwrap();
        match out.payload {
            ProtocolPayload::Http(p) => {
                let auth_headers: Vec<_> = p
                    .headers
                    .iter()
                    .filter(|(k, _)| k.eq_ignore_ascii_case("Authorization"))
                    .collect();
                assert_eq!(auth_headers.len(), 1);
                assert_eq!(auth_headers[0].1, "Bearer fresh");
            }
            _ => panic!("http"),
        }
    }
}
