use std::time::Instant;

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use futures::StreamExt;
use reqwest::Client;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Default)]
pub struct SseDriver {
    client: Client,
}

impl SseDriver {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .no_proxy()
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }
}

type RawSseOptions = (Vec<(String, String)>, Option<String>, u32, u64);

fn raw_options(payload: &ProtocolPayload) -> Result<RawSseOptions, DriverError> {
    let ProtocolPayload::Sse(value) = payload else {
        return Err(DriverError::Validation(
            "SSE payload must be a raw object".into(),
        ));
    };
    Ok((
        value.headers.clone(),
        value.last_event_id.clone(),
        value.reconnect_max,
        value.reconnect_delay_ms,
    ))
}

fn consume_sse_control_fields(
    buffer: &mut String,
    last_event_id: &mut Option<String>,
    reconnect_delay_ms: &mut u64,
) {
    *buffer = buffer.replace("\r\n", "\n");
    while let Some(end) = buffer.find("\n\n") {
        let event = buffer[..end].to_owned();
        buffer.drain(..end + 2);
        for line in event.lines() {
            if let Some(value) = line.strip_prefix("id:") {
                let value = value.trim_start();
                if !value.contains('\0') {
                    *last_event_id = Some(value.to_owned());
                }
            } else if let Some(value) = line.strip_prefix("retry:") {
                if let Ok(value) = value.trim().parse::<u64>() {
                    *reconnect_delay_ms = value.min(60_000);
                }
            }
        }
    }
}

