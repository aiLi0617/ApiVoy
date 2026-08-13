//! Built-in HTTP/HTTPS driver (MVP Phase 0 scaffold).

use std::{sync::Arc, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, HttpPayload,
    ProtocolPayload, RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use futures::StreamExt;
use reqwest::{
    cookie::{CookieStore, Jar},
    multipart,
    redirect::Policy,
    Client, Identity, Method, Proxy, RequestBuilder, Url,
};
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;
use tracing::instrument;

const RESPONSE_PREVIEW_BYTES: usize = 10_000;

#[derive(Debug, Default)]
pub struct HttpDriver {
    client: Client,
    cookie_jar: Arc<Jar>,
}

impl HttpDriver {
    pub fn new() -> Self {
        let cookie_jar = Arc::new(Jar::default());
        let client = Client::builder()
            .user_agent(concat!("ApiVoy/", env!("CARGO_PKG_VERSION")))
            .cookie_provider(Arc::clone(&cookie_jar))
            .no_proxy()
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client, cookie_jar }
    }

    pub fn cookies_for(&self, url: &str) -> Result<Vec<(String, String)>, DriverError> {
        let url = Url::parse(url).map_err(|error| DriverError::Validation(error.to_string()))?;
        let Some(value) = self.cookie_jar.cookies(&url) else {
            return Ok(vec![]);
        };
        let text = value
            .to_str()
            .map_err(|error| DriverError::Internal(error.to_string()))?;
        Ok(text
            .split(';')
            .filter_map(|item| item.trim().split_once('='))
            .map(|(name, value)| (name.to_owned(), value.to_owned()))
            .collect())
    }

    pub fn set_cookie(&self, url: &str, cookie: &str) -> Result<(), DriverError> {
        let url = Url::parse(url).map_err(|error| DriverError::Validation(error.to_string()))?;
        self.cookie_jar.add_cookie_str(cookie, &url);
        Ok(())
    }

    pub fn delete_cookie(&self, url: &str, name: &str) -> Result<(), DriverError> {
        let url = Url::parse(url).map_err(|error| DriverError::Validation(error.to_string()))?;
        let mut paths = vec!["/".to_owned()];
        let segments: Vec<_> = url
            .path()
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        let mut path = String::new();
        for segment in segments {
            path.push('/');
            path.push_str(segment);
            paths.push(path.clone());
            paths.push(format!("{path}/"));
        }
        paths.sort();
        paths.dedup();

        let mut domains = Vec::new();
        if let Some(host) = url.host_str() {
            let labels: Vec<_> = host.split('.').collect();
            // Try the request host and each registrable-looking parent. Invalid/public
            // suffix candidates are ignored by the cookie jar.
            for offset in 0..labels.len().saturating_sub(1) {
                domains.push(labels[offset..].join("."));
            }
        }

        for path in &paths {
            self.cookie_jar
                .add_cookie_str(&format!("{name}=; Path={path}; Max-Age=0"), &url);
            for domain in &domains {
                self.cookie_jar.add_cookie_str(
                    &format!("{name}=; Path={path}; Domain={domain}; Max-Age=0"),
                    &url,
                );
            }
        }
        Ok(())
    }

    fn client_for(
        &self,
        request: &RequestEnvelope,
        follow_redirects: bool,
    ) -> Result<Client, DriverError> {
        if request.proxy.is_none()
            && request.tls.verify
            && request.tls.client_cert_ref.is_none()
            && follow_redirects
        {
            return Ok(self.client.clone());
        }

        let mut builder = Client::builder()
            .user_agent(concat!("ApiVoy/", env!("CARGO_PKG_VERSION")))
            .cookie_provider(Arc::clone(&self.cookie_jar))
            .no_proxy()
            .danger_accept_invalid_certs(!request.tls.verify)
            .redirect(if follow_redirects {
                Policy::limited(10)
            } else {
                Policy::none()
            });
        if let Some(proxy_url) = request.proxy.as_deref() {
            let proxy = Proxy::all(proxy_url)
                .map_err(|e| DriverError::Validation(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        if let Some(secret_ref) = request.tls.client_cert_ref.as_deref() {
            let pem = request.runtime_secrets.get(secret_ref).ok_or_else(|| {
                DriverError::Validation(format!(
                    "TLS client identity secret `{secret_ref}` was not provided"
                ))
            })?;
            let identity = Identity::from_pem(pem.as_bytes()).map_err(|error| {
                DriverError::Validation(format!(
                    "invalid PEM client identity `{secret_ref}`: {error}"
                ))
            })?;
            builder = builder.identity(identity);
        }
        builder
            .build()
            .map_err(|e| DriverError::Internal(e.to_string()))
    }
}

fn map_reqwest_error(error: reqwest::Error) -> DriverError {
    let detail = format!("{error:#}");
    let lower = detail.to_ascii_lowercase();
    if error.is_timeout() {
        DriverError::Timeout(detail)
    } else if lower.contains("tls") || lower.contains("certificate") || lower.contains("ssl") {
        DriverError::Tls(detail)
    } else if error.is_connect() {
        DriverError::Connection(detail)
    } else {
        DriverError::Protocol(detail)
    }
}

fn merge_cookie_values(jar: Option<&str>, request_values: &[&str]) -> Option<String> {
    let mut cookies: Vec<(String, String)> = Vec::new();
    let mut add = |source: &str| {
        for item in source.split(';') {
            let Some((name, value)) = item.trim().split_once('=') else {
                continue;
            };
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            if let Some(existing) = cookies.iter_mut().find(|(key, _)| key == name) {
                existing.1 = value.trim().to_owned();
            } else {
                cookies.push((name.to_owned(), value.trim().to_owned()));
            }
        }
    };
    if let Some(value) = jar {
        add(value);
    }
    for value in request_values {
        add(value);
    }
    (!cookies.is_empty()).then(|| {
        cookies
            .into_iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ")
    })
}

fn apply_http_body(
    mut builder: RequestBuilder,
    payload: &HttpPayload,
) -> Result<RequestBuilder, DriverError> {
    if payload.multipart.is_empty() {
        if let Some(body) = &payload.body {
            if payload.body_encoding == "base64" {
                let bytes = BASE64.decode(body).map_err(|error| {
                    DriverError::Validation(format!("invalid HTTP Base64 body: {error}"))
                })?;
                builder = builder.body(bytes);
            } else {
                builder = builder.body(body.clone());
            }
        }
        return Ok(builder);
    }

    let mut form = multipart::Form::new();
    for field in &payload.multipart {
        let bytes = if field.base64 {
            BASE64.decode(&field.value).map_err(|error| {
                DriverError::Validation(format!(
                    "multipart field `{}` contains invalid Base64: {error}",
                    field.name
                ))
            })?
        } else {
            field.value.as_bytes().to_vec()
        };
        let mut part = if field.file_name.is_none() && !field.base64 {
            multipart::Part::text(field.value.clone())
        } else {
            multipart::Part::bytes(bytes)
        };
        if let Some(file_name) = &field.file_name {
            part = part.file_name(file_name.clone());
        }
        if let Some(content_type) = &field.content_type {
            part = part.mime_str(content_type).map_err(|error| {
                DriverError::Validation(format!(
                    "multipart field `{}` has invalid content type: {error}",
                    field.name
                ))
            })?;
        }
        form = form.part(field.name.clone(), part);
    }
    Ok(builder.multipart(form))
}

#[async_trait]
impl ProtocolDriver for HttpDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "http".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "HTTP / HTTPS".into(),
            capabilities: vec![
                "streaming".into(),
                "tls".into(),
                "proxy".into(),
                "binary".into(),
            ],
        }
    }

    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if request.target.trim().is_empty() {
            report.errors.push("target URL is required".into());
        } else if !(request.target.starts_with("http://") || request.target.starts_with("https://"))
        {
            report
                .errors
                .push("target must start with http:// or https://".into());
        }

        match &request.payload {
            ProtocolPayload::Http(payload) => {
                if Method::from_bytes(payload.method.as_bytes()).is_err() {
                    report
                        .errors
                        .push(format!("invalid HTTP method: {}", payload.method));
                }
                for part in &payload.multipart {
                    if part.name.trim().is_empty() {
                        report
                            .errors
                            .push("multipart field name cannot be empty".into());
                    }
                    if part.base64 && BASE64.decode(&part.value).is_err() {
                        report.errors.push(format!(
                            "multipart field `{}` must contain valid Base64",
                            part.name
                        ));
                    }
                }
                if !payload.multipart.is_empty()
                    && payload
                        .headers
                        .iter()
                        .any(|(name, _)| name.eq_ignore_ascii_case("content-type"))
                {
                    report.warnings.push(
                        "multipart Content-Type header is generated automatically with a boundary"
                            .into(),
                    );
                }
            }
            ProtocolPayload::Sse(_)
            | ProtocolPayload::Tcp(_)
            | ProtocolPayload::Udp(_)
            | ProtocolPayload::Graphql(_)
            | ProtocolPayload::Websocket(_)
            | ProtocolPayload::Grpc(_)
            | ProtocolPayload::Raw(_) => {
                report
                    .errors
                    .push("HTTP driver requires ProtocolPayload::Http".into());
            }
        }

        if let Some(proxy) = request.proxy.as_deref() {
            if Proxy::all(proxy).is_err() {
                report
                    .errors
                    .push("proxy must be a valid HTTP/HTTPS/SOCKS proxy URL".into());
            }
        }
        if let Some(secret_ref) = request.tls.client_cert_ref.as_deref() {
            match request.runtime_secrets.get(secret_ref) {
                Some(pem) if Identity::from_pem(pem.as_bytes()).is_err() => report.errors.push(
                    format!("TLS client identity secret `{secret_ref}` is not valid combined PEM"),
                ),
                None => report.errors.push(format!(
                    "TLS client identity secret `{secret_ref}` is unavailable"
                )),
                _ => {}
            }
        }

        report
    }

    #[instrument(skip(self, request, events, cancel), fields(url = %request.target, execution_id = %execution_id.0))]
    async fn execute(
        &self,
        request: RequestEnvelope,
        mut events: EventSink,
        cancel: CancellationToken,
        execution_id: ExecutionId,
    ) -> Result<ExecutionSummary, DriverError> {
        let started_at = Utc::now();
        let wall = Instant::now();
        let request_id = request.id.0;
        let ProtocolPayload::Http(payload) = &request.payload else {
            return Err(DriverError::Validation(
                "HTTP driver requires ProtocolPayload::Http".into(),
            ));
        };

        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;

        let method = Method::from_bytes(payload.method.as_bytes())
            .map_err(|e| DriverError::Validation(e.to_string()))?;

        let client = self.client_for(&request, payload.follow_redirects)?;
        let target_url = Url::parse(&request.target)
            .map_err(|error| DriverError::Validation(error.to_string()))?;
        let request_cookie_values: Vec<_> = payload
            .headers
            .iter()
            .filter(|(name, _)| name.eq_ignore_ascii_case("cookie"))
            .map(|(_, value)| value.as_str())
            .collect();
        let merged_cookies = if request_cookie_values.is_empty() {
            None
        } else {
            let jar_cookies = self
                .cookie_jar
                .cookies(&target_url)
                .and_then(|value| value.to_str().ok().map(str::to_owned));
            merge_cookie_values(jar_cookies.as_deref(), &request_cookie_values)
        };
        let timeout = Duration::from_millis(request.timeout_ms.max(1));
        let mut attempt = 0u32;
        let response = loop {
            let mut builder = client.request(method.clone(), &request.target);
            for (k, v) in &payload.headers {
                if k.eq_ignore_ascii_case("cookie") {
                    continue;
                }
                if !payload.multipart.is_empty() && k.eq_ignore_ascii_case("content-type") {
                    continue;
                }
                builder = builder.header(k, v);
            }
            if let Some(cookies) = &merged_cookies {
                builder = builder.header("Cookie", cookies);
            }
            builder = apply_http_body(builder, payload)?;

            let result = tokio::select! {
                _ = cancel.cancelled() => {
                    events.emit(ExecutionEvent::Cancelled { reason: Some("user cancelled".into()) }).await;
                    return Err(DriverError::Cancelled);
                }
                result = builder.timeout(timeout).send() => result,
            };

            match result {
                Ok(response)
                    if response.status().is_server_error()
                        && attempt < request.retry_policy.max_retries =>
                {
                    attempt += 1;
                    events
                        .emit(ExecutionEvent::Warning {
                            code: "http_retry".into(),
                            message: format!(
                                "HTTP {}；准备第 {} 次重试",
                                response.status(),
                                attempt
                            ),
                        })
                        .await;
                }
                Ok(response) => break response,
                Err(error) if attempt < request.retry_policy.max_retries => {
                    attempt += 1;
                    events
                        .emit(ExecutionEvent::Warning {
                            code: "http_retry".into(),
                            message: format!(
                                "{}；准备第 {} 次重试",
                                map_reqwest_error(error),
                                attempt
                            ),
                        })
                        .await;
                }
                Err(error) => return Err(map_reqwest_error(error)),
            }

            if request.retry_policy.backoff_ms > 0 {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        events.emit(ExecutionEvent::Cancelled { reason: Some("user cancelled during retry backoff".into()) }).await;
                        return Err(DriverError::Cancelled);
                    }
                    _ = sleep(Duration::from_millis(request.retry_policy.backoff_ms)) => {}
                }
            }
        };

        let status = response.status();
        let headers: Vec<(String, String)> = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: Some(status.as_u16()),
                status_text: Some(status.canonical_reason().unwrap_or("").into()),
                headers,
                content_type: content_type.clone(),
                size_hint: response.content_length(),
            }))
            .await;

        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Transfer),
            })
            .await;

        let mut bytes_received = 0u64;
        let mut preview = String::new();
        let mut stream = response.bytes_stream();

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    events.emit(ExecutionEvent::Cancelled { reason: Some("user cancelled".into()) }).await;
                    return Err(DriverError::Cancelled);
                }
                next = stream.next() => {
                    match next {
                        Some(Ok(chunk)) => {
                            bytes_received = bytes_received.saturating_add(chunk.len() as u64);
                            if preview.len() < RESPONSE_PREVIEW_BYTES {
                                let remain = RESPONSE_PREVIEW_BYTES - preview.len();
                                let slice = &chunk[..chunk.len().min(remain)];
                                preview.push_str(&String::from_utf8_lossy(slice));
                            }
                            events.emit(ExecutionEvent::ResponseChunk {
                                content_type: content_type.clone(),
                                size: chunk.len() as u64,
                                preview: None,
                                data_base64: Some(BASE64.encode(&chunk)),
                                done: false,
                            }).await;
                        }
                        Some(Err(err)) => {
                            return Err(DriverError::Protocol(err.to_string()));
                        }
                        None => break,
                    }
                }
            }
        }

        events
            .emit(ExecutionEvent::ResponseChunk {
                content_type: content_type.clone(),
                size: 0,
                preview: Some(preview),
                data_base64: None,
                done: true,
            })
            .await;

        let finished_at = Utc::now();
        let duration_ms = wall.elapsed().as_millis() as u64;
        let summary = ExecutionSummary {
            execution_id,
            request_id,
            protocol_id: "http".into(),
            state: ExecutionState::Completed,
            started_at,
            finished_at,
            duration_ms,
            bytes_received,
            status: Some(status.as_u16()),
        };

        events
            .emit(ExecutionEvent::Completed {
                summary: summary.clone(),
            })
            .await;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Completed,
                phase: Some(ExecutionPhase::Persist),
            })
            .await;

        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_domain::{MultipartPart, RequestEnvelope};
    use execution_engine::ExecutionEngine;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn validates_empty_url() {
        let driver = HttpDriver::new();
        let mut req = RequestEnvelope::http_get("bad", "https://example.com");
        req.target = "".into();
        let report = driver.validate(&req);
        assert!(!report.is_valid());
    }

    #[tokio::test]
    async fn executes_http_get_example() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await
                .unwrap();
        });
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(HttpDriver::new()));
        let req = RequestEnvelope::http_get("example", format!("http://{address}"));
        let result = engine.execute_collect(req).await;
        assert!(result.is_ok(), "expected ok, got {result:?}");
        let (id, summary, events) = result.unwrap();
        assert_eq!(summary.execution_id.0, id.0);
        assert_eq!(summary.status, Some(200));
        assert!(events
            .iter()
            .any(|e| matches!(e, ExecutionEvent::ResponseMeta(_))));
        assert!(events.iter().any(|event| matches!(
            event,
            ExecutionEvent::ResponseChunk { data_base64: Some(data), .. }
                if BASE64.decode(data).ok().as_deref() == Some(b"ok")
        )));
        let completed_id = events.iter().find_map(|e| match e {
            ExecutionEvent::Completed { summary } => Some(summary.execution_id.0),
            _ => None,
        });
        assert_eq!(completed_id, Some(id.0));
        server.await.unwrap();
    }

    #[test]
    fn rejects_invalid_proxy_and_missing_client_certificate_secret() {
        let driver = HttpDriver::new();
        let mut req = RequestEnvelope::http_get("bad options", "https://example.com");
        req.proxy = Some("://bad proxy".into());
        req.tls.client_cert_ref = Some("client-cert".into());
        let report = driver.validate(&req);
        assert_eq!(report.errors.len(), 2);
    }

    #[test]
    fn accepts_combined_pem_client_identity_from_runtime_secret() {
        let key = rcgen::KeyPair::generate().unwrap();
        let certificate = rcgen::CertificateParams::new(vec!["client.apivoy.local".into()])
            .unwrap()
            .self_signed(&key)
            .unwrap();
        let pem = format!("{}{}", certificate.pem(), key.serialize_pem());
        let driver = HttpDriver::new();
        let mut request = RequestEnvelope::http_get("mTLS", "https://example.com");
        request.tls.client_cert_ref = Some("client-pem".into());
        request.runtime_secrets.insert("client-pem".into(), pem);
        assert!(driver.validate(&request).is_valid());
        assert!(driver.client_for(&request, true).is_ok());
        let serialized = serde_json::to_string(&request).unwrap();
        assert!(!serialized.contains("BEGIN PRIVATE KEY"));
        assert!(!serialized.contains("client.apivoy.local"));
    }

    #[tokio::test]
    async fn retries_server_errors_and_emits_warning() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for status in ["500 Internal Server Error", "200 OK"] {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 1024];
                let _ = stream.read(&mut request).await.unwrap();
                let body = if status.starts_with("200") {
                    "ok"
                } else {
                    "retry"
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });

        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(HttpDriver::new()));
        let mut req = RequestEnvelope::http_get("retry", format!("http://{address}"));
        req.retry_policy.max_retries = 1;
        let (_, summary, events) = engine.execute_collect(req).await.unwrap();
        assert_eq!(summary.status, Some(200));
        assert!(events.iter().any(|event| matches!(
            event,
            ExecutionEvent::Warning { code, .. } if code == "http_retry"
        )));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn persists_response_cookies_for_follow_up_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (cookie_tx, cookie_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let mut cookie_tx = Some(cookie_tx);
            for index in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = vec![0u8; 2048];
                let size = stream.read(&mut request).await.unwrap();
                let text = String::from_utf8_lossy(&request[..size]).into_owned();
                if index == 0 {
                    stream.write_all(b"HTTP/1.1 200 OK\r\nSet-Cookie: session=apivoy; Path=/; HttpOnly\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                } else {
                    let _ = cookie_tx.take().unwrap().send(text);
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .await
                        .unwrap();
                }
            }
        });
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(HttpDriver::new()));
        let url = format!("http://{address}/cookie");
        engine
            .execute_collect(RequestEnvelope::http_get("set", &url))
            .await
            .unwrap();
        engine
            .execute_collect(RequestEnvelope::http_get("read", &url))
            .await
            .unwrap();
        let second_request = cookie_rx.await.unwrap().to_ascii_lowercase();
        assert!(second_request.contains("cookie: session=apivoy"));
        server.await.unwrap();
    }

    #[test]
    fn cookie_jar_supports_manual_list_set_and_delete() {
        let driver = HttpDriver::new();
        let url = "https://api.example.com/path";
        driver.set_cookie(url, "token=abc; Path=/").unwrap();
        assert_eq!(
            driver.cookies_for(url).unwrap(),
            vec![("token".into(), "abc".into())]
        );
        driver.delete_cookie(url, "token").unwrap();
        assert!(driver.cookies_for(url).unwrap().is_empty());
    }

    #[test]
    fn request_cookies_merge_with_jar_and_override_matching_names() {
        assert_eq!(
            merge_cookie_values(
                Some("session=from-jar; theme=dark"),
                &["session=from-request; local=yes"]
            ),
            Some("session=from-request; theme=dark; local=yes".into())
        );
    }

    #[test]
    fn cookie_delete_covers_non_root_paths_and_parent_domains() {
        let driver = HttpDriver::new();
        let url = "https://api.example.com/v1/users";
        driver
            .set_cookie(url, "scoped=abc; Path=/v1; Domain=example.com")
            .unwrap();
        assert_eq!(
            driver.cookies_for(url).unwrap(),
            vec![("scoped".into(), "abc".into())]
        );
        driver.delete_cookie(url, "scoped").unwrap();
        assert!(driver.cookies_for(url).unwrap().is_empty());
    }

    #[test]
    fn cookie_delete_covers_paths_with_a_trailing_slash() {
        let driver = HttpDriver::new();
        let url = "https://api.example.com/v1/users/";
        driver.set_cookie(url, "scoped=abc; Path=/v1/").unwrap();
        assert_eq!(
            driver.cookies_for(url).unwrap(),
            vec![("scoped".into(), "abc".into())]
        );
        driver.delete_cookie(url, "scoped").unwrap();
        assert!(driver.cookies_for(url).unwrap().is_empty());
    }

    #[tokio::test]
    async fn sends_text_and_binary_multipart_parts() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (request_tx, request_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let size = stream.read(&mut buffer).await.unwrap();
                if size == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..size]);
                if let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    let headers = String::from_utf8_lossy(&bytes[..header_end + 4]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(str::trim)
                                .and_then(|value| value.parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() >= header_end + 4 + length {
                        break;
                    }
                }
            }
            let _ = request_tx.send(bytes);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
        });
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(HttpDriver::new()));
        let mut request =
            RequestEnvelope::http_get("multipart", format!("http://{address}/upload"));
        if let ProtocolPayload::Http(payload) = &mut request.payload {
            payload.method = "POST".into();
            payload.multipart = vec![
                MultipartPart {
                    name: "title".into(),
                    value: "ApiVoy".into(),
                    file_name: None,
                    content_type: None,
                    base64: false,
                },
                MultipartPart {
                    name: "file".into(),
                    value: BASE64.encode(b"binary-data"),
                    file_name: Some("sample.bin".into()),
                    content_type: Some("application/octet-stream".into()),
                    base64: true,
                },
            ];
        }
        engine.execute_collect(request).await.unwrap();
        let wire = String::from_utf8_lossy(&request_rx.await.unwrap()).into_owned();
        assert!(wire
            .to_ascii_lowercase()
            .contains("content-type: multipart/form-data; boundary="));
        assert!(wire.contains("name=\"title\""));
        assert!(wire.contains("ApiVoy"));
        assert!(wire.contains("filename=\"sample.bin\""));
        assert!(wire.contains("binary-data"));
        server.await.unwrap();
    }
}
