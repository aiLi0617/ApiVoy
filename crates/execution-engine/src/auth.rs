//! Apply Basic / Bearer / API Key auth after variable resolution.
//!
//! Plaintext credentials live only in `VariableScope.secrets` (or already-resolved
//! env values). `AuthRef` holds secret names and never stores passwords/tokens.

use std::collections::HashMap;
use std::net::IpAddr;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use core_domain::{ErrorKind, HttpPayload, ProtocolPayload, RequestEnvelope};
use reqwest::Url;
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
    #[error("OAuth token request failed: {0}")]
    TokenEndpoint(String),
    #[error("OAuth token response is invalid: {0}")]
    TokenResponse(String),
}

impl AuthError {
    pub fn code(&self) -> &'static str {
        ErrorKind::Auth.as_str()
    }
}

/// Inject auth headers into an HTTP envelope using secrets from `scope`.
pub async fn apply_auth(
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
        "oauth2_client_credentials" | "oauth2-client-credentials" => {
            let client_id_raw = auth
                .username
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or(AuthError::MissingUsername)?;
            let client_id = resolve_template(client_id_raw, &vars)
                .map_err(|error| AuthError::Resolve(error.to_string()))?;
            let secret_name = auth
                .secret_ref
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or(AuthError::MissingSecretRef)?;
            let client_secret = resolve_secret(scope, &vars, secret_name)?;
            let token_url_raw = auth
                .token_url
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AuthError::TokenEndpoint("token_url is required".into()))?;
            let token_url = resolve_template(token_url_raw, &vars)
                .map_err(|error| AuthError::Resolve(error.to_string()))?;
            let mut form = vec![("grant_type", "client_credentials".to_string())];
            if let Some(scope_value) = auth
                .scope
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                form.push((
                    "scope",
                    resolve_template(scope_value, &vars)
                        .map_err(|error| AuthError::Resolve(error.to_string()))?,
                ));
            }
            if let Some(audience) = auth
                .audience
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                form.push((
                    "audience",
                    resolve_template(audience, &vars)
                        .map_err(|error| AuthError::Resolve(error.to_string()))?,
                ));
            }
            let response = oauth_client(&token_url)?
                .post(token_url)
                .basic_auth(client_id, Some(client_secret))
                .form(&form)
                .timeout(std::time::Duration::from_millis(request.timeout_ms.max(1)))
                .send()
                .await
                .map_err(|error| AuthError::TokenEndpoint(error.to_string()))?;
            let status = response.status();
            let body = response
                .text()
                .await
                .map_err(|error| AuthError::TokenResponse(error.to_string()))?;
            if !status.is_success() {
                return Err(AuthError::TokenEndpoint(format!("HTTP {status}: {body}")));
            }
            let token: OAuthTokenResponse = serde_json::from_str(&body)
                .map_err(|error| AuthError::TokenResponse(error.to_string()))?;
            if token.access_token.trim().is_empty() {
                return Err(AuthError::TokenResponse("access_token is empty".into()));
            }
            let token_type = token
                .token_type
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Bearer".into());
            inject_header(
                &mut request,
                "Authorization",
                format!("{token_type} {}", token.access_token),
            );
        }
        "oauth2_authorization_code" | "oauth2-authorization-code" => {
            let client_id_raw = auth
                .username
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or(AuthError::MissingUsername)?;
            let client_id = resolve_template(client_id_raw, &vars)
                .map_err(|error| AuthError::Resolve(error.to_string()))?;
            let token_url_raw = auth
                .token_url
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AuthError::TokenEndpoint("token_url is required".into()))?;
            let token_url = resolve_template(token_url_raw, &vars)
                .map_err(|error| AuthError::Resolve(error.to_string()))?;
            let redirect_uri_raw = auth
                .redirect_uri
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AuthError::TokenEndpoint("redirect_uri is required".into()))?;
            let redirect_uri = resolve_template(redirect_uri_raw, &vars)
                .map_err(|error| AuthError::Resolve(error.to_string()))?;
            let code_ref = auth
                .authorization_code_ref
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AuthError::TokenEndpoint("authorization_code_ref is required".into())
                })?;
            let verifier_ref = auth
                .code_verifier_ref
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AuthError::TokenEndpoint("code_verifier_ref is required".into()))?;
            let code = resolve_secret(scope, &vars, code_ref)?;
            let verifier = resolve_secret(scope, &vars, verifier_ref)?;
            let form = vec![
                ("grant_type", "authorization_code".to_string()),
                ("client_id", client_id.clone()),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("code_verifier", verifier),
            ];
            let client = oauth_client(&token_url)?;
            let mut builder = client
                .post(token_url)
                .form(&form)
                .timeout(std::time::Duration::from_millis(request.timeout_ms.max(1)));
            if let Some(secret_ref) = auth.secret_ref.as_deref().filter(|value| !value.is_empty()) {
                builder =
                    builder.basic_auth(client_id, Some(resolve_secret(scope, &vars, secret_ref)?));
            }
            let response = builder
                .send()
                .await
                .map_err(|error| AuthError::TokenEndpoint(error.to_string()))?;
            let status = response.status();
            let body = response
                .text()
                .await
                .map_err(|error| AuthError::TokenResponse(error.to_string()))?;
            if !status.is_success() {
                return Err(AuthError::TokenEndpoint(format!("HTTP {status}: {body}")));
            }
            let token: OAuthTokenResponse = serde_json::from_str(&body)
                .map_err(|error| AuthError::TokenResponse(error.to_string()))?;
            if token.access_token.trim().is_empty() {
                return Err(AuthError::TokenResponse("access_token is empty".into()));
            }
            let token_type = token
                .token_type
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Bearer".into());
            inject_header(
                &mut request,
                "Authorization",
                format!("{token_type} {}", token.access_token),
            );
        }
        other => return Err(AuthError::UnsupportedKind(other.to_string())),
    }

    Ok(request)
}

