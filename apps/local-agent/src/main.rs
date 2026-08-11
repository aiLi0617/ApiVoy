//! ApiVoy Local Agent.
//!
//! Listens on 127.0.0.1 by default. Container deployments may explicitly override the bind address.
//! Shares the same protocol-core crates as Desktop; ships as an independent binary.

use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, patch, post, put};
use axum::{Json, Router};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use capture_proxy::{CaptureProxy, CaptureStatus, CapturedExchange};
use chrono::Utc;
use core_domain::{ExecutionEvent, ExecutionId, ExecutionState, ProtocolPayload, RequestEnvelope};
use driver_amqp::AmqpDriver;
use driver_graphql::GraphqlDriver;
use driver_grpc::GrpcDriver;
use driver_http::HttpDriver;
use driver_mqtt::MqttDriver;
use driver_redis::RedisDriver;
use driver_rpc_http::{JsonRpcDriver, SoapDriver};
use driver_sse::SseDriver;
use driver_tcp_udp::{TcpDriver, UdpDriver};
use driver_websocket::WebSocketDriver;
use execution_engine::{
    run_ai_assistant, sample_http_get, AiAssistRequest, AiAssistResponse, DriverDescriptor,
    ExecutionEngine, VariableScope,
};
use futures::stream::{self, Stream};
use futures::{SinkExt, StreamExt};
use local_store::{
    CollectionRecord, EnvironmentRecord, ExecutionFilter, ExecutionRecord, LocalStore,
    ProjectRecord, StoredRequest, WorkspaceRecord,
};
use plugin_runtime::{InstalledPlugin, PluginManager, PluginManifest, PluginPermission};
use secret_store::{SecretBackendKind, SecretStore};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, RwLock};
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const PROTOCOL_API_VERSION: &str = "1";
const HEADER_PROTOCOL_API_VERSION: &str = "x-apivoy-protocol-api-version";
const HEADER_CLIENT: &str = "x-apivoy-client";
const HEADER_CLIENT_VERSION: &str = "x-apivoy-client-version";
const MAX_PERSISTED_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone)]
struct AppState {
    engine: Arc<RwLock<ExecutionEngine>>,
    http_driver: Arc<HttpDriver>,
    token: Arc<String>,
    sessions: Arc<Mutex<HashMap<String, Instant>>>,
    secrets: Arc<SecretStore>,
    store: Arc<Mutex<LocalStore>>,
    executions: Arc<Mutex<HashMap<Uuid, ExecutionSlot>>>,
    mock_rules: Arc<Mutex<HashMap<Uuid, MockRuleState>>>,
    mock_rules_path: Arc<PathBuf>,
    plugins: Arc<PluginManager>,
    capture: CaptureProxy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockRule {
    id: Uuid,
    name: String,
    method: String,
    path: String,
    status: u16,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    delay_ms: u64,
    #[serde(default)]
    error_every: Option<u64>,
    #[serde(default)]
    priority: i32,
    #[serde(default)]
    ws_messages: Vec<String>,
    #[serde(default)]
    ws_echo: bool,
    #[serde(default)]
    ws_interval_ms: u64,
}
struct MockRuleState {
    rule: MockRule,
    hits: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMockRule {
    name: String,
    method: String,
    path: String,
    status: u16,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    delay_ms: u64,
    #[serde(default)]
    error_every: Option<u64>,
    #[serde(default)]
    priority: i32,
    #[serde(default)]
    ws_messages: Vec<String>,
    #[serde(default)]
    ws_echo: bool,
    #[serde(default)]
    ws_interval_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallPluginBody {
    manifest: PluginManifest,
    wasm_base64: String,
}
#[derive(Deserialize)]
struct SetPluginEnabledBody {
    enabled: bool,
}
#[derive(Deserialize)]
struct InvokePluginBody {
    input: String,
}
#[derive(Serialize)]
struct InvokePluginResponse {
    output: String,
}

struct ExecutionSlot {
    events: mpsc::Receiver<ExecutionEvent>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    service: &'static str,
    version: &'static str,
    agent_version: &'static str,
    bind: String,
    protocol_api_version: &'static str,
    min_protocol_api_version: &'static str,
    max_protocol_api_version: &'static str,
    auth_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartExecutionResponse {
    execution_id: String,
    state: &'static str,
    protocol_api_version: &'static str,
    agent_version: &'static str,
}

#[derive(Deserialize)]
struct HttpGetBody {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutSecretBody {
    name: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PutSecretResponse {
    name: String,
    backend: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCaptureBody {
    bind: Option<String>,
    allow_remote: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveEnvironmentBody {
    variables: HashMap<String, String>,
    #[serde(default)]
    secret_refs: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HistoryQuery {
    limit: Option<usize>,
    state: Option<String>,
    protocol_id: Option<String>,
    status: Option<u16>,
    request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamedBody {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorkspaceBody {
    name: String,
    root_path: Option<String>,
}

#[derive(Deserialize)]
struct ArchiveWorkspaceBody {
    archived: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectBody {
    workspace_id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCollectionBody {
    project_id: String,
    parent_id: Option<String>,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCollectionBody {
    name: String,
    parent_id: Option<String>,
    sort_order: i64,
}

#[derive(Deserialize)]
struct TagsBody {
    tags: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RequestQuery {
    project_id: Option<String>,
    collection_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveRequestBody {
    project_id: String,
    collection_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTree {
    workspaces: Vec<WorkspaceRecord>,
    projects: Vec<ProjectRecord>,
    collections: Vec<CollectionRecord>,
    requests: Vec<StoredRequest>,
}

#[derive(Deserialize)]
struct CookieQuery {
    url: String,
}
#[derive(Deserialize)]
struct CookieMutation {
    url: String,
    name: String,
    #[serde(default)]
    value: String,
}
#[derive(Deserialize)]
struct TcpSessionQuery {
    target: String,
    token: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    token: String,
    expires_in_seconds: u64,
}
#[derive(Serialize)]
struct CookieItem {
    name: String,
    value: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let token = Arc::new(load_or_create_pairing_token()?);
    let db_path = config_dir().join("apivoy-local.db");
    let store = LocalStore::open(&db_path)?;
    info!(path = %db_path.display(), "opened local store");

    let mut engine = ExecutionEngine::new();
    let http_driver = Arc::new(HttpDriver::new());
    engine.register(http_driver.clone());
    engine.register(Arc::new(GraphqlDriver::new()));
    engine.register(Arc::new(GrpcDriver::new()));
    engine.register(Arc::new(SseDriver::new()));
    engine.register(Arc::new(TcpDriver));
    engine.register(Arc::new(UdpDriver));
    engine.register(Arc::new(WebSocketDriver));
    engine.register(Arc::new(JsonRpcDriver::default()));
    engine.register(Arc::new(SoapDriver::default()));
    engine.register(Arc::new(RedisDriver));
    engine.register(Arc::new(MqttDriver));
    engine.register(Arc::new(AmqpDriver));

    let mock_rules_path = config_dir().join("mock-rules.json");
    let mock_rules = load_mock_rules(&mock_rules_path);
    let plugins =
        PluginManager::new_from_env(config_dir().join("plugins"), plugin_permission_grants())
            .map_err(|error| error.to_string())?;
    let state = AppState {
        engine: Arc::new(RwLock::new(engine)),
        http_driver,
        token,
        sessions: Arc::new(Mutex::new(HashMap::new())),
        secrets: Arc::new(SecretStore::with_keychain()),
        store: Arc::new(Mutex::new(store)),
        executions: Arc::new(Mutex::new(HashMap::new())),
        mock_rules: Arc::new(Mutex::new(mock_rules)),
        mock_rules_path: Arc::new(mock_rules_path),
        plugins: Arc::new(plugins),
        capture: CaptureProxy::new(),
    };

    let origins = allowed_origins()?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_headers(AllowHeaders::list([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            HeaderName::from_static(HEADER_PROTOCOL_API_VERSION),
            HeaderName::from_static(HEADER_CLIENT),
            HeaderName::from_static(HEADER_CLIENT_VERSION),
        ]));

    let protected = Router::new()
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/session", post(create_session))
        .route("/v1/executions", post(start_execution))
        .route("/v1/executions/{id}/events", get(execution_events))
        .route("/v1/executions/{id}/cancel", post(cancel_execution))
        .route("/v1/secrets", put(put_secret))
        .route("/v1/ai/assist", post(ai_assist))
        .route("/v1/capture/status", get(capture_status))
        .route("/v1/capture/start", post(start_capture))
        .route("/v1/capture/stop", post(stop_capture))
        .route(
            "/v1/capture/exchanges",
            get(capture_exchanges).delete(clear_capture),
        )
        .route(
            "/v1/cookies",
            get(list_cookies).put(set_cookie).delete(delete_cookie),
        )
        .route("/v1/environments/default", get(get_default_environment))
        .route("/v1/environments/default", put(put_default_environment))
        .route("/v1/history", get(list_history))
        .route("/v1/history/{id}", get(get_history_item))
        .route("/v1/history/{id}/body", get(get_history_body))
        .route("/v1/requests", post(save_request))
        .route("/v1/requests", get(list_requests))
        .route("/v1/requests/latest", get(load_latest_request))
        .route(
            "/v1/requests/{id}",
            get(get_request).patch(move_request).delete(delete_request),
        )
        .route("/v1/workspace-tree", get(get_workspace_tree))
        .route("/v1/workspaces", post(create_workspace))
        .route(
            "/v1/workspaces/{id}",
            patch(rename_workspace).delete(delete_workspace),
        )
        .route("/v1/workspaces/{id}/archive", patch(archive_workspace))
        .route("/v1/workspaces/{id}/touch", post(touch_workspace))
        .route("/v1/projects", post(create_project))
        .route("/v1/projects/{id}", patch(rename_project))
        .route("/v1/projects/{id}", delete(delete_project))
        .route("/v1/collections", post(create_collection))
        .route("/v1/collections/{id}", patch(update_collection))
        .route("/v1/collections/{id}", delete(delete_collection))
        .route("/v1/collections/{id}/tags", patch(update_collection_tags))
        .route(
            "/v1/mock-rules",
            get(list_mock_rules).post(create_mock_rule),
        )
        .route(
            "/v1/mock-rules/{id}",
            patch(update_mock_rule).delete(delete_mock_rule),
        )
        .route("/v1/plugins", get(list_plugins).post(install_plugin))
        .route(
            "/v1/plugins/{id}",
            patch(set_plugin_enabled).delete(uninstall_plugin),
        )
        .route("/v1/plugins/{id}/invoke", post(invoke_plugin))
        // Deprecated smoke shortcut; prefer POST /v1/executions + SSE.
        .route("/v1/debug/http-get", post(debug_http_get))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let app = Router::new()
        .route("/health", get(health))
        .route("/mock/{*path}", any(serve_mock))
        .route("/mock-ws/{*path}", get(serve_mock_ws))
        .route("/v1/tcp-session", get(tcp_session))
        .merge(protected)
        .layer(cors)
        .with_state(state);

    let addr = agent_bind_addr()?;
    info!("ApiVoy Local Agent listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("APIVOY_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("apivoy");
    }
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg).join("apivoy");
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".config").join("apivoy");
    }
    PathBuf::from(".apivoy")
}

fn agent_bind_addr() -> Result<SocketAddr, Box<dyn std::error::Error>> {
    Ok(std::env::var("APIVOY_AGENT_BIND")
        .unwrap_or_else(|_| "127.0.0.1:39217".to_string())
        .parse()?)
}

fn allowed_origins() -> Result<Vec<HeaderValue>, Box<dyn std::error::Error>> {
    std::env::var("APIVOY_ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5180".to_string())
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.parse().map_err(Into::into))
        .collect()
}

fn plugin_permission_grants() -> Vec<PluginPermission> {
    std::env::var("APIVOY_PLUGIN_PERMISSIONS")
        .unwrap_or_default()
        .split(',')
        .filter_map(|value| match value.trim() {
            "network" => Some(PluginPermission::Network),
            "filesystem_read" => Some(PluginPermission::FilesystemRead),
            "filesystem_write" => Some(PluginPermission::FilesystemWrite),
            "secrets_read" => Some(PluginPermission::SecretsRead),
            _ => None,
        })
        .collect()
}

fn load_or_create_pairing_token() -> Result<String, Box<dyn std::error::Error>> {
    if let Ok(token) = std::env::var("APIVOY_AGENT_TOKEN") {
        if !token.is_empty() {
            info!("using pairing token from APIVOY_AGENT_TOKEN");
            return Ok(token);
        }
    }

    let dir = config_dir();
    let path = dir.join("agent-token");
    if path.is_file() {
        let token = fs::read_to_string(&path)?.trim().to_string();
        if !token.is_empty() {
            info!(path = %path.display(), "loaded pairing token");
            return Ok(token);
        }
    }

    fs::create_dir_all(&dir)?;
    let token = Uuid::new_v4().simple().to_string();
    fs::write(&path, format!("{token}\n"))?;
    info!(path = %path.display(), "created pairing token file");
    eprintln!("ApiVoy Local Agent pairing token (save for Web/Desktop): {token}");
    eprintln!("Token file: {}", path.display());
    Ok(token)
}

fn check_protocol_version(headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    let Some(value) = headers.get(HEADER_PROTOCOL_API_VERSION) else {
        return Ok(());
    };
    let Ok(version) = value.to_str() else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid X-ApiVoy-Protocol-Api-Version header".into(),
        ));
    };
    if version != PROTOCOL_API_VERSION {
        return Err((
            StatusCode::UPGRADE_REQUIRED,
            format!(
                "protocol API version mismatch: client={version}, agent={PROTOCOL_API_VERSION}; upgrade required"
            ),
        ));
    }
    Ok(())
}

async fn auth_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let bearer = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let authorized = if bearer.is_some_and(|value| value == state.token.as_str()) {
        true
    } else if let Some(value) = bearer {
        let now = Instant::now();
        let mut sessions = state.sessions.lock().await;
        sessions.retain(|_, expires| *expires > now);
        sessions.get(value).is_some_and(|expires| *expires > now)
    } else {
        false
    };

    if authorized {
        Ok(next.run(req).await)
    } else {
        warn!("rejected unauthenticated request to {}", req.uri().path());
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn create_session(State(state): State<AppState>) -> Json<SessionResponse> {
    const LIFETIME_SECONDS: u64 = 8 * 60 * 60;
    let token = Uuid::new_v4().simple().to_string();
    state.sessions.lock().await.insert(
        token.clone(),
        Instant::now() + Duration::from_secs(LIFETIME_SECONDS),
    );
    Json(SessionResponse {
        token,
        expires_in_seconds: LIFETIME_SECONDS,
    })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "apivoy-agent",
        version: env!("CARGO_PKG_VERSION"),
        agent_version: env!("CARGO_PKG_VERSION"),
        bind: std::env::var("APIVOY_AGENT_BIND").unwrap_or_else(|_| "127.0.0.1:39217".into()),
        protocol_api_version: PROTOCOL_API_VERSION,
        min_protocol_api_version: PROTOCOL_API_VERSION,
        max_protocol_api_version: PROTOCOL_API_VERSION,
        auth_required: true,
    })
}

async fn list_mock_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<MockRule>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let mut rules = state
        .mock_rules
        .lock()
        .await
        .values()
        .map(|entry| entry.rule.clone())
        .collect::<Vec<_>>();
    rules.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(Json(rules))
}

async fn list_plugins(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<InstalledPlugin>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .plugins
        .list()
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn install_plugin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<InstallPluginBody>,
) -> Result<(StatusCode, Json<InstalledPlugin>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let bytes = BASE64.decode(body.wasm_base64).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            format!("invalid wasmBase64: {error}"),
        )
    })?;
    let plugins = Arc::clone(&state.plugins);
    let plugin = tokio::task::spawn_blocking(move || plugins.install(body.manifest, &bytes))
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    Ok((StatusCode::CREATED, Json(plugin)))
}

async fn set_plugin_enabled(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SetPluginEnabledBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .plugins
        .set_enabled(&id, body.enabled)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))
}

async fn uninstall_plugin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .plugins
        .uninstall(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))
}

async fn invoke_plugin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<InvokePluginBody>,
) -> Result<Json<InvokePluginResponse>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let plugins = Arc::clone(&state.plugins);
    let output = tokio::task::spawn_blocking(move || plugins.invoke(&id, &body.input))
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    Ok(Json(InvokePluginResponse { output }))
}

