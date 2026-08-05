//! Built-in HTTP/HTTPS driver (MVP Phase 0 scaffold).

use std::time::Instant;

use async_trait::async_trait;
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use futures::StreamExt;
use reqwest::{Client, Method, redirect::Policy};
use tokio_util::sync::CancellationToken;
use tracing::instrument;

#[derive(Debug, Default)]
pub struct HttpDriver {
    client: Client,
}

impl HttpDriver {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(concat!("ApiVoy/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client }
    }
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
        } else if !(request.target.starts_with("http://")
            || request.target.starts_with("https://"))
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
            }
            ProtocolPayload::Raw(_) => {
                report
                    .errors
                    .push("HTTP driver requires ProtocolPayload::Http".into());
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
        let ProtocolPayload::Http(payload) = request.payload else {
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

        let mut builder = self.client.request(method, &request.target);
        for (k, v) in &payload.headers {
            builder = builder.header(k, v);
        }
        if let Some(body) = &payload.body {
            builder = builder.body(body.clone());
        }
        if !payload.follow_redirects {
            // Rebuild a one-off client without redirects when needed.
            let no_redirect = Client::builder()
                .redirect(Policy::none())
                .user_agent(concat!("ApiVoy/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| DriverError::Internal(e.to_string()))?;
            builder = no_redirect.request(
                Method::from_bytes(payload.method.as_bytes())
                    .map_err(|e| DriverError::Validation(e.to_string()))?,
                &request.target,
            );
            for (k, v) in &payload.headers {
                builder = builder.header(k, v);
            }
            if let Some(body) = &payload.body {
                builder = builder.body(body.clone());
            }
        }

        let timeout = std::time::Duration::from_millis(request.timeout_ms.max(1));
        let send_fut = builder.timeout(timeout).send();

        let response = tokio::select! {
            _ = cancel.cancelled() => {
                events.emit(ExecutionEvent::Cancelled { reason: Some("user cancelled".into()) }).await;
                return Err(DriverError::Cancelled);
            }
            result = send_fut => {
                result.map_err(|e| {
                    if e.is_timeout() {
                        DriverError::Timeout(e.to_string())
                    } else if e.is_connect() {
                        DriverError::Connection(e.to_string())
                    } else {
                        DriverError::Protocol(e.to_string())
                    }
                })?
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
                            if preview.len() < 4_096 {
                                let remain = 4_096 - preview.len();
                                let slice = &chunk[..chunk.len().min(remain)];
                                preview.push_str(&String::from_utf8_lossy(slice));
                            }
                            events.emit(ExecutionEvent::ResponseChunk {
                                content_type: content_type.clone(),
                                size: chunk.len() as u64,
                                preview: None,
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
    use core_domain::RequestEnvelope;
    use execution_engine::ExecutionEngine;
    use std::sync::Arc;

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
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(HttpDriver::new()));
        let req = RequestEnvelope::http_get("example", "https://example.com");
        let result = engine.execute_collect(req).await;
        assert!(result.is_ok(), "expected ok, got {result:?}");
        let (id, summary, events) = result.unwrap();
        assert_eq!(summary.execution_id.0, id.0);
        assert_eq!(summary.status, Some(200));
        assert!(events.iter().any(|e| matches!(e, ExecutionEvent::ResponseMeta(_))));
        let completed_id = events.iter().find_map(|e| match e {
            ExecutionEvent::Completed { summary } => Some(summary.execution_id.0),
            _ => None,
        });
        assert_eq!(completed_id, Some(id.0));
    }
}