#[derive(serde::Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    #[serde(default)]
    token_type: Option<String>,
}

fn oauth_client(token_url: &str) -> Result<reqwest::Client, AuthError> {
    let mut builder = reqwest::Client::builder();
    if Url::parse(token_url)
        .ok()
        .as_ref()
        .is_some_and(url_is_loopback)
    {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|error| AuthError::TokenEndpoint(error.to_string()))
}

fn url_is_loopback(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_loopback())
    })
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
        ProtocolPayload::Sse(payload) => {
            payload
                .headers
                .retain(|(k, _)| !k.eq_ignore_ascii_case(name));
            payload.headers.push((name.to_string(), value));
        }
        ProtocolPayload::Tcp(_) | ProtocolPayload::Udp(_) => {}
        ProtocolPayload::Graphql(payload) => {
            payload
                .headers
                .retain(|(k, _)| !k.eq_ignore_ascii_case(name));
            payload.headers.push((name.to_string(), value));
        }
        ProtocolPayload::Websocket(payload) => {
            payload
                .headers
                .retain(|(k, _)| !k.eq_ignore_ascii_case(name));
            payload.headers.push((name.to_string(), value));
        }
        ProtocolPayload::Grpc(payload) => {
            payload
                .metadata
                .retain(|(k, _)| !k.eq_ignore_ascii_case(name));
            payload.metadata.push((name.to_string(), value));
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

    #[tokio::test]
    async fn applies_bearer() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::bearer("token"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("token".into(), "abc123".into());
        let out = apply_auth(req, &scope).await.unwrap();
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

    #[tokio::test]
    async fn applies_basic() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::basic("alice", "pass"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("pass".into(), "s3cret".into());
        let out = apply_auth(req, &scope).await.unwrap();
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

    #[tokio::test]
    async fn applies_api_key() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::api_key("key", "X-Custom-Key"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("key".into(), "k-value".into());
        let out = apply_auth(req, &scope).await.unwrap();
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

    #[tokio::test]
    async fn missing_secret_errors() {
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::bearer("missing"));
        let err = apply_auth(req, &VariableScope::default())
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::SecretNotFound(_)));
    }

    #[tokio::test]
    async fn overwrites_existing_authorization_header() {
        let mut req = http_req();
        req.payload = ProtocolPayload::Http(HttpPayload {
            method: "GET".into(),
            headers: vec![("Authorization".into(), "Bearer stale".into())],
            body: None,
            multipart: vec![],
            follow_redirects: true,
        });
        req.auth_ref = Some(AuthRef::bearer("token"));
        let mut scope = VariableScope::default();
        scope.secrets.insert("token".into(), "fresh".into());
        let out = apply_auth(req, &scope).await.unwrap();
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

    #[tokio::test]
    async fn exchanges_oauth_client_credentials_without_persisting_secret() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0u8; 4096];
            let size = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..size]).into_owned();
            let expected = format!("Basic {}", BASE64.encode(b"client:super-private-value"));
            assert!(request.contains(&expected));
            assert!(request.contains("grant_type=client_credentials"));
            let body = r#"{"access_token":"runtime-token","token_type":"Bearer"}"#;
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let mut req = http_req();
        req.auth_ref = Some(AuthRef::oauth2_client_credentials(
            "client",
            "oauth-secret",
            format!("http://{address}/token"),
        ));
        let mut scope = VariableScope::default();
        scope
            .secrets
            .insert("oauth-secret".into(), "super-private-value".into());
        let out = apply_auth(req, &scope).await.unwrap();
        let ProtocolPayload::Http(ref payload) = out.payload else {
            panic!("http")
        };
        assert!(payload
            .headers
            .iter()
            .any(|(name, value)| name == "Authorization" && value == "Bearer runtime-token"));
        assert!(!serde_json::to_string(&out)
            .unwrap()
            .contains("super-private-value"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn exchanges_oauth_authorization_code_with_pkce_secrets() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0u8; 4096];
            let size = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..size]);
            assert!(request.contains("grant_type=authorization_code"));
            assert!(request.contains("code=short-lived-code"));
            assert!(request.contains("code_verifier=pkce-verifier"));
            assert!(request.contains("client_id=public-client"));
            let body = r#"{"access_token":"pkce-token"}"#;
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let mut auth = AuthRef::oauth2_client_credentials(
            "public-client",
            "unused",
            format!("http://{address}/token"),
        );
        auth.kind = "oauth2_authorization_code".into();
        auth.secret_ref = None;
        auth.redirect_uri = Some("http://127.0.0.1/callback".into());
        auth.authorization_code_ref = Some("oauth-code".into());
        auth.code_verifier_ref = Some("oauth-verifier".into());
        let mut req = http_req();
        req.auth_ref = Some(auth);
        let mut scope = VariableScope::default();
        scope
            .secrets
            .insert("oauth-code".into(), "short-lived-code".into());
        scope
            .secrets
            .insert("oauth-verifier".into(), "pkce-verifier".into());
        let out = apply_auth(req, &scope).await.unwrap();
        let ProtocolPayload::Http(payload) = out.payload else {
            panic!("http")
        };
        assert!(payload
            .headers
            .iter()
            .any(|(name, value)| name == "Authorization" && value == "Bearer pkce-token"));
        server.await.unwrap();
    }
}
