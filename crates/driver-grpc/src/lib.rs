use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use bytes::{Buf, BytesMut};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use futures::StreamExt;
use prost::Message as ProstMessage;
use prost_reflect::{DescriptorPool, DynamicMessage, MethodDescriptor};
use reqwest::Client;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

#[derive(Clone, PartialEq, ProstMessage)]
struct ReflectionRequest {
    #[prost(string, tag = "1")]
    host: String,
    #[prost(oneof = "reflection_request::MessageRequest", tags = "3, 4, 7")]
    message_request: Option<reflection_request::MessageRequest>,
}
mod reflection_request {
    #[derive(Clone, PartialEq, prost::Oneof)]
    pub enum MessageRequest {
        #[prost(string, tag = "3")]
        FileByFilename(String),
        #[prost(string, tag = "4")]
        FileContainingSymbol(String),
        #[prost(string, tag = "7")]
        ListServices(String),
    }
}
#[derive(Clone, PartialEq, ProstMessage)]
struct ReflectionResponse {
    #[prost(oneof = "reflection_response::MessageResponse", tags = "4, 7")]
    message_response: Option<reflection_response::MessageResponse>,
}
mod reflection_response {
    #[derive(Clone, PartialEq, prost::Oneof)]
    pub enum MessageResponse {
        #[prost(message, tag = "4")]
        FileDescriptorResponse(super::FileDescriptorResponse),
        #[prost(message, tag = "7")]
        ErrorResponse(super::ReflectionErrorResponse),
    }
}
#[derive(Clone, PartialEq, ProstMessage)]
struct FileDescriptorResponse {
    #[prost(bytes = "vec", repeated, tag = "1")]
    file_descriptor_proto: Vec<Vec<u8>>,
}
#[derive(Clone, PartialEq, ProstMessage)]
struct ReflectionErrorResponse {
    #[prost(int32, tag = "1")]
    error_code: i32,
    #[prost(string, tag = "2")]
    error_message: String,
}

#[derive(Debug)]
pub struct GrpcDriver {
    client: Client,
}
impl Default for GrpcDriver {
    fn default() -> Self {
        Self::new()
    }
}
impl GrpcDriver {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .no_proxy()
                .http2_prior_knowledge()
                .build()
                .unwrap_or_default(),
        }
    }
}

fn encode_frame(message: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(message.len() + 5);
    frame.push(0);
    frame.extend_from_slice(&(message.len() as u32).to_be_bytes());
    frame.extend_from_slice(message);
    frame
}
fn take_frame(buffer: &mut BytesMut) -> Result<Option<Vec<u8>>, DriverError> {
    if buffer.len() < 5 {
        return Ok(None);
    }
    let compressed = buffer[0];
    let length = u32::from_be_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]) as usize;
    if buffer.len() < length + 5 {
        return Ok(None);
    }
    buffer.advance(5);
    let message = buffer.split_to(length).to_vec();
    if compressed != 0 {
        return Err(DriverError::Protocol(
            "compressed gRPC messages are not supported yet".into(),
        ));
    }
    Ok(Some(message))
}

fn method_descriptor(
    payload: &core_domain::GrpcPayload,
) -> Result<Option<MethodDescriptor>, DriverError> {
    let Some(encoded) = payload
        .descriptor_set_base64
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let bytes = BASE64.decode(encoded).map_err(|error| {
        DriverError::Validation(format!("descriptorSetBase64 is invalid: {error}"))
    })?;
    let pool = DescriptorPool::decode(bytes.as_slice())
        .map_err(|error| DriverError::Validation(format!("invalid FileDescriptorSet: {error}")))?;
    let service = pool
        .get_service_by_name(payload.service.trim())
        .ok_or_else(|| {
            DriverError::Validation(format!(
                "service `{}` was not found in descriptor set",
                payload.service
            ))
        })?;
    let method = service
        .methods()
        .find(|method| method.name() == payload.method.trim())
        .ok_or_else(|| {
            DriverError::Validation(format!(
                "method `{}` was not found in service `{}`",
                payload.method, payload.service
            ))
        })?;
    Ok(Some(method))
}

