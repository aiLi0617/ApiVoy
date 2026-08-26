# Contributing to ApiVoy

Thank you for your interest in contributing to ApiVoy.

## Before contributing

- Search existing [issues](https://github.com/aiLi0617/ApiVoy/issues) and pull requests.
- For large changes, open a proposal issue first.
- Keep changes focused on one responsibility.
- Do not include credentials, private endpoints, or proprietary code.

## Development setup

### Requirements

- **Node.js** 22+
- **pnpm** 10.27+
- **Rust** stable (with platform-specific [Tauri dependencies](https://v2.tauri.app/start/prerequisites/))
- **Java 21** — only when working on `services/collaboration-server/`

### Clone and run

```bash
git clone https://github.com/aiLi0617/ApiVoy.git
cd ApiVoy
pnpm install
cargo check --workspace

# Desktop
pnpm dev:desktop

# Web (requires Local Agent in another terminal)
cargo run -p apivoy-local-agent
pnpm dev:web

# CLI smoke test
cargo run -p apivoy-cli -- http-get https://httpbin.org/get
```

### Collaboration server (optional)

```bash
cd services/collaboration-server
./gradlew.bat test   # Windows
./gradlew test       # macOS / Linux
```

## Validation

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

## Pull requests

A pull request should include:

- The problem being solved
- The implementation approach
- Tests (or explain why not applicable)
- Documentation updates for behavior changes
- Screenshots for UI changes
- Security implications when touching secrets, authentication, TLS, scripts, plugins, proxying, or protocol parsing

Before requesting review, self-check any touched areas against
[docs/maintainers/PR_REVIEW_CHECKLIST.md](docs/maintainers/PR_REVIEW_CHECKLIST.md)
(dependency audit, CodeQL-prone UI/import patterns, Agent health contract, workflow assertions).

See [AGENTS.md](AGENTS.md) for maintainer automation rules and [SECURITY.md](SECURITY.md) for vulnerability reporting.
