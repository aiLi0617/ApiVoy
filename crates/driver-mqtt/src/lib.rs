use std::{sync::Arc, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use rustls_pki_types::{pem::PemObject, CertificateDer};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};
use tokio_rustls::{rustls, TlsConnector};
use tokio_util::sync::CancellationToken;

trait AsyncSocket: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncSocket for T {}

#[derive(Debug, Default)]
pub struct MqttDriver;

#[derive(Debug)]
struct MqttRequest {
    mode: String,
    client_id: String,
    username: Option<String>,
    password: Option<String>,
    clean_session: bool,
    keep_alive: u16,
    topic: String,
    payload: Vec<u8>,
    qos: u8,
    retain: bool,
    receive_limit: usize,
    ca_pem: Option<String>,
    server_name: Option<String>,
}

fn raw(value: &Value) -> &Value {
    value.get("value").unwrap_or(value)
}

fn request_payload(request: &RequestEnvelope) -> Result<MqttRequest, DriverError> {
    let ProtocolPayload::Raw(value) = &request.payload else {
        return Err(DriverError::Validation("MQTT requires raw payload".into()));
    };
    let value = raw(value);
    let mode = value
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("publish")
        .to_owned();
    let encoding = value
        .get("encoding")
        .and_then(Value::as_str)
        .unwrap_or("text");
    let data = value.get("payload").and_then(Value::as_str).unwrap_or("");
    let payload = if encoding == "base64" {
        BASE64.decode(data).map_err(|error| {
            DriverError::Validation(format!("invalid MQTT base64 payload: {error}"))
        })?
    } else {
        data.as_bytes().to_vec()
    };
    let password = value
        .get("passwordRef")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|secret_ref| {
            request
                .runtime_secrets
                .get(secret_ref)
                .cloned()
                .ok_or_else(|| {
                    DriverError::Validation(format!(
                        "MQTT password secret `{secret_ref}` is unavailable"
                    ))
                })
        })
        .transpose()?;
    Ok(MqttRequest {
        mode,
        client_id: value
            .get("clientId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or("apivoy-client")
            .to_owned(),
        username: value
            .get("username")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        password,
        clean_session: value
            .get("cleanSession")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        keep_alive: value
            .get("keepAliveSeconds")
            .and_then(Value::as_u64)
            .unwrap_or(30)
            .min(u16::MAX as u64) as u16,
        topic: value
            .get("topic")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        payload,
        qos: value.get("qos").and_then(Value::as_u64).unwrap_or(0) as u8,
        retain: value
            .get("retain")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        receive_limit: value
            .get("receiveLimit")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .clamp(1, 10_000) as usize,
        ca_pem: value
            .get("caPemRef")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(|secret_ref| {
                request
                    .runtime_secrets
                    .get(secret_ref)
                    .cloned()
                    .ok_or_else(|| {
                        DriverError::Validation(format!(
                            "MQTT CA secret `{secret_ref}` is unavailable"
                        ))
                    })
            })
            .transpose()?,
        server_name: value
            .get("serverName")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
    })
}

fn target(target: &str) -> Result<(String, bool), DriverError> {
    let tls = target.starts_with("mqtts://");
    let value = target
        .strip_prefix(if tls { "mqtts://" } else { "mqtt://" })
        .unwrap_or(target)
        .split('/')
        .next()
        .unwrap_or("");
    if value.is_empty() {
        return Err(DriverError::Validation("MQTT target is required".into()));
    }
    Ok((
        if value.contains(':') {
            value.to_owned()
        } else {
            format!("{value}:{}", if tls { 8883 } else { 1883 })
        },
        tls,
    ))
}

fn target_host(address: &str) -> String {
    address
        .strip_prefix('[')
        .and_then(|value| value.split_once(']'))
        .map(|(host, _)| host.to_owned())
        .or_else(|| address.rsplit_once(':').map(|(host, _)| host.to_owned()))
        .unwrap_or_else(|| address.to_owned())
}