fn method_from_pool(
    pool: &DescriptorPool,
    payload: &core_domain::GrpcPayload,
) -> Result<MethodDescriptor, DriverError> {
    let service = pool
        .get_service_by_name(payload.service.trim())
        .ok_or_else(|| {
            DriverError::Validation(format!(
                "service `{}` was not found in descriptor set",
                payload.service
            ))
        })?;
    let method = service
        .methods()
        .find(|method| method.name() == payload.method.trim())
        .ok_or_else(|| {
            DriverError::Validation(format!(
                "method `{}` was not found in service `{}`",
                payload.method, payload.service
            ))
        })?;
    Ok(method)
}

async fn reflect_method_at_path(
    client: &Client,
    target: &str,
    payload: &core_domain::GrpcPayload,
    reflection_service: &str,
) -> Result<MethodDescriptor, DriverError> {
    let request = ReflectionRequest {
        host: String::new(),
        message_request: Some(reflection_request::MessageRequest::FileContainingSymbol(
            payload.service.clone(),
        )),
    };
    let url = format!(
        "{}/{reflection_service}/ServerReflectionInfo",
        target.trim_end_matches('/'),
    );
    let mut builder = client
        .post(url)
        .header("Content-Type", "application/grpc")
        .header("TE", "trailers")
        .body(encode_frame(&request.encode_to_vec()));
    for (name, value) in &payload.metadata {
        builder = builder.header(name, value);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| DriverError::Connection(format!("gRPC reflection: {error:#}")))?;
    if !response.status().is_success() {
        return Err(DriverError::Protocol(format!(
            "gRPC reflection returned HTTP {}",
            response.status()
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| DriverError::Protocol(error.to_string()))?;
    let mut framed = BytesMut::from(bytes.as_ref());
    let message = take_frame(&mut framed)?.ok_or_else(|| {
        DriverError::Protocol("gRPC reflection returned no response message".into())
    })?;
    let response = ReflectionResponse::decode(message.as_slice()).map_err(|error| {
        DriverError::Protocol(format!("invalid gRPC reflection response: {error}"))
    })?;
    let descriptors = match response.message_response {
        Some(reflection_response::MessageResponse::FileDescriptorResponse(value)) => {
            value.file_descriptor_proto
        }
        Some(reflection_response::MessageResponse::ErrorResponse(value)) => {
            return Err(DriverError::Protocol(format!(
                "gRPC reflection error {}: {}",
                value.error_code, value.error_message
            )))
        }
        None => {
            return Err(DriverError::Protocol(
                "gRPC reflection response did not contain descriptors".into(),
            ))
        }
    };
    let descriptor_set = prost_types::FileDescriptorSet {
        file: descriptors
            .into_iter()
            .map(|descriptor| {
                prost_types::FileDescriptorProto::decode(descriptor.as_slice()).map_err(|error| {
                    DriverError::Protocol(format!("invalid reflected descriptor: {error}"))
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
    };
    let pool =
        DescriptorPool::decode(descriptor_set.encode_to_vec().as_slice()).map_err(|error| {
            DriverError::Protocol(format!("invalid reflected descriptor set: {error}"))
        })?;
    method_from_pool(&pool, payload)
}

async fn reflect_method(
    client: &Client,
    target: &str,
    payload: &core_domain::GrpcPayload,
) -> Result<MethodDescriptor, DriverError> {
    match reflect_method_at_path(
        client,
        target,
        payload,
        "grpc.reflection.v1.ServerReflection",
    )
    .await
    {
        Ok(method) => Ok(method),
        Err(v1_error) => reflect_method_at_path(
            client,
            target,
            payload,
            "grpc.reflection.v1alpha.ServerReflection",
        )
        .await
        .map_err(|v1alpha_error| {
            DriverError::Protocol(format!(
                "gRPC reflection failed with v1 ({v1_error}) and v1alpha ({v1alpha_error})"
            ))
        }),
    }
}

fn request_json_values(
    payload: &core_domain::GrpcPayload,
    json: &str,
) -> Result<Vec<serde_json::Value>, DriverError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|error| {
        DriverError::Validation(format!("gRPC request JSON is invalid: {error}"))
    })?;
    if payload.mode == "client_streaming" || payload.mode == "bidi_streaming" {
        return Ok(match value {
            serde_json::Value::Array(values) => values,
            value => vec![value],
        });
    }
    Ok(vec![value])
}

fn request_messages(
    payload: &core_domain::GrpcPayload,
    method: Option<&MethodDescriptor>,
) -> Result<Vec<Vec<u8>>, DriverError> {
    if let Some(json) = payload
        .message_json
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let method = method.ok_or_else(|| {
            DriverError::Validation("messageJson requires descriptorSetBase64".into())
        })?;
        let values = request_json_values(payload, json)?;
        return values
            .into_iter()
            .map(|value| {
                let text = serde_json::to_string(&value)
                    .map_err(|error| DriverError::Validation(error.to_string()))?;
                let mut deserializer = serde_json::Deserializer::from_str(&text);
                DynamicMessage::deserialize(method.input(), &mut deserializer)
                    .map(|message| message.encode_to_vec())
                    .map_err(|error| {
                        DriverError::Validation(format!("gRPC request JSON is invalid: {error}"))
                    })
            })
            .collect();
    }
    let values: Vec<&str> =
        if payload.mode == "client_streaming" || payload.mode == "bidi_streaming" {
            payload
                .message_base64
                .lines()
                .filter(|value| !value.trim().is_empty())
                .collect()
        } else {
            vec![payload.message_base64.as_str()]
        };
    values
        .into_iter()
        .map(|value| {
            BASE64
                .decode(value.trim())
                .map_err(|error| DriverError::Validation(error.to_string()))
        })
        .collect()
}

fn response_preview(message: &[u8], method: Option<&MethodDescriptor>, index: usize) -> String {
    if let Some(method) = method {
        if let Ok(value) = DynamicMessage::decode(method.output(), message) {
            if let Ok(json) = serde_json::to_string_pretty(&value) {
                return json;
            }
        }
    }
    format!(
        "gRPC message #{index}: {} bytes, base64={}",
        message.len(),
        BASE64.encode(message)
    )
}

#[async_trait]
impl ProtocolDriver for GrpcDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "grpc".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "gRPC".into(),
            capabilities: vec![
                "unary".into(),
                "server-streaming".into(),
                "client-streaming".into(),
                "bidi-streaming".into(),
                "binary-metadata".into(),
                "http2".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        if !(request.target.starts_with("http://") || request.target.starts_with("https://")) {
            report
                .errors
                .push("gRPC target must start with http:// or https://".into());
        }
        match &request.payload {
            ProtocolPayload::Grpc(payload) => {
                if payload.service.trim().is_empty() || payload.method.trim().is_empty() {
                    report
                        .errors
                        .push("gRPC service and method are required".into());
                }
                if ![
                    "unary",
                    "server_streaming",
                    "client_streaming",
                    "bidi_streaming",
                ]
                .contains(&payload.mode.as_str())
                {
                    report
                        .errors
                        .push("gRPC mode must be unary, server_streaming, client_streaming or bidi_streaming".into());
                }
                if payload
                    .descriptor_set_base64
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                    && payload
                        .message_json
                        .as_deref()
                        .is_none_or(|value| value.trim().is_empty())
                    && BASE64.decode(&payload.message_base64).is_err()
                {
                    report
                        .errors
                        .push("gRPC message must be base64 protobuf bytes".into());
                }
                match method_descriptor(payload) {
                    Ok(Some(method)) => {
                        if let Err(error) = request_messages(payload, Some(&method)) {
                            report.errors.push(error.to_string());
                        }
                    }
                    Ok(None)
                        if payload
                            .message_json
                            .as_deref()
                            .is_some_and(|value| !value.trim().is_empty()) =>
                    {
                        let json = payload.message_json.as_deref().unwrap_or_default();
                        if let Err(error) = request_json_values(payload, json) {
                            report.errors.push(error.to_string());
                        }
                    }
                    Ok(None) => {
                        if let Err(error) = request_messages(payload, None) {
                            report.errors.push(error.to_string());
                        }
                    }
                    Err(error) => report.errors.push(error.to_string()),
                }
            }
            _ => report
                .errors
                .push("gRPC driver requires gRPC payload".into()),
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
        let ProtocolPayload::Grpc(payload) = &request.payload else {
            return Err(DriverError::Validation(
                "gRPC driver requires gRPC payload".into(),
            ));
        };
        let method_descriptor = match method_descriptor(payload)? {
            Some(method) => Some(method),
            None if payload
                .message_json
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()) =>
            {
                Some(reflect_method(&self.client, &request.target, payload).await?)
            }
            None => None,
        };
        let request_messages = request_messages(payload, method_descriptor.as_ref())?;
        let body = request_messages
            .iter()
            .flat_map(|message| encode_frame(message))
            .collect::<Vec<_>>();
        let url = format!(
            "{}/{}/{}",
            request.target.trim_end_matches('/'),
            payload.service.trim_matches('/'),
            payload.method.trim_matches('/')
        );
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let mut builder = self
            .client
            .post(url)
            .header("content-type", "application/grpc")
            .header("te", "trailers")
            .header("grpc-accept-encoding", "identity")
            .body(body);
        for (name, value) in &payload.metadata {
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
            .collect::<Vec<_>>();
        let grpc_status = response
            .headers()
            .get("grpc-status")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: Some(status.as_u16()),
                status_text: grpc_status
                    .clone()
                    .or_else(|| status.canonical_reason().map(str::to_owned)),
                headers,
                content_type: Some("application/grpc".into()),
                size_hint: response.content_length(),
            }))
            .await;
        if !status.is_success() {
            return Err(DriverError::Protocol(format!(
                "gRPC transport returned HTTP {}",
                status.as_u16()
            )));
        }
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Transfer),
            })
            .await;
        let mut stream = response.bytes_stream();
        let mut buffer = BytesMut::new();
        let mut bytes_received = 0u64;
        let mut messages = 0usize;
        loop {
            let next = tokio::select! { _ = cancel.cancelled() => return Err(DriverError::Cancelled), next = stream.next() => next };
            let Some(chunk) = next else { break };
            let chunk = chunk.map_err(|error| DriverError::Protocol(error.to_string()))?;
            buffer.extend_from_slice(&chunk);
            while let Some(message) = take_frame(&mut buffer)? {
                bytes_received += message.len() as u64;
                messages += 1;
                events
                    .emit(ExecutionEvent::ResponseChunk {
                        content_type: Some("application/protobuf".into()),
                        size: message.len() as u64,
                        preview: Some(response_preview(
                            &message,
                            method_descriptor.as_ref(),
                            messages,
                        )),
                        data_base64: Some(BASE64.encode(&message)),
                        done: payload.mode == "unary" || payload.mode == "client_streaming",
                    })
                    .await;
                if payload.mode == "unary" || payload.mode == "client_streaming" {
                    break;
                }
            }
            if (payload.mode == "unary" || payload.mode == "client_streaming") && messages > 0 {
                break;
            }
        }
        if payload.mode != "unary" && payload.mode != "client_streaming" {
            events
                .emit(ExecutionEvent::ResponseChunk {
                    content_type: Some("application/protobuf".into()),
                    size: 0,
                    preview: None,
                    data_base64: None,
                    done: true,
                })
                .await;
        }
        if !buffer.is_empty() {
            events
                .emit(ExecutionEvent::Warning {
                    code: "grpc_incomplete_frame".into(),
                    message: format!(
                        "{} trailing byte(s) did not form a complete gRPC frame",
                        buffer.len()
                    ),
                })
                .await;
        }
        let result = ExecutionSummary {
            execution_id,
            request_id: request.id.0,
            protocol_id: "grpc".into(),
            state: ExecutionState::Completed,
            started_at,
            finished_at: Utc::now(),
            duration_ms: wall.elapsed().as_millis() as u64,
            bytes_received,
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
    use core_domain::GrpcPayload;
    #[test]
    fn grpc_frames_round_trip_and_wait_for_partial_data() {
        let frame = encode_frame(b"protobuf");
        let mut buffer = BytesMut::from(&frame[..4]);
        assert!(take_frame(&mut buffer).unwrap().is_none());
        buffer.extend_from_slice(&frame[4..]);
        assert_eq!(take_frame(&mut buffer).unwrap(), Some(b"protobuf".to_vec()));
        assert!(buffer.is_empty());
    }
    #[test]
    fn rejects_compressed_frame() {
        let mut frame = BytesMut::from(&encode_frame(b"x")[..]);
        frame[0] = 1;
        assert!(take_frame(&mut frame).is_err());
    }

    #[test]
    fn descriptor_set_encodes_request_json_and_decodes_response_json() {
        use prost_types::{
            field_descriptor_proto::{Label, Type},
            DescriptorProto, FieldDescriptorProto, FileDescriptorProto, FileDescriptorSet,
            MethodDescriptorProto, ServiceDescriptorProto,
        };
        let message = |name: &str| DescriptorProto {
            name: Some(name.into()),
            field: vec![FieldDescriptorProto {
                name: Some("text".into()),
                number: Some(1),
                label: Some(Label::Optional as i32),
                r#type: Some(Type::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let descriptors = FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("echo.proto".into()),
                package: Some("test".into()),
                syntax: Some("proto3".into()),
                message_type: vec![message("Input"), message("Output")],
                service: vec![ServiceDescriptorProto {
                    name: Some("Echo".into()),
                    method: vec![MethodDescriptorProto {
                        name: Some("Say".into()),
                        input_type: Some(".test.Input".into()),
                        output_type: Some(".test.Output".into()),
                        ..Default::default()
                    }],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        };
        let payload = GrpcPayload {
            service: "test.Echo".into(),
            method: "Say".into(),
            message_base64: String::new(),
            mode: "unary".into(),
            metadata: vec![],
            descriptor_set_base64: Some(BASE64.encode(descriptors.encode_to_vec())),
            message_json: Some(r#"{"text":"hello"}"#.into()),
        };
        let method = method_descriptor(&payload).unwrap().unwrap();
        let encoded = request_messages(&payload, Some(&method)).unwrap().remove(0);
        let decoded = DynamicMessage::decode(method.input(), encoded.as_slice()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap()["text"], "hello");
        let output = DynamicMessage::deserialize(
            method.output(),
            &mut serde_json::Deserializer::from_str(r#"{"text":"world"}"#),
        )
        .unwrap()
        .encode_to_vec();
        assert!(response_preview(&output, Some(&method), 1).contains("world"));
        let mut streaming = payload.clone();
        streaming.mode = "client_streaming".into();
        streaming.message_json = Some(r#"[{"text":"one"},{"text":"two"}]"#.into());
        let encoded = request_messages(&streaming, Some(&method)).unwrap();
        assert_eq!(encoded.len(), 2);
        assert_eq!(
            serde_json::to_value(
                DynamicMessage::decode(method.input(), encoded[1].as_slice()).unwrap()
            )
            .unwrap()["text"],
            "two"
        );
        streaming.message_json = Some(r#"{"text":"single"}"#.into());
        let encoded = request_messages(&streaming, Some(&method)).unwrap();
        assert_eq!(encoded.len(), 1);
    }

    #[test]
    fn json_without_descriptor_is_valid_for_server_reflection() {
        let mut request = RequestEnvelope::http_get("gRPC reflection", "https://example.com");
        request.payload = ProtocolPayload::Grpc(GrpcPayload {
            service: "example.Echo".into(),
            method: "Say".into(),
            message_base64: String::new(),
            mode: "unary".into(),
            metadata: vec![],
            descriptor_set_base64: None,
            message_json: Some(r#"{"message":"hello"}"#.into()),
        });

        let report = GrpcDriver::new().validate(&request);

        assert!(report.errors.is_empty(), "{:?}", report.errors);
    }
}
