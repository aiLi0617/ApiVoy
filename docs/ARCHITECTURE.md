# ApiVoy Architecture

This document describes how Desktop, Web, Local Agent, CLI, and optional self-hosted services fit together.

## Components

| Component | Binary / app | Role |
|-----------|--------------|------|
| Desktop | `apivoy` | Tauri shell + shared React UI; may bundle Agent as sidecar |
| Web | browser | Shared React UI; restricted protocols via Local Agent |
| Local Agent | `apivoy-agent` | Headless HTTP API on loopback; executes all protocol drivers |
| CLI | `apivoy-cli` | In-process execution for automation and CI |
| Collaboration server | Java Spring Boot | Optional team sync, OIDC, comments (self-hosted) |
| Protocol gateway | `apivoy-gateway` | Optional remote execution scheduler (self-hosted) |

All execution paths share the same Rust **protocol core**: `core-domain`, `execution-engine`, and per-protocol drivers under `crates/driver-*`.

## Execution flow

```text
User edits request in UI or CLI
  → RequestEnvelope + VariableScope + auth/secret resolution
  → ExecutionEngine (Driver SPI)
  → Protocol driver (HTTP, gRPC, MQTT, …)
  → ExecutionEvent stream (headers, chunks, complete, errors)
  → Response workbench + history persistence
```

### Desktop

Tauri invokes Rust commands directly or spawns/bundles `apivoy-agent`. SQLite and blob storage live under the user config directory (`.apivoy`).

### Web + Agent

The Web app talks to Agent at `127.0.0.1:39217` with Bearer token and Origin checks. Pairing exchanges a long-lived token for session tokens.

### CLI

`apivoy-cli` registers the same drivers in-process. Collections run sequentially or concurrently with structured exit codes and optional JUnit/JSON reports.

## Data storage

| Data | Location |
|------|----------|
| Workspace metadata | SQLite (`crates/local-store`) |
| Large response bodies | External blob files indexed in SQLite |
| Secrets | OS keychain (Desktop) or Agent secret store; projects store `secret_ref` only |
| Drafts | Browser localStorage / Desktop local store |
| Capture records | In-memory ring buffer (not persisted by default) |

Git-friendly exports use `*.apivoy.json` project packages alongside SQLite.

## Secret flow

1. User stores a value via UI → keychain / Agent `PUT /v1/secrets`.
2. Project/environment JSON references `secret_ref` (never the plaintext).
3. At execution time the engine resolves refs into `runtime_secrets` in memory only.
4. Events and exports apply masking for sensitive header names and scanned fields.

## Plugin boundary

Third-party extensions are **WASM Components only** (`plugins/sdk/apivoy-plugin.wit`). The host (`crates/plugin-runtime`):

- Validates SHA-256 and optional Ed25519 publisher signatures
- Enforces memory/fuel limits and declared permissions
- Exposes transformer, protocol, auth, and importer entry points

QuickJS scripts run in a separate sandbox with timeout and memory caps for HTTP pre/post hooks.

## Local vs hosted boundary

Everything in this repository is Apache-2.0, including optional self-hosted collaboration and protocol gateway.

**Future hosted cloud services** (if offered) would be developed and operated separately and are **not** part of this repository.

## Related documents

- [THREAT_MODEL.md](./THREAT_MODEL.md)
- [TRAFFIC_CAPTURE.md](./TRAFFIC_CAPTURE.md)
- [adr/0002-desktop-agent-dual-binary.md](./adr/0002-desktop-agent-dual-binary.md)
- [deploy/README.md](../deploy/README.md)
