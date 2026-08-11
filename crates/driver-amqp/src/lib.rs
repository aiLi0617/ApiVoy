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
use lapin::{
    options::*, types::FieldTable, BasicProperties, Connection, ConnectionProperties, ExchangeKind,
};
use serde_json::Value;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Debug, Default)]
pub struct AmqpDriver;

#[derive(Debug)]
struct AmqpRequest {
    mode: String,
    uri: String,
    exchange: String,
    exchange_type: String,
    routing_key: String,
    queue: String,
    declare: bool,
    durable: bool,
    auto_ack: bool,
    receive_limit: usize,
    payload: Vec<u8>,
    content_type: String,
}
fn raw(value: &Value) -> &Value {
    value.get("value").unwrap_or(value)
}
fn decode(request: &RequestEnvelope) -> Result<AmqpRequest, DriverError> {
    let ProtocolPayload::Raw(value) = &request.payload else {
        return Err(DriverError::Validation("AMQP requires raw payload".into()));
    };
    let value = raw(value);
    let mut uri = Url::parse(&request.target)
        .map_err(|error| DriverError::Validation(format!("invalid AMQP target: {error}")))?;
    if !matches!(uri.scheme(), "amqp" | "amqps") {
        return Err(DriverError::Validation(
            "AMQP target must use amqp:// or amqps://".into(),
        ));
    }
    if let Some(username) = value
        .get("username")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        uri.set_username(username)
            .map_err(|_| DriverError::Validation("invalid AMQP username".into()))?;
    }
    if let Some(secret_ref) = value
        .get("passwordRef")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let secret = request.runtime_secrets.get(secret_ref).ok_or_else(|| {
            DriverError::Validation(format!(
                "AMQP password secret `{secret_ref}` is unavailable"
            ))
        })?;
        uri.set_password(Some(secret))
            .map_err(|_| DriverError::Validation("invalid AMQP password".into()))?;
    }
    let encoding = value
        .get("encoding")
        .and_then(Value::as_str)
        .unwrap_or("text");
    let data = value.get("payload").and_then(Value::as_str).unwrap_or("");
    let payload = if encoding == "base64" {
        BASE64.decode(data).map_err(|error| {
            DriverError::Validation(format!("invalid AMQP base64 payload: {error}"))
        })?
    } else {
        data.as_bytes().to_vec()
    };
    Ok(AmqpRequest {
        mode: value
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("publish")
            .into(),
        uri: uri.to_string(),
        exchange: value
            .get("exchange")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        exchange_type: value
            .get("exchangeType")
            .and_then(Value::as_str)
            .unwrap_or("direct")
            .into(),
        routing_key: value
            .get("routingKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        queue: value
            .get("queue")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        declare: value
            .get("declare")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        durable: value
            .get("durable")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        auto_ack: value
            .get("autoAck")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        receive_limit: value
            .get("receiveLimit")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .clamp(1, 10_000) as usize,
        payload,
        content_type: value
            .get("contentType")
            .and_then(Value::as_str)
            .unwrap_or("application/octet-stream")
            .into(),
    })
}
fn exchange_kind(value: &str) -> Result<ExchangeKind, DriverError> {
    match value {
        "direct" => Ok(ExchangeKind::Direct),
        "fanout" => Ok(ExchangeKind::Fanout),
        "topic" => Ok(ExchangeKind::Topic),
        "headers" => Ok(ExchangeKind::Headers),
        _ => Err(DriverError::Validation(
            "exchangeType must be direct, fanout, topic, or headers".into(),
        )),
    }
}
fn driver_error(error: impl std::fmt::Display) -> DriverError {
    DriverError::Protocol(error.to_string())
}

