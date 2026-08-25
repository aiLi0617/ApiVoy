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

type StoredRequestRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub root_path: Option<String>,
    pub settings: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRecord {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRecord { pub id:String, pub project_id:String, pub name:String, pub language:String, pub source:String, pub created_at:DateTime<Utc>, pub updated_at:DateTime<Utc> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDefinitionRecord {
    pub id: String,
    pub project_id: String,
    pub module_id: Option<String>,
    pub name: String,
    /// OpenAPI, AsyncAPI, Protobuf, GraphQL SDL, WSDL, SQL DDL, or another future adapter id.
    pub format: String,
    pub file_name: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestDefinitionBinding {
    pub request_id: String,
    pub definition_id: String,
    /// Adapter-specific operation locator, for example `GET /users` or `UserService.GetUser`.
    pub operation_ref: Option<String>,
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
              created_at TEXT NOT NULL,
              parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
              sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS modules (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              is_default INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS modules_one_default_per_project
              ON modules(project_id) WHERE is_default = 1;

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
            CREATE TABLE IF NOT EXISTS scripts (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              language TEXT NOT NULL CHECK(language IN ('javascript','typescript')),
              source TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS api_definitions (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
              name TEXT NOT NULL,
              format TEXT NOT NULL,
              file_name TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS api_definitions_project_idx
              ON api_definitions(project_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS request_definition_bindings (
              request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
              definition_id TEXT NOT NULL REFERENCES api_definitions(id) ON DELETE CASCADE,
              operation_ref TEXT,
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
        let _ = self.conn.execute(
            "ALTER TABLE executions ADD COLUMN request_snapshot_json TEXT",
            [],
        );
        let _ = self
            .conn
            .execute("ALTER TABLE executions ADD COLUMN preview TEXT", []);
        let _ = self.conn.execute(
            "ALTER TABLE executions ADD COLUMN response_blob_id TEXT",
            [],
        );
        let _ = self
            .conn
            .execute("ALTER TABLE requests ADD COLUMN body_blob_id TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE projects ADD COLUMN workspace_id TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE collections ADD COLUMN parent_id TEXT", []);
        let _ = self.conn.execute(
            "ALTER TABLE collections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE workspaces ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE collections ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
            [],
        );
        let _ = self.conn.execute("ALTER TABLE collections ADD COLUMN module_id TEXT", []);

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
        self.ensure_project_modules(&now)?;
        // Backfill workspace_id for projects created before the column existed.
        let _ = self.conn.execute(
            "UPDATE projects SET workspace_id = ?1 WHERE workspace_id IS NULL",
            params!["default-workspace"],
        );
        self.conn.execute(
            "INSERT OR IGNORE INTO collections (id, project_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params!["default-collection", "default-project", "Default Collection", now],
        )?;
        let _ = self.conn.execute(
            "UPDATE collections SET module_id = 'default-module' WHERE project_id = 'default-project' AND module_id IS NULL",
            [],
        );
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

    fn ensure_project_modules(&self, now: &str) -> StoreResult<()> {
        let mut stmt = self.conn.prepare("SELECT id FROM projects")?;
        let project_ids = stmt.query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for project_id in project_ids {
            let module_id = if project_id == "default-project" { "default-module".to_string() } else { format!("default-module-{project_id}") };
            self.conn.execute(
                "INSERT OR IGNORE INTO modules (id, project_id, name, is_default, created_at) VALUES (?1, ?2, '默认模块', 1, ?3)",
                params![module_id, project_id, now],
            )?;
            self.conn.execute(
                "UPDATE collections SET module_id = ?1 WHERE project_id = ?2 AND module_id IS NULL",
                params![module_id, project_id],
            )?;
        }
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
                SELECT id, name, root_path, settings_json, created_at, updated_at, archived
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
                        row.get::<_, bool>(6)?,
                    ))
                },
            )
            .optional()?
            .map(
                |(id, name, root_path, settings_json, created_at, updated_at, archived)| {
                    Ok(WorkspaceRecord {
                        id,
                        name,
                        root_path,
                        settings: serde_json::from_str(&settings_json)
                            .unwrap_or_else(|_| serde_json::json!({})),
                        created_at: parse_time(&created_at),
                        updated_at: parse_time(&updated_at),
                        archived,
                    })
                },
            )
            .transpose()
    }

    pub fn list_workspaces(&self) -> StoreResult<Vec<WorkspaceRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, name, root_path, settings_json, created_at, updated_at, archived
            FROM workspaces ORDER BY archived ASC, updated_at DESC
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
                row.get::<_, bool>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, name, root_path, settings_json, created_at, updated_at, archived) = row?;
            out.push(WorkspaceRecord {
                id,
                name,
                root_path,
                settings: serde_json::from_str(&settings_json)
                    .unwrap_or_else(|_| serde_json::json!({})),
                created_at: parse_time(&created_at),
                updated_at: parse_time(&updated_at),
                archived,
            });
        }
        Ok(out)
    }

    pub fn save_workspace(&self, ws: &WorkspaceRecord) -> StoreResult<()> {
        let settings_json = serde_json::to_string(&ws.settings)?;
        self.conn.execute(
            r#"
            INSERT INTO workspaces (id, name, root_path, settings_json, created_at, updated_at, archived)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              root_path = excluded.root_path,
              settings_json = excluded.settings_json,
              updated_at = excluded.updated_at,
              archived = excluded.archived
            "#,
            params![
                ws.id,
                ws.name,
                ws.root_path,
                settings_json,
                ws.created_at.to_rfc3339(),
                ws.updated_at.to_rfc3339(),
                ws.archived,
            ],
        )?;
        Ok(())
    }

    pub fn create_workspace(
        &self,
        name: &str,
        root_path: Option<String>,
    ) -> StoreResult<WorkspaceRecord> {
        let name = name.trim();
        if name.is_empty() {
            return Err(StoreError::InvalidId("workspace name is required".into()));
        }
        let now = Utc::now();
        let record = WorkspaceRecord {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            root_path,
            settings: serde_json::json!({}),
            created_at: now,
            updated_at: now,
            archived: false,
        };
        self.save_workspace(&record)?;
        Ok(record)
    }

    pub fn rename_workspace(&self, id: &str, name: &str) -> StoreResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(StoreError::InvalidId("workspace name is required".into()));
        }
        let changed = self.conn.execute(
            "UPDATE workspaces SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, Utc::now().to_rfc3339()],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn touch_workspace(&self, id: &str) -> StoreResult<()> {
        let changed = self.conn.execute(
            "UPDATE workspaces SET updated_at = ?2 WHERE id = ?1",
            params![id, Utc::now().to_rfc3339()],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn archive_workspace(&self, id: &str, archived: bool) -> StoreResult<()> {
        if id == "default-workspace" && archived {
            return Err(StoreError::InvalidId(
                "default workspace cannot be archived".into(),
            ));
        }
        let changed = self.conn.execute(
            "UPDATE workspaces SET archived = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, archived, Utc::now().to_rfc3339()],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn delete_workspace(&self, id: &str) -> StoreResult<()> {
        if id == "default-workspace" {
            return Err(StoreError::InvalidId(
                "default workspace cannot be deleted".into(),
            ));
        }
        for project in self.list_projects(id)? {
            self.delete_project(&project.id)?;
        }
        let changed = self
            .conn
            .execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn create_project(&self, workspace_id: &str, name: &str) -> StoreResult<ProjectRecord> {
        if self.get_workspace(workspace_id)?.is_none() {
            return Err(StoreError::NotFound(workspace_id.into()));
        }
        let record = ProjectRecord {
            id: Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            name: name.trim().to_string(),
            created_at: Utc::now(),
        };
        if record.name.is_empty() {
            return Err(StoreError::InvalidId("project name is required".into()));
        }
        self.conn.execute(
            "INSERT INTO projects (id, name, created_at, workspace_id) VALUES (?1, ?2, ?3, ?4)",
            params![
                record.id,
                record.name,
                record.created_at.to_rfc3339(),
                record.workspace_id
            ],
        )?;
        let module_id = format!("default-module-{}", record.id);
        self.conn.execute(
            "INSERT INTO modules (id, project_id, name, is_default, created_at) VALUES (?1, ?2, '默认模块', 1, ?3)",
            params![module_id, record.id, record.created_at.to_rfc3339()],
        )?;
        Ok(record)
    }

    pub fn create_module(&self, project_id: &str, name: &str) -> StoreResult<ModuleRecord> {
        if name.trim().is_empty() {
            return Err(StoreError::InvalidId("module name is required".into()));
        }
        let record = ModuleRecord {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.into(),
            name: name.trim().into(),
            is_default: false,
            created_at: Utc::now(),
        };
        self.conn.execute(
            "INSERT INTO modules (id, project_id, name, is_default, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
            params![record.id, record.project_id, record.name, record.created_at.to_rfc3339()],
        )?;
        Ok(record)
    }

    pub fn list_modules(&self, project_id: &str) -> StoreResult<Vec<ModuleRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, name, is_default, created_at FROM modules WHERE project_id = ?1 ORDER BY is_default DESC, created_at, name",
        )?;
        let rows = stmt.query_map(params![project_id], |row| Ok(ModuleRecord {
            id: row.get(0)?, project_id: row.get(1)?, name: row.get(2)?,
            is_default: row.get::<_, i64>(3)? != 0,
            created_at: parse_time(&row.get::<_, String>(4)?),
        }))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_projects(&self, workspace_id: &str) -> StoreResult<Vec<ProjectRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, name, created_at FROM projects WHERE workspace_id = ?1 ORDER BY created_at, name",
        )?;
        let rows = stmt.query_map(params![workspace_id], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                created_at: parse_time(&row.get::<_, String>(3)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn rename_project(&self, id: &str, name: &str) -> StoreResult<()> {
        if name.trim().is_empty() {
            return Err(StoreError::InvalidId("project name is required".into()));
        }
        let changed = self.conn.execute(
            "UPDATE projects SET name = ?2 WHERE id = ?1",
            params![id, name.trim()],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> StoreResult<()> {
        if id == "default-project" {
            return Err(StoreError::InvalidId(
                "default project cannot be deleted".into(),
            ));
        }
        let changed = self
            .conn
            .execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn create_collection(
        &self,
        project_id: &str,
        parent_id: Option<&str>,
        name: &str,
    ) -> StoreResult<CollectionRecord> {
        self.create_collection_in_module(project_id, None, parent_id, name)
    }

    pub fn create_collection_in_module(
        &self,
        project_id: &str,
        requested_module_id: Option<&str>,
        parent_id: Option<&str>,
        name: &str,
    ) -> StoreResult<CollectionRecord> {
        if name.trim().is_empty() {
            return Err(StoreError::InvalidId("collection name is required".into()));
        }
        if let Some(parent) = parent_id {
            let valid_parent: Option<String> = self
                .conn
                .query_row(
                    "SELECT id FROM collections WHERE id = ?1 AND project_id = ?2",
                    params![parent, project_id],
                    |row| row.get(0),
                )
                .optional()?;
            if valid_parent.is_none() {
                return Err(StoreError::NotFound(parent.into()));
            }
        }
        let sort_order: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM collections WHERE project_id = ?1 AND parent_id IS ?2",
            params![project_id, parent_id], |row| row.get(0),
        )?;
        let module_id: String = if let Some(parent_id) = parent_id {
            self.conn.query_row(
                "SELECT module_id FROM collections WHERE id = ?1 AND project_id = ?2",
                params![parent_id, project_id], |row| row.get(0),
            )?
        } else if let Some(module_id) = requested_module_id {
            self.conn.query_row(
                "SELECT id FROM modules WHERE id = ?1 AND project_id = ?2",
                params![module_id, project_id], |row| row.get(0),
            ).optional()?.ok_or_else(|| StoreError::NotFound(module_id.into()))?
        } else {
            self.conn.query_row(
                "SELECT id FROM modules WHERE project_id = ?1 AND is_default = 1",
                params![project_id], |row| row.get(0),
            )?
        };
        let record = CollectionRecord {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.into(),
            module_id,
            name: name.trim().into(),
            parent_id: parent_id.map(Into::into),
            sort_order,
            tags: vec![],
            created_at: Utc::now(),
        };
        self.conn.execute(
            "INSERT INTO collections (id, project_id, module_id, name, created_at, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![record.id, record.project_id, record.module_id, record.name, record.created_at.to_rfc3339(), record.parent_id, record.sort_order],
        )?;
        Ok(record)
    }

    pub fn list_collections(&self, project_id: &str) -> StoreResult<Vec<CollectionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, module_id, name, parent_id, sort_order, created_at, tags_json FROM collections WHERE project_id = ?1 ORDER BY parent_id, sort_order, name",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(CollectionRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                module_id: row.get(2)?,
                name: row.get(3)?,
                parent_id: row.get(4)?,
                sort_order: row.get(5)?,
                created_at: parse_time(&row.get::<_, String>(6)?),
                tags: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn update_collection(
        &self,
        id: &str,
        name: &str,
        parent_id: Option<&str>,
        sort_order: i64,
    ) -> StoreResult<()> {
        if name.trim().is_empty() || parent_id == Some(id) {
            return Err(StoreError::InvalidId(
                "invalid collection name or parent".into(),
            ));
        }
        if let Some(parent_id) = parent_id {
            let mut cursor = parent_id.to_string();
            let project_id: String = self
                .conn
                .query_row(
                    "SELECT project_id FROM collections WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| StoreError::NotFound(id.into()))?;
            loop {
                if cursor == id {
                    return Err(StoreError::InvalidId(
                        "collection cycle is not allowed".into(),
                    ));
                }
                let parent: Option<(String, Option<String>)> = self
                    .conn
                    .query_row(
                        "SELECT project_id, parent_id FROM collections WHERE id = ?1",
                        params![&cursor],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?;
                let Some((parent_project, next)) = parent else {
                    return Err(StoreError::NotFound(cursor));
                };
                if parent_project != project_id {
                    return Err(StoreError::InvalidId(
                        "parent must belong to the same project".into(),
                    ));
                }
                let Some(next) = next else {
                    break;
                };
                cursor = next;
            }
        }
        let changed = self.conn.execute(
            "UPDATE collections SET name = ?2, parent_id = ?3, sort_order = ?4 WHERE id = ?1",
            params![id, name.trim(), parent_id, sort_order.max(0)],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn update_collection_tags(&self, id: &str, tags: &[String]) -> StoreResult<()> {
        let tags = tags
            .iter()
            .map(|tag| tag.trim())
            .filter(|tag| !tag.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        let changed = self.conn.execute(
            "UPDATE collections SET tags_json = ?2 WHERE id = ?1",
            params![id, serde_json::to_string(&tags)?],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn delete_collection(&self, id: &str) -> StoreResult<()> {
        if id == "default-collection" {
            return Err(StoreError::InvalidId(
                "default collection cannot be deleted".into(),
            ));
        }
        let changed = self
            .conn
            .execute("DELETE FROM collections WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.into()));
        }
        Ok(())
    }

    pub fn delete_request(&self, id: &RequestId) -> StoreResult<()> {
        let changed = self.conn.execute(
            "DELETE FROM requests WHERE id = ?1",
            params![id.0.to_string()],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.0.to_string()));
        }
        Ok(())
    }

    pub fn move_request(
        &self,
        id: &RequestId,
        project_id: &str,
        collection_id: &str,
    ) -> StoreResult<()> {
        let collection_project: Option<String> = self
            .conn
            .query_row(
                "SELECT project_id FROM collections WHERE id = ?1",
                params![collection_id],
                |row| row.get(0),
            )
            .optional()?;
        if collection_project.as_deref() != Some(project_id) {
            return Err(StoreError::InvalidId(
                "target collection does not belong to project".into(),
            ));
        }
        let changed = self.conn.execute(
            "UPDATE requests SET project_id = ?2, collection_id = ?3, updated_at = ?4 WHERE id = ?1",
            params![id.0.to_string(), project_id, collection_id, Utc::now().to_rfc3339()],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.0.to_string()));
        }
        Ok(())
    }

    pub fn save_api_definition(&self, definition: &ApiDefinitionRecord) -> StoreResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO api_definitions
              (id, project_id, module_id, name, format, file_name, content, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
              project_id = excluded.project_id,
              module_id = excluded.module_id,
              name = excluded.name,
              format = excluded.format,
              file_name = excluded.file_name,
              content = excluded.content,
              updated_at = excluded.updated_at
            "#,
            params![
                definition.id,
                definition.project_id,
                definition.module_id,
                definition.name,
                definition.format,
                definition.file_name,
                definition.content,
                definition.created_at.to_rfc3339(),
                definition.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_api_definitions(&self, project_id: &str) -> StoreResult<Vec<ApiDefinitionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, module_id, name, format, file_name, content, created_at, updated_at FROM api_definitions WHERE project_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ApiDefinitionRecord {
                id: row.get(0)?, project_id: row.get(1)?, module_id: row.get(2)?,
                name: row.get(3)?, format: row.get(4)?, file_name: row.get(5)?, content: row.get(6)?,
                created_at: parse_time(&row.get::<_, String>(7)?),
                updated_at: parse_time(&row.get::<_, String>(8)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StoreError::from)
    }

    pub fn get_api_definition(&self, id: &str) -> StoreResult<Option<ApiDefinitionRecord>> {
        self.conn.query_row(
            "SELECT id, project_id, module_id, name, format, file_name, content, created_at, updated_at FROM api_definitions WHERE id = ?1",
            params![id],
            |row| Ok(ApiDefinitionRecord {
                id: row.get(0)?, project_id: row.get(1)?, module_id: row.get(2)?,
                name: row.get(3)?, format: row.get(4)?, file_name: row.get(5)?, content: row.get(6)?,
                created_at: parse_time(&row.get::<_, String>(7)?),
                updated_at: parse_time(&row.get::<_, String>(8)?),
            }),
        ).optional().map_err(StoreError::from)
    }

    pub fn delete_api_definition(&self, id: &str) -> StoreResult<()> {
        let changed = self.conn.execute("DELETE FROM api_definitions WHERE id = ?1", params![id])?;
        if changed == 0 { return Err(StoreError::NotFound(id.into())); }
        Ok(())
    }

    pub fn bind_request_definition(&self, binding: &RequestDefinitionBinding) -> StoreResult<()> {
        self.conn.execute(
            r#"INSERT INTO request_definition_bindings (request_id, definition_id, operation_ref, updated_at)
               VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT(request_id) DO UPDATE SET definition_id = excluded.definition_id, operation_ref = excluded.operation_ref, updated_at = excluded.updated_at"#,
            params![binding.request_id, binding.definition_id, binding.operation_ref, binding.updated_at.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn get_request_definition_binding(&self, request_id: &str) -> StoreResult<Option<RequestDefinitionBinding>> {
        self.conn.query_row(
            "SELECT request_id, definition_id, operation_ref, updated_at FROM request_definition_bindings WHERE request_id = ?1",
            params![request_id],
            |row| Ok(RequestDefinitionBinding { request_id: row.get(0)?, definition_id: row.get(1)?, operation_ref: row.get(2)?, updated_at: parse_time(&row.get::<_, String>(3)?) }),
        ).optional().map_err(StoreError::from)
    }

    pub fn unbind_request_definition(&self, request_id: &str) -> StoreResult<()> {
        self.conn.execute("DELETE FROM request_definition_bindings WHERE request_id = ?1", params![request_id])?;
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
        let relative_path = format!("{}/{}", &sha[..2], sha);
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
        self.get_blob(&id)?.ok_or_else(|| StoreError::NotFound(id))
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

    fn externalize_http_body(&self, envelope: &mut RequestEnvelope) -> StoreResult<Option<String>> {
        let ProtocolPayload::Http(HttpPayload {
            body: Some(body), ..
        }) = &envelope.payload
        else {
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

        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<StoredRequestRow> {
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
            let mut request_snapshot: Option<RequestEnvelope> =
                snapshot.as_deref().map(serde_json::from_str).transpose()?;
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
                    let mut request_snapshot: Option<RequestEnvelope> =
                        snapshot.as_deref().map(serde_json::from_str).transpose()?;
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
            .map(
                |(id, project_id, name, variables_json, secret_refs_json, updated_at)| {
                    Ok(EnvironmentRecord {
                        id,
                        project_id,
                        name,
                        variables: serde_json::from_str(&variables_json)?,
                        secret_refs: serde_json::from_str(&secret_refs_json)?,
                        updated_at: parse_time(&updated_at),
                    })
                },
            )
            .transpose()
    }

    pub fn list_environments(&self, project_id: Option<&str>) -> StoreResult<Vec<EnvironmentRecord>> {
        let mut statement = self.conn.prepare(if project_id.is_some() {
            "SELECT id, project_id, name, variables_json, secret_refs_json, updated_at FROM environments WHERE project_id = ?1 ORDER BY name COLLATE NOCASE"
        } else {
            "SELECT id, project_id, name, variables_json, secret_refs_json, updated_at FROM environments ORDER BY name COLLATE NOCASE"
        })?;
        let read = |row: &rusqlite::Row<'_>| -> rusqlite::Result<(String,String,String,String,String,String)> { Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)) };
        let rows = if let Some(id) = project_id { statement.query_map(params![id], read)? } else { statement.query_map([], read)? };
        rows.map(|row| { let (id, project_id, name, variables, secrets, updated_at) = row?; Ok(EnvironmentRecord { id, project_id, name, variables: serde_json::from_str(&variables)?, secret_refs: serde_json::from_str(&secrets)?, updated_at: parse_time(&updated_at) }) }).collect()
    }

    pub fn delete_environment(&self, id: &str) -> StoreResult<()> {
        if id == "default-env" { return Err(StoreError::InvalidId("default-env cannot be deleted".into())); }
        self.conn.execute("DELETE FROM environments WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn default_environment(&self) -> StoreResult<EnvironmentRecord> {
        self.get_environment("default-env")?
            .ok_or_else(|| StoreError::NotFound("default-env".into()))
    }

    pub fn save_script(&self, item:&ScriptRecord)->StoreResult<()> { self.conn.execute("INSERT INTO scripts(id,project_id,name,language,source,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,name=excluded.name,language=excluded.language,source=excluded.source,updated_at=excluded.updated_at",params![item.id,item.project_id,item.name,item.language,item.source,item.created_at.to_rfc3339(),item.updated_at.to_rfc3339()])?;Ok(()) }
    pub fn list_scripts(&self,project_id:&str)->StoreResult<Vec<ScriptRecord>> { let mut statement=self.conn.prepare("SELECT id,project_id,name,language,source,created_at,updated_at FROM scripts WHERE project_id=?1 ORDER BY name COLLATE NOCASE")?;let items=statement.query_map(params![project_id],|row|Ok(ScriptRecord{id:row.get(0)?,project_id:row.get(1)?,name:row.get(2)?,language:row.get(3)?,source:row.get(4)?,created_at:parse_time(&row.get::<_,String>(5)?),updated_at:parse_time(&row.get::<_,String>(6)?)}))?.collect::<Result<Vec<_>,_>>()?;Ok(items) }
    pub fn get_script(&self,id:&str)->StoreResult<Option<ScriptRecord>> { self.conn.query_row("SELECT id,project_id,name,language,source,created_at,updated_at FROM scripts WHERE id=?1",params![id],|row|Ok(ScriptRecord{id:row.get(0)?,project_id:row.get(1)?,name:row.get(2)?,language:row.get(3)?,source:row.get(4)?,created_at:parse_time(&row.get::<_,String>(5)?),updated_at:parse_time(&row.get::<_,String>(6)?)})).optional().map_err(StoreError::from) }
    pub fn delete_script(&self,id:&str)->StoreResult<()> { self.conn.execute("DELETE FROM scripts WHERE id=?1",params![id])?;Ok(()) }
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
    fn api_definition_and_request_binding_roundtrip() {
        let store = LocalStore::open_in_memory().expect("open");
        let request = RequestEnvelope::http_get("users", "https://example.com/users");
        store.save_request(&request, "default-project", "default-collection").expect("save request");
        let now = Utc::now();
        let definition = ApiDefinitionRecord {
            id: "definition-openapi".into(), project_id: "default-project".into(), module_id: None,
            name: "Users API".into(), format: "openapi".into(), file_name: "openapi.yaml".into(),
            content: "openapi: 3.1.0".into(), created_at: now, updated_at: now,
        };
        store.save_api_definition(&definition).expect("save definition");
        assert_eq!(store.list_api_definitions("default-project").unwrap().len(), 1);
        let binding = RequestDefinitionBinding {
            request_id: request.id.0.to_string(), definition_id: definition.id.clone(),
            operation_ref: Some("GET /users".into()), updated_at: now,
        };
        store.bind_request_definition(&binding).expect("bind");
        assert_eq!(store.get_request_definition_binding(&binding.request_id).unwrap().unwrap().operation_ref, binding.operation_ref);
        store.delete_api_definition(&definition.id).expect("delete definition");
        assert!(store.get_request_definition_binding(&binding.request_id).unwrap().is_none());
    }

    #[test]
    fn environment_and_script_resources_support_crud() {
        let store=LocalStore::open_in_memory().expect("open");
        let environments=store.list_environments(Some("default-project")).expect("list envs");
        assert!(environments.iter().any(|item| item.id=="default-env"));
        let now=Utc::now();let script=ScriptRecord{id:"script-test".into(),project_id:"default-project".into(),name:"Auth".into(),language:"typescript".into(),source:"const token: string = 'x';".into(),created_at:now,updated_at:now};
        store.save_script(&script).expect("save script");
        assert_eq!(store.list_scripts("default-project").expect("list scripts").len(),1);
        store.delete_script("script-test").expect("delete script");
        assert!(store.get_script("script-test").expect("get script").is_none());
    }

    #[test]
    fn save_and_reopen_http_request() {
        let store = LocalStore::open_in_memory().expect("open");
        let req = RequestEnvelope::http_get("sample", "https://example.com/api");
        let saved = store
            .save_request(&req, "default-project", "default-collection")
            .expect("save");
        assert_eq!(saved.target, "https://example.com/api");

        let loaded = store.get_request(&req.id).expect("get").expect("present");
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
            body_encoding: "text".into(),
            body_source: None,
            multipart: vec![],
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

        let large_response = "r".repeat(BLOB_THRESHOLD_BYTES + 32);
        let response_record = ExecutionRecord {
            id: Uuid::new_v4().to_string(),
            request_id: req.id.0.to_string(),
            protocol_id: "http".into(),
            state: "completed".into(),
            status: Some(200),
            duration_ms: 2,
            bytes_received: large_response.len() as u64,
            started_at: Utc::now(),
            finished_at: Utc::now(),
            request_snapshot: None,
            preview: Some(large_response.clone()),
            response_blob_id: None,
        };
        store
            .record_execution(&response_record)
            .expect("record response blob");
        let hydrated = store.get_execution(&response_record.id).unwrap().unwrap();
        let response_blob_id = hydrated.response_blob_id.expect("response blob id");
        assert_eq!(
            store.read_blob(&response_blob_id).unwrap(),
            large_response.as_bytes()
        );
    }

    #[test]
    fn workspace_crud_archive_and_recent_order() {
        let store = LocalStore::open_in_memory().unwrap();
        let first = store.create_workspace("First", None).unwrap();
        let second = store
            .create_workspace("Second", Some("C:/api".into()))
            .unwrap();
        store.rename_workspace(&first.id, "Renamed").unwrap();
        store.archive_workspace(&second.id, true).unwrap();
        assert!(
            store
                .list_workspaces()
                .unwrap()
                .iter()
                .find(|item| item.id == second.id)
                .unwrap()
                .archived
        );
        store.archive_workspace(&second.id, false).unwrap();
        store.touch_workspace(&first.id).unwrap();
        assert_eq!(store.list_workspaces().unwrap()[0].id, first.id);
        store.create_project(&second.id, "Nested").unwrap();
        store.delete_workspace(&second.id).unwrap();
        assert!(store.get_workspace(&second.id).unwrap().is_none());
    }

    #[test]
    fn collection_tags_are_persisted_and_normalized() {
        let store = LocalStore::open_in_memory().unwrap();
        let collection = store
            .create_collection("default-project", None, "Tagged")
            .unwrap();
        store
            .update_collection_tags(&collection.id, &[" smoke ".into(), "api".into(), "".into()])
            .unwrap();
        let saved = store
            .list_collections("default-project")
            .unwrap()
            .into_iter()
            .find(|item| item.id == collection.id)
            .unwrap();
        assert_eq!(saved.tags, vec!["smoke", "api"]);
    }

    #[test]
    fn projects_have_default_modules_and_collections_keep_module_scope() {
        let store = LocalStore::open_in_memory().unwrap();
        let project = store.create_project("default-workspace", "Orders").unwrap();
        let modules = store.list_modules(&project.id).unwrap();
        assert_eq!(modules.len(), 1);
        assert!(modules[0].is_default);

        let custom = store.create_module(&project.id, "Fulfillment").unwrap();
        let root = store.create_collection_in_module(&project.id, Some(&custom.id), None, "API").unwrap();
        let child = store.create_collection(&project.id, Some(&root.id), "Internal").unwrap();
        assert_eq!(root.module_id, custom.id);
        assert_eq!(child.module_id, custom.id);
    }

    #[test]
    fn project_collection_and_request_crud() {
        let store = LocalStore::open_in_memory().expect("open");
        let project = store
            .create_project("default-workspace", "Payments")
            .expect("project");
        let root = store
            .create_collection(&project.id, None, "API")
            .expect("root");
        let child = store
            .create_collection(&project.id, Some(&root.id), "Auth")
            .expect("child");
        assert_eq!(store.list_projects("default-workspace").unwrap().len(), 2);
        assert_eq!(store.list_collections(&project.id).unwrap().len(), 2);

        store
            .rename_project(&project.id, "Billing")
            .expect("rename project");
        store
            .update_collection(&child.id, "Login", None, 3)
            .expect("move collection");
        let moved = store
            .list_collections(&project.id)
            .unwrap()
            .into_iter()
            .find(|item| item.id == child.id)
            .unwrap();
        assert_eq!(moved.name, "Login");
        assert!(moved.parent_id.is_none());

        let request = RequestEnvelope::http_get("health", "https://example.com/health");
        store
            .save_request(&request, &project.id, &root.id)
            .expect("save request");
        assert_eq!(store.list_requests(Some(&root.id)).unwrap().len(), 1);
        store
            .move_request(&request.id, &project.id, &child.id)
            .expect("move request");
        assert!(store.list_requests(Some(&root.id)).unwrap().is_empty());
        assert_eq!(store.list_requests(Some(&child.id)).unwrap().len(), 1);
        store.delete_request(&request.id).expect("delete request");
        assert!(store.list_requests(Some(&root.id)).unwrap().is_empty());
        store
            .delete_collection(&child.id)
            .expect("delete collection");
        store.delete_project(&project.id).expect("delete project");
    }
}
