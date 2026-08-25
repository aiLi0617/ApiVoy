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
    /// Ephemeral secret material supplied by the execution host. Never serialized.
    #[serde(skip)]
    pub runtime_secrets: HashMap<String, String>,
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
                body_encoding: "text".into(),
                body_source: None,
                multipart: vec![],
                follow_redirects: true,
            }),
            pre_scripts: vec![],
            post_scripts: vec![],
            assertions: vec![],
            variables: HashMap::new(),
            runtime_secrets: HashMap::new(),
            created_at: Utc::now(),
        }
    }

    /// Returns a copy that is safe to write to the local database or history.
    /// Literal credentials remain available on the in-memory request used for
    /// execution, but are never part of a persisted envelope.
    pub fn sanitized_for_persistence(&self) -> Self {
        let mut sanitized = self.clone();
        if let Some(auth) = sanitized.auth_ref.as_mut() {
            auth.token = None;
        }
        if let ProtocolPayload::Http(payload) = &mut sanitized.payload {
            payload
                .headers
                .retain(|(name, _)| !is_sensitive_header_name(name));
        }
        scrub_sensitive_json(&mut sanitized.metadata);
        sanitized.runtime_secrets.clear();
        sanitized
    }
}

fn normalized_credential_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_sensitive_header_name(name: &str) -> bool {
    let normalized = normalized_credential_name(name);
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxyauthorization"
            | "cookie"
            | "setcookie"
            | "apikey"
            | "xapikey"
            | "authtoken"
            | "xauthtoken"
            | "accesstoken"
            | "xaccesstoken"
    ) || ["token", "secret", "password", "passwd", "apikey"]
        .iter()
        .any(|suffix| normalized.ends_with(suffix))
}

fn is_sensitive_json_key(name: &str) -> bool {
    is_sensitive_header_name(name)
        || matches!(
            normalized_credential_name(name).as_str(),
            "authorizationcode" | "codeverifier"
        )
}