#[async_trait]
impl ProtocolDriver for SseDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "sse".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "Server-Sent Events".into(),
            capabilities: vec!["streaming".into(), "reconnect-token".into(), "tls".into()],
        }
    }

    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if !(request.target.starts_with("http://") || request.target.starts_with("https://")) {
            report
                .errors
                .push("SSE target must start with http:// or https://".into());
        }
        if raw_options(&request.payload).is_err() {
            report
                .errors
                .push("SSE payload must be an object with optional headers and lastEventId".into());
        }
        report
    }

    async fn execute(
        &self,
        request: RequestEnvelope,
        mut events: EventSink,
        cancel: CancellationToken,
        execution_id: ExecutionId,
    ) -> Result<ExecutionSummary, DriverError> {
        let started_at = Utc::now();
        let wall = Instant::now();
        let (request_headers, mut last_event_id, reconnect_max, mut reconnect_delay_ms) =
            raw_options(&request.payload)?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let mut bytes_received = 0u64;
        let mut reconnect_count = 0u32;
        let mut parser_buffer = String::new();
        let (status_code, final_content_type) = loop {
            let mut builder = self
                .client
                .get(&request.target)
                .header("Accept", "text/event-stream");
            for (key, value) in &request_headers {
                builder = builder.header(key, value);
            }
            if let Some(value) = &last_event_id {
                builder = builder.header("Last-Event-ID", value);
            }
            let response = tokio::select! {
                _ = cancel.cancelled() => { events.emit(ExecutionEvent::Cancelled { reason: Some("user cancelled".into()) }).await; return Err(DriverError::Cancelled); }
                result = builder.send() => result.map_err(|error| DriverError::Connection(error.to_string()))?,
            };
            let status = response.status();
            let current_status = status.as_u16();
            let response_headers = response
                .headers()
                .iter()
                .map(|(key, value)| {
                    (
                        key.to_string(),
                        value.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect::<Vec<_>>();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            events
                .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                    status: Some(current_status),
                    status_text: status.canonical_reason().map(str::to_owned),
                    headers: response_headers,
                    content_type: content_type.clone(),
                    size_hint: response.content_length(),
                }))
                .await;
            if !status.is_success() {
                return Err(DriverError::Protocol(format!(
                    "SSE endpoint returned HTTP {}",
                    status.as_u16()
                )));
            }
            if !content_type
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains("text/event-stream")
            {
                events
                    .emit(ExecutionEvent::Warning {
                        code: "sse_content_type".into(),
                        message: "response Content-Type is not text/event-stream".into(),
                    })
                    .await;
            }
            events
                .emit(ExecutionEvent::StateChanged {
                    state: ExecutionState::Running,
                    phase: Some(ExecutionPhase::Transfer),
                })
                .await;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = tokio::select! {
                _ = cancel.cancelled() => { events.emit(ExecutionEvent::Cancelled { reason: Some("user cancelled".into()) }).await; return Err(DriverError::Cancelled); }
                next = stream.next() => next,
            } {
                let chunk = chunk.map_err(|error| DriverError::Protocol(error.to_string()))?;
                bytes_received += chunk.len() as u64;
                parser_buffer.push_str(&String::from_utf8_lossy(&chunk));
                consume_sse_control_fields(
                    &mut parser_buffer,
                    &mut last_event_id,
                    &mut reconnect_delay_ms,
                );
                events
                    .emit(ExecutionEvent::ResponseChunk {
                        content_type: content_type.clone(),
                        size: chunk.len() as u64,
                        preview: Some(String::from_utf8_lossy(&chunk).into_owned()),
                        data_base64: Some(BASE64.encode(&chunk)),
                        done: false,
                    })
                    .await;
            }
            if reconnect_count >= reconnect_max {
                break (current_status, content_type);
            }
            reconnect_count += 1;
            events
                .emit(ExecutionEvent::Warning { code: "sse_reconnect".into(), message: format!("SSE connection closed; reconnecting ({reconnect_count}/{reconnect_max}) after {reconnect_delay_ms}ms") })
                .await;
            tokio::select! {
                _ = cancel.cancelled() => { events.emit(ExecutionEvent::Cancelled { reason: Some("user cancelled during reconnect delay".into()) }).await; return Err(DriverError::Cancelled); }
                _ = sleep(Duration::from_millis(reconnect_delay_ms)) => {}
            }
        };
        events
            .emit(ExecutionEvent::ResponseChunk {
                content_type: final_content_type,
                size: 0,
                preview: None,
                data_base64: None,
                done: true,
            })
            .await;
        let summary = ExecutionSummary {
            execution_id,
            request_id: request.id.0,
            protocol_id: "sse".into(),
            state: ExecutionState::Completed,
            started_at,
            finished_at: Utc::now(),
            duration_ms: wall.elapsed().as_millis() as u64,
            bytes_received,
            status: Some(status_code),
        };
        events
            .emit(ExecutionEvent::Completed {
                summary: summary.clone(),
            })
            .await;
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_domain::{ProtocolId, SsePayload};
    use execution_engine::ProtocolDriver;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn streams_sse_bytes_and_completes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let read = socket.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..read]).contains("accept: text/event-stream"));
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\nid: 1\nevent: ping\ndata: ok\n\n").await.unwrap();
        });
        let mut request = RequestEnvelope::http_get("SSE", format!("http://{address}"));
        request.protocol_id = ProtocolId("sse".into());
        request.payload = ProtocolPayload::Sse(SsePayload {
            headers: vec![],
            last_event_id: Some("0".into()),
            reconnect_max: 0,
            reconnect_delay_ms: 1_000,
        });
        let (sink, mut receiver) = EventSink::channel();
        let summary = SseDriver::new()
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        let mut body = String::new();
        while let Some(event) = receiver.recv().await {
            if let ExecutionEvent::ResponseChunk {
                preview: Some(value),
                ..
            } = event
            {
                body.push_str(&value);
            }
        }
        assert!(body.contains("event: ping"));
        assert_eq!(summary.protocol_id, "sse");
        assert!(summary.bytes_received > 0);
    }

    #[tokio::test]
    async fn reconnects_with_latest_event_id_and_server_retry_delay() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (header_tx, header_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let mut header_tx = Some(header_tx);
            for index in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 2048];
                let read = socket.read(&mut request).await.unwrap();
                if index == 1 {
                    let _ = header_tx
                        .take()
                        .unwrap()
                        .send(String::from_utf8_lossy(&request[..read]).into_owned());
                }
                let event = if index == 0 {
                    "id: 41\nretry: 1\ndata: first\n\n"
                } else {
                    "id: 42\ndata: second\n\n"
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{event}", event.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let mut request = RequestEnvelope::http_get("SSE reconnect", format!("http://{address}"));
        request.protocol_id = ProtocolId("sse".into());
        request.payload = ProtocolPayload::Sse(SsePayload {
            headers: vec![],
            last_event_id: None,
            reconnect_max: 1,
            reconnect_delay_ms: 50,
        });
        let (sink, mut receiver) = EventSink::channel();
        let summary = SseDriver::new()
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        let mut reconnected = false;
        while let Some(event) = receiver.recv().await {
            reconnected |= matches!(event, ExecutionEvent::Warning { ref code, .. } if code == "sse_reconnect");
        }
        assert!(reconnected);
        assert!(header_rx
            .await
            .unwrap()
            .to_ascii_lowercase()
            .contains("last-event-id: 41"));
        assert!(summary.bytes_received > 0);
    }
}
