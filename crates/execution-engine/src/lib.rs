//! Unified execution pipeline shared by desktop, agent, CLI, and (later) cloud runners.

mod assertions;
mod auth;
mod driver;
mod engine;
mod error;
mod lifecycle;
mod scripts;
mod variables;

pub use assertions::{run_assertions, AssertionContext};
pub use auth::{apply_auth, AuthError};
pub use driver::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
pub use engine::{sample_http_get, ExecutionEngine};
pub use error::{EngineError, ErrorKind};
pub use lifecycle::{LifecycleHook, LifecyclePhase, NoopLifecycleHook};
pub use scripts::{run_post_scripts, run_pre_scripts, ScriptError, ScriptResponse, ScriptResult};
pub use variables::{resolve_request, ResolveError, VariableScope};
