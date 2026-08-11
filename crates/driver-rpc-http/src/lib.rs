use async_trait::async_trait;
use core_domain::{
    ExecutionId, ExecutionSummary, HttpPayload, ProtocolId, ProtocolPayload, RequestEnvelope,
};
use driver_http::HttpDriver;
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy)]
enum Kind {
    Soap,
    JsonRpc,
}
#[derive(Debug)]
pub struct SoapDriver {
    http: HttpDriver,
}
#[derive(Debug)]
pub struct JsonRpcDriver {
    http: HttpDriver,
}
impl Default for SoapDriver {
    fn default() -> Self {
        Self {
            http: HttpDriver::new(),
        }
    }
}
impl Default for JsonRpcDriver {
    fn default() -> Self {
        Self {
            http: HttpDriver::new(),
        }
    }
}

fn descriptor(kind: Kind) -> DriverDescriptor {
    let (id, name) = match kind {
        Kind::Soap => ("soap", "SOAP 1.1 / 1.2"),
        Kind::JsonRpc => ("jsonrpc", "JSON-RPC 2.0"),
    };
    DriverDescriptor {
        protocol_id: id.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        display_name: name.into(),
        capabilities: vec![
            "http-transport".into(),
            "headers".into(),
            "tls".into(),
            "proxy".into(),
            "cancel".into(),
        ],
    }
}
fn validate(kind: Kind, request: &RequestEnvelope) -> ValidationReport {
    let mut report = ValidationReport::ok();
    if request.target.trim().is_empty() {
        report.errors.push("target URL is required".into());
    }
    let ProtocolPayload::Raw(payload) = &request.payload else {
        report
            .errors
            .push("RPC driver requires raw protocol payload".into());
        return report;
    };
    let payload = raw_value(payload);
    match kind {
        Kind::Soap => {
            if payload
                .get("envelope")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                report.errors.push("SOAP envelope is required".into());
            }
        }
        Kind::JsonRpc => {
            if payload
                .get("method")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                report.errors.push("JSON-RPC method is required".into());
            }
        }
    }
    report
}
fn string_headers(payload: &Value) -> Vec<(String, String)> {
    payload
        .get("headers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let pair = entry.as_array()?;
            Some((
                pair.first()?.as_str()?.to_string(),
                pair.get(1)?.as_str()?.to_string(),
            ))
        })
        .collect()
}
fn raw_value(payload: &Value) -> &Value {
    payload.get("value").unwrap_or(payload)
}
fn to_http(kind: Kind, mut request: RequestEnvelope) -> Result<RequestEnvelope, DriverError> {
    let ProtocolPayload::Raw(payload) = &request.payload else {
        return Err(DriverError::Validation(
            "RPC driver requires raw payload".into(),
        ));
    };
    let payload = raw_value(payload);
    let (mut headers, body) = match kind {
        Kind::Soap => {
            let version = payload
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("1.2");
            let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
            let mut headers = string_headers(payload);
            headers.push((
                "Content-Type".into(),
                if version == "1.1" {
                    "text/xml; charset=utf-8".into()
                } else {
                    "application/soap+xml; charset=utf-8".into()
                },
            ));
            if !action.is_empty() {
                headers.push(("SOAPAction".into(), action.into()));
            }
            (
                headers,
                payload
                    .get("envelope")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            )
        }
        Kind::JsonRpc => {
            let headers = string_headers(payload);
            let method = payload.get("method").and_then(Value::as_str).unwrap_or("");
            let params = payload.get("params").cloned().unwrap_or(json!({}));
            let id = payload.get("id").cloned().unwrap_or(json!(1));
            (
                headers,
                serde_json::to_string(
                    &json!({"jsonrpc":"2.0","method":method,"params":params,"id":id}),
                )
                .map_err(|error| DriverError::Validation(error.to_string()))?,
            )
        }
    };
    if !headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("content-type"))
    {
        headers.push(("Content-Type".into(), "application/json".into()));
    }
    request.protocol_id = ProtocolId::http();
    request.payload = ProtocolPayload::Http(HttpPayload {
        method: "POST".into(),
        headers,
        body: Some(body),
        multipart: vec![],
        follow_redirects: true,
    });
    Ok(request)
}

macro_rules! impl_driver {
    ($type:ty,$kind:expr) => {
        #[async_trait]
        impl ProtocolDriver for $type {
            fn descriptor(&self) -> DriverDescriptor {
                descriptor($kind)
            }
            fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
                validate($kind, request)
            }
            async fn execute(
                &self,
                request: RequestEnvelope,
                events: EventSink,
                cancel: CancellationToken,
                execution_id: ExecutionId,
            ) -> Result<ExecutionSummary, DriverError> {
                let report = self.validate(&request);
                if !report.is_valid() {
                    return Err(DriverError::Validation(report.errors.join("; ")));
                }
                self.http
                    .execute(to_http($kind, request)?, events, cancel, execution_id)
                    .await
            }
        }
    };
}
impl_driver!(SoapDriver, Kind::Soap);
impl_driver!(JsonRpcDriver, Kind::JsonRpc);

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use core_domain::{RequestId, RetryPolicy, TlsOptions};
    use std::collections::HashMap;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    fn envelope(protocol: &str, target: String, payload: Value) -> RequestEnvelope {
        RequestEnvelope {
            id: RequestId::new(),
            protocol_id: ProtocolId(protocol.into()),
            name: "rpc".into(),
            target,
            environment_ref: None,
            auth_ref: None,
            timeout_ms: 3000,
            retry_policy: RetryPolicy::default(),
            proxy: None,
            tls: TlsOptions::default(),
            metadata: json!({}),
            payload: ProtocolPayload::Raw(payload),
            pre_scripts: vec![],
            post_scripts: vec![],
            assertions: vec![],
            variables: HashMap::new(),
            runtime_secrets: HashMap::new(),
            created_at: Utc::now(),
        }
    }
    async fn server() -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![0; 4096];
            let count = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).to_string();
            let body = "{\"ok\":true}";
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
            request
        });
        (format!("http://{address}"), task)
    }
    #[tokio::test]
    async fn sends_json_rpc_wire_contract() {
        let (target, server) = server().await;
        let (events, _) = EventSink::with_capacity(16);
        let summary = JsonRpcDriver::default()
            .execute(
                envelope(
                    "jsonrpc",
                    target,
                    json!({"method":"users.list","params":{"page":2},"id":7}),
                ),
                events,
                CancellationToken::new(),
                ExecutionId::new(),
            )
            .await
            .unwrap();
        assert_eq!(summary.status, Some(200));
        let wire = server.await.unwrap();
        assert!(wire.contains("\"jsonrpc\":\"2.0\""));
        assert!(wire.contains("\"method\":\"users.list\""));
    }
    #[tokio::test]
    async fn sends_soap_action_and_envelope() {
        let (target, server) = server().await;
        let (events, _) = EventSink::with_capacity(16);
        SoapDriver::default().execute(envelope("soap",target,json!({"version":"1.1","action":"urn:GetUser","envelope":"<Envelope><Body/></Envelope>"})),events,CancellationToken::new(),ExecutionId::new()).await.unwrap();
        let wire = server.await.unwrap();
        assert!(wire
            .to_ascii_lowercase()
            .contains("soapaction: urn:getuser"));
        assert!(wire.contains("<Envelope><Body/></Envelope>"));
    }
}
