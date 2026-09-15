use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use axum::body::{to_bytes, Body};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, Path, Query, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
use futures::{SinkExt, StreamExt};
use mock_server_core::{select_mock_rule, MatchResult, MockRule, RequestFacts};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    bind: SocketAddr,
    rules_path: Arc<PathBuf>,
    rules_modified: Arc<Mutex<Option<SystemTime>>>,
    rules: Arc<RwLock<HashMap<Uuid, MockRule>>>,
    hits: Arc<Mutex<HashMap<Uuid, u64>>>,
    request_count: Arc<AtomicU64>,
    active_websockets: Arc<AtomicU64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockQuery {
    apivoy_api_id: Option<String>,
    apivoy_response_id: Option<String>,
    apivoy_scenario_id: Option<Uuid>,
    #[serde(flatten)]
    values: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    service: &'static str,
    version: &'static str,
    bind: String,
    request_count: u64,
    active_websockets: u64,
}

enum RouteTarget {
    Path(String),
    Operation(String),
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let bind = std::env::var("APIVOY_MOCK_BIND")
        .unwrap_or_else(|_| "127.0.0.1:39218".into())
        .parse::<SocketAddr>()?;
    let rules_path = std::env::var_os("APIVOY_MOCK_RULES_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| config_dir().join("mock-rules.json"));
    let state = AppState {
        bind,
        rules_path: Arc::new(rules_path),
        rules_modified: Arc::new(Mutex::new(None)),
        rules: Arc::new(RwLock::new(HashMap::new())),
        hits: Arc::new(Mutex::new(HashMap::new())),
        request_count: Arc::new(AtomicU64::new(0)),
        active_websockets: Arc::new(AtomicU64::new(0)),
    };
    refresh_rules(&state).await;
    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/m1/{project_key}/{service_key}/{*path}",
            any(serve_path_mock),
        )
        .route(
            "/m2/{project_key}/{service_key}/{operation_id}",
            any(serve_id_mock),
        )
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    info!("ApiVoy Mock Server listening on http://{bind}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn config_dir() -> PathBuf {
    if let Ok(value) = std::env::var("APIVOY_CONFIG_DIR") {
        return PathBuf::from(value);
    }
    if cfg!(target_os = "windows") {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local).join("ApiVoy");
        }
    }
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg).join("apivoy");
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".config").join("apivoy");
    }
    PathBuf::from(".apivoy")
}

async fn refresh_rules(state: &AppState) {
    let modified = fs::metadata(state.rules_path.as_ref())
        .and_then(|metadata| metadata.modified())
        .ok();
    let mut previous = state.rules_modified.lock().await;
    if modified.is_some() && *previous == modified {
        return;
    }
    let parsed = fs::read_to_string(state.rules_path.as_ref())
        .ok()
        .and_then(|content| serde_json::from_str::<Vec<MockRule>>(&content).ok());
    if let Some(rules) = parsed {
        *state.rules.write().await = rules.into_iter().map(|rule| (rule.id, rule)).collect();
        *previous = modified;
    } else if modified.is_some() {
        warn!("Mock rules could not be reloaded; continuing with the last valid snapshot");
    }
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "apivoy-mock",
        version: env!("CARGO_PKG_VERSION"),
        bind: state.bind.to_string(),
        request_count: state.request_count.load(Ordering::Relaxed),
        active_websockets: state.active_websockets.load(Ordering::Relaxed),
    })
}

async fn serve_path_mock(
    State(state): State<AppState>,
    Path((project_key, service_key, path)): Path<(String, String, String)>,
    Query(query): Query<MockQuery>,
    request: Request,
) -> Response {
    serve_mock(
        state,
        project_key,
        service_key,
        RouteTarget::Path(path),
        query,
        request,
    )
    .await
}

