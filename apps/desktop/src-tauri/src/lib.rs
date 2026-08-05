use std::sync::Arc;

use core_domain::{ExecutionEvent, ExecutionId, ExecutionSummary};
use driver_http::HttpDriver;
use execution_engine::{sample_http_get, ExecutionEngine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use uuid::Uuid;

struct AppState {
    engine: RwLock<ExecutionEngine>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpGetResponse {
    execution_id: String,
    summary: ExecutionSummary,
    event_count: usize,
    preview: Option<String>,
}

#[tauri::command]
async fn http_get(
    url: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<HttpGetResponse, String> {
    let engine = state.engine.read().await;
    let req = sample_http_get(url);
    let (id, mut rx, handle) = engine.execute(req).await.map_err(|e| e.to_string())?;

    let _ = app.emit("execution-started", id.0.to_string());

    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
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

    Ok(HttpGetResponse {
        execution_id: id.0.to_string(),
        summary,
        event_count: events.len(),
        preview,
    })
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut engine = ExecutionEngine::new();
    engine.register(Arc::new(HttpDriver::new()));

    tauri::Builder::default()
        .manage(AppState {
            engine: RwLock::new(engine),
        })
        .invoke_handler(tauri::generate_handler![
            http_get,
            cancel_execution,
            list_drivers
        ])
        .run(tauri::generate_context!())
        .expect("error while running ApiVoy desktop");
}