async fn connect(
    target_value: &str,
    payload: &MqttRequest,
    request: &RequestEnvelope,
) -> Result<Box<dyn AsyncSocket>, DriverError> {
    let (address, tls) = target(target_value)?;
    let stream = TcpStream::connect(&address)
        .await
        .map_err(|error| DriverError::Connection(error.to_string()))?;
    if !tls {
        return Ok(Box::new(stream));
    }
    if !request.tls.verify {
        return Err(DriverError::Validation(
            "MQTTS certificate verification cannot be disabled".into(),
        ));
    }
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    if let Some(pem) = &payload.ca_pem {
        let certificates = CertificateDer::pem_slice_iter(pem.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| DriverError::Validation(format!("invalid MQTT CA PEM: {error}")))?;
        if certificates.is_empty() {
            return Err(DriverError::Validation(
                "MQTT CA PEM contains no certificates".into(),
            ));
        }
        for certificate in certificates {
            roots.add(certificate).map_err(|error| {
                DriverError::Validation(format!("invalid MQTT CA certificate: {error}"))
            })?;
        }
    }
    let config = rustls::ClientConfig::builder_with_provider(
        rustls::crypto::ring::default_provider().into(),
    )
    .with_safe_default_protocol_versions()
    .map_err(|error| DriverError::Tls(error.to_string()))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    let name = payload
        .server_name
        .clone()
        .unwrap_or_else(|| target_host(&address));
    let server_name = rustls::pki_types::ServerName::try_from(name)
        .map_err(|error| DriverError::Validation(format!("invalid MQTTS server name: {error}")))?;
    let tls = TlsConnector::from(Arc::new(config))
        .connect(server_name, stream)
        .await
        .map_err(|error| DriverError::Tls(error.to_string()))?;
    Ok(Box::new(tls))
}

fn push_utf8(output: &mut Vec<u8>, value: &str) -> Result<(), DriverError> {
    if value.len() > u16::MAX as usize {
        return Err(DriverError::Validation(
            "MQTT string exceeds 65535 bytes".into(),
        ));
    }
    output.extend_from_slice(&(value.len() as u16).to_be_bytes());
    output.extend_from_slice(value.as_bytes());
    Ok(())
}

fn remaining_length(mut length: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    loop {
        let mut byte = (length % 128) as u8;
        length /= 128;
        if length > 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if length == 0 {
            break;
        }
    }
    bytes
}

fn packet(header: u8, body: Vec<u8>) -> Vec<u8> {
    let mut output = vec![header];
    output.extend(remaining_length(body.len()));
    output.extend(body);
    output
}

fn connect_packet(payload: &MqttRequest) -> Result<Vec<u8>, DriverError> {
    let mut body = Vec::new();
    push_utf8(&mut body, "MQTT")?;
    body.push(4);
    let mut flags = if payload.clean_session { 0x02 } else { 0 };
    if payload.username.is_some() {
        flags |= 0x80;
    }
    if payload.password.is_some() {
        flags |= 0x40;
    }
    body.push(flags);
    body.extend_from_slice(&payload.keep_alive.to_be_bytes());
    push_utf8(&mut body, &payload.client_id)?;
    if let Some(username) = &payload.username {
        push_utf8(&mut body, username)?;
    }
    if let Some(password) = &payload.password {
        push_utf8(&mut body, password)?;
    }
    Ok(packet(0x10, body))
}

fn publish_packet(payload: &MqttRequest, packet_id: u16) -> Result<Vec<u8>, DriverError> {
    let mut body = Vec::new();
    push_utf8(&mut body, &payload.topic)?;
    if payload.qos > 0 {
        body.extend_from_slice(&packet_id.to_be_bytes());
    }
    body.extend_from_slice(&payload.payload);
    Ok(packet(
        0x30 | (payload.qos << 1) | u8::from(payload.retain),
        body,
    ))
}

fn subscribe_packet(topic: &str, qos: u8, packet_id: u16) -> Result<Vec<u8>, DriverError> {
    let mut body = packet_id.to_be_bytes().to_vec();
    push_utf8(&mut body, topic)?;
    body.push(qos);
    Ok(packet(0x82, body))
}

