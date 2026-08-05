use thiserror::Error;

pub type DomainResult<T> = Result<T, DomainError>;

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
}

impl DomainError {
    pub fn validation(field_path: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Validation {
            field_path: field_path.into(),
            message: message.into(),
            suggestion: None,
        }
    }
}