async fn serve_id_mock(
    State(state): State<AppState>,
    Path((project_key, service_key, operation_id)): Path<(String, String, String)>,
    Query(query): Query<MockQuery>,
    request: Request,
) -> Response {
    serve_mock(
        state,
        project_key,
        service_key,
        RouteTarget::Operation(operation_id),
        query,
        request,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn serve_mock(
    state: AppState,
    project_key: String,
    service_key: String,
    target: RouteTarget,
    query: MockQuery,
    request: Request,
) -> Response {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    refresh_rules(&state).await;
    let (mut parts, request_body) = request.into_parts();
    let websocket = WebSocketUpgrade::from_request_parts(&mut parts, &state)
        .await
        .ok();
    let method = parts.method;
    let headers = parts.headers;
    let body = match to_bytes(request_body, 10 * 1024 * 1024).await {
        Ok(body) => body,
        Err(error) => return (StatusCode::PAYLOAD_TOO_LARGE, error.to_string()).into_response(),
    };
    let request_headers = headers
        .iter()
        .filter_map(|(name, value)| {
            Some((
                name.as_str().to_ascii_lowercase(),
                value.to_str().ok()?.to_string(),
            ))
        })
        .collect::<HashMap<_, _>>();
    let cookies = parse_cookies(request_headers.get("cookie").map(String::as_str));
    let body_text = String::from_utf8_lossy(&body);
    let (path, route_operation_id) = match &target {
        RouteTarget::Path(path) => (Some(path.as_str()), query.apivoy_api_id.as_deref()),
        RouteTarget::Operation(operation_id) => (None, Some(operation_id.as_str())),
    };
    let request_method = if websocket.is_some() {
        "WS"
    } else {
        method.as_str()
    };
    let facts = RequestFacts {
        project_key: &project_key,
        service_key: &service_key,
        method: request_method,
        path,
        operation_id: route_operation_id,
        response_id: query.apivoy_response_id.as_deref(),
        scenario_id: query.apivoy_scenario_id,
        query: &query.values,
        headers: &request_headers,
        cookies: &cookies,
        body: &body_text,
    };
    let rules = state.rules.read().await;
    let selected = select_mock_rule(&rules, &facts);
    let rule = match selected {
        MatchResult::NotFound => {
            return (StatusCode::NOT_FOUND, "No ApiVoy Mock response matched").into_response();
        }
        MatchResult::Conflict(ids) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "error": "multiple_mock_responses_matched",
                    "scenarioIds": ids,
                    "hint": "Specify apivoyApiId or apivoyScenarioId",
                })),
            )
                .into_response();
        }
        MatchResult::Matched(id) => rules.get(&id).cloned().expect("selected rule exists"),
    };
    drop(rules);
    let hits = {
        let mut hits = state.hits.lock().await;
        let value = hits.entry(rule.id).or_default();
        *value += 1;
        *value
    };
    if let Some(upgrade) = websocket {
        state.active_websockets.fetch_add(1, Ordering::Relaxed);
        let websocket_state = state.clone();
        return upgrade
            .on_upgrade(move |socket| run_websocket(socket, rule, websocket_state))
            .into_response();
    }
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
        .header("X-ApiVoy-Mock-Scenario", rule.id.to_string());
    for (name, value) in rule.headers {
        response = response.header(name, value);
    }
    response
        .body(Body::from(rule.body))
        .unwrap_or_else(|error| {
            (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response()
        })
}

async fn run_websocket(mut socket: WebSocket, rule: MockRule, state: AppState) {
    if rule.delay_ms > 0 {
        tokio::time::sleep(std::time::Duration::from_millis(rule.delay_ms)).await;
    }
    for (index, message) in rule.ws_messages.iter().enumerate() {
        if socket
            .send(Message::Text(message.clone().into()))
            .await
            .is_err()
        {
            state.active_websockets.fetch_sub(1, Ordering::Relaxed);
            return;
        }
        if index + 1 < rule.ws_messages.len() && rule.ws_interval_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(rule.ws_interval_ms)).await;
        }
    }
    if rule.ws_echo {
        while let Some(Ok(message)) = socket.next().await {
            if socket.send(message).await.is_err() {
                break;
            }
        }
    } else {
        let _ = socket.close().await;
    }
    state.active_websockets.fetch_sub(1, Ordering::Relaxed);
}

fn parse_cookies(header: Option<&str>) -> HashMap<String, String> {
    header
        .into_iter()
        .flat_map(|value| value.split(';'))
        .filter_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            Some((name.to_string(), value.to_string()))
        })
        .collect()
}
