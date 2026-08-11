use axum::{
    extract::{Path as AxumPath, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use core_domain::{ExecutionEvent, ExecutionSummary, RequestEnvelope};
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
use execution_engine::ExecutionEngine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::{Mutex, RwLock, Semaphore};
use tower_http::{limit::RequestBodyLimitLayer, trace::TraceLayer};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const API_VERSION: &str = "1";
const MAX_RESULTS: usize = 500;

#[derive(Clone)]
struct AppState {
    engine: Arc<RwLock<ExecutionEngine>>,
    api_key: Arc<String>,
    jobs: Arc<Mutex<HashMap<Uuid, ScheduledJob>>>,
    results: Arc<Mutex<VecDeque<GatewayExecution>>>,
    jobs_path: Arc<PathBuf>,
    permits: Arc<Semaphore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledJob {
    id: Uuid,
    name: String,
    enabled: bool,
    interval_seconds: u64,
    next_run_at: DateTime<Utc>,
    request: RequestEnvelope,
    created_at: DateTime<Utc>,
    last_execution_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateJob {
    name: String,
    interval_seconds: u64,
    #[serde(default = "default_enabled")]
    enabled: bool,
    request: RequestEnvelope,
}
fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayExecution {
    id: Uuid,
    source: ExecutionSource,
    scheduled_job_id: Option<Uuid>,
    started_at: DateTime<Utc>,
    finished_at: DateTime<Utc>,
    success: bool,
    summary: Option<ExecutionSummary>,
    events: Vec<ExecutionEvent>,
    error: Option<String>,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum ExecutionSource {
    Remote,
    Schedule,
    Ci,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CiRunRequest {
    request: RequestEnvelope,
    #[serde(default)]
    fail_on_assertion: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CiRunResponse {
    execution: GatewayExecution,
    exit_code: i32,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();
    let state = build_state()?;
    spawn_scheduler(state.clone());
    let app = app(state);
    let bind: SocketAddr = std::env::var("APIVOY_GATEWAY_BIND")
        .unwrap_or_else(|_| "0.0.0.0:39218".into())
        .parse()?;
    info!(%bind, "ApiVoy Protocol Gateway listening");
    axum::serve(tokio::net::TcpListener::bind(bind).await?, app).await?;
    Ok(())
}

fn build_state() -> Result<AppState, Box<dyn std::error::Error>> {
    let api_key = std::env::var("APIVOY_GATEWAY_API_KEY")
        .map_err(|_| "APIVOY_GATEWAY_API_KEY is required")?;
    if api_key.len() < 24 {
        return Err("APIVOY_GATEWAY_API_KEY must contain at least 24 characters".into());
    }
    let data_dir = PathBuf::from(
        std::env::var("APIVOY_GATEWAY_DATA_DIR").unwrap_or_else(|_| ".apivoy-gateway".into()),
    );
    fs::create_dir_all(&data_dir)?;
    let jobs_path = data_dir.join("jobs.json");
    let jobs = load_jobs(&jobs_path);
    let max_concurrency = std::env::var("APIVOY_GATEWAY_MAX_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(16usize)
        .max(1);
    Ok(AppState {
        engine: Arc::new(RwLock::new(build_engine())),
        api_key: Arc::new(api_key),
        jobs: Arc::new(Mutex::new(jobs)),
        results: Arc::new(Mutex::new(VecDeque::new())),
        jobs_path: Arc::new(jobs_path),
        permits: Arc::new(Semaphore::new(max_concurrency)),
    })
}

fn build_engine() -> ExecutionEngine {
    let mut e = ExecutionEngine::new();
    e.register(Arc::new(HttpDriver::new()));
    e.register(Arc::new(GraphqlDriver::new()));
    e.register(Arc::new(GrpcDriver::new()));
    e.register(Arc::new(SseDriver::new()));
    e.register(Arc::new(TcpDriver));
    e.register(Arc::new(UdpDriver));
    e.register(Arc::new(WebSocketDriver));
    e.register(Arc::new(JsonRpcDriver::default()));
    e.register(Arc::new(SoapDriver::default()));
    e.register(Arc::new(RedisDriver));
    e.register(Arc::new(MqttDriver));
    e.register(Arc::new(AmqpDriver));
    e.register(Arc::new(KafkaDriver));
    e.register(Arc::new(SqlDriver));
    e
}

fn app(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/executions", get(list_executions).post(remote_execute))
        .route("/v1/runner/execute", post(ci_execute))
        .route("/v1/jobs", get(list_jobs).post(create_job))
        .route("/v1/jobs/{id}", delete(delete_job))
        .layer(middleware::from_fn_with_state(state.clone(), authenticate));
    Router::new()
        .route("/health", get(health))
        .merge(protected)
        .layer(RequestBodyLimitLayer::new(16 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(
        json!({"service":"apivoy-protocol-gateway","version":env!("CARGO_PKG_VERSION"),"status":"ok","apiVersion":API_VERSION}),
    )
}
async fn capabilities(State(state): State<AppState>) -> Json<Value> {
    let drivers = state.engine.read().await.list_drivers();
    Json(
        json!({"apiVersion":API_VERSION,"modes":["remote","scheduled","ci"],"drivers":drivers,"dataFlow":{"request":"sent to this gateway and then directly to the configured target","secrets":"use secret references; scheduled request envelopes are persisted exactly as submitted","retention":"scheduled envelopes persist on disk; the latest 500 summaries retain only states, metrics, assertions, and response metadata without headers"}}),
    )
}
async fn authenticate(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    let expected = format!("Bearer {}", state.api_key);
    if headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        != Some(expected.as_str())
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"invalid gateway API key"})),
        )
            .into_response();
    }
    next.run(request).await
}

async fn remote_execute(
    State(state): State<AppState>,
    Json(request): Json<RequestEnvelope>,
) -> impl IntoResponse {
    execution_response(run_execution(&state, request, ExecutionSource::Remote, None).await)
}
async fn ci_execute(
    State(state): State<AppState>,
    Json(body): Json<CiRunRequest>,
) -> impl IntoResponse {
    let execution = run_execution(&state, body.request, ExecutionSource::Ci, None).await;
    let failed = execution
        .events
        .iter()
        .any(|event| matches!(event,ExecutionEvent::AssertionResult(result) if !result.passed));
    let exit_code = if execution.success && !(body.fail_on_assertion && failed) {
        0
    } else {
        1
    };
    (
        StatusCode::OK,
        Json(CiRunResponse {
            execution,
            exit_code,
        }),
    )
}
fn execution_response(execution: GatewayExecution) -> (StatusCode, Json<GatewayExecution>) {
    let status = if execution.success {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (status, Json(execution))
}

async fn run_execution(
    state: &AppState,
    request: RequestEnvelope,
    source: ExecutionSource,
    job_id: Option<Uuid>,
) -> GatewayExecution {
    let id = Uuid::new_v4();
    let started_at = Utc::now();
    let permit = state.permits.acquire().await;
    let result = match permit {
        Ok(_permit) => state.engine.read().await.execute_collect(request).await,
        Err(error) => return failed_execution(id, source, job_id, started_at, error.to_string()),
    };
    let execution = match result {
        Ok((_engine_id, summary, events)) => GatewayExecution {
            id,
            source,
            scheduled_job_id: job_id,
            started_at,
            finished_at: Utc::now(),
            success: true,
            summary: Some(summary),
            events,
            error: None,
        },
        Err(error) => failed_execution(id, source, job_id, started_at, error.to_string()),
    };
    let retained = retained_execution(&execution);
    let mut results = state.results.lock().await;
    results.push_front(retained);
    results.truncate(MAX_RESULTS);
    execution
}

fn retained_execution(execution: &GatewayExecution) -> GatewayExecution {
    let events = execution
        .events
        .iter()
        .filter_map(|event| match event {
            ExecutionEvent::StateChanged { .. }
            | ExecutionEvent::Metric(_)
            | ExecutionEvent::AssertionResult(_)
            | ExecutionEvent::Warning { .. }
            | ExecutionEvent::Completed { .. }
            | ExecutionEvent::Failed { .. }
            | ExecutionEvent::Cancelled { .. } => Some(event.clone()),
            ExecutionEvent::ResponseMeta(meta) => {
                let mut meta = meta.clone();
                meta.headers.clear();
                Some(ExecutionEvent::ResponseMeta(meta))
            }
            ExecutionEvent::Log { .. }
            | ExecutionEvent::VariablesExtracted { .. }
            | ExecutionEvent::ResponseChunk { .. } => None,
        })
        .take(1000)
        .collect();
    GatewayExecution {
        events,
        ..execution.clone()
    }
}
fn failed_execution(
    id: Uuid,
    source: ExecutionSource,
    job_id: Option<Uuid>,
    started_at: DateTime<Utc>,
    error: String,
) -> GatewayExecution {
    GatewayExecution {
        id,
        source,
        scheduled_job_id: job_id,
        started_at,
        finished_at: Utc::now(),
        success: false,
        summary: None,
        events: vec![],
        error: Some(error),
    }
}
async fn list_executions(State(state): State<AppState>) -> Json<Vec<GatewayExecution>> {
    Json(state.results.lock().await.iter().cloned().collect())
}
async fn list_jobs(State(state): State<AppState>) -> Json<Vec<ScheduledJob>> {
    Json(state.jobs.lock().await.values().cloned().collect())
}

async fn create_job(State(state): State<AppState>, Json(body): Json<CreateJob>) -> Response {
    if body.interval_seconds < 10 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"intervalSeconds must be at least 10"})),
        )
            .into_response();
    }
    let job = ScheduledJob {
        id: Uuid::new_v4(),
        name: body.name,
        enabled: body.enabled,
        interval_seconds: body.interval_seconds,
        next_run_at: Utc::now() + ChronoDuration::seconds(body.interval_seconds as i64),
        request: body.request,
        created_at: Utc::now(),
        last_execution_id: None,
    };
    let mut jobs = state.jobs.lock().await;
    jobs.insert(job.id, job.clone());
    if let Err(error) = persist_jobs(&state.jobs_path, &jobs) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":error.to_string()})),
        )
            .into_response();
    }
    (StatusCode::CREATED, Json(json!(job))).into_response()
}
async fn delete_job(State(state): State<AppState>, AxumPath(id): AxumPath<Uuid>) -> StatusCode {
    let mut jobs = state.jobs.lock().await;
    if jobs.remove(&id).is_none() {
        return StatusCode::NOT_FOUND;
    }
    match persist_jobs(&state.jobs_path, &jobs) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn spawn_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            ticker.tick().await;
            let due = {
                let now = Utc::now();
                let mut jobs = state.jobs.lock().await;
                let mut due = vec![];
                for job in jobs
                    .values_mut()
                    .filter(|job| job.enabled && job.next_run_at <= now)
                {
                    job.next_run_at = now + ChronoDuration::seconds(job.interval_seconds as i64);
                    due.push((job.id, job.request.clone()));
                }
                if !due.is_empty() {
                    if let Err(error) = persist_jobs(&state.jobs_path, &jobs) {
                        error!(%error, "failed to persist scheduled jobs");
                    }
                }
                due
            };
            for (job_id, request) in due {
                let state = state.clone();
                tokio::spawn(async move {
                    let execution =
                        run_execution(&state, request, ExecutionSource::Schedule, Some(job_id))
                            .await;
                    let mut jobs = state.jobs.lock().await;
                    if let Some(job) = jobs.get_mut(&job_id) {
                        job.last_execution_id = Some(execution.id);
                        let _ = persist_jobs(&state.jobs_path, &jobs);
                    }
                });
            }
        }
    });
}
fn load_jobs(path: &Path) -> HashMap<Uuid, ScheduledJob> {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<ScheduledJob>>(&b).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|j| (j.id, j))
        .collect()
}
fn persist_jobs(path: &Path, jobs: &HashMap<Uuid, ScheduledJob>) -> Result<(), std::io::Error> {
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(&jobs.values().collect::<Vec<_>>())
        .map_err(std::io::Error::other)?;
    fs::write(&temp, bytes)?;
    fs::rename(temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jobs_round_trip() {
        let dir = std::env::temp_dir().join(format!("apivoy-gateway-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("jobs.json");
        let request = execution_engine::sample_http_get("https://example.com");
        let job = ScheduledJob {
            id: Uuid::new_v4(),
            name: "smoke".into(),
            enabled: true,
            interval_seconds: 60,
            next_run_at: Utc::now(),
            request,
            created_at: Utc::now(),
            last_execution_id: None,
        };
        let mut jobs = HashMap::new();
        jobs.insert(job.id, job);
        persist_jobs(&path, &jobs).unwrap();
        assert_eq!(load_jobs(&path).len(), 1);
        fs::remove_dir_all(dir).unwrap()
    }
    #[test]
    fn engine_exposes_all_protocols() {
        let ids = build_engine()
            .list_drivers()
            .into_iter()
            .map(|d| d.protocol_id)
            .collect::<Vec<_>>();
        for expected in [
            "amqp",
            "graphql",
            "grpc",
            "http",
            "jsonrpc",
            "kafka",
            "mqtt",
            "redis",
            "soap",
            "sql",
            "sse",
            "tcp",
            "udp",
            "websocket",
        ] {
            assert!(ids.contains(&expected.to_string()), "missing {expected}")
        }
    }

    #[test]
    fn retained_history_removes_sensitive_event_data() {
        let execution = GatewayExecution {
            id: Uuid::new_v4(),
            source: ExecutionSource::Remote,
            scheduled_job_id: None,
            started_at: Utc::now(),
            finished_at: Utc::now(),
            success: true,
            summary: None,
            events: vec![
                ExecutionEvent::Log {
                    level: "info".into(),
                    message: "token=secret".into(),
                },
                ExecutionEvent::ResponseChunk {
                    content_type: Some("text/plain".into()),
                    size: 6,
                    preview: Some("secret".into()),
                    data_base64: Some("c2VjcmV0".into()),
                    done: true,
                },
                ExecutionEvent::Warning {
                    code: "safe".into(),
                    message: "retained".into(),
                },
            ],
            error: None,
        };
        let retained = retained_execution(&execution);
        assert_eq!(retained.events.len(), 1);
        assert!(matches!(retained.events[0], ExecutionEvent::Warning { .. }));
    }
}
