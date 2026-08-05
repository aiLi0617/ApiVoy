use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::Assertion;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestId(pub Uuid);

impl RequestId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for RequestId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProtocolId(pub String);

impl ProtocolId {
    pub fn http() -> Self {
        Self("http".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestEnvelope {
    pub id: RequestId,
    pub protocol_id: ProtocolId,
    pub name: String,
    pub target: String,
    pub environment_ref: Option<String>,
    pub auth_ref: Option<AuthRef>,
    pub timeout_ms: u64,
    pub retry_policy: RetryPolicy,
    pub proxy: Option<String>,
    pub tls: TlsOptions,
    pub metadata: Value,
    pub payload: ProtocolPayload,
    pub pre_scripts: Vec<String>,
    pub post_scripts: Vec<String>,
    #[serde(default)]
    pub assertions: Vec<Assertion>,
    /// Request-scoped variables (highest precedence after dynamic tokens).
    #[serde(default)]
    pub variables: HashMap<String, String>,
    pub created_at: DateTime<Utc>,
}

impl RequestEnvelope {
    pub fn http_get(name: impl Into<String>, url: impl Into<String>) -> Self {
        Self {
            id: RequestId::new(),
            protocol_id: ProtocolId::http(),
            name: name.into(),
            target: url.into(),
            environment_ref: None,
            auth_ref: None,
            timeout_ms: 30_000,
            retry_policy: RetryPolicy::default(),
            proxy: None,
            tls: TlsOptions::default(),
            metadata: Value::Object(Default::default()),
            payload: ProtocolPayload::Http(HttpPayload {
                method: "GET".into(),
                headers: vec![],
                body: None,
                follow_redirects: true,
            }),
            pre_scripts: vec![],
            post_scripts: vec![],
            assertions: vec![],
            variables: HashMap::new(),
            created_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolPayload {
    Http(HttpPayload),
    Raw(Value),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpPayload {
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub follow_redirects: bool,
}

/// Request authentication reference. Secrets are stored by name in `secret-store`;
/// this struct never carries plaintext credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthRef {
    /// `none` | `bearer` | `basic` | `api_key`
    pub kind: String,
    /// Secret store ref for bearer token, basic password, or API key value.
    #[serde(default)]
    pub secret_ref: Option<String>,
    /// Basic auth username (may contain `{{var}}` templates).
    #[serde(default)]
    pub username: Option<String>,
    /// API Key header name (default `X-Api-Key`).
    #[serde(default)]
    pub header_name: Option<String>,
}

impl AuthRef {
    pub fn bearer(secret_ref: impl Into<String>) -> Self {
        Self {
            kind: "bearer".into(),
            secret_ref: Some(secret_ref.into()),
            username: None,
            header_name: None,
        }
    }

    pub fn basic(username: impl Into<String>, password_secret_ref: impl Into<String>) -> Self {
        Self {
            kind: "basic".into(),
            secret_ref: Some(password_secret_ref.into()),
            username: Some(username.into()),
            header_name: None,
        }
    }

    pub fn api_key(secret_ref: impl Into<String>, header_name: impl Into<String>) -> Self {
        Self {
            kind: "api_key".into(),
            secret_ref: Some(secret_ref.into()),
            username: None,
            header_name: Some(header_name.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub backoff_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 0,
            backoff_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsOptions {
    pub verify: bool,
    pub client_cert_ref: Option<String>,
}

impl Default for TlsOptions {
    fn default() -> Self {
        Self {
            verify: true,
            client_cert_ref: None,
        }
    }
}
