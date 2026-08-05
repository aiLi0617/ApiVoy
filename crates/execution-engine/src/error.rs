use thiserror::Error;

use crate::{DriverError, ResolveError};

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("no driver registered for protocol `{0}`")]
    DriverNotFound(String),
    #[error(transparent)]
    Driver(#[from] DriverError),
    #[error(transparent)]
    Resolve(#[from] ResolveError),
    #[error("execution cancelled")]
    Cancelled,
}