async fn create_mock_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateMockRule>,
) -> Result<(StatusCode, Json<MockRule>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    validate_mock_rule(&input)?;
    let rule = MockRule {
        id: Uuid::new_v4(),
        name: input.name,
        method: input.method.to_uppercase(),
        path: normalize_mock_path(&input.path),
        status: input.status,
        headers: input.headers,
        body: input.body,
        delay_ms: input.delay_ms,
        error_every: input.error_every.filter(|value| *value > 0),
        priority: input.priority,
        ws_messages: input.ws_messages,
        ws_echo: input.ws_echo,
        ws_interval_ms: input.ws_interval_ms,
    };
    state.mock_rules.lock().await.insert(
        rule.id,
        MockRuleState {
            rule: rule.clone(),
            hits: 0,
        },
    );
    persist_mock_rules(&state).await?;
    Ok((StatusCode::CREATED, Json(rule)))
}

async fn update_mock_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<CreateMockRule>,
) -> Result<Json<MockRule>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    validate_mock_rule(&input)?;
    let mut rules = state.mock_rules.lock().await;
    let entry = rules
        .get_mut(&id)
        .ok_or((StatusCode::NOT_FOUND, "mock rule not found".into()))?;
    entry.rule = MockRule {
        id,
        name: input.name,
        method: input.method.to_uppercase(),
        path: normalize_mock_path(&input.path),
        status: input.status,
        headers: input.headers,
        body: input.body,
        delay_ms: input.delay_ms,
        error_every: input.error_every.filter(|value| *value > 0),
        priority: input.priority,
        ws_messages: input.ws_messages,
        ws_echo: input.ws_echo,
        ws_interval_ms: input.ws_interval_ms,
    };
    let rule = entry.rule.clone();
    drop(rules);
    persist_mock_rules(&state).await?;
    Ok(Json(rule))
}

