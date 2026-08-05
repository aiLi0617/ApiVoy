use thiserror::Error;

pub type DomainResult<T> = Result<T, DomainError>;

/// Stable wire / UI error kinds shared across Desktop, Agent, CLI, and engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    Validation,
    Resolution,
    Auth,
    Connection,
    Tls,
    Protocol,
    Timeout,
    Cancelled,
    Internal,
    NotFound,
    Permission,
}

impl ErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Validation => "validation",
            Self::Resolution => "resolution",
            Self::Auth => "auth",
            Self::Connection => "connection_failed",
            Self::Tls => "tls",
            Self::Protocol => "protocol_error",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::Internal => "internal",
            Self::NotFound => "not_found",
            Self::Permission => "permission",
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DomainError {
    #[error("validation failed at {field_path}: {message}")]
    Validation {
        field_path: String,
        message: String,
        suggestion: Option<String>,
    },
    #[error("resolution failed for {reference}: {message}")]
    Resolution {
        reference: String,
        message: String,
        recoverable: bool,
    },
    #[error("permission denied for capability `{capability}`")]
    Permission {
        capability: String,
        policy_id: Option<String>,
    },
    #[error("auth failed: {message}")]
    Auth { message: String },
    #[error("connection failed: {message}")]
    Connection { message: String },
    #[error("tls error: {message}")]
    Tls { message: String },
    #[error("protocol error: {message}")]
    Protocol { message: String },
    #[error("timeout: {message}")]
    Timeout { message: String },
    #[error("execution cancelled")]
    Cancelled,
    #[error("internal error: {message}")]
    Internal { message: String },
    #[error("not found: {resource}")]
    NotFound { resource: String },
}

impl DomainError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Validation { .. } => ErrorKind::Validation,
            Self::Resolution { .. } => ErrorKind::Resolution,
            Self::Permission { .. } => ErrorKind::Permission,
            Self::Auth { .. } => ErrorKind::Auth,
            Self::Connection { .. } => ErrorKind::Connection,
            Self::Tls { .. } => ErrorKind::Tls,
            Self::Protocol { .. } => ErrorKind::Protocol,
            Self::Timeout { .. } => ErrorKind::Timeout,
            Self::Cancelled => ErrorKind::Cancelled,
            Self::Internal { .. } => ErrorKind::Internal,
            Self::NotFound { .. } => ErrorKind::NotFound,
        }
    }

    pub fn code(&self) -> &'static str {
        self.kind().as_str()
    }

    pub fn validation(field_path: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Validation {
            field_path: field_path.into(),
            message: message.into(),
            suggestion: None,
        }
    }

    pub fn auth(message: impl Into<String>) -> Self {
        Self::Auth {
            message: message.into(),
        }
    }

    pub fn not_found(resource: impl Into<String>) -> Self {
        Self::NotFound {
            resource: resource.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_codes_are_stable() {
        assert_eq!(ErrorKind::Connection.as_str(), "connection_failed");
        assert_eq!(ErrorKind::Permission.as_str(), "permission");
        assert_eq!(
            DomainError::auth("missing token").code(),
            ErrorKind::Auth.as_str()
        );
        assert_eq!(
            DomainError::validation("url", "required").kind(),
            ErrorKind::Validation
        );
    }
}