async fn read_packet(
    stream: &mut dyn AsyncSocket,
    timeout_ms: u64,
    cancel: &CancellationToken,
) -> Result<(u8, Vec<u8>), DriverError> {
    let mut header = [0u8; 1];
    tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), result = timeout(Duration::from_millis(timeout_ms.max(1)), stream.read_exact(&mut header)) => result.map_err(|_| DriverError::Timeout("MQTT packet timed out".into()))?.map_err(|error| DriverError::Connection(error.to_string()))? };
    let mut multiplier = 1usize;
    let mut length = 0usize;
    for index in 0..4 {
        let mut byte = [0u8; 1];
        stream
            .read_exact(&mut byte)
            .await
            .map_err(|error| DriverError::Connection(error.to_string()))?;
        length += ((byte[0] & 127) as usize) * multiplier;
        if byte[0] & 128 == 0 {
            break;
        }
        if index == 3 {
            return Err(DriverError::Protocol(
                "invalid MQTT remaining length".into(),
            ));
        }
        multiplier *= 128;
    }
    if length > 64 * 1024 * 1024 {
        return Err(DriverError::Protocol("MQTT packet exceeds 64 MiB".into()));
    }
    let mut body = vec![0; length];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|error| DriverError::Connection(error.to_string()))?;
    Ok((header[0], body))
}

fn incoming_publish(
    header: u8,
    body: &[u8],
) -> Result<(String, Vec<u8>, Option<u16>), DriverError> {
    if body.len() < 2 {
        return Err(DriverError::Protocol("truncated MQTT PUBLISH".into()));
    }
    let topic_length = u16::from_be_bytes([body[0], body[1]]) as usize;
    if body.len() < 2 + topic_length {
        return Err(DriverError::Protocol("truncated MQTT topic".into()));
    }
    let topic = std::str::from_utf8(&body[2..2 + topic_length])
        .map_err(|_| DriverError::Protocol("MQTT topic is not UTF-8".into()))?
        .to_owned();
    let qos = (header >> 1) & 3;
    let mut cursor = 2 + topic_length;
    let packet_id = if qos > 0 {
        if body.len() < cursor + 2 {
            return Err(DriverError::Protocol("missing MQTT packet id".into()));
        }
        let id = u16::from_be_bytes([body[cursor], body[cursor + 1]]);
        cursor += 2;
        Some(id)
    } else {
        None
    };
    Ok((topic, body[cursor..].to_vec(), packet_id))
}

async fn emit(events: &mut EventSink, value: Value, done: bool) -> Result<usize, DriverError> {
    let preview = serde_json::to_string_pretty(&value)
        .map_err(|error| DriverError::Internal(error.to_string()))?;
    events
        .emit(ExecutionEvent::ResponseChunk {
            content_type: Some("application/json".into()),
            size: preview.len() as u64,
            preview: Some(preview.clone()),
            data_base64: Some(BASE64.encode(preview.as_bytes())),
            done,
        })
        .await;
    Ok(preview.len())
}

