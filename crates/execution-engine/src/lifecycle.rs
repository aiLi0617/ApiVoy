//! Request lifecycle phases.
//!
//! P0 implements a no-script pipeline (variable resolve + built-in assertions).
//! P1 will attach QuickJS handlers to the same phase hooks without reshaping
//! the execution path.

use serde::{Deserialize, Serialize};

/// Ordered lifecycle for every protocol execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecyclePhase {
    BeforeRequest,
    ResolveVariables,
    BuildRequest,
    SendRequest,
    ReceiveHeaders,
    ReceiveStreamChunk,
    ReceiveComplete,
    RunAssertions,
    ExtractVariables,
    AfterResponse,
}

impl LifecyclePhase {
    pub const ALL: [LifecyclePhase; 10] = [
        Self::BeforeRequest,
        Self::ResolveVariables,
        Self::BuildRequest,
        Self::SendRequest,
        Self::ReceiveHeaders,
        Self::ReceiveStreamChunk,
        Self::ReceiveComplete,
        Self::RunAssertions,
        Self::ExtractVariables,
        Self::AfterResponse,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::BeforeRequest => "before_request",
            Self::ResolveVariables => "resolve_variables",
            Self::BuildRequest => "build_request",
            Self::SendRequest => "send_request",
            Self::ReceiveHeaders => "receive_headers",
            Self::ReceiveStreamChunk => "receive_stream_chunk",
            Self::ReceiveComplete => "receive_complete",
            Self::RunAssertions => "run_assertions",
            Self::ExtractVariables => "extract_variables",
            Self::AfterResponse => "after_response",
        }
    }
}

/// Hook slot reserved for future script / plugin observers.
///
/// P0 keeps a no-op implementation so callers can depend on the trait early.
#[async_trait::async_trait]
pub trait LifecycleHook: Send + Sync {
    async fn on_phase(&self, phase: LifecyclePhase) {
        let _ = phase;
    }
}

/// Default no-op hook used until QuickJS lands in P1.
#[derive(Debug, Default)]
pub struct NoopLifecycleHook;

#[async_trait::async_trait]
impl LifecycleHook for NoopLifecycleHook {}
