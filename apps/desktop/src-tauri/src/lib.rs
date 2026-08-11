use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use capture_proxy::{CaptureProxy, CaptureStatus, CapturedExchange};
use core_domain::{
    Assertion, AuthRef, ExecutionEvent, ExecutionId, ExecutionState, ExecutionSummary, HttpPayload,
    MultipartPart, ProtocolPayload, RequestEnvelope, ResponseMeta,
};
use driver_graphql::GraphqlDriver;
use driver_grpc::GrpcDriver;
use driver_http::HttpDriver;
use driver_rpc_http::{JsonRpcDriver, SoapDriver};
use driver_sse::SseDriver;
use driver_tcp_udp::{TcpDriver, UdpDriver};
use driver_websocket::WebSocketDriver;
use execution_engine::{
    run_ai_assistant as execute_ai_assistant, AiAssistRequest, AiAssistResponse, ExecutionEngine,
    VariableScope,
};
use local_store::{
    CollectionRecord, EnvironmentRecord, ExecutionFilter, ExecutionRecord, LocalStore,
    ProjectRecord, StoredRequest, WorkspaceRecord,
};
use plugin_runtime::{InstalledPlugin, PluginManager, PluginManifest, PluginPermission};
use secret_store::{SecretBackendKind, SecretStore};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

const PROTOCOL_API_VERSION: &str = "1";
const MAX_PERSISTED_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

