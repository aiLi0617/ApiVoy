use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use futures::{SinkExt, StreamExt};
use http::{HeaderName, HeaderValue};
use std::time::Instant;
use tokio::time::{sleep, timeout, Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Default)]
pub struct WebSocketDriver;

fn binary(data: &str) -> Result<Vec<u8>, DriverError> {
    BASE64.decode(data).map_err(|error| {
        DriverError::Validation(format!("binary WebSocket message must be base64: {error}"))
    })
}

fn build_handshake(
    request: &RequestEnvelope,
    payload: &core_domain::WebSocketPayload,
) -> Result<http::Request<()>, DriverError> {
    let mut handshake = request
        .target
        .clone()
        .into_client_request()
        .map_err(|error| DriverError::Validation(error.to_string()))?;
    for (name, value) in &payload.headers {
        handshake.headers_mut().insert(
            HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| DriverError::Validation(error.to_string()))?,
            HeaderValue::from_str(value)
                .map_err(|error| DriverError::Validation(error.to_string()))?,
        );
    }
    if !payload.subprotocols.is_empty() {
        handshake.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            HeaderValue::from_str(&payload.subprotocols.join(", "))
                .map_err(|error| DriverError::Validation(error.to_string()))?,
        );
    }
    Ok(handshake)
}

#[async_trait]
impl ProtocolDriver for WebSocketDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "websocket".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "WebSocket".into(),
            capabilities: vec![
                "text-frame".into(),
                "binary-frame".into(),
                "subprotocol".into(),
                "ping-pong".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if !(request.target.starts_with("ws://") || request.target.starts_with("wss://")) {
            report
                .errors
                .push("WebSocket target must start with ws:// or wss://".into());
        }
        match &request.payload {
            ProtocolPayload::Websocket(payload) => {
                for message in &payload.messages {
                    if message.encoding != "text" && message.encoding != "binary" {
                        report
                            .errors
                            .push("WebSocket message encoding must be text or binary".into());
                    } else if message.encoding == "binary" {
                        if let Err(error) = binary(&message.data) {
                            report.errors.push(error.to_string());
                        }
                    }
                }
            }
            _ => report
                .errors
                .push("WebSocket driver requires WebSocket payload".into()),
        };
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
        let ProtocolPayload::Websocket(payload) = &request.payload else {
            return Err(DriverError::Validation(
                "WebSocket driver requires WebSocket payload".into(),
            ));
        };
        let handshake = build_handshake(&request, payload)?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let mut bytes_received = 0u64;
        let mut frames = 0usize;
        let limit = payload.receive_limit.unwrap_or(usize::MAX);
        let mut reconnect_count = 0u32;
        let status_code = loop {
            let connection = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), value = connect_async(handshake.clone()) => value };
            let (mut socket, response) = match connection {
                Ok(value) => value,
                Err(error) if reconnect_count < payload.reconnect_max => {
                    reconnect_count += 1;
                    events.emit(ExecutionEvent::Warning { code: "websocket_reconnect".into(), message: format!("WebSocket connection failed: {error}; reconnecting ({reconnect_count}/{})", payload.reconnect_max) }).await;
                    tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), _ = sleep(Duration::from_millis(payload.reconnect_delay_ms)) => {} }
                    continue;
                }
                Err(error) => return Err(DriverError::Connection(error.to_string())),
            };
            let current_status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .map(|(name, value)| {
                    (
                        name.to_string(),
                        value.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect();
            events
                .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                    status: Some(current_status),
                    status_text: response.status().canonical_reason().map(str::to_owned),
                    headers,
                    content_type: None,
                    size_hint: None,
                }))
                .await;
            for message in &payload.messages {
                let frame = if message.encoding == "binary" {
                    Message::Binary(binary(&message.data)?.into())
                } else {
                    Message::Text(message.data.clone().into())
                };
                socket
                    .send(frame)
                    .await
                    .map_err(|error| DriverError::Protocol(error.to_string()))?;
            }
            events
                .emit(ExecutionEvent::StateChanged {
                    state: ExecutionState::Running,
                    phase: Some(ExecutionPhase::Transfer),
                })
                .await;
            while frames < limit {
                let next = tokio::select! { _ = cancel.cancelled() => { let _ = socket.close(None).await; return Err(DriverError::Cancelled); }, value = timeout(Duration::from_millis(request.timeout_ms.max(1)), socket.next()) => value.unwrap_or_default() };
                let Some(frame) = next else { break };
                let frame = match frame {
                    Ok(value) => value,
                    Err(_) => break,
                };
                match frame {
                    Message::Text(value) => {
                        let data = value.as_bytes();
                        bytes_received += data.len() as u64;
                        frames += 1;
                        events
                            .emit(ExecutionEvent::ResponseChunk {
                                content_type: Some("text/plain".into()),
                                size: data.len() as u64,
                                preview: Some(value.to_string()),
                                data_base64: Some(BASE64.encode(data)),
                                done: false,
                            })
                            .await;
                    }
                    Message::Binary(value) => {
                        bytes_received += value.len() as u64;
                        frames += 1;
                        events
                            .emit(ExecutionEvent::ResponseChunk {
                                content_type: Some("application/octet-stream".into()),
                                size: value.len() as u64,
                                preview: Some(format!("[binary frame: {} bytes]", value.len())),
                                data_base64: Some(BASE64.encode(&value)),
                                done: false,
                            })
                            .await;
                    }
                    Message::Ping(value) => {
                        socket
                            .send(Message::Pong(value))
                            .await
                            .map_err(|error| DriverError::Protocol(error.to_string()))?;
                        events
                            .emit(ExecutionEvent::Log {
                                level: "debug".into(),
                                message: "WebSocket ping/pong".into(),
                            })
                            .await;
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            let _ = socket.close(None).await;
            if frames >= limit || reconnect_count >= payload.reconnect_max {
                break current_status;
            }
            reconnect_count += 1;
            events
                .emit(ExecutionEvent::Warning {
                    code: "websocket_reconnect".into(),
                    message: format!(
                        "WebSocket disconnected; reconnecting ({reconnect_count}/{})",
                        payload.reconnect_max
                    ),
                })
                .await;
            tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), _ = sleep(Duration::from_millis(payload.reconnect_delay_ms)) => {} }
        };
        events
            .emit(ExecutionEvent::ResponseChunk {
                content_type: None,
                size: 0,
                preview: None,
                data_base64: None,
                done: true,
            })
            .await;
        let result = ExecutionSummary {
            execution_id,
            request_id: request.id.0,
            protocol_id: "websocket".into(),
            state: ExecutionState::Completed,
            started_at,
            finished_at: Utc::now(),
            duration_ms: wall.elapsed().as_millis() as u64,
            bytes_received,
            status: Some(status_code),
        };
        events
            .emit(ExecutionEvent::Completed {
                summary: result.clone(),
            })
            .await;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_domain::{ProtocolId, WebSocketMessage, WebSocketPayload};
    use execution_engine::ProtocolDriver;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;
    #[tokio::test]
    async fn sends_and_receives_text_and_binary_frames() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            while let Some(Ok(message)) = socket.next().await {
                if message.is_text() || message.is_binary() {
                    socket.send(message).await.unwrap();
                }
            }
        });
        let mut request = RequestEnvelope::http_get("WS", format!("ws://{address}"));
        request.protocol_id = ProtocolId("websocket".into());
        request.timeout_ms = 1000;
        request.payload = ProtocolPayload::Websocket(WebSocketPayload {
            headers: vec![],
            subprotocols: vec![],
            messages: vec![
                WebSocketMessage {
                    encoding: "text".into(),
                    data: "hello".into(),
                },
                WebSocketMessage {
                    encoding: "binary".into(),
                    data: BASE64.encode(b"bin"),
                },
            ],
            receive_limit: Some(2),
            reconnect_max: 0,
            reconnect_delay_ms: 1_000,
        });
        let (sink, mut receiver) = EventSink::channel();
        let result = WebSocketDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert_eq!(result.bytes_received, 8);
    }

    #[tokio::test]
    async fn reconnects_until_receive_limit_is_reached() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            for index in 0..2 {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = accept_async(stream).await.unwrap();
                socket
                    .send(Message::Text(format!("frame-{index}").into()))
                    .await
                    .unwrap();
                socket.close(None).await.unwrap();
            }
        });
        let mut request =
            RequestEnvelope::http_get("WebSocket reconnect", format!("ws://{address}"));
        request.protocol_id = ProtocolId("websocket".into());
        request.timeout_ms = 500;
        request.payload = ProtocolPayload::Websocket(WebSocketPayload {
            headers: vec![],
            subprotocols: vec![],
            messages: vec![],
            receive_limit: Some(2),
            reconnect_max: 1,
            reconnect_delay_ms: 1,
        });
        let (sink, mut receiver) = EventSink::channel();
        let result = WebSocketDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        let mut warning = false;
        while let Some(event) = receiver.recv().await {
            warning |= matches!(event, ExecutionEvent::Warning { ref code, .. } if code == "websocket_reconnect");
        }
        assert!(warning);
        assert_eq!(result.bytes_received, 14);
    }
}
