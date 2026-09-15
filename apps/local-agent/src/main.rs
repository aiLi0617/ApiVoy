//! ApiVoy Local Agent.
//!
//! Listens on 127.0.0.1 by default. Container deployments may explicitly override the bind address.
//! Shares the same protocol-core crates as Desktop; ships as an independent binary.

use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use axum::{Json, Router};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use capture_proxy::{CaptureProxy, CaptureStatus, CapturedExchange};
use chrono::Utc;
use core_domain::{ExecutionEvent, ExecutionId, ExecutionState, ProtocolPayload, RequestEnvelope};
use driver_amqp::AmqpDriver;
use driver_graphql::GraphqlDriver;
use driver_grpc::GrpcDriver;
use driver_http::HttpDriver;
use driver_kafka::KafkaDriver;
use driver_mqtt::MqttDriver;
use driver_redis::RedisDriver;
use driver_rpc_http::{JsonRpcDriver, SoapDriver};
use driver_sql::SqlDriver;
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
    ApiDefinitionRecord, CollectionRecord, EnvironmentRecord, ExecutionFilter, ExecutionRecord,
    LocalStore, ModuleRecord, ProjectRecord, RequestDefinitionBinding, ScriptRecord, StoredRequest,
    WorkspaceRecord,
};
use mock_server_core::{normalize_mock_path, MockMatchConditions, MockRule};
use plugin_runtime::{InstalledPlugin, PluginManager, PluginManifest, PluginPermission};
use secret_store::{SecretBackendKind, SecretStore};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::Child;
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
const TCP_SESSION_TICKET_PREFIX: &str = "apivoy-ticket.";
const TCP_SESSION_TICKET_LIFETIME_SECONDS: u64 = 30;
const MAX_PENDING_TCP_SESSION_TICKETS: usize = 256;

#[derive(Clone)]
struct AppState {
    engine: Arc<RwLock<ExecutionEngine>>,
    http_driver: Arc<HttpDriver>,
    token: Arc<String>,
    sessions: Arc<Mutex<HashMap<String, Instant>>>,
    tcp_session_tickets: Arc<Mutex<HashMap<String, TcpSessionTicket>>>,
    allowed_origins: Arc<HashSet<String>>,
    secrets: Arc<SecretStore>,
    store: Arc<Mutex<LocalStore>>,
    executions: Arc<Mutex<HashMap<Uuid, ExecutionSlot>>>,
    mock_rules: Arc<Mutex<HashMap<Uuid, MockRuleState>>>,
    mock_rules_path: Arc<PathBuf>,
    mock_server: Arc<Mutex<MockServerProcess>>,
    plugins: Arc<PluginManager>,
    capture: CaptureProxy,
}

