//! Explicit opt-in traffic capture proxy. HTTP exchanges are inspectable; HTTPS CONNECT traffic
//! remains end-to-end encrypted and records destination/timing only (no implicit MITM CA).

use bytes::Bytes;
use chrono::{DateTime, Utc};
use http_body_util::{BodyExt, Full};
use hyper::{body::Incoming, service::service_fn, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::{collections::VecDeque, convert::Infallible, net::SocketAddr, sync::Arc, time::Instant};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
const MAX_CAPTURE_PREVIEW: usize = 64 * 1024;
const MAX_EXCHANGES: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedExchange {
    pub id: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub request_headers: Vec<(String, String)>,
    pub response_headers: Vec<(String, String)>,
    pub request_body_preview: String,
    pub response_body_preview: String,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub tunnel: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub running: bool,
    pub bind: Option<String>,
    pub exchange_count: usize,
}

#[derive(Clone, Default)]
pub struct CaptureProxy {
    inner: Arc<Mutex<State>>,
}
#[derive(Default)]
struct State {
    running: bool,
    bind: Option<SocketAddr>,
    shutdown: Option<CancellationToken>,
    exchanges: VecDeque<CapturedExchange>,
    generation: u64,
}

impl CaptureProxy {
    pub fn new() -> Self {
        Self::default()
    }
    pub async fn start(
        &self,
        bind: SocketAddr,
        allow_remote: bool,
    ) -> Result<CaptureStatus, String> {
        if !allow_remote && !bind.ip().is_loopback() {
            return Err(
                "capture proxy may only bind loopback unless remote access is explicitly enabled"
                    .into(),
            );
        }
        {
            let state = self.inner.lock().await;
            if state.running {
                return Ok(snapshot_status(&state));
            }
        }
        let listener = TcpListener::bind(bind)
            .await
            .map_err(|error| error.to_string())?;
        let actual = listener.local_addr().map_err(|error| error.to_string())?;
        let cancel = CancellationToken::new();
        let generation = {
            let mut state = self.inner.lock().await;
            state.generation = state.generation.wrapping_add(1);
            state.running = true;
            state.bind = Some(actual);
            state.shutdown = Some(cancel.clone());
            state.generation
        };
        let proxy = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {_ = cancel.cancelled()=>break,accepted=listener.accept()=>match accepted{Ok((stream,_))=>{let proxy=proxy.clone();tokio::spawn(async move{let io=TokioIo::new(stream);let service=service_fn(move|request|proxy.clone().handle(request));let _=hyper::server::conn::http1::Builder::new().serve_connection(io,service).with_upgrades().await;});},Err(_)=>break}}
            }
            let mut state = proxy.inner.lock().await;
            if state.generation == generation {
                state.running = false;
                state.bind = None;
                state.shutdown = None;
            }
        });
        Ok(self.status().await)
    }
    pub async fn stop(&self) -> CaptureStatus {
        let token = {
            let mut state = self.inner.lock().await;
            state.generation = state.generation.wrapping_add(1);
            state.running = false;
            state.bind = None;
            state.shutdown.take()
        };
        if let Some(token) = token {
            token.cancel();
        }
        self.status().await
    }
    pub async fn status(&self) -> CaptureStatus {
        let state = self.inner.lock().await;
        snapshot_status(&state)
    }
    pub async fn exchanges(&self) -> Vec<CapturedExchange> {
        self.inner.lock().await.exchanges.iter().cloned().collect()
    }
    pub async fn clear(&self) {
        self.inner.lock().await.exchanges.clear();
    }
    async fn record(&self, value: CapturedExchange) {
        let mut state = self.inner.lock().await;
        if state.exchanges.len() >= MAX_EXCHANGES {
            state.exchanges.pop_front();
        }
        state.exchanges.push_back(value);
    }
    async fn handle(self, request: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
        if request.method() == Method::CONNECT {
            return Ok(self.connect(request).await);
        }
        Ok(self.forward(request).await)
    }
    async fn connect(&self, mut request: Request<Incoming>) -> Response<Full<Bytes>> {
        let started = Utc::now();
        let clock = Instant::now();
        let authority = request
            .uri()
            .authority()
            .map(|value| value.as_str().to_string())
            .unwrap_or_default();
        if authority.is_empty() {
            return text_response(StatusCode::BAD_REQUEST, "CONNECT authority required");
        }
        let proxy = self.clone();
        tokio::spawn(async move {
            let mut captured = CapturedExchange {
                id: Uuid::new_v4().to_string(),
                method: "CONNECT".into(),
                url: authority.clone(),
                status: Some(200),
                request_headers: redact_headers(&headers(request.headers())),
                response_headers: vec![],
                request_body_preview: String::new(),
                response_body_preview: String::new(),
                started_at: started,
                duration_ms: 0,
                tunnel: true,
                error: None,
            };
            match TcpStream::connect(&authority).await {
                Ok(mut upstream) => match hyper::upgrade::on(&mut request).await {
                    Ok(upgraded) => {
                        let mut client = TokioIo::new(upgraded);
                        if let Err(error) =
                            tokio::io::copy_bidirectional(&mut client, &mut upstream).await
                        {
                            captured.error = Some(error.to_string());
                        }
                    }
                    Err(error) => captured.error = Some(error.to_string()),
                },
                Err(error) => {
                    captured.status = Some(502);
                    captured.error = Some(error.to_string());
                }
            }
            captured.duration_ms = clock.elapsed().as_millis() as u64;
            proxy.record(captured).await;
        });
        Response::new(Full::new(Bytes::new()))
    }
    async fn forward(&self, request: Request<Incoming>) -> Response<Full<Bytes>> {
        let started = Utc::now();
        let clock = Instant::now();
        let method = request.method().clone();
        let request_headers = headers(request.headers());
        let url = absolute_url(&request);
        let mut captured = CapturedExchange {
            id: Uuid::new_v4().to_string(),
            method: method.to_string(),
            url: url.clone(),
            status: None,
            request_headers: redact_headers(&request_headers),
            response_headers: vec![],
            request_body_preview: String::new(),
            response_body_preview: String::new(),
            started_at: started,
            duration_ms: 0,
            tunnel: false,
            error: None,
        };
        let body = match request.into_body().collect().await {
            Ok(value) => value.to_bytes(),
            Err(error) => return text_response(StatusCode::BAD_REQUEST, &error.to_string()),
        };
        if body.len() > MAX_BODY_BYTES {
            return text_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request body exceeds capture limit",
            );
        }
        captured.request_body_preview = preview(&body);
        let result = self.send(&method, &url, &request_headers, body).await;
        let response = match result {
            Ok((status, response_headers, bytes)) => {
                captured.status = Some(status.as_u16());
                captured.response_headers = redact_headers(&response_headers);
                captured.response_body_preview = preview(&bytes);
                response_from(status, &response_headers, bytes)
            }
            Err(error) => {
                captured.status = Some(502);
                captured.error = Some(error.clone());
                text_response(StatusCode::BAD_GATEWAY, &error)
            }
        };
        captured.duration_ms = clock.elapsed().as_millis() as u64;
        self.record(captured).await;
        response
    }
    async fn send(
        &self,
        method: &Method,
        url: &str,
        header_values: &[(String, String)],
        body: Bytes,
    ) -> Result<(StatusCode, Vec<(String, String)>, Bytes), String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| error.to_string())?;
        let mut builder = client.request(method.clone(), url).body(body);
        for (name, value) in header_values {
            if !hop_header(name) && !name.eq_ignore_ascii_case("host") {
                builder = builder.header(name, value);
            }
        }
        let response = builder.send().await.map_err(|error| error.to_string())?;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BODY_BYTES as u64)
        {
            return Err("response body exceeds capture limit".into());
        }
        let status = response.status();
        let response_headers = headers(response.headers());
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err("response body exceeds capture limit".into());
        }
        Ok((status, response_headers, bytes))
    }
}

