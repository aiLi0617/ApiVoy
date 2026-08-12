use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, ProtocolPayload,
    RequestEnvelope, ResponseMeta,
};
use event_stream::EventSink;
use execution_engine::{DriverDescriptor, DriverError, ProtocolDriver, ValidationReport};
use futures::TryStreamExt;
use serde_json::Value;
use sqlx::{any::AnyPoolOptions, AssertSqlSafe, Column, Row, TypeInfo};
use std::time::Instant;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;
use url::Url;
#[derive(Debug, Default)]
pub struct SqlDriver;
#[derive(Debug)]
struct SqlRequest {
    url: String,
    sql: String,
    parameters: Vec<Value>,
    transactional: bool,
    row_limit: usize,
}
fn raw(value: &Value) -> &Value {
    value.get("value").unwrap_or(value)
}
fn decode(request: &RequestEnvelope) -> Result<SqlRequest, DriverError> {
    let ProtocolPayload::Raw(value) = &request.payload else {
        return Err(DriverError::Validation("SQL requires raw payload".into()));
    };
    let value = raw(value);
    let mut url = Url::parse(&request.target)
        .map_err(|error| DriverError::Validation(format!("invalid SQL target: {error}")))?;
    if !matches!(url.scheme(), "postgres" | "postgresql" | "mysql" | "sqlite") {
        return Err(DriverError::Validation(
            "SQL target must use postgres://, mysql://, or sqlite://".into(),
        ));
    }
    if url.scheme() == "mysql" {
        let ssl_modes = url
            .query_pairs()
            .filter(|(name, _)| {
                name.eq_ignore_ascii_case("ssl-mode") || name.eq_ignore_ascii_case("sslmode")
            })
            .map(|(_, value)| value.into_owned())
            .collect::<Vec<_>>();
        if ssl_modes.is_empty() {
            url.query_pairs_mut().append_pair("ssl-mode", "REQUIRED");
        } else if ssl_modes.iter().any(|mode| {
            !matches!(
                mode.to_ascii_uppercase().as_str(),
                "REQUIRED" | "VERIFY_CA" | "VERIFY_IDENTITY"
            )
        }) {
            return Err(DriverError::Validation(
                "MySQL connections must use ssl-mode=REQUIRED, VERIFY_CA, or VERIFY_IDENTITY"
                    .into(),
            ));
        }
    }
    if url.scheme() != "sqlite" {
        if let Some(username) = value
            .get("username")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        {
            url.set_username(username)
                .map_err(|_| DriverError::Validation("invalid SQL username".into()))?;
        }
        if let Some(reference) = value
            .get("passwordRef")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        {
            let password = request.runtime_secrets.get(reference).ok_or_else(|| {
                DriverError::Validation(format!("SQL password secret `{reference}` is unavailable"))
            })?;
            url.set_password(Some(password))
                .map_err(|_| DriverError::Validation("invalid SQL password".into()))?;
        }
    }
    Ok(SqlRequest {
        url: url.to_string(),
        sql: value
            .get("sql")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        parameters: value
            .get("parameters")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        transactional: value
            .get("transactional")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        row_limit: value
            .get("rowLimit")
            .and_then(Value::as_u64)
            .unwrap_or(500)
            .clamp(1, 10_000) as usize,
    })
}
fn bind<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Any, sqlx::any::AnyArguments>,
    parameters: &'q [Value],
) -> Result<sqlx::query::Query<'q, sqlx::Any, sqlx::any::AnyArguments>, DriverError> {
    for value in parameters {
        query = match value {
            Value::Null => query.bind(Option::<String>::None),
            Value::Bool(value) => query.bind(*value),
            Value::Number(value) if value.is_i64() => query.bind(value.as_i64().unwrap()),
            Value::Number(value) if value.is_u64() => {
                let number = value.as_u64().unwrap();
                if number > i64::MAX as u64 {
                    return Err(DriverError::Validation(
                        "SQL unsigned parameter exceeds i64".into(),
                    ));
                }
                query.bind(number as i64)
            }
            Value::Number(value) => query.bind(
                value
                    .as_f64()
                    .ok_or_else(|| DriverError::Validation("invalid SQL number".into()))?,
            ),
            Value::String(value) => query.bind(value.clone()),
            value => query.bind(
                serde_json::to_string(value)
                    .map_err(|error| DriverError::Validation(error.to_string()))?,
            ),
        };
    }
    Ok(query)
}
fn query_like(sql: &str) -> bool {
    matches!(
        sql.split_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_uppercase()
            .as_str(),
        "SELECT" | "WITH" | "SHOW" | "EXPLAIN" | "PRAGMA" | "DESCRIBE" | "DESC" | "VALUES"
    )
}
fn cell(row: &sqlx::any::AnyRow, index: usize) -> Value {
    let name = row.column(index).type_info().name().to_ascii_uppercase();
    if name.contains("BOOL") {
        return row
            .try_get::<Option<bool>, _>(index)
            .ok()
            .flatten()
            .map(Value::Bool)
            .unwrap_or(Value::Null);
    }
    if name.contains("INT") || name.contains("SERIAL") {
        return row
            .try_get::<Option<i64>, _>(index)
            .ok()
            .flatten()
            .map(Value::from)
            .unwrap_or(Value::Null);
    }
    if name.contains("REAL")
        || name.contains("FLOAT")
        || name.contains("DOUBLE")
        || name.contains("NUMERIC")
        || name.contains("DECIMAL")
    {
        return row
            .try_get::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null);
    }
    if name.contains("BYTE") || name.contains("BLOB") || name.contains("BINARY") {
        return row
            .try_get::<Option<Vec<u8>>, _>(index)
            .ok()
            .flatten()
            .map(|value| serde_json::json!({"base64":BASE64.encode(value)}))
            .unwrap_or(Value::Null);
    }
    row.try_get::<Option<String>, _>(index)
        .ok()
        .flatten()
        .map(Value::String)
        .unwrap_or_else(|| serde_json::json!({"unsupportedType":name}))
}
fn err(error: impl std::fmt::Display) -> DriverError {
    DriverError::Protocol(error.to_string())
}
#[async_trait]
impl ProtocolDriver for SqlDriver {
    fn descriptor(&self) -> DriverDescriptor {
        DriverDescriptor {
            protocol_id: "sql".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            display_name: "SQL (PostgreSQL / MySQL / SQLite)".into(),
            capabilities: vec![
                "postgresql".into(),
                "mysql".into(),
                "sqlite".into(),
                "parameters".into(),
                "transactions".into(),
                "tls".into(),
                "row-limit".into(),
            ],
        }
    }
    fn validate(&self, request: &RequestEnvelope) -> ValidationReport {
        let mut report = ValidationReport::ok();
        match decode(request) {
            Ok(payload) => {
                if payload.sql.trim().is_empty() {
                    report.errors.push("SQL statement is required".into())
                }
            }
            Err(error) => report.errors.push(error.to_string()),
        }
        report
    }
    async fn execute(
        &self,
        request: RequestEnvelope,
        mut events: EventSink,
        cancel: CancellationToken,
        execution_id: ExecutionId,
    ) -> Result<ExecutionSummary, DriverError> {
        sqlx::any::install_default_drivers();
        let started_at = Utc::now();
        let wall = Instant::now();
        let payload = decode(&request)?;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Connect),
            })
            .await;
        let pool = tokio::select! {_ = cancel.cancelled()=>return Err(DriverError::Cancelled),result=timeout(Duration::from_millis(request.timeout_ms.max(1)),AnyPoolOptions::new().max_connections(1).connect(&payload.url))=>result.map_err(|_|DriverError::Timeout("SQL connection timed out".into()))?.map_err(err)?};
        let mut connection = pool.acquire().await.map_err(err)?;
        if payload.transactional {
            sqlx::query("BEGIN")
                .execute(&mut *connection)
                .await
                .map_err(err)?;
        }
        events
            .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                status: None,
                status_text: Some("SQL connection open".into()),
                headers: vec![],
                content_type: Some("application/json".into()),
                size_hint: None,
            }))
            .await;
        events
            .emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Running,
                phase: Some(ExecutionPhase::Transfer),
            })
            .await;
        let operation = async {
            if query_like(&payload.sql) {
                // ApiVoy is an explicit SQL debugging client: the complete statement is supplied
                // by the user, while individual values still use driver bind parameters below.
                let query = bind(
                    sqlx::query(AssertSqlSafe(payload.sql.as_str())),
                    &payload.parameters,
                )?;
                let mut rows = query.fetch(&mut *connection);
                let mut output = Vec::new();
                while output.len() < payload.row_limit {
                    let Some(row) = rows.try_next().await.map_err(err)? else {
                        break;
                    };
                    let mut object = serde_json::Map::new();
                    for (index, column) in row.columns().iter().enumerate() {
                        object.insert(column.name().into(), cell(&row, index));
                    }
                    output.push(Value::Object(object));
                }
                drop(rows);
                Ok::<Value, DriverError>(
                    serde_json::json!({"columns":output.first().and_then(Value::as_object).map(|v|v.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),"rows":output,"truncated":output.len()==payload.row_limit}),
                )
            } else {
                let result = bind(
                    sqlx::query(AssertSqlSafe(payload.sql.as_str())),
                    &payload.parameters,
                )?
                .execute(&mut *connection)
                .await
                .map_err(err)?;
                Ok(
                    serde_json::json!({"rowsAffected":result.rows_affected(),"lastInsertId":result.last_insert_id()}),
                )
            }
        };
        let outcome = tokio::select! {_ = cancel.cancelled()=>Err(DriverError::Cancelled),result=timeout(Duration::from_millis(request.timeout_ms.max(1)),operation)=>result.map_err(|_|DriverError::Timeout("SQL query timed out".into()))?};
        match outcome {
            Ok(value) => {
                if payload.transactional {
                    sqlx::query("COMMIT")
                        .execute(&mut *connection)
                        .await
                        .map_err(err)?;
                }
                let preview = serde_json::to_string_pretty(&value).map_err(err)?;
                events
                    .emit(ExecutionEvent::ResponseChunk {
                        content_type: Some("application/json".into()),
                        size: preview.len() as u64,
                        preview: Some(preview.clone()),
                        data_base64: Some(BASE64.encode(&preview)),
                        done: true,
                    })
                    .await;
                let summary = ExecutionSummary {
                    execution_id,
                    request_id: request.id.0,
                    protocol_id: request.protocol_id.0,
                    state: ExecutionState::Completed,
                    started_at,
                    finished_at: Utc::now(),
                    duration_ms: wall.elapsed().as_millis() as u64,
                    bytes_received: preview.len() as u64,
                    status: None,
                };
                events
                    .emit(ExecutionEvent::Completed {
                        summary: summary.clone(),
                    })
                    .await;
                Ok(summary)
            }
            Err(error) => {
                if payload.transactional {
                    let _ = sqlx::query("ROLLBACK").execute(&mut *connection).await;
                }
                Err(error)
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core_domain::ProtocolId;
    #[test]
    fn validates_supported_urls_and_secrets() {
        let mut request = RequestEnvelope::http_get("SQL", "postgres://localhost/db");
        request.protocol_id = ProtocolId("sql".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"sql":"select 1","username":"user","passwordRef":"db-pass"}),
        );
        assert!(!SqlDriver.validate(&request).is_valid());
        request
            .runtime_secrets
            .insert("db-pass".into(), "secret".into());
        assert!(SqlDriver.validate(&request).is_valid());
    }
    #[test]
    fn requires_tls_for_mysql_connections() {
        let mut request = RequestEnvelope::http_get("SQL", "mysql://localhost/db");
        request.protocol_id = ProtocolId("sql".into());
        request.payload = ProtocolPayload::Raw(serde_json::json!({"sql":"select 1"}));

        let decoded = decode(&request).unwrap();
        assert!(decoded.url.contains("ssl-mode=REQUIRED"));

        request.target = "mysql://localhost/db?ssl-mode=DISABLED".into();
        assert!(decode(&request).is_err());

        request.target = "mysql://localhost/db?ssl-mode=VERIFY_IDENTITY".into();
        assert!(decode(&request).is_ok());

        request.target = "mysql://localhost/db?ssl-mode=REQUIRED&ssl-mode=DISABLED".into();
        assert!(decode(&request).is_err());

        request.target = "mysql://localhost/db?sslmode=DISABLED".into();
        assert!(decode(&request).is_err());
    }
    #[tokio::test]
    async fn runs_parameterized_sqlite_query() {
        let mut request = RequestEnvelope::http_get("SQLite", "sqlite::memory:");
        request.protocol_id = ProtocolId("sql".into());
        request.payload = ProtocolPayload::Raw(
            serde_json::json!({"sql":"SELECT ? AS answer","parameters":[42],"transactional":true}),
        );
        let (sink, mut receiver) = EventSink::channel();
        let summary = SqlDriver
            .execute(request, sink, CancellationToken::new(), ExecutionId::new())
            .await
            .unwrap();
        while receiver.recv().await.is_some() {}
        assert!(summary.bytes_received > 0);
    }
}
