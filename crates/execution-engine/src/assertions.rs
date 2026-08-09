//! Built-in assertion runner (status / duration / size / header / body / JSONPath).

use core_domain::{Assertion, AssertionResultEvent, ResponseMeta};
use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct AssertionContext {
    pub status: Option<u16>,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub duration_ms: u64,
    pub bytes_received: u64,
}

impl AssertionContext {
    pub fn from_response(
        meta: &ResponseMeta,
        body: impl Into<String>,
        duration_ms: u64,
        bytes: u64,
    ) -> Self {
        Self {
            status: meta.status,
            headers: meta.headers.clone(),
            body: body.into(),
            duration_ms,
            bytes_received: bytes,
        }
    }
}

pub fn run_assertions(
    assertions: &[Assertion],
    ctx: &AssertionContext,
) -> Vec<AssertionResultEvent> {
    assertions.iter().map(|a| evaluate(a, ctx)).collect()
}

fn evaluate(assertion: &Assertion, ctx: &AssertionContext) -> AssertionResultEvent {
    let name = assertion.name();
    match assertion {
        Assertion::StatusEquals { expected } => {
            let actual = ctx.status.map(|s| s.to_string());
            let passed = ctx.status == Some(*expected);
            AssertionResultEvent {
                name,
                passed,
                expected: Some(expected.to_string()),
                actual,
                message: None,
            }
        }
        Assertion::StatusIn { expected } => {
            let actual = ctx.status.map(|s| s.to_string());
            let passed = ctx.status.map(|s| expected.contains(&s)).unwrap_or(false);
            AssertionResultEvent {
                name,
                passed,
                expected: Some(format!("{expected:?}")),
                actual,
                message: None,
            }
        }
        Assertion::DurationLt { max_ms } => {
            let passed = ctx.duration_ms < *max_ms;
            AssertionResultEvent {
                name,
                passed,
                expected: Some(format!("< {max_ms}")),
                actual: Some(ctx.duration_ms.to_string()),
                message: None,
            }
        }
        Assertion::SizeLt { max_bytes } => {
            let passed = ctx.bytes_received < *max_bytes;
            AssertionResultEvent {
                name,
                passed,
                expected: Some(format!("< {max_bytes}")),
                actual: Some(ctx.bytes_received.to_string()),
                message: None,
            }
        }
        Assertion::HeaderEquals {
            name: header,
            expected,
        } => {
            let actual = find_header(&ctx.headers, header);
            let passed = actual.as_deref() == Some(expected.as_str());
            AssertionResultEvent {
                name,
                passed,
                expected: Some(expected.clone()),
                actual,
                message: None,
            }
        }
        Assertion::HeaderContains {
            name: header,
            expected,
        } => {
            let actual = find_header(&ctx.headers, header);
            let passed = actual
                .as_ref()
                .map(|v| v.contains(expected))
                .unwrap_or(false);
            AssertionResultEvent {
                name,
                passed,
                expected: Some(expected.clone()),
                actual,
                message: None,
            }
        }
        Assertion::BodyContains { expected } => {
            let passed = ctx.body.contains(expected);
            AssertionResultEvent {
                name,
                passed,
                expected: Some(expected.clone()),
                actual: Some(truncate(&ctx.body, 200)),
                message: None,
            }
        }
        Assertion::JsonPathEquals { path, expected } => match json_path_get(&ctx.body, path) {
            Ok(Some(value)) => {
                let actual = value_to_compare_string(&value);
                let passed = actual == *expected;
                AssertionResultEvent {
                    name,
                    passed,
                    expected: Some(expected.clone()),
                    actual: Some(actual),
                    message: None,
                }
            }
            Ok(None) => AssertionResultEvent {
                name,
                passed: false,
                expected: Some(expected.clone()),
                actual: None,
                message: Some(format!("path `{path}` not found")),
            },
            Err(err) => AssertionResultEvent {
                name,
                passed: false,
                expected: Some(expected.clone()),
                actual: None,
                message: Some(err),
            },
        },
    }
}

fn find_header(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.clone())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

/// Minimal JSON path: `$.a.b[0].c` or `/a/b/0/c`.
fn json_path_get(body: &str, path: &str) -> Result<Option<Value>, String> {
    let root: Value =
        serde_json::from_str(body).map_err(|e| format!("response is not JSON: {e}"))?;
    let pointer = to_json_pointer(path)?;
    Ok(root.pointer(&pointer).cloned())
}

fn to_json_pointer(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.starts_with('/') {
        return Ok(trimmed.to_string());
    }
    let trimmed = trimmed.strip_prefix("$").unwrap_or(trimmed);
    if trimmed.is_empty() || trimmed == "." {
        return Ok(String::new());
    }
    let mut pointer = String::new();
    let mut rest = trimmed;
    if rest.starts_with('.') {
        rest = &rest[1..];
    }
    while !rest.is_empty() {
        if rest.starts_with('[') {
            let end = rest
                .find(']')
                .ok_or_else(|| format!("invalid jsonpath: {path}"))?;
            let idx = &rest[1..end];
            pointer.push('/');
            pointer.push_str(idx);
            rest = &rest[end + 1..];
            continue;
        }
        let end = rest.find(['.', '[']).unwrap_or(rest.len());
        let seg = &rest[..end];
        if !seg.is_empty() {
            pointer.push('/');
            pointer.push_str(&seg.replace('~', "~0").replace('/', "~1"));
        }
        rest = &rest[end..];
        if rest.starts_with('.') {
            rest = &rest[1..];
        }
    }
    Ok(pointer)
}

fn value_to_compare_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_and_body_assertions() {
        let ctx = AssertionContext {
            status: Some(200),
            headers: vec![("content-type".into(), "application/json".into())],
            body: r#"{"ok":true,"n":1}"#.into(),
            duration_ms: 12,
            bytes_received: 20,
        };
        let results = run_assertions(
            &[
                Assertion::StatusEquals { expected: 200 },
                Assertion::BodyContains {
                    expected: "\"ok\":true".into(),
                },
                Assertion::JsonPathEquals {
                    path: "$.ok".into(),
                    expected: "true".into(),
                },
                Assertion::DurationLt { max_ms: 100 },
            ],
            &ctx,
        );
        assert!(results.iter().all(|r| r.passed));
    }
}
