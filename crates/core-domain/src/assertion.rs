use serde::{Deserialize, Serialize};

/// Built-in assertion (P0; no user scripts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Assertion {
    StatusEquals { expected: u16 },
    StatusIn { expected: Vec<u16> },
    DurationLt { max_ms: u64 },
    SizeLt { max_bytes: u64 },
    HeaderEquals { name: String, expected: String },
    HeaderContains { name: String, expected: String },
    BodyContains { expected: String },
    JsonPathEquals { path: String, expected: String },
}

impl Assertion {
    pub fn name(&self) -> String {
        match self {
            Self::StatusEquals { expected } => format!("status == {expected}"),
            Self::StatusIn { expected } => format!("status in {expected:?}"),
            Self::DurationLt { max_ms } => format!("duration < {max_ms}ms"),
            Self::SizeLt { max_bytes } => format!("size < {max_bytes}B"),
            Self::HeaderEquals { name, .. } => format!("header[{name}] equals"),
            Self::HeaderContains { name, .. } => format!("header[{name}] contains"),
            Self::BodyContains { .. } => "body contains".into(),
            Self::JsonPathEquals { path, .. } => format!("jsonpath {path}"),
        }
    }
}