struct MockRuleState {
    rule: MockRule,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMockRule {
    project_key: String,
    service_key: String,
    operation_id: Option<String>,
    response_id: Option<String>,
    #[serde(default = "default_true")]
    enabled: bool,
    name: String,
    method: String,
    path: String,
    status: u16,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    match_conditions: MockMatchConditions,
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

fn default_true() -> bool {
    true
}

struct MockServerProcess {
    child: Option<Child>,
    bind: String,
    last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartMockServerBody {
    #[serde(default = "default_mock_bind")]
    bind: String,
    #[serde(default)]
    allow_remote: bool,
}

fn default_mock_bind() -> String {
    "127.0.0.1:39218".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MockServerStatus {
    running: bool,
    bind: String,
    request_count: u64,
    active_websockets: u64,
    last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockServerHealth {
    request_count: u64,
    active_websockets: u64,
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
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    variables: HashMap<String, String>,
    #[serde(default)]
    secret_refs: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct EnvironmentQuery {
    project_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveScriptBody {
    project_id: String,
    name: String,
    language: String,
    source: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptQuery {
    project_id: String,
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
    module_id: Option<String>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiDefinitionQuery {
    project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveApiDefinitionBody {
    id: Option<String>,
    project_id: String,
    module_id: Option<String>,
    name: String,
    format: String,
    file_name: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockDesignResponse {
    id: String,
    name: String,
    status_code: String,
    #[serde(default = "default_mock_content_type")]
    content_type: String,
    #[serde(default)]
    example_body: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockDesignField {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    example: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
    scope: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    response_id: Option<String>,
}

fn default_mock_content_type() -> String {
    "application/json".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindRequestDefinitionBody {
    definition_id: String,
    operation_ref: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTree {
    workspaces: Vec<WorkspaceRecord>,
    projects: Vec<ProjectRecord>,
    modules: Vec<ModuleRecord>,
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
}

struct TcpSessionTicket {
    target: String,
    expires_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TcpSessionTicketResponse {
    ticket: String,
    expires_in_seconds: u64,
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
    engine.register(Arc::new(KafkaDriver));
    engine.register(Arc::new(SqlDriver));

    let mock_rules_path = config_dir().join("mock-rules.json");
    let mock_rules = load_mock_rules(&mock_rules_path);
    let plugins =
        PluginManager::new_from_env(config_dir().join("plugins"), plugin_permission_grants())
            .map_err(|error| error.to_string())?;
    let origins = allowed_origins()?;
    let allowed_origin_strings = origins
        .iter()
        .filter_map(|origin| origin.to_str().ok())
        .map(str::to_owned)
        .collect();
    let state = AppState {
        engine: Arc::new(RwLock::new(engine)),
        http_driver,
        token,
        sessions: Arc::new(Mutex::new(HashMap::new())),
        tcp_session_tickets: Arc::new(Mutex::new(HashMap::new())),
        allowed_origins: Arc::new(allowed_origin_strings),
        secrets: Arc::new(SecretStore::with_keychain()),
        store: Arc::new(Mutex::new(store)),
        executions: Arc::new(Mutex::new(HashMap::new())),
        mock_rules: Arc::new(Mutex::new(mock_rules)),
        mock_rules_path: Arc::new(mock_rules_path),
        mock_server: Arc::new(Mutex::new(MockServerProcess {
            child: None,
            bind: default_mock_bind(),
            last_error: None,
        })),
        plugins: Arc::new(plugins),
        capture: CaptureProxy::new(),
    };
    let existing_bindings = state
        .store
        .lock()
        .await
        .list_request_definition_bindings()?;
    for binding in existing_bindings {
        sync_design_mock_rules(&state, &binding)
            .await
            .map_err(|(_, error)| error)?;
    }

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
            Method::HEAD,
        ])
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
        .route("/v1/tcp-session-ticket", post(create_tcp_session_ticket))
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
        .route(
            "/v1/environments",
            get(list_environments).post(create_environment),
        )
        .route(
            "/v1/environments/{id}",
            put(put_environment).delete(delete_environment),
        )
        .route("/v1/scripts", get(list_scripts).post(create_script))
        .route("/v1/scripts/{id}", put(put_script).delete(delete_script))
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
        .route(
            "/v1/api-definitions",
            get(list_api_definitions).post(save_api_definition),
        )
        .route(
            "/v1/api-definitions/{id}",
            get(get_api_definition)
                .put(save_api_definition_at_id)
                .delete(delete_api_definition),
        )
        .route(
            "/v1/requests/{id}/definition-binding",
            get(get_request_definition_binding)
                .put(bind_request_definition)
                .delete(unbind_request_definition),
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
        .route("/v1/modules", post(create_module))
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
        .route("/v1/mock-server/status", get(mock_server_status))
        .route("/v1/mock-server/start", post(start_mock_server))
        .route("/v1/mock-server/stop", post(stop_mock_server))
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
        .unwrap_or_else(|_| {
            "http://localhost:5180,http://tauri.localhost,tauri://localhost".to_string()
        })
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

async fn create_tcp_session_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TcpSessionQuery>,
) -> Result<Json<TcpSessionTicketResponse>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let target = body.target.trim();
    if target.is_empty() || target.len() > 2_048 || target.contains("\r") || target.contains("\n") {
        return Err((StatusCode::BAD_REQUEST, "invalid TCP target".into()));
    }
    let ticket = Uuid::new_v4().simple().to_string();
    let now = Instant::now();
    let mut tickets = state.tcp_session_tickets.lock().await;
    tickets.retain(|_, entry| entry.expires_at > now);
    if tickets.len() >= MAX_PENDING_TCP_SESSION_TICKETS {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "too many pending TCP session tickets".into(),
        ));
    }
    tickets.insert(
        ticket.clone(),
        TcpSessionTicket {
            target: target.to_owned(),
            expires_at: now + Duration::from_secs(TCP_SESSION_TICKET_LIFETIME_SECONDS),
        },
    );
    Ok(Json(TcpSessionTicketResponse {
        ticket,
        expires_in_seconds: TCP_SESSION_TICKET_LIFETIME_SECONDS,
    }))
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
        source: "custom".into(),
        project_key: input.project_key,
        service_key: input.service_key,
        operation_id: input.operation_id,
        response_id: input.response_id,
        enabled: input.enabled,
        name: input.name,
        method: input.method.to_uppercase(),
        path: normalize_mock_path(&input.path),
        status: input.status,
        headers: input.headers,
        body: input.body,
        match_conditions: input.match_conditions,
        delay_ms: input.delay_ms,
        error_every: input.error_every.filter(|value| *value > 0),
        priority: input.priority,
        ws_messages: input.ws_messages,
        ws_echo: input.ws_echo,
        ws_interval_ms: input.ws_interval_ms,
    };
    state
        .mock_rules
        .lock()
        .await
        .insert(rule.id, MockRuleState { rule: rule.clone() });
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
        source: "custom".into(),
        project_key: input.project_key,
        service_key: input.service_key,
        operation_id: input.operation_id,
        response_id: input.response_id,
        enabled: input.enabled,
        name: input.name,
        method: input.method.to_uppercase(),
        path: normalize_mock_path(&input.path),
        status: input.status,
        headers: input.headers,
        body: input.body,
        match_conditions: input.match_conditions,
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
    if input.project_key.trim().is_empty() || input.service_key.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "mock projectKey and serviceKey are required".into(),
        ));
    }
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

fn load_mock_rules(path: &PathBuf) -> HashMap<Uuid, MockRuleState> {
    let rules = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<MockRule>>(&text).ok())
        .unwrap_or_default();
    rules
        .into_iter()
        .map(|rule| (rule.id, MockRuleState { rule }))
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

async fn mock_server_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MockServerStatus>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    Ok(Json(read_mock_server_status(&state).await))
}

async fn read_mock_server_status(state: &AppState) -> MockServerStatus {
    let (running, bind, last_error) = {
        let mut process = state.mock_server.lock().await;
        let running = if let Some(child) = process.child.as_mut() {
            match child.try_wait() {
                Ok(None) => true,
                Ok(Some(status)) => {
                    process.last_error = if status.success() {
                        None
                    } else {
                        Some(format!("Mock 服务已退出：{status}"))
                    };
                    process.child = None;
                    false
                }
                Err(error) => {
                    process.last_error = Some(format!("无法读取 Mock 服务状态：{error}"));
                    false
                }
            }
        } else {
            false
        };
        (running, process.bind.clone(), process.last_error.clone())
    };
    let health = if running {
        if let Ok(url) = mock_health_url(&bind) {
            match reqwest::get(url).await {
                Ok(response) => response.json::<MockServerHealth>().await.ok(),
                Err(_) => None,
            }
        } else {
            None
        }
    } else {
        None
    };
    MockServerStatus {
        running,
        bind,
        request_count: health.as_ref().map_or(0, |value| value.request_count),
        active_websockets: health.map_or(0, |value| value.active_websockets),
        last_error,
    }
}

async fn start_mock_server(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<StartMockServerBody>,
) -> Result<Json<MockServerStatus>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let bind = body.bind.parse::<SocketAddr>().map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            format!("无效的 Mock 监听地址：{error}"),
        )
    })?;
    if bind.port() == 0 {
        return Err((StatusCode::BAD_REQUEST, "Mock 监听端口不能为 0".into()));
    }
    if !bind.ip().is_loopback() && !body.allow_remote {
        return Err((
            StatusCode::BAD_REQUEST,
            "局域网监听必须显式确认 allowRemote；Mock 响应可能被同网段设备访问".into(),
        ));
    }
    if read_mock_server_status(&state).await.running {
        return Err((StatusCode::CONFLICT, "Mock 服务已经在运行".into()));
    }
    std::net::TcpListener::bind(bind)
        .map_err(|error| (StatusCode::CONFLICT, format!("Mock 端口无法监听：{error}")))?;
    let mut command = tokio::process::Command::new(mock_server_binary());
    command
        .env("APIVOY_MOCK_BIND", bind.to_string())
        .env("APIVOY_MOCK_RULES_PATH", state.mock_rules_path.as_ref())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
    let child = command.spawn().map_err(|error| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            format!("无法启动 apivoy-mock：{error}"),
        )
    })?;
    {
        let mut process = state.mock_server.lock().await;
        process.child = Some(child);
        process.bind = bind.to_string();
        process.last_error = None;
    }
    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let status = read_mock_server_status(&state).await;
        if status.running {
            if let Ok(url) = mock_health_url(&status.bind) {
                if reqwest::get(url)
                    .await
                    .is_ok_and(|response| response.status().is_success())
                {
                    return Ok(Json(status));
                }
            }
        }
        if !status.running {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                status
                    .last_error
                    .unwrap_or_else(|| "Mock 服务启动后立即退出".into()),
            ));
        }
    }
    Err((StatusCode::GATEWAY_TIMEOUT, "Mock 服务启动超时".into()))
}

