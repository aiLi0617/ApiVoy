//! Local SQLite store: requests, environments/variables, execution history.

use std::collections::HashMap;
use std::path::Path;

use chrono::{DateTime, Utc};
use core_domain::{RequestEnvelope, RequestId};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid id: {0}")]
    InvalidId(String),
    #[error("not found: {0}")]
    NotFound(String),
}

pub type StoreResult<T> = Result<T, StoreError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRequest {
    pub id: String,
    pub project_id: String,
    pub collection_id: String,
    pub name: String,
    pub protocol_id: String,
    pub target: String,
    pub envelope: RequestEnvelope,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    pub request_id: String,
    pub protocol_id: String,
    pub state: String,
    pub status: Option<u16>,
    pub duration_ms: u64,
    pub bytes_received: u64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    /// Snapshot of the request at send time (for history replay).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_snapshot: Option<RequestEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub variables: HashMap<String, String>,
    /// Names of secrets stored in OS keychain (values never persisted here).
    pub secret_refs: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

pub struct LocalStore {
    conn: Connection,
}

impl LocalStore {
    pub fn open(path: impl AsRef<Path>) -> StoreResult<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        store.ensure_defaults()?;
        Ok(store)
    }

    pub fn open_in_memory() -> StoreResult<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        store.ensure_defaults()?;
        Ok(store)
    }

    fn migrate(&self) -> StoreResult<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS collections (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS requests (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              protocol_id TEXT NOT NULL,
              target TEXT NOT NULL,
              envelope_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS executions (
              id TEXT PRIMARY KEY,
              request_id TEXT,
              protocol_id TEXT NOT NULL,
              state TEXT NOT NULL,
              status INTEGER,
              duration_ms INTEGER NOT NULL,
              bytes_received INTEGER NOT NULL,
              started_at TEXT NOT NULL,
              finished_at TEXT NOT NULL,
              request_snapshot_json TEXT,
              preview TEXT
            );

            CREATE TABLE IF NOT EXISTS environments (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              variables_json TEXT NOT NULL,
              secret_refs_json TEXT NOT NULL DEFAULT '[]',
              updated_at TEXT NOT NULL
            );
            "#,
        )?;

        // Additive migrations for DBs created in Phase 0.
        let _ = self
            .conn
            .execute("ALTER TABLE executions ADD COLUMN request_snapshot_json TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE executions ADD COLUMN preview TEXT", []);

        Ok(())
    }

    fn ensure_defaults(&self) -> StoreResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (?1, ?2, ?3)",
            params!["default-project", "Default Project", now],
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO collections (id, project_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params!["default-collection", "default-project", "Default Collection", now],
        )?;
        self.conn.execute(
            r#"
            INSERT OR IGNORE INTO environments (id, project_id, name, variables_json, secret_refs_json, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                "default-env",
                "default-project",
                "Default",
                "{}",
                "[]",
                now,
            ],
        )?;
        Ok(())
    }

    pub fn save_request(
        &self,
        envelope: &RequestEnvelope,
        project_id: &str,
        collection_id: &str,
    ) -> StoreResult<StoredRequest> {
        let id = envelope.id.0.to_string();
        let updated_at = Utc::now();
        let envelope_json = serde_json::to_string(envelope)?;
        self.conn.execute(
            r#"
            INSERT INTO requests (id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
              project_id = excluded.project_id,
              collection_id = excluded.collection_id,
              name = excluded.name,
              protocol_id = excluded.protocol_id,
              target = excluded.target,
              envelope_json = excluded.envelope_json,
              updated_at = excluded.updated_at
            "#,
            params![
                id,
                project_id,
                collection_id,
                envelope.name,
                envelope.protocol_id.0,
                envelope.target,
                envelope_json,
                updated_at.to_rfc3339(),
            ],
        )?;
        Ok(StoredRequest {
            id: envelope.id.0.to_string(),
            project_id: project_id.into(),
            collection_id: collection_id.into(),
            name: envelope.name.clone(),
            protocol_id: envelope.protocol_id.0.clone(),
            target: envelope.target.clone(),
            envelope: envelope.clone(),
            updated_at,
        })
    }

    pub fn get_request(&self, id: &RequestId) -> StoreResult<Option<StoredRequest>> {
        self.conn
            .query_row(
                r#"
                SELECT id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at
                FROM requests WHERE id = ?1
                "#,
                params![id.0.to_string()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .optional()?
            .map(|(id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at)| {
                let envelope: RequestEnvelope = serde_json::from_str(&envelope_json)?;
                Ok(StoredRequest {
                    id,
                    project_id,
                    collection_id,
                    name,
                    protocol_id,
                    target,
                    envelope,
                    updated_at: parse_time(&updated_at),
                })
            })
            .transpose()
    }

    pub fn latest_request(&self) -> StoreResult<Option<StoredRequest>> {
        let id: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM requests ORDER BY updated_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match id {
            Some(id) => {
                let uuid =
                    Uuid::parse_str(&id).map_err(|e| StoreError::InvalidId(e.to_string()))?;
                self.get_request(&RequestId(uuid))
            }
            None => Ok(None),
        }
    }

    pub fn list_requests(&self, collection_id: Option<&str>) -> StoreResult<Vec<StoredRequest>> {
        let mut stmt = if collection_id.is_some() {
            self.conn.prepare(
                r#"
                SELECT id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at
                FROM requests WHERE collection_id = ?1 ORDER BY updated_at DESC
                "#,
            )?
        } else {
            self.conn.prepare(
                r#"
                SELECT id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at
                FROM requests ORDER BY updated_at DESC
                "#,
            )?
        };

        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<(String, String, String, String, String, String, String, String)> {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        };

        let rows = if let Some(cid) = collection_id {
            stmt.query_map(params![cid], map_row)?
        } else {
            stmt.query_map([], map_row)?
        };

        let mut out = Vec::new();
        for row in rows {
            let (id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at) =
                row?;
            let envelope: RequestEnvelope = serde_json::from_str(&envelope_json)?;
            out.push(StoredRequest {
                id,
                project_id,
                collection_id,
                name,
                protocol_id,
                target,
                envelope,
                updated_at: parse_time(&updated_at),
            });
        }
        Ok(out)
    }

    pub fn record_execution(&self, record: &ExecutionRecord) -> StoreResult<()> {
        let snapshot = record
            .request_snapshot
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        self.conn.execute(
            r#"
            INSERT INTO executions
              (id, request_id, protocol_id, state, status, duration_ms, bytes_received,
               started_at, finished_at, request_snapshot_json, preview)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
            params![
                record.id,
                record.request_id,
                record.protocol_id,
                record.state,
                record.status,
                record.duration_ms as i64,
                record.bytes_received as i64,
                record.started_at.to_rfc3339(),
                record.finished_at.to_rfc3339(),
                snapshot,
                record.preview,
            ],
        )?;
        Ok(())
    }

    pub fn list_executions(&self, limit: usize) -> StoreResult<Vec<ExecutionRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, request_id, protocol_id, state, status, duration_ms, bytes_received,
                   started_at, finished_at, request_snapshot_json, preview
            FROM executions
            ORDER BY started_at DESC
            LIMIT ?1
            "#,
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })?;

        let mut out = Vec::new();
        for row in rows {
            let (
                id,
                request_id,
                protocol_id,
                state,
                status,
                duration_ms,
                bytes_received,
                started_at,
                finished_at,
                snapshot,
                preview,
            ) = row?;
            let request_snapshot = snapshot
                .as_deref()
                .map(serde_json::from_str)
                .transpose()?;
            out.push(ExecutionRecord {
                id,
                request_id: request_id.unwrap_or_default(),
                protocol_id,
                state,
                status: status.map(|s| s as u16),
                duration_ms: duration_ms as u64,
                bytes_received: bytes_received as u64,
                started_at: parse_time(&started_at),
                finished_at: parse_time(&finished_at),
                request_snapshot,
                preview,
            });
        }
        Ok(out)
    }

    pub fn get_execution(&self, id: &str) -> StoreResult<Option<ExecutionRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT id, request_id, protocol_id, state, status, duration_ms, bytes_received,
                       started_at, finished_at, request_snapshot_json, preview
                FROM executions WHERE id = ?1
                "#,
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, Option<String>>(10)?,
                    ))
                },
            )
            .optional()?
            .map(
                |(
                    id,
                    request_id,
                    protocol_id,
                    state,
                    status,
                    duration_ms,
                    bytes_received,
                    started_at,
                    finished_at,
                    snapshot,
                    preview,
                )| {
                    let request_snapshot = snapshot
                        .as_deref()
                        .map(serde_json::from_str)
                        .transpose()?;
                    Ok(ExecutionRecord {
                        id,
                        request_id: request_id.unwrap_or_default(),
                        protocol_id,
                        state,
                        status: status.map(|s| s as u16),
                        duration_ms: duration_ms as u64,
                        bytes_received: bytes_received as u64,
                        started_at: parse_time(&started_at),
                        finished_at: parse_time(&finished_at),
                        request_snapshot,
                        preview,
                    })
                },
            )
            .transpose()
    }

    pub fn save_environment(&self, env: &EnvironmentRecord) -> StoreResult<()> {
        let variables_json = serde_json::to_string(&env.variables)?;
        let secret_refs_json = serde_json::to_string(&env.secret_refs)?;
        self.conn.execute(
            r#"
            INSERT INTO environments (id, project_id, name, variables_json, secret_refs_json, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
              project_id = excluded.project_id,
              name = excluded.name,
              variables_json = excluded.variables_json,
              secret_refs_json = excluded.secret_refs_json,
              updated_at = excluded.updated_at
            "#,
            params![
                env.id,
                env.project_id,
                env.name,
                variables_json,
                secret_refs_json,
                env.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_environment(&self, id: &str) -> StoreResult<Option<EnvironmentRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT id, project_id, name, variables_json, secret_refs_json, updated_at
                FROM environments WHERE id = ?1
                "#,
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?
            .map(|(id, project_id, name, variables_json, secret_refs_json, updated_at)| {
                Ok(EnvironmentRecord {
                    id,
                    project_id,
                    name,
                    variables: serde_json::from_str(&variables_json)?,
                    secret_refs: serde_json::from_str(&secret_refs_json)?,
                    updated_at: parse_time(&updated_at),
                })
            })
            .transpose()
    }

    pub fn default_environment(&self) -> StoreResult<EnvironmentRecord> {
        self.get_environment("default-env")?
            .ok_or_else(|| StoreError::NotFound("default-env".into()))
    }
}

fn parse_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_domain::RequestEnvelope;

    #[test]
    fn save_and_reopen_http_request() {
        let store = LocalStore::open_in_memory().expect("open");
        let req = RequestEnvelope::http_get("sample", "https://example.com/api");
        let saved = store
            .save_request(&req, "default-project", "default-collection")
            .expect("save");
        assert_eq!(saved.target, "https://example.com/api");

        let loaded = store
            .get_request(&req.id)
            .expect("get")
            .expect("present");
        assert_eq!(loaded.envelope.target, req.target);
        assert_eq!(loaded.envelope.name, "sample");

        let latest = store.latest_request().expect("latest").expect("present");
        assert_eq!(latest.id, saved.id);
    }

    #[test]
    fn environment_and_history_roundtrip() {
        let store = LocalStore::open_in_memory().expect("open");
        let mut env = store.default_environment().expect("env");
        env.variables.insert("host".into(), "example.com".into());
        env.secret_refs.push("apiToken".into());
        env.updated_at = Utc::now();
        store.save_environment(&env).expect("save env");

        let reloaded = store.default_environment().expect("reload");
        assert_eq!(reloaded.variables.get("host").unwrap(), "example.com");
        assert_eq!(reloaded.secret_refs, vec!["apiToken".to_string()]);

        let req = RequestEnvelope::http_get("hist", "https://example.com");
        let record = ExecutionRecord {
            id: Uuid::new_v4().to_string(),
            request_id: req.id.0.to_string(),
            protocol_id: "http".into(),
            state: "completed".into(),
            status: Some(200),
            duration_ms: 10,
            bytes_received: 5,
            started_at: Utc::now(),
            finished_at: Utc::now(),
            request_snapshot: Some(req),
            preview: Some("hi".into()),
        };
        store.record_execution(&record).expect("record");
        let list = store.list_executions(10).expect("list");
        assert_eq!(list.len(), 1);
        assert!(list[0].request_snapshot.is_some());
        assert_eq!(list[0].preview.as_deref(), Some("hi"));
    }
}
