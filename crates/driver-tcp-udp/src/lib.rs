use std::{io::BufReader, sync::Arc, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::time::{sleep, timeout, Duration};
use tokio_rustls::{rustls, TlsConnector};
use tokio_util::sync::CancellationToken;

trait AsyncSocket: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncSocket for T {}

fn target_host(address: &str) -> String {
    if let Some(value) = address
        .strip_prefix('[')
        .and_then(|value| value.split_once(']'))
        .map(|(host, _)| host)
    {
        return value.to_owned();
    }
    address
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(address)
        .to_owned()
}

async fn connect_tcp(
    address: &str,
    payload: &core_domain::SocketPayload,
    request: &RequestEnvelope,
) -> Result<Box<dyn AsyncSocket>, DriverError> {
    let stream = TcpStream::connect(address)
        .await
        .map_err(|error| DriverError::Connection(error.to_string()))?;
    if !payload.tls {
        return Ok(Box::new(stream));
    }
    if !request.tls.verify {
        return Err(DriverError::Validation(
            "TCP TLS certificate verification cannot be disabled".into(),
        ));
    }
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    if let Some(secret_ref) = payload.ca_cert_ref.as_deref() {
        let pem = request.runtime_secrets.get(secret_ref).ok_or_else(|| {
            DriverError::Validation(format!("TCP TLS CA secret `{secret_ref}` is unavailable"))
        })?;
        let mut reader = BufReader::new(pem.as_bytes());
        let certificates = rustls_pemfile::certs(&mut reader)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                DriverError::Validation(format!("invalid CA PEM `{secret_ref}`: {error}"))
            })?;
        if certificates.is_empty() {
            return Err(DriverError::Validation(format!(
                "CA PEM `{secret_ref}` contains no certificates"
            )));
        }
        for certificate in certificates {
            roots.add(certificate).map_err(|error| {
                DriverError::Validation(format!("invalid CA certificate `{secret_ref}`: {error}"))
            })?;
        }
    }
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = payload
        .server_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| target_host(address));
    let server_name = rustls::pki_types::ServerName::try_from(server_name).map_err(|error| {
        DriverError::Validation(format!("invalid TCP TLS server name: {error}"))
    })?;
    let tls = TlsConnector::from(Arc::new(config))
        .connect(server_name, stream)
        .await
        .map_err(|error| DriverError::Tls(error.to_string()))?;
    Ok(Box::new(tls))
}

fn decode_data(data: &str, encoding: &str) -> Result<Vec<u8>, DriverError> {
    if encoding.eq_ignore_ascii_case("text") {
        return Ok(data.as_bytes().to_vec());
    }
    if !encoding.eq_ignore_ascii_case("hex") {
        return Err(DriverError::Validation(
            "encoding must be text or hex".into(),
        ));
    }
    let compact: String = data
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    if compact.len() % 2 != 0 {
        return Err(DriverError::Validation(
            "hex data must contain an even number of digits".into(),
        ));
    }
    (0..compact.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&compact[index..index + 2], 16)
                .map_err(|_| DriverError::Validation(format!("invalid hex byte at offset {index}")))
        })
        .collect()
}

fn target(request: &RequestEnvelope, scheme: &str) -> Result<String, DriverError> {
    let value = request
        .target
        .strip_prefix(&format!("{scheme}://"))
        .unwrap_or(&request.target);
    if !value.contains(':') {
        return Err(DriverError::Validation(format!(
            "{scheme} target must be host:port"
        )));
    }
    Ok(value.to_owned())
}

fn summary(
    request: &RequestEnvelope,
    execution_id: ExecutionId,
    started_at: chrono::DateTime<Utc>,
    wall: Instant,
    bytes_received: u64,
) -> ExecutionSummary {
    ExecutionSummary {
        execution_id,
        request_id: request.id.0,
        protocol_id: request.protocol_id.0.clone(),
        state: ExecutionState::Completed,
        started_at,
        finished_at: Utc::now(),
        duration_ms: wall.elapsed().as_millis() as u64,
        bytes_received,
        status: None,
    }
}

async fn emit_chunk(events: &mut EventSink, data: &[u8], done: bool) {
    events
        .emit(ExecutionEvent::ResponseChunk {
            content_type: Some("application/octet-stream".into()),
            size: data.len() as u64,
            preview: if data.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(data).into_owned())
            },
            data_base64: if data.is_empty() {
                None
            } else {
                Some(BASE64.encode(data))
            },
            done,
        })
        .await;
}