async fn stop_mock_server(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MockServerStatus>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let child = state.mock_server.lock().await.child.take();
    if let Some(mut child) = child {
        child
            .kill()
            .await
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let _ = child.wait().await;
    }
    Ok(Json(read_mock_server_status(&state).await))
}

fn mock_server_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("APIVOY_MOCK_BIN") {
        return PathBuf::from(path);
    }
    let file_name = if cfg!(windows) {
        "apivoy-mock.exe"
    } else {
        "apivoy-mock"
    };
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            if let Some(current_name) = current.file_name().and_then(|name| name.to_str()) {
                let packaged_name = current_name.replacen("apivoy-agent", "apivoy-mock", 1);
                let packaged = parent.join(packaged_name);
                if packaged.is_file() {
                    return packaged;
                }
            }
            let development = parent.join(file_name);
            if development.is_file() {
                return development;
            }
        }
    }
    PathBuf::from(file_name)
}

fn mock_health_url(bind: &str) -> Result<String, String> {
    let address = bind
        .parse::<SocketAddr>()
        .map_err(|error| error.to_string())?;
    let host = if address.is_ipv4() {
        if address.ip().is_unspecified() {
            "127.0.0.1".into()
        } else {
            address.ip().to_string()
        }
    } else if address.ip().is_unspecified() {
        "[::1]".into()
    } else {
        format!("[{}]", address.ip())
    };
    Ok(format!("http://{host}:{}/health", address.port()))
}

