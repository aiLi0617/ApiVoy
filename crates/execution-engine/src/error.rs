use thiserror::Error;

use crate::DriverError;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("no driver registered for protocol `{0}`")]
    DriverNotFound(String),
    #[error(transparent)]
    Driver(#[from] DriverError),
    #[error("execution cancelled")]
    Cancelled,
}
