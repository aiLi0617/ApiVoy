use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ExecutionId(pub Uuid);

impl ExecutionId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for ExecutionId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionPhase {
    Validate,
    Resolve,
    PreScript,
    Connect,
    Transfer,
    PostScript,
    Assert,
    Persist,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExecutionEvent {
    StateChanged {
        state: ExecutionState,
        phase: Option<ExecutionPhase>,
    },
    Log {
        level: String,
        message: String,
    },
    VariablesExtracted {
        variables: std::collections::HashMap<String, String>,
    },
    Metric(MetricEvent),
    ResponseMeta(ResponseMeta),
    ResponseChunk {
        content_type: Option<String>,
        size: u64,
        preview: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data_base64: Option<String>,
        done: bool,
    },
    AssertionResult(AssertionResultEvent),
    Warning {
        code: String,
        message: String,
    },
    Completed {
        summary: ExecutionSummary,
    },
    Failed {
        code: String,
        message: String,
    },
    Cancelled {
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricEvent {
    pub name: String,
    pub value: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMeta {
    pub status: Option<u16>,
    pub status_text: Option<String>,
    pub headers: Vec<(String, String)>,
    pub content_type: Option<String>,
    pub size_hint: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssertionResultEvent {
    pub name: String,
    pub passed: bool,
    pub expected: Option<String>,
    pub actual: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSummary {
    pub execution_id: ExecutionId,
    pub request_id: Uuid,
    pub protocol_id: String,
    pub state: ExecutionState,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub bytes_received: u64,
    pub status: Option<u16>,
}