async fn tcp_session(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        if !state.allowed_origins.contains(origin) {
            warn!(%origin, "rejected TCP WebSocket from untrusted origin");
            return (StatusCode::FORBIDDEN, "untrusted WebSocket origin").into_response();
        }
    }
    let Some(ticket) = tcp_session_ticket_from_headers(&headers) else {
        return (StatusCode::UNAUTHORIZED, "missing TCP session ticket").into_response();
    };
    let target = {
        let now = Instant::now();
        let mut tickets = state.tcp_session_tickets.lock().await;
        tickets.retain(|_, entry| entry.expires_at > now);
        tickets.remove(ticket).map(|entry| entry.target)
    };
    let Some(target) = target else {
        return (
            StatusCode::UNAUTHORIZED,
            "invalid or expired TCP session ticket",
        )
            .into_response();
    };
    ws.protocols(["apivoy"])
        .on_upgrade(move |socket| relay_tcp_session(socket, target))
        .into_response()
}

fn tcp_session_ticket_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)?
        .to_str()
        .ok()?
        .split(',')
        .map(str::trim)
        .find_map(|protocol| protocol.strip_prefix(TCP_SESSION_TICKET_PREFIX))
        .filter(|ticket| !ticket.is_empty())
}

async fn relay_tcp_session(mut socket: WebSocket, target: String) {
    let stream = match TcpStream::connect(&target).await {
        Ok(stream) => stream,
        Err(error) => {
            let message = serde_json::json!({ "type": "error", "reason": format!("目标 TCP 连接失败：{error}") }).to_string();
            let _ = socket.send(AxumWsMessage::Text(message.into())).await;
            return;
        }
    };
    let connected = serde_json::json!({ "type": "connected", "target": target }).to_string();
    if socket
        .send(AxumWsMessage::Text(connected.into()))
        .await
        .is_err()
    {
        return;
    }
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
            match tcp_read.read(&mut buffer).await {
                Ok(0) => {
                    let message = serde_json::json!({ "type": "closed", "reason": "远端服务器主动关闭了 TCP 连接" }).to_string();
                    let _ = ws_write.send(AxumWsMessage::Text(message.into())).await;
                    break;
                }
                Ok(size) => {
                    if ws_write
                        .send(AxumWsMessage::Binary(buffer[..size].to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(error) => {
                    let message = serde_json::json!({ "type": "error", "reason": format!("TCP 读取失败：{error}") }).to_string();
                    let _ = ws_write.send(AxumWsMessage::Text(message.into())).await;
                    break;
                }
            }
        }
    };
    tokio::select! { _ = to_tcp => {}, _ = from_tcp => {} }
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

async fn list_environments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EnvironmentQuery>,
) -> Result<Json<Vec<EnvironmentRecord>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .list_environments(query.project_id.as_deref())
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn create_environment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveEnvironmentBody>,
) -> Result<(StatusCode, Json<EnvironmentRecord>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let env = EnvironmentRecord {
        id: format!("env-{}", uuid::Uuid::new_v4()),
        project_id: body.project_id.unwrap_or_else(|| "default-project".into()),
        name: body.name.unwrap_or_else(|| "New environment".into()),
        variables: body.variables,
        secret_refs: body.secret_refs,
        updated_at: Utc::now(),
    };
    state
        .store
        .lock()
        .await
        .save_environment(&env)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok((StatusCode::CREATED, Json(env)))
}