async fn delete_mock_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let status = state
        .mock_rules
        .lock()
        .await
        .remove(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .ok_or((StatusCode::NOT_FOUND, "mock rule not found".into()))?;
    persist_mock_rules(&state).await?;
    Ok(status)
}

fn validate_mock_rule(input: &CreateMockRule) -> Result<(), (StatusCode, String)> {
    if input.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "mock rule name is required".into()));
    }
    if Method::from_bytes(input.method.as_bytes()).is_err()
        && input.method != "*"
        && !input.method.eq_ignore_ascii_case("WS")
    {
        return Err((StatusCode::BAD_REQUEST, "invalid mock HTTP method".into()));
    }
    if StatusCode::from_u16(input.status).is_err() {
        return Err((StatusCode::BAD_REQUEST, "invalid mock status".into()));
    }
    Ok(())
}
fn normalize_mock_path(value: &str) -> String {
    format!("/{}", value.trim().trim_start_matches('/'))
}

fn load_mock_rules(path: &PathBuf) -> HashMap<Uuid, MockRuleState> {
    let rules = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<MockRule>>(&text).ok())
        .unwrap_or_default();
    rules
        .into_iter()
        .map(|rule| (rule.id, MockRuleState { rule, hits: 0 }))
        .collect()
}

async fn persist_mock_rules(state: &AppState) -> Result<(), (StatusCode, String)> {
    let rules = state
        .mock_rules
        .lock()
        .await
        .values()
        .map(|entry| entry.rule.clone())
        .collect::<Vec<_>>();
    if let Some(parent) = state.mock_rules_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    let bytes = serde_json::to_vec_pretty(&rules)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    fs::write(state.mock_rules_path.as_ref(), bytes)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn serve_mock(
    State(state): State<AppState>,
    method: Method,
    Path(path): Path<String>,
) -> Response {
    let requested_path = normalize_mock_path(&path);
    let selected = {
        let mut rules = state.mock_rules.lock().await;
        let selected_id = select_mock_rule_id(&rules, method.as_str(), &requested_path);
        selected_id.and_then(|id| rules.get_mut(&id)).map(|entry| {
            entry.hits += 1;
            (entry.rule.clone(), entry.hits)
        })
    };
    let Some((rule, hits)) = selected else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("No ApiVoy mock rule matched"))
            .unwrap();
    };
    if rule.delay_ms > 0 {
        tokio::time::sleep(std::time::Duration::from_millis(rule.delay_ms)).await;
    }
    if rule.error_every.is_some_and(|every| hits % every == 0) {
        return Response::builder()
            .status(StatusCode::SERVICE_UNAVAILABLE)
            .header("X-ApiVoy-Mock-Injected", "true")
            .body(Body::from("Injected mock failure"))
            .unwrap();
    }
    let mut response = Response::builder()
        .status(rule.status)
        .header("X-ApiVoy-Mock-Rule", rule.id.to_string());
    for (name, value) in rule.headers {
        response = response.header(name, value);
    }
    response
        .body(Body::from(rule.body))
        .unwrap_or_else(|error| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from(error.to_string()))
                .unwrap()
        })
}