fn scrub_sensitive_json(value: &mut Value) {
    match value {
        Value::Object(object) => {
            object.retain(|key, _| !is_sensitive_json_key(key));
            for (key, nested) in object.iter_mut() {
                if normalized_credential_name(key) == "headers" {
                    if let Value::Array(headers) = nested {
                        headers.retain(|header| {
                            header
                                .as_array()
                                .and_then(|pair| pair.first())
                                .and_then(Value::as_str)
                                .is_none_or(|name| !is_sensitive_header_name(name))
                        });
                    }
                }
                scrub_sensitive_json(nested);
            }
        }
        Value::Array(values) => values.iter_mut().for_each(scrub_sensitive_json),
        _ => {}
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolPayload {
    Http(HttpPayload),
    Sse(SsePayload),
    Tcp(SocketPayload),
    Udp(UdpPayload),
    Graphql(GraphqlPayload),
    Websocket(WebSocketPayload),
    Grpc(GrpcPayload),
    Raw(Value),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsePayload {
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub last_event_id: Option<String>,
    #[serde(default)]
    pub reconnect_max: u32,
    #[serde(default = "default_sse_reconnect_delay")]
    pub reconnect_delay_ms: u64,
}

fn default_sse_reconnect_delay() -> u64 {
    1_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketPayload {
    pub data: String,
    #[serde(default = "default_text_encoding")]
    pub encoding: String,
    #[serde(default)]
    pub framing: Option<String>,
    #[serde(default)]
    pub delimiter: Option<String>,
    #[serde(default)]
    pub fixed_length: Option<usize>,
    #[serde(default = "default_send_count")]
    pub send_count: u32,
    #[serde(default)]
    pub interval_ms: u64,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub server_name: Option<String>,
    #[serde(default)]
    pub ca_cert_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdpPayload {
    pub data: String,
    #[serde(default = "default_text_encoding")]
    pub encoding: String,
    #[serde(default = "default_send_count")]
    pub send_count: u32,
    #[serde(default)]
    pub interval_ms: u64,
}

fn default_text_encoding() -> String {
    "text".into()
}
fn default_send_count() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphqlPayload {
    pub query: String,
    #[serde(default)]
    pub variables: Value,
    #[serde(default)]
    pub operation_name: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketPayload {
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub subprotocols: Vec<String>,
    #[serde(default)]
    pub messages: Vec<WebSocketMessage>,
    #[serde(default)]
    pub receive_limit: Option<usize>,
    #[serde(default)]
    pub reconnect_max: u32,
    #[serde(default = "default_websocket_reconnect_delay")]
    pub reconnect_delay_ms: u64,
}

fn default_websocket_reconnect_delay() -> u64 {
    1_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketMessage {
    #[serde(default = "default_text_encoding")]
    pub encoding: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcPayload {
    pub service: String,
    pub method: String,
    pub message_base64: String,
    #[serde(default = "default_grpc_mode")]
    pub mode: String,
    #[serde(default)]
    pub metadata: Vec<(String, String)>,
    #[serde(default)]
    pub descriptor_set_base64: Option<String>,
    #[serde(default)]
    pub message_json: Option<String>,
}

fn default_grpc_mode() -> String {
    "unary".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpPayload {
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    #[serde(default = "default_text_encoding")]
    pub body_encoding: String,
    #[serde(default)]
    pub body_source: Option<String>,
    #[serde(default)]
    pub multipart: Vec<MultipartPart>,
    pub follow_redirects: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartPart {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub base64: bool,
}

/// Request authentication configuration. Credentials may be referenced from
/// `secret-store`; bearer auth can also carry an execution-only token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthRef {
    /// `none` | `bearer` | `basic` | `api_key` | `oauth2_client_credentials`
    pub kind: String,
    /// Secret store ref for bearer token, basic password, or API key value.
    #[serde(default)]
    pub secret_ref: Option<String>,
    /// Literal bearer token supplied only to the execution transport.
    #[serde(default, skip_serializing)]
    pub token: Option<String>,
    /// Basic auth username (may contain `{{var}}` templates).
    #[serde(default)]
    pub username: Option<String>,
    /// API Key header name (default `X-Api-Key`).
    #[serde(default)]
    pub header_name: Option<String>,
    /// OAuth 2.0 token endpoint.
    #[serde(default)]
    pub token_url: Option<String>,
    /// Space-delimited OAuth scopes.
    #[serde(default)]
    pub scope: Option<String>,
    /// Optional OAuth audience/resource identifier.
    #[serde(default)]
    pub audience: Option<String>,
    /// OAuth authorization endpoint (used by clients to start the browser flow).
    #[serde(default)]
    pub authorization_url: Option<String>,
    #[serde(default)]
    pub redirect_uri: Option<String>,
    /// Keychain refs for the short-lived authorization code and PKCE verifier.
    #[serde(default)]
    pub authorization_code_ref: Option<String>,
    #[serde(default)]
    pub code_verifier_ref: Option<String>,
}

impl AuthRef {
    pub fn bearer(secret_ref: impl Into<String>) -> Self {
        Self {
            kind: "bearer".into(),
            secret_ref: Some(secret_ref.into()),
            token: None,
            username: None,
            header_name: None,
            token_url: None,
            scope: None,
            audience: None,
            authorization_url: None,
            redirect_uri: None,
            authorization_code_ref: None,
            code_verifier_ref: None,
        }
    }

    pub fn basic(username: impl Into<String>, password_secret_ref: impl Into<String>) -> Self {
        Self {
            kind: "basic".into(),
            secret_ref: Some(password_secret_ref.into()),
            token: None,
            username: Some(username.into()),
            header_name: None,
            token_url: None,
            scope: None,
            audience: None,
            authorization_url: None,
            redirect_uri: None,
            authorization_code_ref: None,
            code_verifier_ref: None,
        }
    }

    pub fn api_key(secret_ref: impl Into<String>, header_name: impl Into<String>) -> Self {
        Self {
            kind: "api_key".into(),
            secret_ref: Some(secret_ref.into()),
            token: None,
            username: None,
            header_name: Some(header_name.into()),
            token_url: None,
            scope: None,
            audience: None,
            authorization_url: None,
            redirect_uri: None,
            authorization_code_ref: None,
            code_verifier_ref: None,
        }
    }

    pub fn oauth2_client_credentials(
        client_id: impl Into<String>,
        client_secret_ref: impl Into<String>,
        token_url: impl Into<String>,
    ) -> Self {
        Self {
            kind: "oauth2_client_credentials".into(),
            secret_ref: Some(client_secret_ref.into()),
            token: None,
            username: Some(client_id.into()),
            header_name: None,
            token_url: Some(token_url.into()),
            scope: None,
            audience: None,
            authorization_url: None,
            redirect_uri: None,
            authorization_code_ref: None,
            code_verifier_ref: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub backoff_ms: u64,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistence_copy_removes_literal_credentials() {
        let mut request = RequestEnvelope::http_get("private", "https://example.test");
        request.auth_ref = Some(AuthRef {
            kind: "bearer".into(),
            secret_ref: None,
            token: Some("top-secret".into()),
            username: None,
            header_name: None,
            token_url: None,
            scope: None,
            audience: None,
            authorization_url: None,
            redirect_uri: None,
            authorization_code_ref: None,
            code_verifier_ref: None,
        });
        if let ProtocolPayload::Http(payload) = &mut request.payload {
            payload
                .headers
                .push(("Authorization".into(), "Bearer top-secret".into()));
            payload
                .headers
                .push(("X-Csrf-Token".into(), "top-secret".into()));
            payload
                .headers
                .push(("Accept".into(), "application/json".into()));
        }
        request.metadata = serde_json::json!({
            "request": { "auth": { "token": "top-secret" }, "headers": [["Cookie", "sid=top-secret"], ["Accept", "application/json"]] }
        });

        let saved = request.sanitized_for_persistence();
        let json = serde_json::to_string(&saved).expect("serialize persistence copy");
        assert!(!json.contains("top-secret"));
        assert!(json.contains("application/json"));
        assert_eq!(
            request
                .auth_ref
                .as_ref()
                .and_then(|auth| auth.token.as_deref()),
            Some("top-secret")
        );
    }
}