async fn put_environment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SaveEnvironmentBody>,
) -> Result<Json<EnvironmentRecord>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let mut env = state
        .store
        .lock()
        .await
        .get_environment(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "environment not found".into()))?;
    if let Some(name) = body.name {
        env.name = name;
    }
    if let Some(project_id) = body.project_id {
        env.project_id = project_id;
    }
    env.variables = body.variables;
    env.secret_refs = body.secret_refs;
    env.updated_at = Utc::now();
    state
        .store
        .lock()
        .await
        .save_environment(&env)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(env))
}

async fn delete_environment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .delete_environment(&id)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_scripts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ScriptQuery>,
) -> Result<Json<Vec<ScriptRecord>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .list_scripts(&query.project_id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
async fn create_script(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveScriptBody>,
) -> Result<(StatusCode, Json<ScriptRecord>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    if body.language != "javascript" && body.language != "typescript" {
        return Err((
            StatusCode::BAD_REQUEST,
            "unsupported script language".into(),
        ));
    }
    let now = Utc::now();
    let item = ScriptRecord {
        id: format!("script-{}", uuid::Uuid::new_v4()),
        project_id: body.project_id,
        name: body.name,
        language: body.language,
        source: body.source,
        created_at: now,
        updated_at: now,
    };
    state
        .store
        .lock()
        .await
        .save_script(&item)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok((StatusCode::CREATED, Json(item)))
}
async fn put_script(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SaveScriptBody>,
) -> Result<Json<ScriptRecord>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    if body.language != "javascript" && body.language != "typescript" {
        return Err((
            StatusCode::BAD_REQUEST,
            "unsupported script language".into(),
        ));
    }
    let previous = state
        .store
        .lock()
        .await
        .get_script(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "script not found".into()))?;
    let item = ScriptRecord {
        id,
        project_id: body.project_id,
        name: body.name,
        language: body.language,
        source: body.source,
        created_at: previous.created_at,
        updated_at: Utc::now(),
    };
    state
        .store
        .lock()
        .await
        .save_script(&item)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(item))
}
async fn delete_script(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .delete_script(&id)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
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
    let operation_id = {
        let store = state.store.lock().await;
        store
            .get_request_definition_binding(&id)
            .map_err(internal_store_error)?
            .map(|binding| binding.mock_operation_id)
            .unwrap_or_else(|| id.clone())
    };
    let request_id = core_domain::RequestId(
        Uuid::parse_str(&id).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
    );
    state
        .store
        .lock()
        .await
        .delete_request(&request_id)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    remove_design_mock_rules(&state, &operation_id).await?;
    Ok(StatusCode::NO_CONTENT)
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

async fn list_api_definitions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ApiDefinitionQuery>,
) -> Result<Json<Vec<ApiDefinitionRecord>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .list_api_definitions(&query.project_id)
        .map(Json)
        .map_err(internal_store_error)
}

