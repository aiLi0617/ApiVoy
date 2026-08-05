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

use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, HeaderName, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use core_domain::{ExecutionEvent, ExecutionId, RequestEnvelope};
use driver_http::HttpDriver;
use execution_engine::{sample_http_get, DriverDescriptor, ExecutionEngine};
use futures::stream::{self, Stream};
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let token = Arc::new(load_or_create_pairing_token()?);

    let mut engine = ExecutionEngine::new();
    engine.register(Arc::new(HttpDriver::new()));

    let state = AppState {
        engine: Arc::new(RwLock::new(engine)),
        token,
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

async fn start_execution(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<RequestEnvelope>,
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

    let engine = state.engine.read().await;
    let (id, rx, handle) = engine
        .execute(request)
        .await
        .map_err(|err| (StatusCode::BAD_GATEWAY, err.to_string()))?;

    // Keep the join handle alive so panics surface in logs; event rx is claimed by SSE.
    tokio::spawn(async move {
        if let Err(err) = handle.await {
            warn!(error = %err, "execution task join error");
        }
    });

    state
        .executions
        .lock()
        .await
        .insert(id.0, ExecutionSlot { events: rx });

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