fn snapshot_status(state: &State) -> CaptureStatus {
    CaptureStatus {
        running: state.running,
        bind: state.bind.map(|value| value.to_string()),
        exchange_count: state.exchanges.len(),
    }
}
fn absolute_url(request: &Request<Incoming>) -> String {
    if request.uri().scheme().is_some() {
        return request.uri().to_string();
    }
    let host = request
        .headers()
        .get("host")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    format!("http://{host}{}", request.uri())
}
fn headers(values: &hyper::HeaderMap) -> Vec<(String, String)> {
    values
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect()
}
fn redact_headers(values: &[(String, String)]) -> Vec<(String, String)> {
    values
        .iter()
        .map(|(name, value)| {
            let sensitive = matches!(
                name.to_ascii_lowercase().as_str(),
                "authorization"
                    | "proxy-authorization"
                    | "cookie"
                    | "set-cookie"
                    | "x-api-key"
                    | "x-auth-token"
            );
            (
                name.clone(),
                if sensitive {
                    "***".into()
                } else {
                    value.clone()
                },
            )
        })
        .collect()
}
fn hop_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "proxy-connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "content-length"
    )
}
fn preview(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_CAPTURE_PREVIEW)]).into_owned()
}
fn response_from(
    status: StatusCode,
    header_values: &[(String, String)],
    bytes: Bytes,
) -> Response<Full<Bytes>> {
    let mut response = Response::builder().status(status);
    for (name, value) in header_values {
        if !hop_header(name) {
            response = response.header(name, value);
        }
    }
    response
        .body(Full::new(bytes))
        .unwrap_or_else(|error| text_response(StatusCode::BAD_GATEWAY, &error.to_string()))
}
fn text_response(status: StatusCode, text: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Full::new(Bytes::copy_from_slice(text.as_bytes())))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    #[tokio::test]
    async fn captures_http_through_loopback_proxy() {
        let upstream = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let upstream_addr = upstream.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = upstream.accept().unwrap();
            let mut buffer = [0; 2048];
            let count = socket.read(&mut buffer).unwrap();
            assert!(String::from_utf8_lossy(&buffer[..count]).contains("Bearer original-secret"));
            let body = "captured";
            write!(
                socket,
                "HTTP/1.1 201 Created\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let proxy = CaptureProxy::new();
        let status = proxy
            .start("127.0.0.1:0".parse().unwrap(), false)
            .await
            .unwrap();
        let client = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all(format!("http://{}", status.bind.unwrap())).unwrap())
            .build()
            .unwrap();
        let response = client
            .post(format!("http://{upstream_addr}/items"))
            .bearer_auth("original-secret")
            .body("request")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 201);
        assert_eq!(response.text().await.unwrap(), "captured");
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        let exchanges = proxy.exchanges().await;
        assert_eq!(exchanges.len(), 1);
        assert_eq!(exchanges[0].request_body_preview, "request");
        assert!(exchanges[0]
            .request_headers
            .iter()
            .any(|(name, value)| name == "authorization" && value == "***"));
        proxy.stop().await;
        server.join().unwrap();
    }
    #[tokio::test]
    async fn tunnels_connect_without_decrypting_payload() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_addr = upstream.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = upstream.accept().await.unwrap();
            let mut input = [0u8; 4];
            socket.read_exact(&mut input).await.unwrap();
            assert_eq!(&input, b"ping");
            socket.write_all(b"pong").await.unwrap();
        });
        let proxy = CaptureProxy::new();
        let proxy_addr = proxy
            .start("127.0.0.1:0".parse().unwrap(), false)
            .await
            .unwrap()
            .bind
            .unwrap();
        let mut client = tokio::net::TcpStream::connect(&proxy_addr).await.unwrap();
        client
            .write_all(
                format!("CONNECT {upstream_addr} HTTP/1.1\r\nHost: {upstream_addr}\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
        let mut response = [0u8; 256];
        let count = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            client.read(&mut response),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.1 200"));
        client.write_all(b"ping").await.unwrap();
        let mut output = [0u8; 4];
        client.read_exact(&mut output).await.unwrap();
        assert_eq!(&output, b"pong");
        drop(client);
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        let exchanges = proxy.exchanges().await;
        assert_eq!(exchanges.len(), 1);
        assert!(exchanges[0].tunnel);
        assert!(exchanges[0].request_body_preview.is_empty());
        proxy.stop().await;
    }
}