async fn save_api_definition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveApiDefinitionBody>,
) -> Result<(StatusCode, Json<ApiDefinitionRecord>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    save_api_definition_record(state, body, None)
        .await
        .map(|item| (StatusCode::CREATED, Json(item)))
}

async fn save_api_definition_at_id(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SaveApiDefinitionBody>,
) -> Result<Json<ApiDefinitionRecord>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    save_api_definition_record(state, body, Some(id))
        .await
        .map(Json)
}

async fn save_api_definition_record(
    state: AppState,
    body: SaveApiDefinitionBody,
    path_id: Option<String>,
) -> Result<ApiDefinitionRecord, (StatusCode, String)> {
    let id = path_id
        .or(body.id)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let store = state.store.lock().await;
    let existing = store
        .get_api_definition(&id)
        .map_err(internal_store_error)?;
    let now = Utc::now();
    let canonical_content = store
        .canonicalize_mock_response_ids(
            &body.content,
            existing
                .as_ref()
                .map(|definition| definition.content.as_str()),
        )
        .map_err(internal_store_error)?;
    let record = ApiDefinitionRecord {
        id,
        project_id: body.project_id,
        module_id: body.module_id,
        name: body.name,
        format: body.format,
        file_name: body.file_name,
        content: canonical_content,
        created_at: existing.map(|item| item.created_at).unwrap_or(now),
        updated_at: now,
    };
    store
        .save_api_definition(&record)
        .map_err(internal_store_error)?;
    let bindings = store
        .list_request_definition_bindings()
        .map_err(internal_store_error)?
        .into_iter()
        .filter(|binding| binding.definition_id == record.id)
        .collect::<Vec<_>>();
    drop(store);
    for binding in bindings {
        sync_design_mock_rules(&state, &binding).await?;
    }
    Ok(record)
}

fn parse_definition_extension<T: for<'de> Deserialize<'de>>(
    content: &str,
    prefix: &str,
) -> Option<T> {
    content
        .lines()
        .find_map(|line| serde_json::from_str(line.trim_start().strip_prefix(prefix)?.trim()).ok())
}

