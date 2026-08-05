//! Local SQLite store: workspace, requests, environments, execution history, blobs.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use core_domain::{HttpPayload, ProtocolPayload, RequestEnvelope, RequestId};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

/// Bodies / previews larger than this are written to `blob_index` + disk.
pub const BLOB_THRESHOLD_BYTES: usize = 64 * 1024;

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
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub root_path: Option<String>,
    pub settings: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobIndexRecord {
    pub id: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub content_type: Option<String>,
    pub relative_path: String,
    pub ref_count: i64,
    pub created_at: DateTime<Utc>,
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_blob_id: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_blob_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ExecutionFilter {
    pub request_id: Option<String>,
    pub state: Option<String>,
    pub protocol_id: Option<String>,
    pub status: Option<u16>,
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
    blob_dir: PathBuf,
}

impl LocalStore {
    pub fn open(path: impl AsRef<Path>) -> StoreResult<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let blob_dir = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("blobs");
        std::fs::create_dir_all(&blob_dir)?;
        let conn = Connection::open(path)?;
        let store = Self { conn, blob_dir };
        store.migrate()?;
        store.ensure_defaults()?;
        Ok(store)
    }

    pub fn open_in_memory() -> StoreResult<Self> {
        let blob_dir = std::env::temp_dir().join(format!("apivoy-blobs-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&blob_dir)?;
        let conn = Connection::open_in_memory()?;
        let store = Self { conn, blob_dir };
        store.migrate()?;
        store.ensure_defaults()?;
        Ok(store)
    }

    pub fn blob_dir(&self) -> &Path {
        &self.blob_dir
    }

    fn migrate(&self) -> StoreResult<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              root_path TEXT,
              settings_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL,
              workspace_id TEXT REFERENCES workspaces(id)
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
              updated_at TEXT NOT NULL,
              body_blob_id TEXT
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
              preview TEXT,
              response_blob_id TEXT
            );

            CREATE TABLE IF NOT EXISTS environments (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              variables_json TEXT NOT NULL,
              secret_refs_json TEXT NOT NULL DEFAULT '[]',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blob_index (
              id TEXT PRIMARY KEY,
              sha256 TEXT NOT NULL UNIQUE,
              size_bytes INTEGER NOT NULL,
              content_type TEXT,
              relative_path TEXT NOT NULL,
              ref_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            "#,
        )?;

        // Additive migrations for DBs created in Phase 0 / early M1.
        let _ = self
            .conn
            .execute("ALTER TABLE executions ADD COLUMN request_snapshot_json TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE executions ADD COLUMN preview TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE executions ADD COLUMN response_blob_id TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE requests ADD COLUMN body_blob_id TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE projects ADD COLUMN workspace_id TEXT", []);

        Ok(())
    }

    fn ensure_defaults(&self) -> StoreResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"
            INSERT OR IGNORE INTO workspaces (id, name, root_path, settings_json, created_at, updated_at)
            VALUES (?1, ?2, NULL, '{}', ?3, ?3)
            "#,
            params!["default-workspace", "Default Workspace", now],
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, created_at, workspace_id) VALUES (?1, ?2, ?3, ?4)",
            params!["default-project", "Default Project", now, "default-workspace"],
        )?;
        // Backfill workspace_id for projects created before the column existed.
        let _ = self.conn.execute(
            "UPDATE projects SET workspace_id = ?1 WHERE workspace_id IS NULL",
            params!["default-workspace"],
        );
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

    pub fn default_workspace(&self) -> StoreResult<WorkspaceRecord> {
        self.get_workspace("default-workspace")?
            .ok_or_else(|| StoreError::NotFound("default-workspace".into()))
    }

    pub fn get_workspace(&self, id: &str) -> StoreResult<Option<WorkspaceRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT id, name, root_path, settings_json, created_at, updated_at
                FROM workspaces WHERE id = ?1
                "#,
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?
            .map(|(id, name, root_path, settings_json, created_at, updated_at)| {
                Ok(WorkspaceRecord {
                    id,
                    name,
                    root_path,
                    settings: serde_json::from_str(&settings_json)
                        .unwrap_or_else(|_| serde_json::json!({})),
                    created_at: parse_time(&created_at),
                    updated_at: parse_time(&updated_at),
                })
            })
            .transpose()
    }

    pub fn list_workspaces(&self) -> StoreResult<Vec<WorkspaceRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, name, root_path, settings_json, created_at, updated_at
            FROM workspaces ORDER BY updated_at DESC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, name, root_path, settings_json, created_at, updated_at) = row?;
            out.push(WorkspaceRecord {
                id,
                name,
                root_path,
                settings: serde_json::from_str(&settings_json)
                    .unwrap_or_else(|_| serde_json::json!({})),
                created_at: parse_time(&created_at),
                updated_at: parse_time(&updated_at),
            });
        }
        Ok(out)
    }

    pub fn save_workspace(&self, ws: &WorkspaceRecord) -> StoreResult<()> {
        let settings_json = serde_json::to_string(&ws.settings)?;
        self.conn.execute(
            r#"
            INSERT INTO workspaces (id, name, root_path, settings_json, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              root_path = excluded.root_path,
              settings_json = excluded.settings_json,
              updated_at = excluded.updated_at
            "#,
            params![
                ws.id,
                ws.name,
                ws.root_path,
                settings_json,
                ws.created_at.to_rfc3339(),
                ws.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Store bytes under content-addressed blob storage; increments ref_count on reuse.
    pub fn put_blob(
        &self,
        data: &[u8],
        content_type: Option<&str>,
    ) -> StoreResult<BlobIndexRecord> {
        let sha = hex_sha256(data);
        if let Some(existing) = self.get_blob_by_sha(&sha)? {
            self.conn.execute(
                "UPDATE blob_index SET ref_count = ref_count + 1 WHERE id = ?1",
                params![existing.id],
            )?;
            return self
                .get_blob(&existing.id)?
                .ok_or_else(|| StoreError::NotFound(existing.id));
        }

        let id = Uuid::new_v4().to_string();
        let relative_path = format!("{}/{}", &sha[..2], &sha);
        let abs = self.blob_dir.join(&relative_path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(&abs)?;
        file.write_all(data)?;
        file.sync_all()?;

        let created_at = Utc::now();
        self.conn.execute(
            r#"
            INSERT INTO blob_index (id, sha256, size_bytes, content_type, relative_path, ref_count, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
            "#,
            params![
                id,
                sha,
                data.len() as i64,
                content_type,
                relative_path,
                created_at.to_rfc3339(),
            ],
        )?;
        self.get_blob(&id)?
            .ok_or_else(|| StoreError::NotFound(id))
    }

    pub fn read_blob(&self, id: &str) -> StoreResult<Vec<u8>> {
        let meta = self
            .get_blob(id)?
            .ok_or_else(|| StoreError::NotFound(id.into()))?;
        let path = self.blob_dir.join(&meta.relative_path);
        Ok(std::fs::read(path)?)
    }

    pub fn get_blob(&self, id: &str) -> StoreResult<Option<BlobIndexRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT id, sha256, size_bytes, content_type, relative_path, ref_count, created_at
                FROM blob_index WHERE id = ?1
                "#,
                params![id],
                |row| {
                    Ok(BlobIndexRecord {
                        id: row.get(0)?,
                        sha256: row.get(1)?,
                        size_bytes: row.get::<_, i64>(2)? as u64,
                        content_type: row.get(3)?,
                        relative_path: row.get(4)?,
                        ref_count: row.get(5)?,
                        created_at: parse_time(&row.get::<_, String>(6)?),
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    fn get_blob_by_sha(&self, sha: &str) -> StoreResult<Option<BlobIndexRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT id, sha256, size_bytes, content_type, relative_path, ref_count, created_at
                FROM blob_index WHERE sha256 = ?1
                "#,
                params![sha],
                |row| {
                    Ok(BlobIndexRecord {
                        id: row.get(0)?,
                        sha256: row.get(1)?,
                        size_bytes: row.get::<_, i64>(2)? as u64,
                        content_type: row.get(3)?,
                        relative_path: row.get(4)?,
                        ref_count: row.get(5)?,
                        created_at: parse_time(&row.get::<_, String>(6)?),
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    fn externalize_http_body(
        &self,
        envelope: &mut RequestEnvelope,
    ) -> StoreResult<Option<String>> {
        let ProtocolPayload::Http(HttpPayload { body: Some(body), .. }) = &envelope.payload else {
            return Ok(None);
        };
        if body.len() <= BLOB_THRESHOLD_BYTES {
            return Ok(None);
        }
        let blob = self.put_blob(body.as_bytes(), Some("application/octet-stream"))?;
        if let ProtocolPayload::Http(ref mut payload) = envelope.payload {
            payload.body = Some(format!("@apivoy-blob:{}", blob.id));
        }
        Ok(Some(blob.id))
    }

    fn hydrate_http_body(
        &self,
        envelope: &mut RequestEnvelope,
        body_blob_id: Option<&str>,
    ) -> StoreResult<()> {
        if let Some(id) = body_blob_id {
            let bytes = self.read_blob(id)?;
            let text = String::from_utf8_lossy(&bytes).into_owned();
            if let ProtocolPayload::Http(ref mut payload) = envelope.payload {
                payload.body = Some(text);
            }
            return Ok(());
        }
        if let ProtocolPayload::Http(HttpPayload {
            body: Some(ref marker),
            ..
        }) = envelope.payload
        {
            if let Some(id) = marker.strip_prefix("@apivoy-blob:") {
                let bytes = self.read_blob(id)?;
                let text = String::from_utf8_lossy(&bytes).into_owned();
                if let ProtocolPayload::Http(ref mut payload) = envelope.payload {
                    payload.body = Some(text);
                }
            }
        }
        Ok(())
    }

    pub fn save_request(
        &self,
        envelope: &RequestEnvelope,
        project_id: &str,
        collection_id: &str,
    ) -> StoreResult<StoredRequest> {
        let mut envelope = envelope.clone();
        let body_blob_id = self.externalize_http_body(&mut envelope)?;
        let id = envelope.id.0.to_string();
        let updated_at = Utc::now();
        let envelope_json = serde_json::to_string(&envelope)?;
        self.conn.execute(
            r#"
            INSERT INTO requests (id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at, body_blob_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
              project_id = excluded.project_id,
              collection_id = excluded.collection_id,
              name = excluded.name,
              protocol_id = excluded.protocol_id,
              target = excluded.target,
              envelope_json = excluded.envelope_json,
              updated_at = excluded.updated_at,
              body_blob_id = excluded.body_blob_id
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
                body_blob_id,
            ],
        )?;

        let mut hydrated = envelope;
        self.hydrate_http_body(&mut hydrated, body_blob_id.as_deref())?;
        Ok(StoredRequest {
            id: hydrated.id.0.to_string(),
            project_id: project_id.into(),
            collection_id: collection_id.into(),
            name: hydrated.name.clone(),
            protocol_id: hydrated.protocol_id.0.clone(),
            target: hydrated.target.clone(),
            envelope: hydrated,
            updated_at,
            body_blob_id,
        })
    }

    pub fn get_request(&self, id: &RequestId) -> StoreResult<Option<StoredRequest>> {
        self.conn
            .query_row(
                r#"
                SELECT id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at, body_blob_id
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
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .optional()?
            .map(
                |(
                    id,
                    project_id,
                    collection_id,
                    name,
                    protocol_id,
                    target,
                    envelope_json,
                    updated_at,
                    body_blob_id,
                )| {
                    let mut envelope: RequestEnvelope = serde_json::from_str(&envelope_json)?;
                    self.hydrate_http_body(&mut envelope, body_blob_id.as_deref())?;
                    Ok(StoredRequest {
                        id,
                        project_id,
                        collection_id,
                        name,
                        protocol_id,
                        target,
                        envelope,
                        updated_at: parse_time(&updated_at),
                        body_blob_id,
                    })
                },
            )
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
                SELECT id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at, body_blob_id
                FROM requests WHERE collection_id = ?1 ORDER BY updated_at DESC
                "#,
            )?
        } else {
            self.conn.prepare(
                r#"
                SELECT id, project_id, collection_id, name, protocol_id, target, envelope_json, updated_at, body_blob_id
                FROM requests ORDER BY updated_at DESC
                "#,
            )?
        };

        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<(
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
        )> {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ))
        };

        let rows = if let Some(cid) = collection_id {
            stmt.query_map(params![cid], map_row)?
        } else {
            stmt.query_map([], map_row)?
        };

        let mut out = Vec::new();
        for row in rows {
            let (
                id,
                project_id,
                collection_id,
                name,
                protocol_id,
                target,
                envelope_json,
                updated_at,
                body_blob_id,
            ) = row?;
            let mut envelope: RequestEnvelope = serde_json::from_str(&envelope_json)?;
            self.hydrate_http_body(&mut envelope, body_blob_id.as_deref())?;
            out.push(StoredRequest {
                id,
                project_id,
                collection_id,
                name,
                protocol_id,
                target,
                envelope,
                updated_at: parse_time(&updated_at),
                body_blob_id,
            });
        }
        Ok(out)
    }

    pub fn record_execution(&self, record: &ExecutionRecord) -> StoreResult<()> {
        let mut snapshot = record.request_snapshot.clone();
        let mut body_blob_id = None;
        if let Some(ref mut env) = snapshot {
            body_blob_id = self.externalize_http_body(env)?;
        }
        let snapshot_json = snapshot.as_ref().map(serde_json::to_string).transpose()?;

        let mut preview = record.preview.clone();
        let mut response_blob_id = record.response_blob_id.clone();
        if response_blob_id.is_none() {
            if let Some(ref p) = preview {
                if p.len() > BLOB_THRESHOLD_BYTES {
                    let blob = self.put_blob(p.as_bytes(), Some("text/plain"))?;
                    response_blob_id = Some(blob.id);
                    preview = Some(p.chars().take(4096).collect());
                }
            }
        }

        // Keep body_blob_id linked via snapshot marker; column reserved for response.
        let _ = body_blob_id;

        self.conn.execute(
            r#"
            INSERT INTO executions
              (id, request_id, protocol_id, state, status, duration_ms, bytes_received,
               started_at, finished_at, request_snapshot_json, preview, response_blob_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
                snapshot_json,
                preview,
                response_blob_id,
            ],
        )?;
        Ok(())
    }

    pub fn list_executions(&self, limit: usize) -> StoreResult<Vec<ExecutionRecord>> {
        self.list_executions_filtered(limit, &ExecutionFilter::default())
    }

    pub fn list_executions_filtered(
        &self,
        limit: usize,
        filter: &ExecutionFilter,
    ) -> StoreResult<Vec<ExecutionRecord>> {
        let mut sql = String::from(
            r#"
            SELECT id, request_id, protocol_id, state, status, duration_ms, bytes_received,
                   started_at, finished_at, request_snapshot_json, preview, response_blob_id
            FROM executions
            WHERE 1=1
            "#,
        );
        let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref request_id) = filter.request_id {
            sql.push_str(" AND request_id = ?");
            binds.push(Box::new(request_id.clone()));
        }
        if let Some(ref state) = filter.state {
            sql.push_str(" AND state = ?");
            binds.push(Box::new(state.clone()));
        }
        if let Some(ref protocol_id) = filter.protocol_id {
            sql.push_str(" AND protocol_id = ?");
            binds.push(Box::new(protocol_id.clone()));
        }
        if let Some(status) = filter.status {
            sql.push_str(" AND status = ?");
            binds.push(Box::new(status as i64));
        }
        sql.push_str(" ORDER BY started_at DESC LIMIT ?");
        binds.push(Box::new(limit as i64));

        let mut stmt = self.conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
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
                row.get::<_, Option<String>>(11)?,
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
                response_blob_id,
            ) = row?;
            let mut request_snapshot: Option<RequestEnvelope> = snapshot
                .as_deref()
                .map(serde_json::from_str)
                .transpose()?;
            if let Some(ref mut env) = request_snapshot {
                self.hydrate_http_body(env, None)?;
            }
            let preview = self.resolve_preview(preview, response_blob_id.as_deref())?;
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
                response_blob_id,
            });
        }
        Ok(out)
    }

    fn resolve_preview(
        &self,
        preview: Option<String>,
        response_blob_id: Option<&str>,
    ) -> StoreResult<Option<String>> {
        if let Some(id) = response_blob_id {
            if let Ok(bytes) = self.read_blob(id) {
                return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()));
            }
        }
        Ok(preview)
    }

    pub fn get_execution(&self, id: &str) -> StoreResult<Option<ExecutionRecord>> {
        self.conn
            .query_row(
                r#"
                SELECT id, request_id, protocol_id, state, status, duration_ms, bytes_received,
                       started_at, finished_at, request_snapshot_json, preview, response_blob_id
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
                        row.get::<_, Option<String>>(11)?,
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
                    response_blob_id,
                )| {
                    let mut request_snapshot: Option<RequestEnvelope> = snapshot
                        .as_deref()
                        .map(serde_json::from_str)
                        .transpose()?;
                    if let Some(ref mut env) = request_snapshot {
                        self.hydrate_http_body(env, None)?;
                    }
                    let preview = self.resolve_preview(preview, response_blob_id.as_deref())?;
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
                        response_blob_id,
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

fn hex_sha256(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    digest.iter().map(|b| format!("{b:02x}")).collect()
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
            response_blob_id: None,
        };
        store.record_execution(&record).expect("record");
        let list = store.list_executions(10).expect("list");
        assert_eq!(list.len(), 1);
        assert!(list[0].request_snapshot.is_some());
        assert_eq!(list[0].preview.as_deref(), Some("hi"));
    }

    #[test]
    fn workspace_and_blob_externalization() {
        let store = LocalStore::open_in_memory().expect("open");
        let ws = store.default_workspace().expect("workspace");
        assert_eq!(ws.id, "default-workspace");

        let large = "x".repeat(BLOB_THRESHOLD_BYTES + 10);
        let mut req = RequestEnvelope::http_get("big", "https://example.com");
        req.payload = ProtocolPayload::Http(HttpPayload {
            method: "POST".into(),
            headers: vec![],
            body: Some(large.clone()),
            follow_redirects: true,
        });
        let saved = store
            .save_request(&req, "default-project", "default-collection")
            .expect("save");
        assert!(saved.body_blob_id.is_some());
        match &saved.envelope.payload {
            ProtocolPayload::Http(p) => assert_eq!(p.body.as_deref(), Some(large.as_str())),
            _ => panic!("expected http"),
        }

        let blob_id = saved.body_blob_id.clone().unwrap();
        let bytes = store.read_blob(&blob_id).expect("read blob");
        assert_eq!(bytes, large.as_bytes());

        let failed = ExecutionRecord {
            id: Uuid::new_v4().to_string(),
            request_id: req.id.0.to_string(),
            protocol_id: "http".into(),
            state: "failed".into(),
            status: Some(500),
            duration_ms: 1,
            bytes_received: 0,
            started_at: Utc::now(),
            finished_at: Utc::now(),
            request_snapshot: None,
            preview: None,
            response_blob_id: None,
        };
        store.record_execution(&failed).expect("record failed");
        let filtered = store
            .list_executions_filtered(
                10,
                &ExecutionFilter {
                    state: Some("failed".into()),
                    ..Default::default()
                },
            )
            .expect("filter");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].state, "failed");
    }
}