async fn serve_mock_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Response {
    let requested_path = normalize_mock_path(&path);
    let selected = {
        let mut rules = state.mock_rules.lock().await;
        let selected_id = select_mock_rule_id(&rules, "WS", &requested_path);
        selected_id.and_then(|id| rules.get_mut(&id)).map(|entry| {
            entry.hits += 1;
            entry.rule.clone()
        })
    };
    let Some(rule) = selected else {
        return (
            StatusCode::NOT_FOUND,
            "No ApiVoy WebSocket mock rule matched",
        )
            .into_response();
    };
    ws.on_upgrade(move |socket| run_websocket_mock(socket, rule))
        .into_response()
}

async fn run_websocket_mock(mut socket: WebSocket, rule: MockRule) {
    if rule.delay_ms > 0 {
        tokio::time::sleep(std::time::Duration::from_millis(rule.delay_ms)).await;
    }
    for (index, message) in rule.ws_messages.iter().enumerate() {
        if socket
            .send(AxumWsMessage::Text(message.clone().into()))
            .await
            .is_err()
        {
            return;
        }
        if index + 1 < rule.ws_messages.len() && rule.ws_interval_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(rule.ws_interval_ms)).await;
        }
    }
    if !rule.ws_echo {
        let _ = socket.close().await;
        return;
    }
    while let Some(Ok(message)) = socket.next().await {
        match message {
            AxumWsMessage::Text(value) => {
                if socket.send(AxumWsMessage::Text(value)).await.is_err() {
                    break;
                }
            }
            AxumWsMessage::Binary(value) => {
                if socket.send(AxumWsMessage::Binary(value)).await.is_err() {
                    break;
                }
            }
            AxumWsMessage::Close(_) => break,
            _ => {}
        }
    }
}

