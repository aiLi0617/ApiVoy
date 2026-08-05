use std::path::PathBuf;
use std::sync::Arc;

use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionState, ExecutionSummary, HttpPayload, ProtocolPayload,
    RequestEnvelope,
};
use driver_http::HttpDriver;
use execution_engine::ExecutionEngine;
use local_store::{ExecutionRecord, LocalStore, StoredRequest};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

const PROTOCOL_API_VERSION: &str = "1";

struct AppState {
    engine: tokio::sync::RwLock<ExecutionEngine>,
    store: Mutex<LocalStore>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionInfo {
    desktop_version: &'static str,
    protocol_api_version: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResponse {
    execution_id: String,
    summary: ExecutionSummary,
    event_count: usize,
    preview: Option<String>,
    protocol_api_version: &'static str,
    desktop_version: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpExecuteRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_ms: u64,
}

#[tauri::command]
fn version_info() -> VersionInfo {
    VersionInfo {
        desktop_version: env!("CARGO_PKG_VERSION"),
        protocol_api_version: PROTOCOL_API_VERSION,
    }
}

#[tauri::command]
async fn execute_request(
    request: HttpExecuteRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecuteResponse, String> {
    let envelope = build_envelope(&request);
    let engine = state.engine.read().await;
    let (id, mut rx, handle) = engine
        .execute(envelope.clone())
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

    let record = ExecutionRecord {
        id: id.0.to_string(),
        request_id: envelope.id.0.to_string(),
        protocol_id: summary.protocol_id.clone(),
        state: state_name(summary.state).into(),
        status: summary.status,
        duration_ms: summary.duration_ms,
        bytes_received: summary.bytes_received,
        started_at: summary.started_at,
        finished_at: summary.finished_at,
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
    let envelope = build_envelope(&request);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running ApiVoy desktop");
}
