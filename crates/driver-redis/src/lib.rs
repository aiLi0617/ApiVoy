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
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Default)]
pub struct RedisDriver;

#[derive(Debug)]
struct RedisRequest {
    username: Option<String>,
    password: Option<String>,
    database: Option<u64>,
    commands: Vec<Vec<String>>,
}

fn raw_value(payload: &Value) -> &Value {
    payload.get("value").unwrap_or(payload)
}

fn decode_request(request: &RequestEnvelope) -> Result<RedisRequest, DriverError> {
    let ProtocolPayload::Raw(value) = &request.payload else {
        return Err(DriverError::Validation(
            "Redis requires a raw payload".into(),
        ));
    };
    let value = raw_value(value);
    let commands = value
        .get("commands")
        .and_then(Value::as_array)
        .ok_or_else(|| DriverError::Validation("Redis commands are required".into()))?
        .iter()
        .map(|command| {
            command
                .as_array()
                .ok_or_else(|| {
                    DriverError::Validation("each Redis command must be an array".into())
                })?
                .iter()
                .map(|argument| {
                    argument.as_str().map(str::to_owned).ok_or_else(|| {
                        DriverError::Validation("Redis command arguments must be strings".into())
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .collect::<Result<Vec<_>, _>>()?;
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
                        "Redis password secret `{secret_ref}` is unavailable"
                    ))
                })
        })
        .transpose()?;
    Ok(RedisRequest {
        username: value
            .get("username")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        password,
        database: value.get("database").and_then(Value::as_u64),
        commands,
    })
}

fn address(target: &str) -> Result<String, DriverError> {
    let without_scheme = target.strip_prefix("redis://").unwrap_or(target);
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    if authority.is_empty() {
        return Err(DriverError::Validation("Redis target is required".into()));
    }
    Ok(if authority.contains(':') {
        authority.to_owned()
    } else {
        format!("{authority}:6379")
    })
}

fn encode_command(arguments: &[String]) -> Vec<u8> {
    let mut output = format!("*{}\r\n", arguments.len()).into_bytes();
    for argument in arguments {
        output.extend_from_slice(format!("${}\r\n", argument.len()).as_bytes());
        output.extend_from_slice(argument.as_bytes());
        output.extend_from_slice(b"\r\n");
    }
    output
}

fn line(input: &[u8], start: usize) -> Option<(&[u8], usize)> {
    input
        .get(start..)?
        .windows(2)
        .position(|part| part == b"\r\n")
        .map(|offset| {
            let end = start + offset;
            (&input[start..end], end + 2)
        })
}

fn parse_frame(input: &[u8]) -> Result<Option<(Value, usize)>, DriverError> {
    let Some(prefix) = input.first().copied() else {
        return Ok(None);
    };
    let Some((head, cursor)) = line(input, 1) else {
        return Ok(None);
    };
    let text = String::from_utf8_lossy(head).into_owned();
    match prefix {
        b'+' => Ok(Some((json!({"type":"string","value":text}), cursor))),
        b'-' => Ok(Some((json!({"type":"error","value":text}), cursor))),
        b':' => Ok(Some((
            json!({"type":"integer","value":text.parse::<i64>().map_err(|_| DriverError::Protocol("invalid RESP integer".into()))?}),
            cursor,
        ))),
        b'$' | b'=' | b'!' => {
            let length = text
                .parse::<i64>()
                .map_err(|_| DriverError::Protocol("invalid RESP bulk length".into()))?;
            if length < 0 {
                return Ok(Some((Value::Null, cursor)));
            }
            let end = cursor + length as usize;
            if input.len() < end + 2 {
                return Ok(None);
            }
            if &input[end..end + 2] != b"\r\n" {
                return Err(DriverError::Protocol("invalid RESP bulk terminator".into()));
            }
            let bytes = &input[cursor..end];
            let value = match std::str::from_utf8(bytes) {
                Ok(value) => {
                    json!({"type": if prefix == b'!' {"error"} else {"bulk"}, "value":value})
                }
                Err(_) => json!({"type":"binary","base64":BASE64.encode(bytes)}),
            };
            Ok(Some((value, end + 2)))
        }
        b'_' => Ok(Some((Value::Null, cursor))),
        b'#' => Ok(Some((json!(text == "t"), cursor))),
        b',' => Ok(Some((
            json!(text
                .parse::<f64>()
                .map_err(|_| DriverError::Protocol("invalid RESP double".into()))?),
            cursor,
        ))),
        b'*' | b'~' | b'>' | b'%' => {
            let count = text
                .parse::<i64>()
                .map_err(|_| DriverError::Protocol("invalid RESP aggregate length".into()))?;
            if count < 0 {
                return Ok(Some((Value::Null, cursor)));
            }
            let entries = count as usize * if prefix == b'%' { 2 } else { 1 };
            let mut values = Vec::with_capacity(entries);
            let mut used = cursor;
            for _ in 0..entries {
                let Some((value, size)) = parse_frame(&input[used..])? else {
                    return Ok(None);
                };
                values.push(value);
                used += size;
            }
            Ok(Some((
                json!({"type": if prefix == b'%' {"map"} else {"array"}, "value":values}),
                used,
            )))
        }
        _ => Err(DriverError::Protocol(format!(
            "unsupported RESP prefix 0x{prefix:02x}"
        ))),
    }
}