async fn tcp_session(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<TcpSessionQuery>,
) -> Response {
    let valid_master = query.token.as_bytes() == state.token.as_bytes();
    let valid_session = {
        let now = Instant::now();
        let mut sessions = state.sessions.lock().await;
        sessions.retain(|_, expires| *expires > now);
        sessions
            .get(&query.token)
            .is_some_and(|expires| *expires > now)
    };
    if !valid_master && !valid_session {
        return (
            StatusCode::UNAUTHORIZED,
            "invalid or expired pairing/session token",
        )
            .into_response();
    }
    let target = query.target;
    ws.on_upgrade(move |socket| relay_tcp_session(socket, target))
        .into_response()
}

async fn relay_tcp_session(socket: WebSocket, target: String) {
    let Ok(stream) = TcpStream::connect(&target).await else {
        return;
    };
    let (mut tcp_read, mut tcp_write) = tokio::io::split(stream);
    let (mut ws_write, mut ws_read) = socket.split();
    let to_tcp = async {
        while let Some(Ok(message)) = ws_read.next().await {
            let data = match message {
                AxumWsMessage::Text(value) => value.as_bytes().to_vec(),
                AxumWsMessage::Binary(value) => value.to_vec(),
                AxumWsMessage::Close(_) => break,
                _ => continue,
            };
            if tcp_write.write_all(&data).await.is_err() {
                break;
            }
        }
    };
    let from_tcp = async {
        let mut buffer = vec![0u8; 16 * 1024];
        loop {
            let Ok(size) = tcp_read.read(&mut buffer).await else {
                break;
            };
            if size == 0 {
                break;
            }
            if ws_write
                .send(AxumWsMessage::Binary(buffer[..size].to_vec().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    };
    tokio::select! { _ = to_tcp => {}, _ = from_tcp => {} }
}

fn select_mock_rule_id(
    rules: &HashMap<Uuid, MockRuleState>,
    method: &str,
    requested_path: &str,
) -> Option<Uuid> {
    rules
        .iter()
        .filter(|(_, entry)| {
            entry.rule.path == requested_path
                && (entry.rule.method == "*" || entry.rule.method.eq_ignore_ascii_case(method))
        })
        .max_by_key(|(_, entry)| (entry.rule.priority, entry.rule.method != "*"))
        .map(|(id, _)| *id)
}

async fn capabilities(State(state): State<AppState>) -> Json<Vec<DriverDescriptor>> {
    let engine = state.engine.read().await;
    Json(engine.list_drivers())
}

async fn put_secret(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutSecretBody>,
) -> Result<Json<PutSecretResponse>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "secret name is required".into()));
    }
    state
        .secrets
        .put_ref(&name, body.value)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(PutSecretResponse {
        name,
        backend: match state.secrets.backend_kind() {
            SecretBackendKind::Memory => "memory",
            SecretBackendKind::Keychain => "keychain",
        },
    }))
}

async fn ai_assist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AiAssistRequest>,
) -> Result<Json<AiAssistResponse>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let api_key = state
        .secrets
        .resolve(&request.secret_ref)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    run_ai_assistant(request, &api_key)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, error.to_string()))
}

