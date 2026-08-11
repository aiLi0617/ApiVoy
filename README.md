# ApiVoy

**Explore Every Protocol.**

A lightweight, local-first, multi-protocol API debugging client.

ApiVoy 多协议接口调试工具 — 轻量、本地优先、可扩展的多协议接口调试平台。

| | |
|---|---|
| Product | ApiVoy Multi-Protocol API Client |
| License | Apache-2.0 (core OSS) + commercial cloud closed-source |
| Slogan | Explore Every Protocol. / 探索每一种协议。 |
| Config dir | `.apivoy` |
| Workspace files | `*.apivoy.json` |
| Env prefix | `APIVOY_` |

## Binaries

| Artifact | Binary |
|----------|--------|
| Desktop | `apivoy` |
| Local Agent | `apivoy-agent` |
| CLI | `apivoy-cli` |
| Plugin SDK | `apivoy-plugin-sdk` |

Desktop and Agent share the same Rust protocol-core crates and release version, but ship as **two independent binaries**. Desktop may bundle Agent as a sidecar; Web users can install Agent alone.

## Repository layout

```text
apps/
  desktop/              # Tauri UI → binary: apivoy
  web/                  # Web workbench
  local-agent/          # binary: apivoy-agent
  cli/                  # binary: apivoy-cli
packages/
  ui/
  request-model/
  protocol-ui-sdk/
crates/                 # shared protocol core
plugins/
  sdk/                  # apivoy-plugin-sdk (WASM, P1)
services/
  collaboration-server/ # Java 21 + Spring Boot + Gradle (P2, commercial)
docs/
```

## Quick start

```bash
pnpm install
cargo check --workspace

# CLI
cargo run -p apivoy-cli -- http-get https://example.com

# Local Agent + Web
cargo run -p apivoy-local-agent
pnpm dev:web

# Desktop
pnpm dev:desktop
```

Formal Agent execution path (Phase 0): `POST /v1/executions` → `GET /v1/executions/{id}/events` (SSE) → optional `POST .../cancel`.  
Smoke checklist: [`docs/SMOKE_CHECKLIST.md`](docs/SMOKE_CHECKLIST.md).

## Phase focus

- **P0 / MVP**: local-first Desktop + Web + Agent; seven protocols; no cloud sync
- **P1**: WASM plugins, QuickJS scripts, MQ/DB drivers, Mock, CLI automation
- **P2**: OIDC/team collaboration and a complete private Docker deployment under [`deploy/`](./deploy/README.md)

The Web and Desktop apps also include a local-first AI workbench. It supports OpenAI-compatible providers and local models, stores API keys only through the existing secret store, and never executes generated requests without an explicit preview/apply step.

An opt-in [traffic capture proxy](./docs/TRAFFIC_CAPTURE.md) records inspectable HTTP exchanges and HTTPS CONNECT metadata with loopback-only defaults and sensitive-header masking.
- **P2**: team sync, Java collaboration services, enterprise features (closed-source)

See [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) and [`docs/BRANDING.md`](docs/BRANDING.md).

## License

Core open source is licensed under the [Apache License 2.0](LICENSE).  
Brand assets (name, logo, slogan) are **not** covered by Apache-2.0 — see [NOTICE](NOTICE).
