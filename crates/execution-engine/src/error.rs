use thiserror::Error;

use core_domain::DomainError;

use crate::{AuthError, DriverError, ResolveError};

pub use core_domain::ErrorKind;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("no driver registered for protocol `{0}`")]
    DriverNotFound(String),
    #[error(transparent)]
    Driver(#[from] DriverError),
    #[error(transparent)]
    Resolve(#[from] ResolveError),
    #[error(transparent)]
    Auth(#[from] AuthError),
    #[error("execution cancelled")]
    Cancelled,
}

impl EngineError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::DriverNotFound(_) => ErrorKind::NotFound,
            Self::Driver(err) => err.kind(),
            Self::Resolve(_) => ErrorKind::Resolution,
            Self::Auth(_) => ErrorKind::Auth,
            Self::Cancelled => ErrorKind::Cancelled,
        }
    }

    pub fn code(&self) -> &'static str {
        self.kind().as_str()
    }

    /// Map engine failures onto the shared domain error model.
    pub fn to_domain(&self) -> DomainError {
        match self {
            Self::DriverNotFound(protocol) => DomainError::not_found(format!("driver:{protocol}")),
            Self::Driver(err) => err.to_domain(),
            Self::Resolve(err) => DomainError::Resolution {
                reference: err.reference(),
                message: err.to_string(),
                recoverable: true,
            },
            Self::Auth(err) => DomainError::auth(err.to_string()),
            Self::Cancelled => DomainError::Cancelled,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_error_maps_to_domain_kinds() {
        let cancelled = EngineError::Cancelled.to_domain();
        assert_eq!(cancelled.kind(), ErrorKind::Cancelled);
        assert_eq!(cancelled.code(), "cancelled");

        let missing = EngineError::DriverNotFound("http".into()).to_domain();
        assert_eq!(missing.kind(), ErrorKind::NotFound);

        let timeout = EngineError::Driver(DriverError::Timeout("slow".into())).to_domain();
        assert_eq!(timeout.kind(), ErrorKind::Timeout);
        assert_eq!(timeout.code(), "timeout");
    }
}
