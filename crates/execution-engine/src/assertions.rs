//! Built-in assertion runner (status / duration / size / header / body / JSONPath).

use core_domain::{Assertion, AssertionOperator, AssertionResultEvent, AssertionTarget, ResponseMeta};
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
    assertions.iter().filter(|a| a.enabled).map(|a| evaluate(a, ctx)).collect()
}

fn evaluate(assertion: &Assertion, ctx: &AssertionContext) -> AssertionResultEvent {
    let name = assertion.name();
    let expected = assertion.expected.clone();
    let mut actual = match assertion.target {
        AssertionTarget::Status => ctx.status.map(|value| value.to_string()),
        AssertionTarget::Header => find_header(&ctx.headers, assertion.selector.as_deref().unwrap_or("")),
        AssertionTarget::Body => Some(ctx.body.clone()),
        AssertionTarget::Duration => Some(ctx.duration_ms.to_string()),
        AssertionTarget::Size => Some(ctx.bytes_received.to_string()),
        AssertionTarget::JsonPath => match json_path_get(&ctx.body, assertion.selector.as_deref().unwrap_or("$")) {
            Ok(value) => value.map(|item| value_to_compare_string(&item)),
            Err(message) => return result(assertion, name, false, expected, None, Some(message)),
        },
    };
    let mut failure = None;
    let passed = match assertion.operator {
        AssertionOperator::Exists => actual.is_some(),
        AssertionOperator::NotExists => actual.is_none(),
        AssertionOperator::Equals => actual.as_deref() == expected.as_deref(),
        AssertionOperator::NotEquals => actual.as_deref() != expected.as_deref(),
        AssertionOperator::Contains => actual.as_ref().zip(expected.as_ref()).map(|(a, e)| a.contains(e)).unwrap_or(false),
        AssertionOperator::NotContains => actual.as_ref().zip(expected.as_ref()).map(|(a, e)| !a.contains(e)).unwrap_or(false),
        AssertionOperator::In => expected.as_ref().map(|items| items.split(',').any(|item| actual.as_deref() == Some(item.trim()))).unwrap_or(false),
        AssertionOperator::GreaterThan => numeric_compare(actual.as_deref(), expected.as_deref(), |a, b| a > b),
        AssertionOperator::LessThan => numeric_compare(actual.as_deref(), expected.as_deref(), |a, b| a < b),
        AssertionOperator::TypeIs => json_path_value(&ctx.body, assertion.selector.as_deref().unwrap_or("$")).ok().flatten().map(|value| { let kind = json_type(&value); actual = Some(kind.into()); kind == expected.as_deref().unwrap_or("") }).unwrap_or(false),
        AssertionOperator::LengthEquals | AssertionOperator::LengthGreaterThan | AssertionOperator::LengthLessThan => {
            let length = json_path_value(&ctx.body, assertion.selector.as_deref().unwrap_or("$")).ok().flatten().and_then(|value| match value { Value::Array(items) => Some(items.len() as f64), _ => None });
            let wanted = expected.as_deref().and_then(|value| value.parse::<f64>().ok());
            actual = length.map(|value| value.to_string());
            if length.is_none() { failure = Some("目标值不是数组，无法计算长度".into()); }
            length.zip(wanted).map(|(a, b)| match assertion.operator { AssertionOperator::LengthEquals => a == b, AssertionOperator::LengthGreaterThan => a > b, _ => a < b }).unwrap_or(false)
        }
    };
    if !passed && failure.is_none() {
        failure = Some(if actual.is_none() { "定位路径或响应字段不存在".into() } else { "实际值不满足比较条件".into() });
    }
    let shown_actual = if matches!(assertion.target, AssertionTarget::Body) { actual.map(|value| truncate(&value, 200)) } else { actual };
    result(assertion, name, passed, expected, shown_actual, failure)
}

fn result(assertion: &Assertion, name: String, passed: bool, expected: Option<String>, actual: Option<String>, message: Option<String>) -> AssertionResultEvent {
    AssertionResultEvent { rule_id: assertion.id.clone(), name, passed, expected, actual, message }
}

fn numeric_compare(actual: Option<&str>, expected: Option<&str>, compare: impl FnOnce(f64, f64) -> bool) -> bool {
    actual.and_then(|value| value.parse::<f64>().ok()).zip(expected.and_then(|value| value.parse::<f64>().ok())).map(|(a, b)| compare(a, b)).unwrap_or(false)
}

fn json_type(value: &Value) -> &'static str { match value { Value::Null => "null", Value::Bool(_) => "boolean", Value::Number(_) => "number", Value::String(_) => "string", Value::Array(_) => "array", Value::Object(_) => "object" } }

fn json_path_value(body: &str, path: &str) -> Result<Option<Value>, String> { json_path_get(body, path) }

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

    fn rule(id: &str, target: AssertionTarget, operator: AssertionOperator, selector: Option<&str>, expected: Option<&str>) -> Assertion {
        Assertion { id: id.into(), enabled: true, target, operator, selector: selector.map(Into::into), expected: expected.map(Into::into) }
    }

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
                rule("status", AssertionTarget::Status, AssertionOperator::Equals, None, Some("200")),
                rule("body", AssertionTarget::Body, AssertionOperator::Contains, None, Some("\"ok\":true")),
                rule("json", AssertionTarget::JsonPath, AssertionOperator::Equals, Some("$.ok"), Some("true")),
                rule("duration", AssertionTarget::Duration, AssertionOperator::LessThan, None, Some("100")),
            ],
            &ctx,
        );
        assert!(results.iter().all(|r| r.passed));
        assert_eq!(results[0].rule_id, "status");
    }

    #[test]
    fn skips_disabled_and_handles_array_length_and_missing_paths() {
        let ctx = AssertionContext { body: r#"{"items":[1,2]}"#.into(), ..Default::default() };
        let results = run_assertions(&[
            Assertion { enabled: false, ..rule("off", AssertionTarget::Body, AssertionOperator::Contains, None, Some("missing")) },
            rule("length", AssertionTarget::JsonPath, AssertionOperator::LengthEquals, Some("$.items"), Some("2")),
            rule("missing", AssertionTarget::JsonPath, AssertionOperator::Exists, Some("$.nope"), None),
        ], &ctx);
        assert_eq!(results.len(), 2);
        assert!(results[0].passed);
        assert!(!results[1].passed);
    }
}