async fn capture_status(State(state): State<AppState>) -> Json<CaptureStatus> {
    Json(state.capture.status().await)
}
async fn start_capture(
    State(state): State<AppState>,
    Json(body): Json<StartCaptureBody>,
) -> Result<Json<CaptureStatus>, (StatusCode, String)> {
    let bind = body
        .bind
        .unwrap_or_else(|| "127.0.0.1:39219".into())
        .parse()
        .map_err(|error: std::net::AddrParseError| (StatusCode::BAD_REQUEST, error.to_string()))?;
    state
        .capture
        .start(bind, body.allow_remote.unwrap_or(false))
        .await
        .map(Json)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))
}
async fn stop_capture(State(state): State<AppState>) -> Json<CaptureStatus> {
    Json(state.capture.stop().await)
}
async fn capture_exchanges(State(state): State<AppState>) -> Json<Vec<CapturedExchange>> {
    Json(state.capture.exchanges().await)
}
async fn clear_capture(State(state): State<AppState>) -> StatusCode {
    state.capture.clear().await;
    StatusCode::NO_CONTENT
}

async fn list_cookies(
    State(state): State<AppState>,
    Query(query): Query<CookieQuery>,
) -> Result<Json<Vec<CookieItem>>, (StatusCode, String)> {
    state
        .http_driver
        .cookies_for(&query.url)
        .map(|items| {
            Json(
                items
                    .into_iter()
                    .map(|(name, value)| CookieItem { name, value })
                    .collect(),
            )
        })
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))
}

async fn set_cookie(
    State(state): State<AppState>,
    Json(input): Json<CookieMutation>,
) -> Result<StatusCode, (StatusCode, String)> {
    if input.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "cookie name is required".into()));
    }
    state
        .http_driver
        .set_cookie(
            &input.url,
            &format!("{}={}; Path=/", input.name.trim(), input.value),
        )
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))
}

async fn delete_cookie(
    State(state): State<AppState>,
    Json(input): Json<CookieMutation>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .http_driver
        .delete_cookie(&input.url, input.name.trim())
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))
}

async fn get_default_environment(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<EnvironmentRecord>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .default_environment()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn put_default_environment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveEnvironmentBody>,
) -> Result<Json<EnvironmentRecord>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let mut env = state
        .store
        .lock()
        .await
        .default_environment()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    env.variables = body.variables;
    env.secret_refs = body.secret_refs;
    env.updated_at = Utc::now();
    state
        .store
        .lock()
        .await
        .save_environment(&env)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(env))
}

async fn list_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Vec<ExecutionRecord>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let filter = ExecutionFilter {
        request_id: query.request_id,
        state: query.state,
        protocol_id: query.protocol_id,
        status: query.status,
    };
    state
        .store
        .lock()
        .await
        .list_executions_filtered(query.limit.unwrap_or(30), &filter)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_history_item(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Option<ExecutionRecord>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .get_execution(&id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_history_body(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let store = state.store.lock().await;
    let execution = store
        .get_execution(&id)
        .map_err(internal_store_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("execution {id} not found")))?;
    let blob_id = execution.response_blob_id.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            "response body was not persisted".into(),
        )
    })?;
    let meta = store
        .get_blob(&blob_id)
        .map_err(internal_store_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "response body blob not found".into()))?;
    let bytes = store.read_blob(&blob_id).map_err(internal_store_error)?;
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            meta.content_type
                .unwrap_or_else(|| "application/octet-stream".into()),
        )
        .header(header::CONTENT_LENGTH, bytes.len())
        .body(Body::from(bytes))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn save_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RequestQuery>,
    Json(envelope): Json<RequestEnvelope>,
) -> Result<Json<StoredRequest>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .save_request(
            &envelope,
            query.project_id.as_deref().unwrap_or("default-project"),
            query
                .collection_id
                .as_deref()
                .unwrap_or("default-collection"),
        )
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn list_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RequestQuery>,
) -> Result<Json<Vec<StoredRequest>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .list_requests(query.collection_id.as_deref())
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn delete_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let id = core_domain::RequestId(
        Uuid::parse_str(&id).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
    );
    state
        .store
        .lock()
        .await
        .delete_request(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn get_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Option<StoredRequest>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let id = core_domain::RequestId(
        Uuid::parse_str(&id).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
    );
    state
        .store
        .lock()
        .await
        .get_request(&id)
        .map(Json)
        .map_err(internal_store_error)
}