#[async_trait]
impl ProtocolDriver for MqttDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "mqtt".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "MQTT 3.1.1".into(),
            capabilities: vec![
                "publish".into(),
                "subscribe".into(),
                "qos0".into(),
                "qos1".into(),
                "qos2".into(),
                "tls".into(),
                "auth".into(),
                "retain".into(),
                "cancel".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if let Err(error) = target(&request.target) {
            report.errors.push(error.to_string());
        }
        match request_payload(request) {
            Ok(payload) => {
                if !matches!(payload.mode.as_str(), "publish" | "subscribe") {
                    report
                        .errors
                        .push("MQTT mode must be publish or subscribe".into());
                }
                if payload.topic.is_empty() {
                    report.errors.push("MQTT topic is required".into());
                }
                if payload.qos > 2 {
                    report.errors.push("MQTT QoS must be 0, 1, or 2".into());
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
        let payload = request_payload(&request)?;
        target(&request.target)?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let mut stream = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), result = timeout(Duration::from_millis(request.timeout_ms.max(1)), connect(&request.target, &payload, &request)) => result.map_err(|_| DriverError::Timeout("MQTT connection timed out".into()))?? };
        stream
            .write_all(&connect_packet(&payload)?)
            .await
            .map_err(|error| DriverError::Connection(error.to_string()))?;
        let (header, connack) = read_packet(&mut *stream, request.timeout_ms, &cancel).await?;
        if header >> 4 != 2 || connack.len() != 2 {
            return Err(DriverError::Protocol("expected MQTT CONNACK".into()));
        }
        if connack[1] != 0 {
            return Err(DriverError::Protocol(format!(
                "MQTT broker rejected connection with code {}",
                connack[1]
            )));
        }
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: None,
                status_text: Some("MQTT connected".into()),
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
            stream
                .write_all(&publish_packet(&payload, 1)?)
                .await
                .map_err(|error| DriverError::Connection(error.to_string()))?;
            if payload.qos == 1 {
                let (header, body) = read_packet(&mut *stream, request.timeout_ms, &cancel).await?;
                if header >> 4 != 4 || body != [0, 1] {
                    return Err(DriverError::Protocol(
                        "expected matching MQTT PUBACK".into(),
                    ));
                }
            }
            if payload.qos == 2 {
                let (header, body) = read_packet(&mut *stream, request.timeout_ms, &cancel).await?;
                if header >> 4 != 5 || body != [0, 1] {
                    return Err(DriverError::Protocol(
                        "expected matching MQTT PUBREC".into(),
                    ));
                }
                stream
                    .write_all(&packet(0x62, vec![0, 1]))
                    .await
                    .map_err(|error| DriverError::Connection(error.to_string()))?;
                let (header, body) = read_packet(&mut *stream, request.timeout_ms, &cancel).await?;
                if header >> 4 != 7 || body != [0, 1] {
                    return Err(DriverError::Protocol(
                        "expected matching MQTT PUBCOMP".into(),
                    ));
                }
            }
            received += emit(&mut events, serde_json::json!({"published":true,"topic":payload.topic,"qos":payload.qos,"bytes":payload.payload.len(),"retained":payload.retain}), true).await?;
        } else {
            stream
                .write_all(&subscribe_packet(&payload.topic, payload.qos, 1)?)
                .await
                .map_err(|error| DriverError::Connection(error.to_string()))?;
            let (header, body) = read_packet(&mut *stream, request.timeout_ms, &cancel).await?;
            if header >> 4 != 9 || body.len() < 3 || body[..2] != [0, 1] || body[2] == 0x80 {
                return Err(DriverError::Protocol(
                    "MQTT subscription was rejected".into(),
                ));
            }
            for index in 0..payload.receive_limit {
                let (header, body) = read_packet(&mut *stream, request.timeout_ms, &cancel).await?;
                if header >> 4 != 3 {
                    continue;
                }
                let (topic, data, packet_id) = incoming_publish(header, &body)?;
                if let Some(id) = packet_id.filter(|_| ((header >> 1) & 3) == 1) {
                    stream
                        .write_all(&packet(0x40, id.to_be_bytes().to_vec()))
                        .await
                        .map_err(|error| DriverError::Connection(error.to_string()))?;
                }
                if let Some(id) = packet_id.filter(|_| ((header >> 1) & 3) == 2) {
                    stream
                        .write_all(&packet(0x50, id.to_be_bytes().to_vec()))
                        .await
                        .map_err(|error| DriverError::Connection(error.to_string()))?;
                    let (reply_header, reply_body) =
                        read_packet(&mut *stream, request.timeout_ms, &cancel).await?;
                    if reply_header != 0x62 || reply_body != id.to_be_bytes() {
                        return Err(DriverError::Protocol(
                            "expected matching MQTT PUBREL".into(),
                        ));
                    }
                    stream
                        .write_all(&packet(0x70, id.to_be_bytes().to_vec()))
                        .await
                        .map_err(|error| DriverError::Connection(error.to_string()))?;
                }
                let text = std::str::from_utf8(&data).ok();
                received += emit(&mut events, serde_json::json!({"topic":topic,"qos":(header>>1)&3,"retain":header&1!=0,"payload":text,"payloadBase64":BASE64.encode(&data)}), index + 1 == payload.receive_limit).await?;
            }
        }
        let _ = stream.write_all(&[0xe0, 0]).await;
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
    use tokio::net::TcpListener;
    #[test]
    fn encodes_remaining_lengths() {
        assert_eq!(remaining_length(127), vec![127]);
        assert_eq!(remaining_length(128), vec![128, 1]);
    }
    #[tokio::test]
    async fn connects_and_publishes_qos_one() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let (kind, _) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(kind >> 4, 1);
            socket.write_all(&[0x20, 2, 0, 0]).await.unwrap();
            let (kind, body) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(kind >> 4, 3);
            assert!(body.windows(5).any(|value| value == b"hello"));
            socket.write_all(&[0x40, 2, 0, 1]).await.unwrap();
        });
        let mut request = RequestEnvelope::http_get("MQTT", format!("mqtt://{address}"));
        request.protocol_id = ProtocolId("mqtt".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"mode":"publish","clientId":"test","topic":"demo/topic","payload":"hello","qos":1}),
        );
        let (sink, mut receiver) = EventSink::channel();
        let summary = MqttDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert!(summary.bytes_received > 0);
    }

    #[tokio::test]
    async fn subscribes_and_acknowledges_qos_one_message() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            socket.write_all(&[0x20, 2, 0, 0]).await.unwrap();
            let (kind, _) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(kind >> 4, 8);
            socket.write_all(&[0x90, 3, 0, 1, 1]).await.unwrap();
            let mut body = Vec::new();
            push_utf8(&mut body, "demo/topic").unwrap();
            body.extend_from_slice(&7u16.to_be_bytes());
            body.extend_from_slice(b"message");
            socket.write_all(&packet(0x32, body)).await.unwrap();
            let (kind, body) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(kind >> 4, 4);
            assert_eq!(body, [0, 7]);
        });
        let mut request = RequestEnvelope::http_get("MQTT subscribe", format!("mqtt://{address}"));
        request.protocol_id = ProtocolId("mqtt".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"mode":"subscribe","topic":"demo/topic","qos":1,"receiveLimit":1}),
        );
        let (sink, mut receiver) = EventSink::channel();
        let summary = MqttDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert!(summary.bytes_received > 0);
    }

    #[tokio::test]
    async fn completes_qos_two_publish_handshake() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            socket.write_all(&[0x20, 2, 0, 0]).await.unwrap();
            let (header, _) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!((header >> 1) & 3, 2);
            socket.write_all(&[0x50, 2, 0, 1]).await.unwrap();
            let (header, body) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(header, 0x62);
            assert_eq!(body, [0, 1]);
            socket.write_all(&[0x70, 2, 0, 1]).await.unwrap();
        });
        let mut request = RequestEnvelope::http_get("MQTT QoS2", format!("mqtt://{address}"));
        request.protocol_id = ProtocolId("mqtt".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"mode":"publish","topic":"demo/qos2","payload":"exactly once","qos":2}),
        );
        let (sink, mut receiver) = EventSink::channel();
        MqttDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
    }

    #[tokio::test]
    async fn completes_qos_two_subscriber_handshake() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            socket.write_all(&[0x20, 2, 0, 0]).await.unwrap();
            read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            socket.write_all(&[0x90, 3, 0, 1, 2]).await.unwrap();
            let mut body = Vec::new();
            push_utf8(&mut body, "demo/qos2").unwrap();
            body.extend_from_slice(&9u16.to_be_bytes());
            body.extend_from_slice(b"once");
            socket.write_all(&packet(0x34, body)).await.unwrap();
            let (header, body) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(header >> 4, 5);
            assert_eq!(body, [0, 9]);
            socket.write_all(&[0x62, 2, 0, 9]).await.unwrap();
            let (header, body) = read_packet(&mut socket, 1000, &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(header >> 4, 7);
            assert_eq!(body, [0, 9]);
        });
        let mut request =
            RequestEnvelope::http_get("MQTT QoS2 subscribe", format!("mqtt://{address}"));
        request.protocol_id = ProtocolId("mqtt".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"mode":"subscribe","topic":"demo/qos2","qos":2,"receiveLimit":1}),
        );
        let (sink, mut receiver) = EventSink::channel();
        MqttDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
    }
}