#[async_trait]
impl ProtocolDriver for AmqpDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "amqp".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "AMQP 0-9-1".into(),
            capabilities: vec![
                "publish".into(),
                "consume".into(),
                "tls".into(),
                "publisher-confirms".into(),
                "manual-ack".into(),
                "topology".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        match decode(request) {
            Ok(payload) => {
                if !matches!(payload.mode.as_str(), "publish" | "consume") {
                    report
                        .errors
                        .push("AMQP mode must be publish or consume".into())
                }
                if payload.mode == "consume" && payload.queue.is_empty() {
                    report
                        .errors
                        .push("AMQP queue is required for consume".into())
                }
                if let Err(error) = exchange_kind(&payload.exchange_type) {
                    report.errors.push(error.to_string())
                }
            }
            Err(error) => report.errors.push(error.to_string()),
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
        let payload = decode(&request)?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let connection = tokio::select! {_ = cancel.cancelled()=>return Err(DriverError::Cancelled),result=timeout(Duration::from_millis(request.timeout_ms.max(1)),Connection::connect(&payload.uri,ConnectionProperties::default()))=>result.map_err(|_|DriverError::Timeout("AMQP connection timed out".into()))?.map_err(driver_error)?};
        let channel = connection.create_channel().await.map_err(driver_error)?;
        if payload.declare && !payload.exchange.is_empty() {
            channel
                .exchange_declare(
                    payload.exchange.as_str().into(),
                    exchange_kind(&payload.exchange_type)?,
                    ExchangeDeclareOptions {
                        durable: payload.durable,
                        ..Default::default()
                    },
                    FieldTable::default(),
                )
                .await
                .map_err(driver_error)?;
        }
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: None,
                status_text: Some("AMQP channel open".into()),
                headers: vec![],
                content_type: Some("application/json".into()),
                size_hint: None,
            }))
            .await;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Transfer),
            })
            .await;
        let mut received = 0usize;
        if payload.mode == "publish" {
            channel
                .confirm_select(ConfirmSelectOptions::default())
                .await
                .map_err(driver_error)?;
            let confirmation = channel
                .basic_publish(
                    payload.exchange.as_str().into(),
                    payload.routing_key.as_str().into(),
                    BasicPublishOptions {
                        mandatory: true,
                        ..Default::default()
                    },
                    &payload.payload,
                    BasicProperties::default()
                        .with_content_type(payload.content_type.clone().into())
                        .with_delivery_mode(if payload.durable { 2 } else { 1 }),
                )
                .await
                .map_err(driver_error)?
                .await
                .map_err(driver_error)?;
            let preview=serde_json::to_string_pretty(&serde_json::json!({"published":!confirmation.is_nack(),"exchange":payload.exchange,"routingKey":payload.routing_key,"bytes":payload.payload.len(),"confirmation":format!("{confirmation:?}")})).map_err(driver_error)?;
            received = preview.len();
            events
                .emit(ExecutionEvent::ResponseChunk {
                    content_type: Some("application/json".into()),
                    size: received as u64,
                    preview: Some(preview.clone()),
                    data_base64: Some(BASE64.encode(preview)),
                    done: true,
                })
                .await;
        } else {
            if payload.declare {
                channel
                    .queue_declare(
                        payload.queue.as_str().into(),
                        QueueDeclareOptions {
                            durable: payload.durable,
                            ..Default::default()
                        },
                        FieldTable::default(),
                    )
                    .await
                    .map_err(driver_error)?;
                if !payload.exchange.is_empty() {
                    channel
                        .queue_bind(
                            payload.queue.as_str().into(),
                            payload.exchange.as_str().into(),
                            payload.routing_key.as_str().into(),
                            QueueBindOptions::default(),
                            FieldTable::default(),
                        )
                        .await
                        .map_err(driver_error)?;
                }
            }
            let mut consumer = channel
                .basic_consume(
                    payload.queue.as_str().into(),
                    format!("apivoy-{}", execution_id.0).into(),
                    BasicConsumeOptions {
                        no_ack: payload.auto_ack,
                        ..Default::default()
                    },
                    FieldTable::default(),
                )
                .await
                .map_err(driver_error)?;
            for index in 0..payload.receive_limit {
                let delivery = tokio::select! {_ = cancel.cancelled()=>return Err(DriverError::Cancelled),result=timeout(Duration::from_millis(request.timeout_ms.max(1)),consumer.next())=>result.map_err(|_|DriverError::Timeout("AMQP consume timed out".into()))?.ok_or_else(||DriverError::Connection("AMQP consumer closed".into()))?.map_err(driver_error)?};
                let text = std::str::from_utf8(&delivery.data).ok();
                let preview=serde_json::to_string_pretty(&serde_json::json!({"exchange":delivery.exchange.as_str(),"routingKey":delivery.routing_key.as_str(),"redelivered":delivery.redelivered,"payload":text,"payloadBase64":BASE64.encode(&delivery.data),"properties":format!("{:?}",delivery.properties)})).map_err(driver_error)?;
                received += preview.len();
                if !payload.auto_ack {
                    delivery
                        .ack(BasicAckOptions::default())
                        .await
                        .map_err(driver_error)?;
                }
                events
                    .emit(ExecutionEvent::ResponseChunk {
                        content_type: Some("application/json".into()),
                        size: preview.len() as u64,
                        preview: Some(preview.clone()),
                        data_base64: Some(BASE64.encode(preview)),
                        done: index + 1 == payload.receive_limit,
                    })
                    .await;
            }
        }
        let _ = connection.close(200, "ApiVoy completed".into()).await;
        let summary = ExecutionSummary {
            execution_id,
            request_id: request.id.0,
            protocol_id: request.protocol_id.0,
            state: ExecutionState::Completed,
            started_at,
            finished_at: Utc::now(),
            duration_ms: wall.elapsed().as_millis() as u64,
            bytes_received: received as u64,
            status: None,
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
    use core_domain::ProtocolId;
    #[test]
    fn validates_secret_and_modes() {
        let mut request = RequestEnvelope::http_get("AMQP", "amqp://localhost/%2f");
        request.protocol_id = ProtocolId("amqp".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"mode":"consume","queue":"jobs","passwordRef":"password"}),
        );
        let report = AmqpDriver.validate(&request);
        assert!(report
            .errors
            .iter()
            .any(|error| error.contains("unavailable")));
        request
            .runtime_secrets
            .insert("password".into(), "secret".into());
        assert!(AmqpDriver.validate(&request).is_valid());
    }
    #[test]
    fn supports_standard_exchange_types() {
        for kind in ["direct", "fanout", "topic", "headers"] {
            assert!(exchange_kind(kind).is_ok())
        }
        assert!(exchange_kind("invalid").is_err());
    }
}