#[derive(Debug, Default)]
pub struct TcpDriver;

#[async_trait]
impl ProtocolDriver for TcpDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "tcp".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "TCP".into(),
            capabilities: vec![
                "text".into(),
                "hex".into(),
                "delimiter-framing".into(),
                "fixed-framing".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if target(request, "tcp").is_err() {
            report
                .errors
                .push("TCP target must be host:port or tcp://host:port".into());
        }
        match &request.payload {
            ProtocolPayload::Tcp(payload) => {
                if let Err(error) = decode_data(&payload.data, &payload.encoding) {
                    report.errors.push(error.to_string());
                }
                if payload.send_count == 0 {
                    report
                        .errors
                        .push("TCP sendCount must be at least 1".into());
                }
                if payload.tls {
                    report.warnings.push(
                        "TCP TLS enabled; server certificate verification is mandatory".into(),
                    );
                    if let Some(secret_ref) = payload.ca_cert_ref.as_deref() {
                        if !request.runtime_secrets.contains_key(secret_ref) {
                            report
                                .errors
                                .push(format!("TCP TLS CA secret `{secret_ref}` is unavailable"));
                        }
                    }
                }
            }
            _ => report.errors.push("TCP driver requires TCP payload".into()),
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
        let address = target(&request, "tcp")?;
        let ProtocolPayload::Tcp(payload) = &request.payload else {
            return Err(DriverError::Validation(
                "TCP driver requires TCP payload".into(),
            ));
        };
        let outgoing = decode_data(&payload.data, &payload.encoding)?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let mut stream = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), value = connect_tcp(&address, payload, &request) => value? };
        for index in 0..payload.send_count.max(1) {
            stream
                .write_all(&outgoing)
                .await
                .map_err(|error| DriverError::Connection(error.to_string()))?;
            if index + 1 < payload.send_count && payload.interval_ms > 0 {
                tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), _ = sleep(Duration::from_millis(payload.interval_ms)) => {} }
            }
        }
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: None,
                status_text: None,
                headers: vec![],
                content_type: Some("application/octet-stream".into()),
                size_hint: None,
            }))
            .await;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Transfer),
            })
            .await;
        let mut received = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let read = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), value = timeout(Duration::from_millis(request.timeout_ms.max(1)), stream.read(&mut buffer)) => match value { Ok(value) => value.map_err(|error| DriverError::Connection(error.to_string()))?, Err(_) => break } };
            if read == 0 {
                break;
            }
            received.extend_from_slice(&buffer[..read]);
            emit_chunk(&mut events, &buffer[..read], false).await;
            let complete = match payload.framing.as_deref() {
                Some("fixed") => payload
                    .fixed_length
                    .is_some_and(|length| received.len() >= length),
                Some("delimiter") => payload
                    .delimiter
                    .as_ref()
                    .filter(|delimiter| !delimiter.is_empty())
                    .is_some_and(|delimiter| {
                        received
                            .windows(delimiter.len())
                            .any(|window| window == delimiter.as_bytes())
                    }),
                _ => false,
            };
            if complete {
                break;
            }
        }
        emit_chunk(&mut events, &[], true).await;
        let result = summary(
            &request,
            execution_id,
            started_at,
            wall,
            received.len() as u64,
        );
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
    use core_domain::{ProtocolId, SocketPayload, UdpPayload};
    use execution_engine::ProtocolDriver;
    use tokio::net::{TcpListener, UdpSocket};

    #[tokio::test]
    async fn tcp_text_round_trip() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 16];
            socket.read_exact(&mut buffer[..8]).await.unwrap();
            socket.write_all(&buffer[..8]).await.unwrap();
        });
        let mut request = RequestEnvelope::http_get("TCP", format!("tcp://{address}"));
        request.protocol_id = ProtocolId("tcp".into());
        request.timeout_ms = 100;
        request.payload = ProtocolPayload::Tcp(SocketPayload {
            data: "ping".into(),
            encoding: "text".into(),
            framing: Some("fixed".into()),
            delimiter: None,
            fixed_length: Some(8),
            send_count: 2,
            interval_ms: 1,
            tls: false,
            server_name: None,
            ca_cert_ref: None,
        });
        let (sink, mut receiver) = EventSink::channel();
        let result = TcpDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert_eq!(result.bytes_received, 8);
    }

    #[tokio::test]
    async fn tcp_tls_round_trip_with_custom_ca_and_sni() {
        let key = rcgen::KeyPair::generate().unwrap();
        let certificate = rcgen::CertificateParams::new(vec!["localhost".into()])
            .unwrap()
            .self_signed(&key)
            .unwrap();
        let server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![certificate.der().clone()],
                rustls::pki_types::PrivateKeyDer::Pkcs8(
                    rustls::pki_types::PrivatePkcs8KeyDer::from(key.serialize_der()),
                ),
            )
            .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = acceptor.accept(socket).await.unwrap();
            let mut buffer = [0u8; 4];
            socket.read_exact(&mut buffer).await.unwrap();
            socket.write_all(&buffer).await.unwrap();
        });
        let mut request = RequestEnvelope::http_get("TCP TLS", format!("tcp://{address}"));
        request.protocol_id = ProtocolId("tcp".into());
        request.timeout_ms = 500;
        request
            .runtime_secrets
            .insert("test-ca".into(), certificate.pem());
        request.payload = ProtocolPayload::Tcp(SocketPayload {
            data: "ping".into(),
            encoding: "text".into(),
            framing: Some("fixed".into()),
            delimiter: None,
            fixed_length: Some(4),
            send_count: 1,
            interval_ms: 0,
            tls: true,
            server_name: Some("localhost".into()),
            ca_cert_ref: Some("test-ca".into()),
        });
        let (sink, mut receiver) = EventSink::channel();
        let result = TcpDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert_eq!(result.bytes_received, 4);
    }

    #[tokio::test]
    async fn udp_hex_round_trip() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let address = server.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buffer = [0u8; 16];
            let (size, peer) = server.recv_from(&mut buffer).await.unwrap();
            server.send_to(&buffer[..size], peer).await.unwrap();
        });
        let mut request = RequestEnvelope::http_get("UDP", format!("udp://{address}"));
        request.protocol_id = ProtocolId("udp".into());
        request.timeout_ms = 500;
        request.payload = ProtocolPayload::Udp(UdpPayload {
            data: "70 69 6e 67".into(),
            encoding: "hex".into(),
            send_count: 1,
            interval_ms: 0,
        });
        let (sink, mut receiver) = EventSink::channel();
        let result = UdpDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert_eq!(result.bytes_received, 4);
    }
}

