//! ApiVoy Local Agent.
//!
//! Listens on 127.0.0.1 only. Requires a pairing Bearer token on protected routes.
//! Shares the same protocol-core crates as Desktop; ships as an independent binary.

use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use core_domain::ExecutionId;
use driver_http::HttpDriver;
use execution_engine::{sample_http_get, DriverDescriptor, ExecutionEngine};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    engine: Arc<RwLock<ExecutionEngine>>,
    token: Arc<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    service: &'static str,
    version: &'static str,
    bind: &'static str,
    protocol_api_version: &'static str,
    auth_required: bool,
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
    };

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(
            "http://localhost:5173".parse().expect("origin"),
        ))
        .allow_headers(AllowHeaders::list([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
        ]));

    let protected = Router::new()
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/debug/http-get", post(debug_http_get))
        .route("/v1/executions/{id}/cancel", post(cancel_execution))
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
    // First-run hint: path only in info; token printed once to stderr for local pairing.
    info!(path = %path.display(), "created pairing token file");
    eprintln!("ApiVoy Local Agent pairing token (save for Web/Desktop): {token}");
    eprintln!("Token file: {}", path.display());
    Ok(token)
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
        bind: "127.0.0.1",
        protocol_api_version: "1",
        auth_required: true,
    })
}

async fn capabilities(State(state): State<AppState>) -> Json<Vec<DriverDescriptor>> {
    let engine = state.engine.read().await;
    Json(engine.list_drivers())
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
