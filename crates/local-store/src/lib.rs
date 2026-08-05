//! Minimal SQLite store for Phase 0: save / open HTTP requests.

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
              finished_at TEXT NOT NULL
            );
            "#,
        )?;
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
                    updated_at: DateTime::parse_from_rfc3339(&updated_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
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
                updated_at: DateTime::parse_from_rfc3339(&updated_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            });
        }
        Ok(out)
    }

    pub fn record_execution(&self, record: &ExecutionRecord) -> StoreResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO executions
              (id, request_id, protocol_id, state, status, duration_ms, bytes_received, started_at, finished_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
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
            ],
        )?;
        Ok(())
    }
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
}