async fn move_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MoveRequestBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let id = core_domain::RequestId(
        Uuid::parse_str(&id).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
    );
    state
        .store
        .lock()
        .await
        .move_request(&id, &body.project_id, &body.collection_id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn get_workspace_tree(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WorkspaceTree>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let store = state.store.lock().await;
    let workspaces = store.list_workspaces().map_err(internal_store_error)?;
    let mut projects = Vec::new();
    let mut collections = Vec::new();
    for workspace in &workspaces {
        projects.extend(
            store
                .list_projects(&workspace.id)
                .map_err(internal_store_error)?,
        );
    }
    for project in &projects {
        collections.extend(
            store
                .list_collections(&project.id)
                .map_err(internal_store_error)?,
        );
    }
    let requests = store.list_requests(None).map_err(internal_store_error)?;
    Ok(Json(WorkspaceTree {
        workspaces,
        projects,
        collections,
        requests,
    }))
}

async fn create_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateWorkspaceBody>,
) -> Result<(StatusCode, Json<WorkspaceRecord>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .create_workspace(&body.name, body.root_path)
        .map(|record| (StatusCode::CREATED, Json(record)))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn rename_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NamedBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .rename_workspace(&id, &body.name)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn archive_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ArchiveWorkspaceBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .archive_workspace(&id, body.archived)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn touch_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .touch_workspace(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn delete_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .delete_workspace(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

fn internal_store_error(error: local_store::StoreError) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateProjectBody>,
) -> Result<(StatusCode, Json<ProjectRecord>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .create_project(&body.workspace_id, &body.name)
        .map(|record| (StatusCode::CREATED, Json(record)))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn rename_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NamedBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .rename_project(&id, &body.name)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn delete_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .delete_project(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn update_collection_tags(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<TagsBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .update_collection_tags(&id, &body.tags)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn create_collection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateCollectionBody>,
) -> Result<(StatusCode, Json<CollectionRecord>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .create_collection(&body.project_id, body.parent_id.as_deref(), &body.name)
        .map(|record| (StatusCode::CREATED, Json(record)))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn update_collection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateCollectionBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .update_collection(&id, &body.name, body.parent_id.as_deref(), body.sort_order)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn delete_collection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .delete_collection(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

async fn load_latest_request(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<StoredRequest>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .latest_request()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn start_execution(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut request): Json<RequestEnvelope>,
) -> Result<(StatusCode, Json<StartExecutionResponse>), (StatusCode, String)> {
    check_protocol_version(&headers)?;

    let client = headers
        .get(HEADER_CLIENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");
    let client_version = headers
        .get(HEADER_CLIENT_VERSION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");
    info!(%client, %client_version, "starting execution");

    let env_id = request
        .environment_ref
        .clone()
        .unwrap_or_else(|| "default-env".into());
    request.environment_ref = Some(env_id.clone());

    let mut scope = VariableScope::default();
    {
        let store = state.store.lock().await;
        if let Ok(Some(env)) = store.get_environment(&env_id) {
            scope.environment = env.variables;
            for secret_name in env.secret_refs {
                if let Ok(value) = state.secrets.resolve(&secret_name) {
                    scope.secrets.insert(secret_name.clone(), value.clone());
                    scope.environment.insert(secret_name, value);
                }
            }
        }
    }
    scope.request = request.variables.clone();
    if let Some(auth) = &request.auth_ref {
        if let Some(name) = auth.secret_ref.as_deref().filter(|s| !s.is_empty()) {
            if let Ok(value) = state.secrets.resolve(name) {
                scope.secrets.insert(name.to_string(), value);
            }
        }
    }

    let mut snapshot = request.clone();
    if snapshot.auth_ref.is_some() {
        if let ProtocolPayload::Http(ref mut payload) = snapshot.payload {
            payload
                .headers
                .retain(|(k, _)| !k.eq_ignore_ascii_case("Authorization"));
        }
    }

    let engine = state.engine.read().await;
    let (id, mut rx, handle) = engine
        .execute_with_scope(request, scope)
        .await
        .map_err(|err| (StatusCode::BAD_GATEWAY, err.to_string()))?;

    let (sse_tx, sse_rx) = mpsc::channel::<ExecutionEvent>(256);
    let store = state.store.clone();
    let execution_id = id.clone();
    let execution_environment_id = env_id.clone();
    tokio::spawn(async move {
        let mut preview = None;
        let mut response_bytes = Vec::new();
        let mut response_content_type = None;
        let mut truncated = false;
        let mut client_connected = true;
        let mut extracted_variables = None;
        while let Some(mut event) = rx.recv().await {
            if let ExecutionEvent::ResponseMeta(meta) = &event {
                response_content_type = meta.content_type.clone();
            }
            if let ExecutionEvent::ResponseChunk {
                preview: event_preview,
                done,
                data_base64,
                ..
            } = &mut event
            {
                if *done {
                    preview = event_preview.clone();
                }
                if let Some(encoded) = data_base64.take() {
                    if let Ok(decoded) = BASE64.decode(encoded) {
                        let remaining =
                            MAX_PERSISTED_RESPONSE_BYTES.saturating_sub(response_bytes.len());
                        response_bytes.extend_from_slice(&decoded[..decoded.len().min(remaining)]);
                        truncated |= decoded.len() > remaining;
                    }
                }
            }
            if let ExecutionEvent::VariablesExtracted { variables } = &event {
                extracted_variables = Some(variables.clone());
            }
            if client_connected && sse_tx.send(event).await.is_err() {
                client_connected = false;
            }
        }
        if truncated && client_connected {
            let _ = sse_tx
                .send(ExecutionEvent::Warning {
                    code: "response_persist_truncated".into(),
                    message: format!(
                        "响应正文超过 {} MiB，本地持久化已截断",
                        MAX_PERSISTED_RESPONSE_BYTES / 1024 / 1024
                    ),
                })
                .await;
        }
        match handle.await {
            Ok(Ok(summary)) => {
                let store = store.lock().await;
                let response_blob_id = if response_bytes.is_empty() {
                    None
                } else {
                    store
                        .put_blob(&response_bytes, response_content_type.as_deref())
                        .ok()
                        .map(|blob| blob.id)
                };
                let record = ExecutionRecord {
                    id: execution_id.0.to_string(),
                    request_id: snapshot.id.0.to_string(),
                    protocol_id: summary.protocol_id.clone(),
                    state: state_name(summary.state).into(),
                    status: summary.status,
                    duration_ms: summary.duration_ms,
                    bytes_received: summary.bytes_received,
                    started_at: summary.started_at,
                    finished_at: summary.finished_at,
                    request_snapshot: Some(snapshot),
                    preview,
                    response_blob_id,
                };
                if let Err(err) = store.record_execution(&record) {
                    warn!(error = %err, "failed to persist execution history");
                }
                if let Some(variables) = extracted_variables {
                    match store.get_environment(&execution_environment_id) {
                        Ok(Some(mut environment)) => {
                            environment.variables.extend(variables);
                            environment.updated_at = Utc::now();
                            if let Err(err) = store.save_environment(&environment) {
                                warn!(error = %err, "failed to persist extracted script variables");
                            }
                        }
                        Ok(None) => {
                            warn!(environment = %execution_environment_id, "script variables were not persisted because environment was missing")
                        }
                        Err(err) => {
                            warn!(error = %err, "failed to load environment for extracted variables")
                        }
                    }
                }
            }
            Ok(Err(err)) => {
                let now = Utc::now();
                let record = ExecutionRecord {
                    id: execution_id.0.to_string(),
                    request_id: snapshot.id.0.to_string(),
                    protocol_id: snapshot.protocol_id.0.clone(),
                    state: "failed".into(),
                    status: None,
                    duration_ms: 0,
                    bytes_received: 0,
                    started_at: now,
                    finished_at: now,
                    request_snapshot: Some(snapshot),
                    preview: Some(err.to_string()),
                    response_blob_id: None,
                };
                if let Err(store_err) = store.lock().await.record_execution(&record) {
                    warn!(error = %store_err, "failed to persist failed execution");
                }
            }
            Err(err) => {
                warn!(error = %err, "execution task join error");
            }
        }
    });

    state
        .executions
        .lock()
        .await
        .insert(id.0, ExecutionSlot { events: sse_rx });

    Ok((
        StatusCode::ACCEPTED,
        Json(StartExecutionResponse {
            execution_id: id.0.to_string(),
            state: "running",
            protocol_api_version: PROTOCOL_API_VERSION,
            agent_version: env!("CARGO_PKG_VERSION"),
        }),
    ))
}

async fn execution_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;

    let uuid = Uuid::parse_str(&id).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let slot = state.executions.lock().await.remove(&uuid).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            format!("execution {id} not found or events already consumed"),
        )
    })?;

    let stream = stream::unfold(slot.events, |mut rx| async move {
        match rx.recv().await {
            Some(event) => {
                let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".into());
                let item = Ok(Event::default().event("execution").data(data));
                Some((item, rx))
            }
            None => None,
        }
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

async fn debug_http_get(
    State(state): State<AppState>,
    Json(body): Json<HttpGetBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let engine = state.engine.read().await;
    let req = sample_http_get(body.url);
    match engine.execute_collect(req).await {
        Ok((id, summary, events)) => Ok(Json(serde_json::json!({
            "executionId": id.0,
            "summary": summary,
            "eventCount": events.len(),
            "deprecated": true,
            "prefer": "POST /v1/executions + GET /v1/executions/{id}/events",
        }))),
        Err(err) => Err((StatusCode::BAD_GATEWAY, err.to_string())),
    }
}

async fn cancel_execution(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let uuid = Uuid::parse_str(&id).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let engine = state.engine.read().await;
    let cancelled = engine.cancel(&ExecutionId(uuid));
    Ok(Json(serde_json::json!({ "cancelled": cancelled })))
}

fn state_name(state: ExecutionState) -> &'static str {
    match state {
        ExecutionState::Queued => "queued",
        ExecutionState::Running => "running",
        ExecutionState::Completed => "completed",
        ExecutionState::Failed => "failed",
        ExecutionState::Cancelled => "cancelled",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_rule(method: &str, priority: i32) -> MockRuleState {
        MockRuleState {
            rule: MockRule {
                id: Uuid::new_v4(),
                name: format!("{method}-{priority}"),
                method: method.into(),
                path: "/same".into(),
                status: 200,
                headers: HashMap::new(),
                body: String::new(),
                delay_ms: 0,
                error_every: None,
                priority,
                ws_messages: vec![],
                ws_echo: false,
                ws_interval_ms: 0,
            },
            hits: 0,
        }
    }

    #[test]
    fn mock_selection_uses_priority_then_method_specificity() {
        let mut rules = HashMap::new();
        let wildcard = mock_rule("*", 10);
        let wildcard_id = wildcard.rule.id;
        rules.insert(wildcard_id, wildcard);
        let exact = mock_rule("GET", 5);
        rules.insert(exact.rule.id, exact);
        assert_eq!(
            select_mock_rule_id(&rules, "GET", "/same"),
            Some(wildcard_id)
        );
        let exact_high = mock_rule("GET", 10);
        let exact_high_id = exact_high.rule.id;
        rules.insert(exact_high_id, exact_high);
        assert_eq!(
            select_mock_rule_id(&rules, "GET", "/same"),
            Some(exact_high_id)
        );
    }
}
