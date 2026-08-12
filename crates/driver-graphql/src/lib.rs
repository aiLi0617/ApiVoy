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
use reqwest::Client;
use serde_json::json;
use std::time::Instant;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Default)]
pub struct GraphqlDriver {
    client: Client,
}
impl GraphqlDriver {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .no_proxy()
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }
}

fn is_subscription(query: &str) -> bool {
    query.trim_start().starts_with("subscription")
}

async fn execute_subscription(
    request: &RequestEnvelope,
    payload: &core_domain::GraphqlPayload,
    events: &mut EventSink,
    cancel: &CancellationToken,
) -> Result<(u64, u16), DriverError> {
    let target = request
        .target
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    let mut handshake = target
        .into_client_request()
        .map_err(|error| DriverError::Validation(error.to_string()))?;
    handshake.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_static("graphql-transport-ws"),
    );
    for (name, value) in &payload.headers {
        handshake.headers_mut().insert(
            HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| DriverError::Validation(error.to_string()))?,
            HeaderValue::from_str(value)
                .map_err(|error| DriverError::Validation(error.to_string()))?,
        );
    }
    let (mut socket, response) = tokio::select! {
        _ = cancel.cancelled() => return Err(DriverError::Cancelled),
        result = connect_async(handshake) => result.map_err(|error| DriverError::Connection(error.to_string()))?,
    };
    let status = response.status().as_u16();
    events
        .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
            status: Some(status),
            status_text: Some("WebSocket Switching Protocols".into()),
            headers: response
                .headers()
                .iter()
                .map(|(name, value)| {
                    (
                        name.to_string(),
                        value.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect(),
            content_type: Some("application/graphql-response+json".into()),
            size_hint: None,
        }))
        .await;
    socket
        .send(Message::Text(
            json!({"type":"connection_init"}).to_string().into(),
        ))
        .await
        .map_err(|error| DriverError::Protocol(error.to_string()))?;
    loop {
        let message = tokio::select! { _ = cancel.cancelled() => { let _ = socket.close(None).await; return Err(DriverError::Cancelled); }, next = socket.next() => next };
        let Some(message) = message else {
            return Err(DriverError::Protocol(
                "GraphQL subscription closed before connection_ack".into(),
            ));
        };
        let message = message.map_err(|error| DriverError::Protocol(error.to_string()))?;
        if let Message::Text(text) = message {
            let value: serde_json::Value = serde_json::from_str(&text)
                .map_err(|error| DriverError::Protocol(error.to_string()))?;
            if value["type"] == "connection_ack" {
                break;
            }
            if value["type"] == "ping" {
                socket
                    .send(Message::Text(json!({"type":"pong"}).to_string().into()))
                    .await
                    .map_err(|error| DriverError::Protocol(error.to_string()))?;
            }
            if value["type"] == "connection_error" {
                return Err(DriverError::Protocol(text.to_string()));
            }
        }
    }
    socket.send(Message::Text(json!({"id":"1","type":"subscribe","payload":{"query":payload.query,"variables":payload.variables,"operationName":payload.operation_name}}).to_string().into())).await.map_err(|error| DriverError::Protocol(error.to_string()))?;
    events
        .emit(ExecutionEvent::StateChanged {
            state: ExecutionState::Running,
            phase: Some(ExecutionPhase::Transfer),
        })
        .await;
    let mut bytes_received = 0u64;
    while let Some(message) = tokio::select! { _ = cancel.cancelled() => { let _ = socket.send(Message::Text(json!({"id":"1","type":"complete"}).to_string().into())).await; let _ = socket.close(None).await; return Err(DriverError::Cancelled); }, next = socket.next() => next }
    {
        let message = message.map_err(|error| DriverError::Protocol(error.to_string()))?;
        match message {
            Message::Text(text) => {
                let value: serde_json::Value = serde_json::from_str(&text)
                    .map_err(|error| DriverError::Protocol(error.to_string()))?;
                match value["type"].as_str() {
                    Some("next") | Some("error") => {
                        let preview = serde_json::to_string_pretty(&value["payload"])
                            .unwrap_or_else(|_| value["payload"].to_string());
                        bytes_received += preview.len() as u64;
                        events
                            .emit(ExecutionEvent::ResponseChunk {
                                content_type: Some("application/graphql-response+json".into()),
                                size: preview.len() as u64,
                                preview: Some(preview.clone()),
                                data_base64: Some(BASE64.encode(preview.as_bytes())),
                                done: false,
                            })
                            .await;
                        if value["type"] == "error" {
                            events
                                .emit(ExecutionEvent::Warning {
                                    code: "graphql_subscription_error".into(),
                                    message: preview,
                                })
                                .await;
                        }
                    }
                    Some("complete") => break,
                    Some("ping") => {
                        socket
                            .send(Message::Text(
                                json!({"type":"pong","payload":value["payload"]})
                                    .to_string()
                                    .into(),
                            ))
                            .await
                            .map_err(|error| DriverError::Protocol(error.to_string()))?;
                    }
                    _ => {}
                }
            }
            Message::Ping(value) => {
                socket
                    .send(Message::Pong(value))
                    .await
                    .map_err(|error| DriverError::Protocol(error.to_string()))?;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    events
        .emit(ExecutionEvent::ResponseChunk {
            content_type: Some("application/graphql-response+json".into()),
            size: 0,
            preview: None,
            data_base64: None,
            done: true,
        })
        .await;
    Ok((bytes_received, status))
}

#[async_trait]
impl ProtocolDriver for GraphqlDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "graphql".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "GraphQL".into(),
            capabilities: vec![
                "query".into(),
                "mutation".into(),
                "variables".into(),
                "operation-name".into(),
                "subscription".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        let subscription = matches!(&request.payload, ProtocolPayload::Graphql(payload) if is_subscription(&payload.query));
        if !(request.target.starts_with("http://")
            || request.target.starts_with("https://")
            || (subscription
                && (request.target.starts_with("ws://") || request.target.starts_with("wss://"))))
        {
            report
                .errors
                .push("GraphQL endpoint must be HTTP(S), or WS(S) for a subscription".into());
        }
        match &request.payload {
            ProtocolPayload::Graphql(payload) if payload.query.trim().is_empty() => {
                report.errors.push("GraphQL query is required".into())
            }
            ProtocolPayload::Graphql(_) => {}
            _ => report
                .errors
                .push("GraphQL driver requires GraphQL payload".into()),
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
        let ProtocolPayload::Graphql(payload) = &request.payload else {
            return Err(DriverError::Validation(
                "GraphQL driver requires GraphQL payload".into(),
            ));
        };
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        if is_subscription(&payload.query) {
            let (bytes_received, status) =
                execute_subscription(&request, payload, &mut events, &cancel).await?;
            let result = ExecutionSummary {
                execution_id,
                request_id: request.id.0,
                protocol_id: "graphql".into(),
                state: ExecutionState::Completed,
                started_at,
                finished_at: Utc::now(),
                duration_ms: wall.elapsed().as_millis() as u64,
                bytes_received,
                status: Some(status),
            };
            events
                .emit(ExecutionEvent::Completed {
                    summary: result.clone(),
                })
                .await;
            return Ok(result);
        }
        let mut builder = self.client.post(&request.target).json(&json!({ "query": payload.query, "variables": payload.variables, "operationName": payload.operation_name }));
        for (name, value) in &payload.headers {
            builder = builder.header(name, value);
        }
        let response = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), result = builder.send() => result.map_err(|error| DriverError::Connection(error.to_string()))? };
        let status = response.status();
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
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: Some(status.as_u16()),
                status_text: status.canonical_reason().map(str::to_owned),
                headers,
                content_type: content_type.clone(),
                size_hint: response.content_length(),
            }))
            .await;
        let bytes = response
            .bytes()
            .await
            .map_err(|error| DriverError::Protocol(error.to_string()))?;
        let preview = String::from_utf8_lossy(&bytes).into_owned();
        events
            .emit(ExecutionEvent::ResponseChunk {
                content_type,
                size: bytes.len() as u64,
                preview: Some(preview.clone()),
                data_base64: Some(BASE64.encode(&bytes)),
                done: true,
            })
            .await;
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            if let Some(errors) = value.get("errors").and_then(|item| item.as_array()) {
                if !errors.is_empty() {
                    events
                        .emit(ExecutionEvent::Warning {
                            code: "graphql_errors".into(),
                            message: format!("GraphQL response contains {} error(s)", errors.len()),
                        })
                        .await;
                }
            }
        }
        let result = ExecutionSummary {
            execution_id,
            request_id: request.id.0,
            protocol_id: "graphql".into(),
            state: ExecutionState::Completed,
            started_at,
            finished_at: Utc::now(),
            duration_ms: wall.elapsed().as_millis() as u64,
            bytes_received: bytes.len() as u64,
            status: Some(status.as_u16()),
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
    use core_domain::{GraphqlPayload, ProtocolId};
    use execution_engine::ProtocolDriver;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{
        accept_hdr_async,
        tungstenite::handshake::server::{Request, Response},
    };
    #[tokio::test]
    async fn sends_graphql_json_and_receives_data() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 4096];
            let read = socket.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.contains("query"));
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{\"data\":{\"ok\":true}}").await.unwrap();
        });
        let mut request = RequestEnvelope::http_get("GraphQL", format!("http://{address}"));
        request.protocol_id = ProtocolId("graphql".into());
        request.payload = ProtocolPayload::Graphql(GraphqlPayload {
            query: "query { ok }".into(),
            variables: json!({}),
            operation_name: None,
            headers: vec![],
        });
        let (sink, mut receiver) = EventSink::channel();
        let result = GraphqlDriver::new()
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert_eq!(result.status, Some(200));
    }

    #[tokio::test]
    #[allow(clippy::result_large_err)] // Signature is fixed by tungstenite's handshake callback.
    async fn receives_graphql_transport_ws_subscription_events() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket =
                accept_hdr_async(stream, |request: &Request, mut response: Response| {
                    assert_eq!(
                        request.headers()["sec-websocket-protocol"],
                        "graphql-transport-ws"
                    );
                    response.headers_mut().insert(
                        "Sec-WebSocket-Protocol",
                        HeaderValue::from_static("graphql-transport-ws"),
                    );
                    Ok(response)
                })
                .await
                .unwrap();
            let init = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&init).unwrap()["type"],
                "connection_init"
            );
            socket
                .send(Message::Text(
                    json!({"type":"connection_ack"}).to_string().into(),
                ))
                .await
                .unwrap();
            let subscribe = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&subscribe).unwrap()["type"],
                "subscribe"
            );
            socket
                .send(Message::Text(
                    json!({"id":"1","type":"next","payload":{"data":{"event":"ready"}}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    json!({"id":"1","type":"complete"}).to_string().into(),
                ))
                .await
                .unwrap();
        });
        let mut request = RequestEnvelope::http_get("Subscription", format!("http://{address}"));
        request.protocol_id = ProtocolId("graphql".into());
        request.payload = ProtocolPayload::Graphql(GraphqlPayload {
            query: "subscription { event }".into(),
            variables: json!({}),
            operation_name: None,
            headers: vec![],
        });
        let (sink, mut receiver) = EventSink::channel();
        let events = tokio::spawn(async move {
            let mut previews = Vec::new();
            while let Some(event) = receiver.recv().await {
                if let ExecutionEvent::ResponseChunk {
                    preview: Some(value),
                    ..
                } = event
                {
                    previews.push(value);
                }
            }
            previews
        });
        let result = GraphqlDriver::new()
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        let previews = events.await.unwrap();
        assert_eq!(result.status, Some(101));
        assert!(previews.iter().any(|value| value.contains("ready")));
    }
}
