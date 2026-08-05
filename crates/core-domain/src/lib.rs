//! Protocol-agnostic domain models.
//!
//! This crate must not depend on concrete protocol drivers.

mod assertion;
mod error;
mod execution;
mod request;

pub use assertion::Assertion;
pub use error::{DomainError, DomainResult};
pub use execution::{
    AssertionResultEvent, ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState,
    ExecutionSummary, MetricEvent, ResponseMeta,
};
pub use request::{
    AuthRef, HttpPayload, ProtocolId, ProtocolPayload, RequestEnvelope, RequestId, RetryPolicy,
    TlsOptions,
};
