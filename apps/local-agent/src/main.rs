//! ApiVoy Local Agent.
//!
//! Listens on 127.0.0.1 only. Requires a pairing Bearer token on protected routes.
//! Shares the same protocol-core crates as Desktop; ships as an independent binary.

use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderName, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionState, ProtocolPayload, RequestEnvelope,
};
use driver_http::HttpDriver;
use execution_engine::{sample_http_get, DriverDescriptor, ExecutionEngine, VariableScope};
use futures::stream::{self, Stream};
use local_store::{
    EnvironmentRecord, ExecutionFilter, ExecutionRecord, LocalStore, StoredRequest,
};
use secret_store::{SecretBackendKind, SecretStore};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex, RwLock};
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const PROTOCOL_API_VERSION: &str = "1";
const HEADER_PROTOCOL_API_VERSION: &str = "x-apivoy-protocol-api-version";
const HEADER_CLIENT: &str = "x-apivoy-client";
const HEADER_CLIENT_VERSION: &str = "x-apivoy-client-version";

#[derive(Clone)]
struct AppState {
    engine: Arc<RwLock<ExecutionEngine>>,
    token: Arc<String>,
    secrets: Arc<SecretStore>,
    store: Arc<Mutex<LocalStore>>,
    executions: Arc<Mutex<HashMap<Uuid, ExecutionSlot>>>,
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
    bind: &'static str,
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
    engine.register(Arc::new(HttpDriver::new()));

    let state = AppState {
        engine: Arc::new(RwLock::new(engine)),
        token,
        secrets: Arc::new(SecretStore::with_keychain()),
        store: Arc::new(Mutex::new(store)),
        executions: Arc::new(Mutex::new(HashMap::new())),
    };

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(
            "http://localhost:5180".parse().expect("origin"),
        ))
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
        .route("/v1/executions", post(start_execution))
        .route("/v1/executions/{id}/events", get(execution_events))
        .route("/v1/executions/{id}/cancel", post(cancel_execution))
        .route("/v1/secrets", put(put_secret))
        .route("/v1/environments/default", get(get_default_environment))
        .route("/v1/environments/default", put(put_default_environment))
        .route("/v1/history", get(list_history))
        .route("/v1/history/{id}", get(get_history_item))
        .route("/v1/requests", post(save_request))
        .route("/v1/requests/latest", get(load_latest_request))
        // Deprecated smoke shortcut; prefer POST /v1/executions + SSE.
        .route("/v1/debug/http-get", post(debug_http_get))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let app = Router::new()
        .route("/health", get(health))
        .merge(protected)
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 39217));
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
    let expected = format!("Bearer {}", state.token);
    let authorized = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|value| value == expected);

    if authorized {
        Ok(next.run(req).await)
    } else {
        warn!("rejected unauthenticated request to {}", req.uri().path());
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "apivoy-agent",
        version: env!("CARGO_PKG_VERSION"),
        agent_version: env!("CARGO_PKG_VERSION"),
        bind: "127.0.0.1",
        protocol_api_version: PROTOCOL_API_VERSION,
        min_protocol_api_version: PROTOCOL_API_VERSION,
        max_protocol_api_version: PROTOCOL_API_VERSION,
        auth_required: true,
    })
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

async fn save_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(envelope): Json<RequestEnvelope>,
) -> Result<Json<StoredRequest>, (StatusCode, String)> {
    check_protocol_version(&headers)?;
    state
        .store
        .lock()
        .await
        .save_request(&envelope, "default-project", "default-collection")
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
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
    tokio::spawn(async move {
        let mut preview = None;
        while let Some(event) = rx.recv().await {
            if let ExecutionEvent::ResponseChunk {
                preview: Some(p),
                done: true,
                ..
            } = &event
            {
                preview = Some(p.clone());
            }
            if sse_tx.send(event).await.is_err() {
                break;
            }
        }
        match handle.await {
            Ok(Ok(summary)) => {
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
                    response_blob_id: None,
                };
                if let Err(err) = store.lock().await.record_execution(&record) {
                    warn!(error = %err, "failed to persist execution history");
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
    let slot = state
        .executions
        .lock()
        .await
        .remove(&uuid)
        .ok_or_else(|| {
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
