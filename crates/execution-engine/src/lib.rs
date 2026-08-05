//! Unified execution pipeline shared by desktop, agent, CLI, and (later) cloud runners.

mod driver;
mod engine;
mod error;
mod lifecycle;

pub use driver::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
pub use engine::{sample_http_get, ExecutionEngine};
pub use error::EngineError;
pub use lifecycle::{LifecycleHook, LifecyclePhase, NoopLifecycleHook};