async fn sync_design_mock_rules(
    state: &AppState,
    binding: &RequestDefinitionBinding,
) -> Result<(), (StatusCode, String)> {
    let (definition, request, request_service_key) = {
        let store = state.store.lock().await;
        let definition = store
            .get_api_definition(&binding.definition_id)
            .map_err(internal_store_error)?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "API definition not found".into()))?;
        let request_id = Uuid::parse_str(&binding.request_id)
            .map(core_domain::RequestId)
            .map_err(|error| (StatusCode::BAD_REQUEST, format!("无效的接口 ID：{error}")))?;
        let request = store
            .get_request(&request_id)
            .map_err(internal_store_error)?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "request not found".into()))?;
        let service_key = store
            .list_collections(&request.project_id)
            .map_err(internal_store_error)?
            .into_iter()
            .find(|collection| collection.id == request.collection_id)
            .map(|collection| collection.module_id)
            .unwrap_or_else(|| "default".into());
        (definition, request, service_key)
    };
    let responses = parse_definition_extension::<Vec<MockDesignResponse>>(
        &definition.content,
        "x-apivoy-responses:",
    )
    .unwrap_or_default();
    let fields = parse_definition_extension::<Vec<MockDesignField>>(
        &definition.content,
        "x-apivoy-visual-fields:",
    )
    .unwrap_or_default();
    let method = match &request.envelope.payload {
        ProtocolPayload::Http(payload) => payload.method.to_uppercase(),
        ProtocolPayload::Websocket(_) => "WS".into(),
        _ => request.protocol_id.to_uppercase(),
    };
    let path = mock_path_from_target(&request.target);
    let service_key = definition.module_id.unwrap_or(request_service_key);
    let mut rules = state.mock_rules.lock().await;
    rules.retain(|_, entry| {
        entry.rule.source != "design"
            || (entry.rule.operation_id.as_deref() != Some(binding.mock_operation_id.as_str())
                && entry.rule.operation_id.as_deref() != Some(binding.request_id.as_str()))
    });
    for (index, response) in responses.into_iter().enumerate() {
        let response_fields = fields
            .iter()
            .filter(|field| {
                field.scope == "response.body"
                    && field.response_id.as_deref().map_or_else(
                        || field.status.as_deref().unwrap_or("200") == response.status_code,
                        |id| id == response.id,
                    )
            })
            .cloned()
            .collect::<Vec<_>>();
        let body = response.example_body.as_ref().map_or_else(
            || {
                serde_json::to_string_pretty(&mock_object_from_fields(&response_fields))
                    .unwrap_or_else(|_| "{}".into())
            },
            |example| {
                example.as_str().map(str::to_owned).unwrap_or_else(|| {
                    serde_json::to_string_pretty(example).unwrap_or_else(|_| "{}".into())
                })
            },
        );
        let rule = MockRule {
            id: Uuid::new_v4(),
            source: "design".into(),
            project_key: request.project_id.clone(),
            service_key: service_key.clone(),
            operation_id: Some(binding.mock_operation_id.clone()),
            response_id: Some(response.id),
            enabled: true,
            name: response.name,
            method: method.clone(),
            path: path.clone(),
            status: response.status_code.parse().unwrap_or(200),
            headers: HashMap::from([("Content-Type".into(), response.content_type)]),
            body,
            match_conditions: MockMatchConditions::default(),
            delay_ms: 0,
            error_every: None,
            priority: -1000 - i32::try_from(index).unwrap_or(i32::MAX - 1000),
            ws_messages: Vec::new(),
            ws_echo: false,
            ws_interval_ms: 0,
        };
        rules.insert(rule.id, MockRuleState { rule });
    }
    drop(rules);
    persist_mock_rules(state).await
}

fn mock_path_from_target(target: &str) -> String {
    let without_query = target.split(['?', '#']).next().unwrap_or(target);
    if let Some((_, remainder)) = without_query.split_once("://") {
        return normalize_mock_path(remainder.find('/').map_or("/", |index| &remainder[index..]));
    }
    normalize_mock_path(without_query)
}

fn mock_object_from_fields(fields: &[MockDesignField]) -> serde_json::Value {
    mock_object_for_parent(fields, None)
}

fn mock_object_for_parent(
    fields: &[MockDesignField],
    parent_id: Option<&str>,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    for field in fields
        .iter()
        .filter(|field| field.parent_id.as_deref() == parent_id)
    {
        if !field.name.is_empty()
            && !matches!(
                field.name.as_str(),
                "__proto__" | "prototype" | "constructor"
            )
        {
            object.insert(field.name.clone(), mock_field_value(field, fields));
        }
    }
    serde_json::Value::Object(object)
}

fn mock_field_value(field: &MockDesignField, fields: &[MockDesignField]) -> serde_json::Value {
    let children = fields
        .iter()
        .filter(|candidate| candidate.parent_id.as_deref() == Some(field.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if field.kind == "array" {
        return serde_json::Value::Array(
            children
                .first()
                .map(|child| mock_field_value(child, fields))
                .into_iter()
                .collect(),
        );
    }
    if field.kind == "object" || !children.is_empty() {
        return mock_object_for_parent(fields, Some(&field.id));
    }
    if let Some(example) = field
        .example
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return serde_json::from_str(example).unwrap_or_else(|_| {
            serde_json::Value::String(example.trim_matches(['\'', '"']).into())
        });
    }
    match field.kind.as_str() {
        "boolean" => serde_json::Value::Bool(true),
        "integer" => serde_json::Value::Number(1001.into()),
        "number" => serde_json::json!(12.5),
        "null" => serde_json::Value::Null,
        _ => serde_json::Value::String("string".into()),
    }
}

async fn get_api_definition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiDefinitionRecord>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .get_api_definition(&id)
        .map_err(internal_store_error)?
        .map(Json)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "API definition not found".into()))
}

