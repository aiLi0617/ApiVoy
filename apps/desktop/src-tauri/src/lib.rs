use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use core_domain::{
    Assertion, AuthRef, ExecutionEvent, ExecutionId, ExecutionState, ExecutionSummary, HttpPayload,
    ProtocolPayload, RequestEnvelope,
};
use driver_http::HttpDriver;
use execution_engine::{ExecutionEngine, VariableScope};
use local_store::{
    EnvironmentRecord, ExecutionFilter, ExecutionRecord, LocalStore, StoredRequest,
};
use secret_store::{SecretBackendKind, SecretStore};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

const PROTOCOL_API_VERSION: &str = "1";

struct AppState {
    engine: tokio::sync::RwLock<ExecutionEngine>,
    store: Mutex<LocalStore>,
    secrets: SecretStore,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionInfo {
    desktop_version: &'static str,
    protocol_api_version: &'static str,
    secret_backend: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResponse {
    execution_id: String,
    summary: ExecutionSummary,
    event_count: usize,
    preview: Option<String>,
    assertions: Vec<core_domain::AssertionResultEvent>,
    protocol_api_version: &'static str,
    desktop_version: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthDto {
    kind: String,
    #[serde(default)]
    secret_ref: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    header_name: Option<String>,
}

impl From<AuthDto> for AuthRef {
    fn from(value: AuthDto) -> Self {
        AuthRef {
            kind: value.kind,
            secret_ref: value.secret_ref,
            username: value.username,
            header_name: value.header_name,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpExecuteRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_ms: u64,
    #[serde(default)]
    variables: HashMap<String, String>,
    #[serde(default)]
    assertions: Vec<AssertionDto>,
    #[serde(default)]
    environment_id: Option<String>,
    #[serde(default)]
    auth: Option<AuthDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AssertionDto {
    StatusEquals { expected: u16 },
    StatusIn { expected: Vec<u16> },
    DurationLt { max_ms: u64 },
    SizeLt { max_bytes: u64 },
    HeaderEquals { name: String, expected: String },
    HeaderContains { name: String, expected: String },
    BodyContains { expected: String },
    JsonPathEquals { path: String, expected: String },
}

impl From<AssertionDto> for Assertion {
    fn from(value: AssertionDto) -> Self {
        match value {
            AssertionDto::StatusEquals { expected } => Assertion::StatusEquals { expected },
            AssertionDto::StatusIn { expected } => Assertion::StatusIn { expected },
            AssertionDto::DurationLt { max_ms } => Assertion::DurationLt { max_ms },
            AssertionDto::SizeLt { max_bytes } => Assertion::SizeLt { max_bytes },
            AssertionDto::HeaderEquals { name, expected } => {
                Assertion::HeaderEquals { name, expected }
            }
            AssertionDto::HeaderContains { name, expected } => {
                Assertion::HeaderContains { name, expected }
            }
            AssertionDto::BodyContains { expected } => Assertion::BodyContains { expected },
            AssertionDto::JsonPathEquals { path, expected } => {
                Assertion::JsonPathEquals { path, expected }
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveEnvironmentRequest {
    variables: HashMap<String, String>,
    #[serde(default)]
    secret_refs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutSecretRequest {
    name: String,
    value: String,
}

#[tauri::command]
fn version_info(state: State<'_, AppState>) -> VersionInfo {
    VersionInfo {
        desktop_version: env!("CARGO_PKG_VERSION"),
        protocol_api_version: PROTOCOL_API_VERSION,
        secret_backend: match state.secrets.backend_kind() {
            SecretBackendKind::Memory => "memory",
            SecretBackendKind::Keychain => "keychain",
        },
    }
}

#[tauri::command]
async fn execute_request(
    request: HttpExecuteRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecuteResponse, String> {
    let mut envelope = build_envelope(&request);
    let env_id = request
        .environment_id
        .as_deref()
        .unwrap_or("default-env");

    let mut scope = VariableScope::default();
    {
        let store = state.store.lock().await;
        if let Some(env) = store.get_environment(env_id).map_err(|e| e.to_string())? {
            scope.environment = env.variables;
            for secret_name in env.secret_refs {
                if let Ok(value) = state.secrets.resolve(&secret_name) {
                    scope.secrets.insert(secret_name.clone(), value.clone());
                    scope.environment.insert(secret_name, value);
                }
            }
        }
    }

    // Resolve auth secret into scope.secrets (not into request variables).
    if let Some(auth) = &request.auth {
        if let Some(name) = auth.secret_ref.as_deref().filter(|s| !s.is_empty()) {
            if let Ok(value) = state.secrets.resolve(name) {
                scope.secrets.insert(name.to_string(), value);
            }
        }
    }

    scope.request = request.variables.clone();
    envelope.variables = request.variables.clone();
    envelope.assertions = request.assertions.into_iter().map(Into::into).collect();
    envelope.environment_ref = Some(env_id.to_string());
    envelope.auth_ref = request.auth.map(Into::into);

    let engine = state.engine.read().await;
    let (id, mut rx, handle) = engine
        .execute_with_scope(envelope.clone(), scope)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("execution-started", id.0.to_string());

    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        let _ = app.emit("execution-event", &event);
        events.push(event);
    }
    let summary = handle
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let preview = events.iter().rev().find_map(|e| match e {
        ExecutionEvent::ResponseChunk {
            preview: Some(p),
            done: true,
            ..
        } => Some(p.clone()),
        _ => None,
    });

    let assertions: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            ExecutionEvent::AssertionResult(r) => Some(r.clone()),
            _ => None,
        })
        .collect();

    // Persist snapshot without resolved auth headers (keep AuthRef only).
    let mut snapshot = envelope.clone();
    if let ProtocolPayload::Http(ref mut payload) = snapshot.payload {
        // Auth headers are injected at execute time; strip Authorization if auth_ref set
        // so replay regenerates from secret store.
        if snapshot.auth_ref.is_some() {
            payload
                .headers
                .retain(|(k, _)| !k.eq_ignore_ascii_case("Authorization"));
        }
    }

    let record = ExecutionRecord {
        id: id.0.to_string(),
        request_id: snapshot.id.0.to_string(),
        protocol_id: summary.protocol_id.clone(),
        state: state_name(summary.state).into(),
        status: summary.status,
        duration_ms: summary.duration_ms,
        bytes_received: summary.bytes_received,
        started_at: summary.started_at,
        finished_at: summary.finished_at,
        request_snapshot: Some(snapshot),
        preview: preview.clone(),
        response_blob_id: None,
    };
    state
        .store
        .lock()
        .await
        .record_execution(&record)
        .map_err(|e| e.to_string())?;

    Ok(ExecuteResponse {
        execution_id: id.0.to_string(),
        summary,
        event_count: events.len(),
        preview,
        assertions,
        protocol_api_version: PROTOCOL_API_VERSION,
        desktop_version: env!("CARGO_PKG_VERSION"),
    })
}

/// Backward-compatible GET smoke command.
#[tauri::command]
async fn http_get(
    url: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecuteResponse, String> {
    execute_request(
        HttpExecuteRequest {
            url,
            method: "GET".into(),
            headers: vec![],
            body: None,
            timeout_ms: 30_000,
            variables: HashMap::new(),
            assertions: vec![],
            environment_id: None,
            auth: None,
        },
        app,
        state,
    )
    .await
}

#[tauri::command]
async fn cancel_execution(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let engine = state.engine.read().await;
    Ok(engine.cancel(&ExecutionId(uuid)))
}

#[tauri::command]
async fn list_drivers(
    state: State<'_, AppState>,
) -> Result<Vec<execution_engine::DriverDescriptor>, String> {
    let engine = state.engine.read().await;
    Ok(engine.list_drivers())
}

#[tauri::command]
async fn save_request(
    request: HttpExecuteRequest,
    state: State<'_, AppState>,
) -> Result<StoredRequest, String> {
    let mut envelope = build_envelope(&request);
    envelope.variables = request.variables;
    envelope.assertions = request.assertions.into_iter().map(Into::into).collect();
    envelope.auth_ref = request.auth.map(Into::into);
    state
        .store
        .lock()
        .await
        .save_request(&envelope, "default-project", "default-collection")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_latest_request(state: State<'_, AppState>) -> Result<Option<StoredRequest>, String> {
    state
        .store
        .lock()
        .await
        .latest_request()
        .map_err(|e| e.to_string())
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HistoryFilterDto {
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    protocol_id: Option<String>,
    #[serde(default)]
    status: Option<u16>,
}

#[tauri::command]
async fn list_history(
    limit: Option<usize>,
    filter: Option<HistoryFilterDto>,
    state: State<'_, AppState>,
) -> Result<Vec<ExecutionRecord>, String> {
    let filter = filter.unwrap_or_default();
    state
        .store
        .lock()
        .await
        .list_executions_filtered(
            limit.unwrap_or(30),
            &ExecutionFilter {
                request_id: filter.request_id,
                state: filter.state,
                protocol_id: filter.protocol_id,
                status: filter.status,
            },
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_history_item(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<ExecutionRecord>, String> {
    state
        .store
        .lock()
        .await
        .get_execution(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_environment(state: State<'_, AppState>) -> Result<EnvironmentRecord, String> {
    state
        .store
        .lock()
        .await
        .default_environment()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_environment(
    request: SaveEnvironmentRequest,
    state: State<'_, AppState>,
) -> Result<EnvironmentRecord, String> {
    let mut env = state
        .store
        .lock()
        .await
        .default_environment()
        .map_err(|e| e.to_string())?;
    env.variables = request.variables;
    env.secret_refs = request.secret_refs;
    env.updated_at = chrono::Utc::now();
    state
        .store
        .lock()
        .await
        .save_environment(&env)
        .map_err(|e| e.to_string())?;
    Ok(env)
}

#[tauri::command]
async fn put_secret(request: PutSecretRequest, state: State<'_, AppState>) -> Result<(), String> {
    state
        .secrets
        .put_ref(request.name, request.value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn secret_exists(name: String, state: State<'_, AppState>) -> Result<bool, String> {
    state.secrets.exists(&name).map_err(|e| e.to_string())
}

fn build_envelope(request: &HttpExecuteRequest) -> RequestEnvelope {
    let mut envelope = RequestEnvelope::http_get(
        format!("{} {}", request.method, request.url),
        request.url.clone(),
    );
    envelope.timeout_ms = request.timeout_ms.max(1);
    envelope.payload = ProtocolPayload::Http(HttpPayload {
        method: request.method.clone(),
        headers: request.headers.clone(),
        body: request.body.clone(),
        follow_redirects: true,
    });
    envelope
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

fn default_db_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from(".apivoy"))
        .join("apivoy-local.db")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db_path = default_db_path(app.handle());
            let store = LocalStore::open(&db_path).map_err(|e| e.to_string())?;
            let mut engine = ExecutionEngine::new();
            engine.register(Arc::new(HttpDriver::new()));
            app.manage(AppState {
                engine: tokio::sync::RwLock::new(engine),
                store: Mutex::new(store),
                secrets: SecretStore::with_keychain(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            version_info,
            execute_request,
            http_get,
            cancel_execution,
            list_drivers,
            save_request,
            load_latest_request,
            list_history,
            get_history_item,
            get_environment,
            save_environment,
            put_secret,
            secret_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ApiVoy desktop");
}
