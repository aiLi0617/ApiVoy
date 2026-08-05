use async_trait::async_trait;
use core_domain::{DomainError, ErrorKind, ExecutionId, ExecutionSummary, RequestEnvelope};
use event_stream::EventSink;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverDescriptor {
    pub protocol_id: String,
    pub version: String,
    pub display_name: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ValidationReport {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl ValidationReport {
    pub fn ok() -> Self {
        Self::default()
    }

    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }
}

#[derive(Debug, Error)]
pub enum DriverError {
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("connection failed: {0}")]
    Connection(String),
    #[error("tls error: {0}")]
    Tls(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("cancelled")]
    Cancelled,
    #[error("internal error: {0}")]
    Internal(String),
}

impl DriverError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Validation(_) => ErrorKind::Validation,
            Self::Connection(_) => ErrorKind::Connection,
            Self::Tls(_) => ErrorKind::Tls,
            Self::Protocol(_) => ErrorKind::Protocol,
            Self::Timeout(_) => ErrorKind::Timeout,
            Self::Cancelled => ErrorKind::Cancelled,
            Self::Internal(_) => ErrorKind::Internal,
        }
    }

    /// Stable wire / UI error codes.
    pub fn code(&self) -> &'static str {
        self.kind().as_str()
    }

    pub fn message(&self) -> String {
        self.to_string()
    }

    pub fn to_domain(&self) -> DomainError {
        match self {
            Self::Validation(msg) => DomainError::validation("request", msg.clone()),
            Self::Connection(msg) => DomainError::Connection {
                message: msg.clone(),
            },
            Self::Tls(msg) => DomainError::Tls {
                message: msg.clone(),
            },
            Self::Protocol(msg) => DomainError::Protocol {
                message: msg.clone(),
            },
            Self::Timeout(msg) => DomainError::Timeout {
                message: msg.clone(),
            },
            Self::Cancelled => DomainError::Cancelled,
            Self::Internal(msg) => DomainError::internal(msg.clone()),
        }
    }
}

#[async_trait]
pub trait ProtocolDriver: Send + Sync {
    fn descriptor(&self) -> DriverDescriptor;

    fn validate(&self, request: &RequestEnvelope) -> ValidationReport;

    async fn execute(
        &self,
        request: RequestEnvelope,
        events: EventSink,
        cancel: CancellationToken,
        execution_id: ExecutionId,
    ) -> Result<ExecutionSummary, DriverError>;
}
