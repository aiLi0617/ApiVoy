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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthRef {
    pub kind: String,
    pub secret_ref: Option<String>,
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