struct AppState {
    engine: tokio::sync::RwLock<ExecutionEngine>,
    http_driver: Arc<HttpDriver>,
    store: Mutex<LocalStore>,
    secrets: SecretStore,
    plugins: Arc<PluginManager>,
    capture: CaptureProxy,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallPluginRequest {
    manifest: PluginManifest,
    wasm_base64: String,
}

#[derive(Serialize)]
struct InvokePluginResponse {
    output: String,
}

#[derive(Serialize)]
struct CookieItem {
    name: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectionRunCase {
    request_id: String,
    name: String,
    protocol_id: String,
    passed: bool,
    status: Option<u16>,
    duration_ms: u64,
    error: Option<String>,
    failed_assertions: Vec<String>,
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
    response_body: Option<String>,
    assertions: Vec<core_domain::AssertionResultEvent>,
    response_meta: Option<ResponseMeta>,
    protocol_api_version: &'static str,
    desktop_version: &'static str,
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
#[serde(rename_all = "camelCase")]
struct AuthDto {
    kind: String,
    #[serde(default)]
    secret_ref: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    header_name: Option<String>,
    #[serde(default)]
    token_url: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    audience: Option<String>,
    #[serde(default)]
    authorization_url: Option<String>,
    #[serde(default)]
    redirect_uri: Option<String>,
    #[serde(default)]
    authorization_code_ref: Option<String>,
    #[serde(default)]
    code_verifier_ref: Option<String>,
}

impl From<AuthDto> for AuthRef {
    fn from(value: AuthDto) -> Self {
        AuthRef {
            kind: value.kind,
            secret_ref: value.secret_ref,
            username: value.username,
            header_name: value.header_name,
            token_url: value.token_url,
            scope: value.scope,
            audience: value.audience,
            authorization_url: value.authorization_url,
            redirect_uri: value.redirect_uri,
            authorization_code_ref: value.authorization_code_ref,
            code_verifier_ref: value.code_verifier_ref,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpExecuteRequest {
    #[serde(default)]
    name: Option<String>,
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    #[serde(default)]
    multipart: Vec<MultipartPart>,
    timeout_ms: u64,
    #[serde(default)]
    variables: HashMap<String, String>,
    #[serde(default)]
    assertions: Vec<AssertionDto>,
    #[serde(default)]
    environment_id: Option<String>,
    #[serde(default)]
    auth: Option<AuthDto>,
    #[serde(default = "default_true")]
    follow_redirects: bool,
    #[serde(default)]
    retry_max: u32,
    #[serde(default)]
    retry_backoff_ms: u64,
    #[serde(default)]
    proxy: Option<String>,
    #[serde(default = "default_true")]
    tls_verify: bool,
    #[serde(default)]
    tls_client_cert_ref: Option<String>,
    #[serde(default)]
    pre_scripts: Vec<String>,
    #[serde(default)]
    post_scripts: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SseExecuteRequest {
    name: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    last_event_id: Option<String>,
    #[serde(default)]
    reconnect_max: u32,
    #[serde(default = "default_sse_reconnect_delay")]
    reconnect_delay_ms: u64,
    #[serde(default)]
    variables: HashMap<String, String>,
}

fn default_sse_reconnect_delay() -> u64 {
    1_000
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SocketExecuteRequest {
    protocol: String,
    name: String,
    target: String,
    data: String,
    encoding: String,
    #[serde(default)]
    framing: Option<String>,
    #[serde(default)]
    delimiter: Option<String>,
    #[serde(default)]
    fixed_length: Option<usize>,
    #[serde(default = "default_send_count")]
    send_count: u32,
    #[serde(default)]
    interval_ms: u64,
    #[serde(default = "default_socket_timeout")]
    timeout_ms: u64,
    #[serde(default)]
    tls: bool,
    #[serde(default)]
    server_name: Option<String>,
    #[serde(default)]
    ca_cert_ref: Option<String>,
}

fn default_send_count() -> u32 {
    1
}
fn default_socket_timeout() -> u64 {
    3_000
}

fn default_true() -> bool {
    true
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCaptureRequest {
    bind: Option<String>,
    allow_remote: Option<bool>,
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
    let env_id = request.environment_id.as_deref().unwrap_or("default-env");

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

    execute_envelope(envelope, scope, &app, &state).await
}

async fn execute_envelope(
    envelope: RequestEnvelope,
    scope: VariableScope,
    app: &AppHandle,
    state: &AppState,
) -> Result<ExecuteResponse, String> {
    let engine = state.engine.read().await;
    let (id, mut rx, handle) = engine
        .execute_with_scope(envelope.clone(), scope)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("execution-started", id.0.to_string());

    let mut events = Vec::new();
    let mut response_bytes = Vec::new();
    let mut response_content_type = None;
    let mut extracted_variables = None;
    while let Some(mut event) = rx.recv().await {
        let _ = app.emit(
            "execution-event",
            serde_json::json!({ "executionId": id.0.to_string(), "event": &event }),
        );
        if let ExecutionEvent::ResponseMeta(meta) = &event {
            response_content_type = meta.content_type.clone();
        }
        if let ExecutionEvent::ResponseChunk { data_base64, .. } = &mut event {
            if let Some(encoded) = data_base64.take() {
                if let Ok(decoded) = BASE64.decode(encoded) {
                    let remaining =
                        MAX_PERSISTED_RESPONSE_BYTES.saturating_sub(response_bytes.len());
                    response_bytes.extend_from_slice(&decoded[..decoded.len().min(remaining)]);
                }
            }
        }
        if let ExecutionEvent::VariablesExtracted { variables } = &event {
            extracted_variables = Some(variables.clone());
        }
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
    let response_meta = events.iter().find_map(|event| match event {
        ExecutionEvent::ResponseMeta(meta) => Some(meta.clone()),
        _ => None,
    });

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

    let store = state.store.lock().await;
    let response_blob_id = if response_bytes.is_empty() {
        None
    } else {
        store
            .put_blob(&response_bytes, response_content_type.as_deref())
            .ok()
            .map(|blob| blob.id)
    };
    let response_body = String::from_utf8(response_bytes).ok();
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
        response_blob_id,
    };
    store.record_execution(&record).map_err(|e| e.to_string())?;
    if let Some(variables) = extracted_variables {
        let environment_id = envelope.environment_ref.as_deref().unwrap_or("default-env");
        if let Some(mut environment) = store
            .get_environment(environment_id)
            .map_err(|e| e.to_string())?
        {
            environment.variables.extend(variables);
            environment.updated_at = chrono::Utc::now();
            store
                .save_environment(&environment)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(ExecuteResponse {
        execution_id: id.0.to_string(),
        summary,
        event_count: events.len(),
        preview,
        response_body,
        assertions,
        response_meta,
        protocol_api_version: PROTOCOL_API_VERSION,
        desktop_version: env!("CARGO_PKG_VERSION"),
    })
}

#[tauri::command]
async fn execute_sse(
    request: SseExecuteRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecuteResponse, String> {
    let mut envelope = RequestEnvelope::http_get(request.name, request.url);
    envelope.protocol_id = core_domain::ProtocolId("sse".into());
    envelope.payload = ProtocolPayload::Sse(core_domain::SsePayload {
        headers: request.headers,
        last_event_id: request.last_event_id,
        reconnect_max: request.reconnect_max,
        reconnect_delay_ms: request.reconnect_delay_ms,
    });
    envelope.timeout_ms = 0;
    envelope.variables = request.variables.clone();

    let mut scope = VariableScope::default();
    if let Some(env) = state
        .store
        .lock()
        .await
        .get_environment("default-env")
        .map_err(|e| e.to_string())?
    {
        scope.environment = env.variables;
        for secret_name in env.secret_refs {
            if let Ok(value) = state.secrets.resolve(&secret_name) {
                scope.secrets.insert(secret_name.clone(), value.clone());
                scope.environment.insert(secret_name, value);
            }
        }
    }
    scope.request = request.variables;
    execute_envelope(envelope, scope, &app, &state).await
}

#[tauri::command]
async fn execute_socket(
    request: SocketExecuteRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecuteResponse, String> {
    let mut envelope = RequestEnvelope::http_get(request.name, request.target);
    envelope.timeout_ms = request.timeout_ms;
    match request.protocol.as_str() {
        "tcp" => {
            envelope.protocol_id = core_domain::ProtocolId("tcp".into());
            envelope.payload = ProtocolPayload::Tcp(core_domain::SocketPayload {
                data: request.data,
                encoding: request.encoding,
                framing: request.framing,
                delimiter: request.delimiter,
                fixed_length: request.fixed_length,
                send_count: request.send_count,
                interval_ms: request.interval_ms,
                tls: request.tls,
                server_name: request.server_name,
                ca_cert_ref: request.ca_cert_ref,
            });
        }
        "udp" => {
            envelope.protocol_id = core_domain::ProtocolId("udp".into());
            envelope.payload = ProtocolPayload::Udp(core_domain::UdpPayload {
                data: request.data,
                encoding: request.encoding,
                send_count: request.send_count,
                interval_ms: request.interval_ms,
            });
        }
        _ => return Err("protocol must be tcp or udp".into()),
    }
    execute_envelope(envelope, VariableScope::default(), &app, &state).await
}

#[tauri::command]
async fn execute_protocol(
    request: RequestEnvelope,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecuteResponse, String> {
    let env_id = request.environment_ref.as_deref().unwrap_or("default-env");
    let mut scope = VariableScope::default();
    if let Some(env) = state
        .store
        .lock()
        .await
        .get_environment(env_id)
        .map_err(|e| e.to_string())?
    {
        scope.environment = env.variables;
        for secret_name in env.secret_refs {
            if let Ok(value) = state.secrets.resolve(&secret_name) {
                scope.secrets.insert(secret_name.clone(), value.clone());
                scope.environment.insert(secret_name, value);
            }
        }
    }
    if let Some(secret_name) = request
        .auth_ref
        .as_ref()
        .and_then(|auth| auth.secret_ref.as_deref())
    {
        if let Ok(value) = state.secrets.resolve(secret_name) {
            scope.secrets.insert(secret_name.to_string(), value);
        }
    }
    scope.request = request.variables.clone();
    execute_envelope(request, scope, &app, &state).await
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
            name: None,
            url,
            method: "GET".into(),
            headers: vec![],
            body: None,
            multipart: vec![],
            timeout_ms: 30_000,
            variables: HashMap::new(),
            assertions: vec![],
            environment_id: None,
            auth: None,
            follow_redirects: true,
            retry_max: 0,
            retry_backoff_ms: 0,
            proxy: None,
            tls_verify: true,
            tls_client_cert_ref: None,
            pre_scripts: vec![],
            post_scripts: vec![],
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
    project_id: Option<String>,
    collection_id: Option<String>,
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
        .save_request(
            &envelope,
            project_id.as_deref().unwrap_or("default-project"),
            collection_id.as_deref().unwrap_or("default-collection"),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_envelope(
    request: RequestEnvelope,
    project_id: Option<String>,
    collection_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<StoredRequest, String> {
    state
        .store
        .lock()
        .await
        .save_request(
            &request,
            project_id.as_deref().unwrap_or("default-project"),
            collection_id.as_deref().unwrap_or("default-collection"),
        )
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
async fn run_ai_assistant(
    request: AiAssistRequest,
    state: State<'_, AppState>,
) -> Result<AiAssistResponse, String> {
    let api_key = state
        .secrets
        .resolve(&request.secret_ref)
        .map_err(|error| error.to_string())?;
    execute_ai_assistant(request, &api_key)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn capture_status(state: State<'_, AppState>) -> Result<CaptureStatus, String> {
    Ok(state.capture.status().await)
}
#[tauri::command]
async fn start_capture(
    request: StartCaptureRequest,
    state: State<'_, AppState>,
) -> Result<CaptureStatus, String> {
    let bind = request
        .bind
        .unwrap_or_else(|| "127.0.0.1:39219".into())
        .parse::<std::net::SocketAddr>()
        .map_err(|error| error.to_string())?;
    state
        .capture
        .start(bind, request.allow_remote.unwrap_or(false))
        .await
}
#[tauri::command]
async fn stop_capture(state: State<'_, AppState>) -> Result<CaptureStatus, String> {
    Ok(state.capture.stop().await)
}
#[tauri::command]
async fn capture_exchanges(state: State<'_, AppState>) -> Result<Vec<CapturedExchange>, String> {
    Ok(state.capture.exchanges().await)
}
#[tauri::command]
async fn clear_capture(state: State<'_, AppState>) -> Result<(), String> {
    state.capture.clear().await;
    Ok(())
}

#[tauri::command]
async fn secret_exists(name: String, state: State<'_, AppState>) -> Result<bool, String> {
    state.secrets.exists(&name).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_workspace_tree(state: State<'_, AppState>) -> Result<WorkspaceTree, String> {
    let store = state.store.lock().await;
    let workspaces = store.list_workspaces().map_err(|e| e.to_string())?;
    let mut projects = Vec::new();
    let mut collections = Vec::new();
    for workspace in &workspaces {
        projects.extend(
            store
                .list_projects(&workspace.id)
                .map_err(|e| e.to_string())?,
        );
    }
    for project in &projects {
        collections.extend(
            store
                .list_collections(&project.id)
                .map_err(|e| e.to_string())?,
        );
    }
    let requests = store.list_requests(None).map_err(|e| e.to_string())?;
    Ok(WorkspaceTree {
        workspaces,
        projects,
        collections,
        requests,
    })
}

#[tauri::command]
async fn create_workspace(
    name: String,
    root_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceRecord, String> {
    state
        .store
        .lock()
        .await
        .create_workspace(&name, root_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_workspace(
    id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .rename_workspace(&id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn archive_workspace(
    id: String,
    archived: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .archive_workspace(&id, archived)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn touch_workspace(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .touch_workspace(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_workspace(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .delete_workspace(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_project(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<ProjectRecord, String> {
    state
        .store
        .lock()
        .await
        .create_project(&workspace_id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_project(
    id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .rename_project(&id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_project(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .delete_project(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_collection(
    project_id: String,
    parent_id: Option<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<CollectionRecord, String> {
    state
        .store
        .lock()
        .await
        .create_collection(&project_id, parent_id.as_deref(), &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_collection_tags(
    id: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .update_collection_tags(&id, &tags)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_collection(
    id: String,
    name: String,
    parent_id: Option<String>,
    sort_order: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .update_collection(&id, &name, parent_id.as_deref(), sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_collection(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .store
        .lock()
        .await
        .delete_collection(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_request(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let request_id = core_domain::RequestId(Uuid::parse_str(&id).map_err(|e| e.to_string())?);
    state
        .store
        .lock()
        .await
        .delete_request(&request_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_request(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<StoredRequest>, String> {
    let request_id = core_domain::RequestId(Uuid::parse_str(&id).map_err(|e| e.to_string())?);
    state
        .store
        .lock()
        .await
        .get_request(&request_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn move_request(
    id: String,
    project_id: String,
    collection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let request_id = core_domain::RequestId(Uuid::parse_str(&id).map_err(|e| e.to_string())?);
    state
        .store
        .lock()
        .await
        .move_request(&request_id, &project_id, &collection_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_plugins(state: State<'_, AppState>) -> Result<Vec<InstalledPlugin>, String> {
    state.plugins.list().map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_cookies(state: State<'_, AppState>, url: String) -> Result<Vec<CookieItem>, String> {
    state
        .http_driver
        .cookies_for(&url)
        .map(|items| {
            items
                .into_iter()
                .map(|(name, value)| CookieItem { name, value })
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_cookie(
    state: State<'_, AppState>,
    url: String,
    name: String,
    value: String,
) -> Result<(), String> {
    state
        .http_driver
        .set_cookie(&url, &format!("{}={}; Path=/", name.trim(), value))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_cookie(
    state: State<'_, AppState>,
    url: String,
    name: String,
) -> Result<(), String> {
    state
        .http_driver
        .delete_cookie(&url, name.trim())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_collection(
    state: State<'_, AppState>,
    app: AppHandle,
    collection_id: String,
    fail_fast: bool,
) -> Result<Vec<CollectionRunCase>, String> {
    let requests = state
        .store
        .lock()
        .await
        .list_requests(Some(&collection_id))
        .map_err(|error| error.to_string())?;
    let mut cases = Vec::new();
    for stored in requests {
        let mut scope = VariableScope::default();
        if let Some(env) = state
            .store
            .lock()
            .await
            .get_environment("default-env")
            .map_err(|error| error.to_string())?
        {
            scope.environment = env.variables;
            for secret_name in env.secret_refs {
                if let Ok(value) = state.secrets.resolve(&secret_name) {
                    scope.secrets.insert(secret_name, value);
                }
            }
        }
        let request_id = stored.id.clone();
        let name = stored.name.clone();
        let protocol_id = stored.protocol_id.clone();
        match execute_envelope(stored.envelope, scope, &app, &state).await {
            Ok(result) => {
                let failed_assertions = result
                    .assertions
                    .iter()
                    .filter(|assertion| !assertion.passed)
                    .map(|assertion| assertion.name.clone())
                    .collect::<Vec<_>>();
                let passed = result.summary.state == ExecutionState::Completed
                    && failed_assertions.is_empty();
                cases.push(CollectionRunCase {
                    request_id,
                    name,
                    protocol_id,
                    passed,
                    status: result.summary.status,
                    duration_ms: result.summary.duration_ms,
                    error: None,
                    failed_assertions,
                });
                if fail_fast && !passed {
                    break;
                }
            }
            Err(error) => {
                cases.push(CollectionRunCase {
                    request_id,
                    name,
                    protocol_id,
                    passed: false,
                    status: None,
                    duration_ms: 0,
                    error: Some(error),
                    failed_assertions: vec![],
                });
                if fail_fast {
                    break;
                }
            }
        }
    }
    Ok(cases)
}

#[tauri::command]
async fn install_plugin(
    state: State<'_, AppState>,
    request: InstallPluginRequest,
) -> Result<InstalledPlugin, String> {
    let bytes = BASE64
        .decode(request.wasm_base64)
        .map_err(|error| format!("invalid wasmBase64: {error}"))?;
    let plugins = Arc::clone(&state.plugins);
    tokio::task::spawn_blocking(move || plugins.install(request.manifest, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_plugin_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    state
        .plugins
        .set_enabled(&id, enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn uninstall_plugin(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .plugins
        .uninstall(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn invoke_plugin(
    state: State<'_, AppState>,
    id: String,
    input: String,
) -> Result<InvokePluginResponse, String> {
    let plugins = Arc::clone(&state.plugins);
    let output = tokio::task::spawn_blocking(move || plugins.invoke(&id, &input))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(InvokePluginResponse { output })
}

fn build_envelope(request: &HttpExecuteRequest) -> RequestEnvelope {
    let mut envelope = RequestEnvelope::http_get(
        request
            .name
            .clone()
            .unwrap_or_else(|| format!("{} {}", request.method, request.url)),
        request.url.clone(),
    );
    envelope.timeout_ms = request.timeout_ms.max(1);
    envelope.payload = ProtocolPayload::Http(HttpPayload {
        method: request.method.clone(),
        headers: request.headers.clone(),
        body: request.body.clone(),
        multipart: request.multipart.clone(),
        follow_redirects: request.follow_redirects,
    });
    envelope.retry_policy.max_retries = request.retry_max;
    envelope.retry_policy.backoff_ms = request.retry_backoff_ms;
    envelope.proxy = request
        .proxy
        .clone()
        .filter(|value| !value.trim().is_empty());
    envelope.tls.verify = request.tls_verify;
    envelope.tls.client_cert_ref = request
        .tls_client_cert_ref
        .clone()
        .filter(|value| !value.trim().is_empty());
    envelope.pre_scripts = request.pre_scripts.clone();
    envelope.post_scripts = request.post_scripts.clone();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db_path = default_db_path(app.handle());
            let store = LocalStore::open(&db_path).map_err(|e| e.to_string())?;
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
            let plugins = PluginManager::new_from_env(
                db_path
                    .parent()
                    .unwrap_or_else(|| std::path::Path::new("."))
                    .join("plugins"),
                plugin_permission_grants(),
            )
            .map_err(|error| error.to_string())?;
            app.manage(AppState {
                engine: tokio::sync::RwLock::new(engine),
                http_driver,
                store: Mutex::new(store),
                secrets: SecretStore::with_keychain(),
                plugins: Arc::new(plugins),
                capture: CaptureProxy::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            version_info,
            execute_request,
            execute_sse,
            execute_socket,
            execute_protocol,
            http_get,
            cancel_execution,
            list_drivers,
            save_request,
            save_envelope,
            load_latest_request,
            list_history,
            get_history_item,
            get_environment,
            save_environment,
            put_secret,
            run_ai_assistant,
            capture_status,
            start_capture,
            stop_capture,
            capture_exchanges,
            clear_capture,
            secret_exists,
            get_workspace_tree,
            create_workspace,
            rename_workspace,
            archive_workspace,
            touch_workspace,
            delete_workspace,
            create_project,
            rename_project,
            delete_project,
            create_collection,
            update_collection,
            update_collection_tags,
            delete_collection,
            delete_request,
            get_request,
            move_request,
            list_plugins,
            list_cookies,
            set_cookie,
            delete_cookie,
            run_collection,
            install_plugin,
            set_plugin_enabled,
            uninstall_plugin,
            invoke_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ApiVoy desktop");
}
