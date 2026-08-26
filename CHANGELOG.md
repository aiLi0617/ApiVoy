# Changelog

All notable changes to ApiVoy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

### Security

## [0.2.0] - 2026-08-26

### Added

- Interface design lifecycle: design, debug, validate, and synchronize API definitions.
- Hierarchical JSON tree editor with array and nested-field support.
- Shared interface-structure models and conversion helpers across workbenches.
- Maintainer [PR review checklist](docs/maintainers/PR_REVIEW_CHECKLIST.md) to catch CI/CodeQL/Installer issues before merge.

### Changed

- Unified HTTP request/response presentation across protocol workbenches.
- Improved cURL import, request naming, code generation, and design/debug synchronization.
- Standardized layouts and interactions across HTTP, gRPC, SSE, WebSocket, TCP, MQTT, Kafka, AMQP, Redis, SQL, and gateway workbenches.
- Branch protection guidance: require aggregate `CI` status check instead of the retired `test` job.

### Fixed

- Empty workbench tab layout stability.
- Installer lifecycle tools smoke: assert `/health` `service` as `apivoy-agent` (not crate name).

### Security

- Bump transitive `h2` to `0.4.16` (`RUSTSEC-2026-0258`).
- CodeQL: remove DOMParser XML validation sink, single-pass HTML entity decode, non-regex OpenAPI `{var}` expansion, and prototype-pollution guards on interface structure path writes.

## [0.1.0] - 2026-08-18

### Added

- First public release.
- Cross-platform desktop application (Windows, macOS, Linux).
- HTTP, GraphQL, gRPC, WebSocket and SSE workbenches.
- Local Agent and CLI.
- Local-first workspace, environments, and OS keychain-backed secret storage.
- Apache-2.0 open-source repository, community docs, and examples.

### Known limitations

- Early release quality; some protocol workbenches remain experimental.
- Fine-grained internationalization is incomplete.
- Desktop Content Security Policy is baseline; HTML response sandboxing is still planned.
- Automatic updates are not yet available.
- Windows MSI ProductVersion matches app version (numeric WiX-compatible format).

[Unreleased]: https://github.com/aiLi0617/ApiVoy/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/aiLi0617/ApiVoy/releases/tag/v0.2.0
[0.1.0]: https://github.com/aiLi0617/ApiVoy/releases/tag/v0.1.0