#[derive(Debug, Default)]
pub struct UdpDriver;

#[async_trait]
impl ProtocolDriver for UdpDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "udp".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "UDP".into(),
            capabilities: vec!["text".into(), "hex".into(), "repeat-send".into()],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if target(request, "udp").is_err() {
            report
                .errors
                .push("UDP target must be host:port or udp://host:port".into());
        }
        match &request.payload {
            ProtocolPayload::Udp(payload) => {
                if let Err(error) = decode_data(&payload.data, &payload.encoding) {
                    report.errors.push(error.to_string());
                }
            }
            _ => report.errors.push("UDP driver requires UDP payload".into()),
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
        let address = target(&request, "udp")?;
        let ProtocolPayload::Udp(payload) = &request.payload else {
            return Err(DriverError::Validation(
                "UDP driver requires UDP payload".into(),
            ));
        };
        let outgoing = decode_data(&payload.data, &payload.encoding)?;
        let socket = UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(|error| DriverError::Connection(error.to_string()))?;
        socket
            .connect(address)
            .await
            .map_err(|error| DriverError::Connection(error.to_string()))?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Transfer),
            })
            .await;
        for index in 0..payload.send_count.max(1) {
            tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), result = socket.send(&outgoing) => { result.map_err(|error| DriverError::Connection(error.to_string()))?; } }
            if index + 1 < payload.send_count.max(1) {
                sleep(Duration::from_millis(payload.interval_ms)).await;
            }
        }
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: None,
                status_text: None,
                headers: vec![],
                content_type: Some("application/octet-stream".into()),
                size_hint: None,
            }))
            .await;
        let mut buffer = [0u8; 65535];
        let received = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), value = timeout(Duration::from_millis(request.timeout_ms.max(1)), socket.recv(&mut buffer)) => match value { Ok(Ok(size)) => size, Ok(Err(error)) => return Err(DriverError::Connection(error.to_string())), Err(_) => 0 } };
        if received > 0 {
            emit_chunk(&mut events, &buffer[..received], false).await;
        }
        emit_chunk(&mut events, &[], true).await;
        let result = summary(&request, execution_id, started_at, wall, received as u64);
        events
            .emit(ExecutionEvent::Completed {
                summary: result.clone(),
            })
            .await;
        Ok(result)
    }
}