async fn delete_api_definition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .delete_api_definition(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(internal_store_error)
}

async fn get_request_definition_binding(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Option<RequestDefinitionBinding>>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .get_request_definition_binding(&id)
        .map(Json)
        .map_err(internal_store_error)
}

async fn bind_request_definition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<BindRequestDefinitionBody>,
) -> Result<Json<RequestDefinitionBinding>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let mock_operation_id = {
        let store = state.store.lock().await;
        store
            .get_request_definition_binding(&id)
            .map_err(internal_store_error)?
            .map(|binding| binding.mock_operation_id)
            .map(Ok)
            .unwrap_or_else(|| store.allocate_mock_id().map_err(internal_store_error))?
    };
    let binding = RequestDefinitionBinding {
        request_id: id,
        definition_id: body.definition_id,
        mock_operation_id,
        operation_ref: body.operation_ref,
        updated_at: Utc::now(),
    };
    state
        .store
        .lock()
        .await
        .bind_request_definition(&binding)
        .map_err(internal_store_error)?;
    sync_design_mock_rules(&state, &binding).await?;
    Ok(Json(binding))
}

async fn unbind_request_definition(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    let mock_operation_id = {
        let store = state.store.lock().await;
        let operation_id = store
            .get_request_definition_binding(&id)
            .map_err(internal_store_error)?
            .map(|binding| binding.mock_operation_id)
            .unwrap_or_else(|| id.clone());
        store
            .unbind_request_definition(&id)
            .map_err(internal_store_error)?;
        operation_id
    };
    remove_design_mock_rules(&state, &mock_operation_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_design_mock_rules(
    state: &AppState,
    operation_id: &str,
) -> Result<(), (StatusCode, String)> {
    state.mock_rules.lock().await.retain(|_, entry| {
        entry.rule.source != "design" || entry.rule.operation_id.as_deref() != Some(operation_id)
    });
    persist_mock_rules(state).await
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
    let mut modules = Vec::new();
    for workspace in &workspaces {
        projects.extend(
            store
                .list_projects(&workspace.id)
                .map_err(internal_store_error)?,
        );
    }
    for project in &projects {
        modules.extend(
            store
                .list_modules(&project.id)
                .map_err(internal_store_error)?,
        );
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
        modules,
        collections,
        requests,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateModuleBody {
    project_id: String,
    name: String,
}

async fn create_module(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateModuleBody>,
) -> Result<(StatusCode, Json<ModuleRecord>), (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .create_module(&body.project_id, &body.name)
        .map(|record| (StatusCode::CREATED, Json(record)))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
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
        .create_collection_in_module(
            &body.project_id,
            body.module_id.as_deref(),
            body.parent_id.as_deref(),
            &body.name,
        )
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
    let execution_id = id;
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
        // The engine normally reports failures before closing its event channel.
        // A task panic bypasses that path, so translate the JoinError into the
        // same structured event contract before closing the SSE stream.
        let task_result = handle.await;
        if let Err(err) = &task_result {
            let message = format!("execution task terminated unexpectedly: {err}");
            let _ = sse_tx
                .send(ExecutionEvent::Failed {
                    code: "execution_task_panicked".into(),
                    message,
                })
                .await;
            let _ = sse_tx
                .send(ExecutionEvent::StateChanged {
                    state: ExecutionState::Failed,
                    phase: None,
                })
                .await;
        }
        // All execution events have now been forwarded. Close the SSE stream
        // before response/history persistence so the client is not blocked on
        // local SQLite or blob writes after it has received completion.
        drop(sse_tx);
        match task_result {
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

    #[test]
    fn tcp_ticket_is_read_from_websocket_subprotocol() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static("apivoy, apivoy-ticket.abc123"),
        );
        assert_eq!(tcp_session_ticket_from_headers(&headers), Some("abc123"));
    }
}