async fn read_frame(
    stream: &mut TcpStream,
    buffer: &mut Vec<u8>,
    timeout_ms: u64,
    cancel: &CancellationToken,
) -> Result<Value, DriverError> {
    loop {
        if let Some((value, used)) = parse_frame(buffer)? {
            buffer.drain(..used);
            return Ok(value);
        }
        let mut chunk = [0u8; 8192];
        let read = tokio::select! {
            _ = cancel.cancelled() => return Err(DriverError::Cancelled),
            result = timeout(Duration::from_millis(timeout_ms.max(1)), stream.read(&mut chunk)) => result.map_err(|_| DriverError::Timeout("Redis response timed out".into()))?.map_err(|error| DriverError::Connection(error.to_string()))?,
        };
        if read == 0 {
            return Err(DriverError::Protocol(
                "Redis connection closed before a complete response".into(),
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > 64 * 1024 * 1024 {
            return Err(DriverError::Protocol(
                "Redis response exceeds 64 MiB".into(),
            ));
        }
    }
}

#[async_trait]
impl ProtocolDriver for RedisDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "redis".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "Redis RESP2 / RESP3".into(),
            capabilities: vec![
                "resp2".into(),
                "resp3".into(),
                "auth".into(),
                "database".into(),
                "pipeline".into(),
                "cancel".into(),
            ],
        }
    }

    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if let Err(error) = address(&request.target) {
            report.errors.push(error.to_string());
        }
        match decode_request(request) {
            Ok(payload) if payload.commands.is_empty() => report
                .errors
                .push("at least one Redis command is required".into()),
            Ok(payload) if payload.commands.iter().any(Vec::is_empty) => {
                report.errors.push("Redis commands cannot be empty".into())
            }
            Err(error) => report.errors.push(error.to_string()),
            _ => {}
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
        let payload = decode_request(&request)?;
        let address = address(&request.target)?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let mut stream = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), result = timeout(Duration::from_millis(request.timeout_ms.max(1)), TcpStream::connect(address)) => result.map_err(|_| DriverError::Timeout("Redis connection timed out".into()))?.map_err(|error| DriverError::Connection(error.to_string()))? };
        let mut commands = Vec::new();
        if let Some(password) = payload.password {
            commands.push(if let Some(username) = payload.username {
                vec!["AUTH".into(), username, password]
            } else {
                vec!["AUTH".into(), password]
            });
        }
        if let Some(database) = payload.database {
            commands.push(vec!["SELECT".into(), database.to_string()]);
        }
        let setup_count = commands.len();
        commands.extend(payload.commands);
        let outgoing = commands
            .iter()
            .flat_map(|command| encode_command(command))
            .collect::<Vec<_>>();
        tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), result = stream.write_all(&outgoing) => result.map_err(|error| DriverError::Connection(error.to_string()))? };
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: None,
                status_text: None,
                headers: vec![],
                content_type: Some("application/x-redis-resp".into()),
                size_hint: None,
            }))
            .await;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Transfer),
            })
            .await;
        let mut buffer = Vec::new();
        let mut responses = Vec::new();
        for index in 0..commands.len() {
            let value = read_frame(&mut stream, &mut buffer, request.timeout_ms, &cancel).await?;
            if index < setup_count && value.get("type").and_then(Value::as_str) == Some("error") {
                return Err(DriverError::Protocol(format!(
                    "Redis setup failed: {}",
                    value
                        .get("value")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown error")
                )));
            }
            if index >= setup_count {
                responses.push(value);
            }
        }
        let preview = serde_json::to_string_pretty(&responses)
            .map_err(|error| DriverError::Internal(error.to_string()))?;
        events
            .emit(ExecutionEvent::ResponseChunk {
                content_type: Some("application/json".into()),
                size: preview.len() as u64,
                preview: Some(preview.clone()),
                data_base64: Some(BASE64.encode(preview.as_bytes())),
                done: true,
            })
            .await;
        let summary = ExecutionSummary {
            execution_id,
            request_id: request.id.0,
            protocol_id: request.protocol_id.0,
            state: ExecutionState::Completed,
            started_at,
            finished_at: Utc::now(),
            duration_ms: wall.elapsed().as_millis() as u64,
            bytes_received: preview.len() as u64,
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
    fn parses_nested_and_binary_responses() {
        let input = b"*3\r\n:1\r\n$3\r\nhey\r\n$2\r\n\xff\x00\r\n";
        let (value, used) = parse_frame(input).unwrap().unwrap();
        assert_eq!(used, input.len());
        assert_eq!(value["value"][0]["value"], 1);
        assert_eq!(value["value"][2]["type"], "binary");
    }

    #[tokio::test]
    async fn authenticates_selects_and_pipelines() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![0; 512];
            let read = socket.read(&mut bytes).await.unwrap();
            let text = String::from_utf8_lossy(&bytes[..read]);
            assert!(text.contains("AUTH"));
            assert!(text.contains("SELECT"));
            assert!(text.contains("PING"));
            socket
                .write_all(b"+OK\r\n+OK\r\n+PONG\r\n:2\r\n")
                .await
                .unwrap();
        });
        let mut request = RequestEnvelope::http_get("Redis", format!("redis://{address}"));
        request.protocol_id = ProtocolId("redis".into());
        request
            .runtime_secrets
            .insert("redis-pass".into(), "secret".into());
        request.payload = ProtocolPayload::Raw(
            json!({"username":"default","passwordRef":"redis-pass","database":2,"commands":[["PING"],["DBSIZE"]]}),
        );
        let (sink, mut receiver) = EventSink::channel();
        let summary = RedisDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert!(summary.bytes_received > 0);
    }
}
