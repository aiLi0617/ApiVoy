use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use rdkafka::{
    config::ClientConfig,
    consumer::{CommitMode, Consumer, StreamConsumer},
    message::Message,
    producer::{FutureProducer, FutureRecord},
};
use serde_json::Value;
use std::time::Instant;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;
#[derive(Debug, Default)]
pub struct KafkaDriver;
#[derive(Debug)]
struct KafkaRequest {
    mode: String,
    brokers: String,
    topic: String,
    key: Option<String>,
    payload: Vec<u8>,
    partition: Option<i32>,
    group_id: String,
    offset_reset: String,
    auto_commit: bool,
    receive_limit: usize,
    security_protocol: String,
    sasl_mechanism: String,
    username: Option<String>,
    password: Option<String>,
    ca_pem: Option<String>,
    certificate_pem: Option<String>,
    key_pem: Option<String>,
    key_password: Option<String>,
}
fn raw(value: &Value) -> &Value {
    value.get("value").unwrap_or(value)
}
fn secret(
    request: &RequestEnvelope,
    value: &Value,
    key: &str,
) -> Result<Option<String>, DriverError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|reference| {
            request
                .runtime_secrets
                .get(reference)
                .cloned()
                .ok_or_else(|| {
                    DriverError::Validation(format!(
                        "Kafka secret `{reference}` for {key} is unavailable"
                    ))
                })
        })
        .transpose()
}
fn decode(request: &RequestEnvelope) -> Result<KafkaRequest, DriverError> {
    let ProtocolPayload::Raw(value) = &request.payload else {
        return Err(DriverError::Validation("Kafka requires raw payload".into()));
    };
    let value = raw(value);
    let brokers = request
        .target
        .strip_prefix("kafka://")
        .unwrap_or(&request.target)
        .to_owned();
    let encoding = value
        .get("encoding")
        .and_then(Value::as_str)
        .unwrap_or("text");
    let data = value.get("payload").and_then(Value::as_str).unwrap_or("");
    let payload = if encoding == "base64" {
        BASE64.decode(data).map_err(|error| {
            DriverError::Validation(format!("invalid Kafka base64 payload: {error}"))
        })?
    } else {
        data.as_bytes().to_vec()
    };
    Ok(KafkaRequest {
        mode: value
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("produce")
            .into(),
        brokers,
        topic: value
            .get("topic")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        key: value
            .get("key")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .map(str::to_owned),
        payload,
        partition: value
            .get("partition")
            .and_then(Value::as_i64)
            .map(|v| v as i32)
            .filter(|v| *v >= 0),
        group_id: value
            .get("groupId")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .unwrap_or("apivoy-consumer")
            .into(),
        offset_reset: value
            .get("offsetReset")
            .and_then(Value::as_str)
            .unwrap_or("latest")
            .into(),
        auto_commit: value
            .get("autoCommit")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        receive_limit: value
            .get("receiveLimit")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .clamp(1, 10_000) as usize,
        security_protocol: value
            .get("securityProtocol")
            .and_then(Value::as_str)
            .unwrap_or("PLAINTEXT")
            .into(),
        sasl_mechanism: value
            .get("saslMechanism")
            .and_then(Value::as_str)
            .unwrap_or("PLAIN")
            .into(),
        username: value
            .get("username")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .map(str::to_owned),
        password: secret(request, value, "passwordRef")?,
        ca_pem: secret(request, value, "caPemRef")?,
        certificate_pem: secret(request, value, "certificatePemRef")?,
        key_pem: secret(request, value, "keyPemRef")?,
        key_password: secret(request, value, "keyPasswordRef")?,
    })
}
fn config(payload: &KafkaRequest) -> ClientConfig {
    let mut config = ClientConfig::new();
    config
        .set("bootstrap.servers", &payload.brokers)
        .set("security.protocol", &payload.security_protocol)
        .set("socket.keepalive.enable", "true");
    if payload.security_protocol.contains("SASL") {
        config.set("sasl.mechanism", &payload.sasl_mechanism);
        if let Some(value) = &payload.username {
            config.set("sasl.username", value);
        }
        if let Some(value) = &payload.password {
            config.set("sasl.password", value);
        }
    }
    if let Some(value) = &payload.ca_pem {
        config.set("ssl.ca.pem", value);
    }
    if let Some(value) = &payload.certificate_pem {
        config.set("ssl.certificate.pem", value);
    }
    if let Some(value) = &payload.key_pem {
        config.set("ssl.key.pem", value);
    }
    if let Some(value) = &payload.key_password {
        config.set("ssl.key.password", value);
    }
    config
}
fn err(error: impl std::fmt::Display) -> DriverError {
    DriverError::Protocol(error.to_string())
}
#[async_trait]
impl ProtocolDriver for KafkaDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "kafka".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "Apache Kafka".into(),
            capabilities: vec![
                "produce".into(),
                "consume".into(),
                "consumer-groups".into(),
                "manual-commit".into(),
                "tls".into(),
                "sasl".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        match decode(request) {
            Ok(payload) => {
                if payload.brokers.trim().is_empty() {
                    report
                        .errors
                        .push("Kafka bootstrap brokers are required".into())
                }
                if payload.topic.trim().is_empty() {
                    report.errors.push("Kafka topic is required".into())
                }
                if !matches!(payload.mode.as_str(), "produce" | "consume") {
                    report
                        .errors
                        .push("Kafka mode must be produce or consume".into())
                }
                if !matches!(
                    payload.offset_reset.as_str(),
                    "earliest" | "latest" | "error"
                ) {
                    report
                        .errors
                        .push("Kafka offsetReset must be earliest, latest, or error".into())
                }
                if payload.security_protocol.contains("SASL")
                    && (payload.username.is_none() || payload.password.is_none())
                {
                    report
                        .errors
                        .push("Kafka SASL requires username and passwordRef".into())
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
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: None,
                status_text: Some("Kafka client initialized".into()),
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
        if payload.mode == "produce" {
            let producer: FutureProducer = config(&payload)
                .set("message.timeout.ms", request.timeout_ms.to_string())
                .create()
                .map_err(err)?;
            let mut record = FutureRecord::to(&payload.topic).payload(&payload.payload);
            if let Some(key) = payload.key.as_deref() {
                record = record.key(key);
            }
            if let Some(partition) = payload.partition {
                record = record.partition(partition);
            }
            let delivery = tokio::select! {_ = cancel.cancelled()=>return Err(DriverError::Cancelled),result=producer.send(record,Duration::from_millis(request.timeout_ms.max(1)))=>result.map_err(|(error,_)|err(error))?};
            let preview=serde_json::to_string_pretty(&serde_json::json!({"produced":true,"topic":payload.topic,"partition":delivery.partition,"offset":delivery.offset,"timestamp":format!("{:?}",delivery.timestamp),"bytes":payload.payload.len()})).map_err(err)?;
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
            let consumer: StreamConsumer = config(&payload)
                .set("group.id", &payload.group_id)
                .set("enable.auto.commit", payload.auto_commit.to_string())
                .set("auto.offset.reset", &payload.offset_reset)
                .create()
                .map_err(err)?;
            consumer.subscribe(&[&payload.topic]).map_err(err)?;
            for index in 0..payload.receive_limit {
                let message = tokio::select! {_ = cancel.cancelled()=>return Err(DriverError::Cancelled),result=timeout(Duration::from_millis(request.timeout_ms.max(1)),consumer.recv())=>result.map_err(|_|DriverError::Timeout("Kafka consume timed out".into()))?.map_err(err)?};
                let bytes = message.payload().unwrap_or_default();
                let preview=serde_json::to_string_pretty(&serde_json::json!({"topic":message.topic(),"partition":message.partition(),"offset":message.offset(),"timestamp":format!("{:?}",message.timestamp()),"key":message.key().and_then(|v|std::str::from_utf8(v).ok()),"keyBase64":message.key().map(|v|BASE64.encode(v)),"payload":std::str::from_utf8(bytes).ok(),"payloadBase64":BASE64.encode(bytes)})).map_err(err)?;
                received += preview.len();
                if !payload.auto_commit {
                    consumer
                        .commit_message(&message, CommitMode::Sync)
                        .map_err(err)?;
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
    fn validates_sasl_secrets() {
        let mut request = RequestEnvelope::http_get("Kafka", "kafka://localhost:9092");
        request.protocol_id = ProtocolId("kafka".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"mode":"produce","topic":"events","securityProtocol":"SASL_SSL","username":"user","passwordRef":"pass"}),
        );
        assert!(!KafkaDriver.validate(&request).is_valid());
        request
            .runtime_secrets
            .insert("pass".into(), "secret".into());
        assert!(KafkaDriver.validate(&request).is_valid());
    }
    #[test]
    fn config_accepts_tls_pem_secrets() {
        let request = KafkaRequest {
            mode: "produce".into(),
            brokers: "localhost:9092".into(),
            topic: "x".into(),
            key: None,
            payload: vec![],
            partition: None,
            group_id: "g".into(),
            offset_reset: "latest".into(),
            auto_commit: false,
            receive_limit: 1,
            security_protocol: "SSL".into(),
            sasl_mechanism: "PLAIN".into(),
            username: None,
            password: None,
            ca_pem: Some("pem".into()),
            certificate_pem: None,
            key_pem: None,
            key_password: None,
        };
        let _ = config(&request);
    }
}
