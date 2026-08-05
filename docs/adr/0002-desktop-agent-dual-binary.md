# ADR-0002: Desktop 与 Agent 双二进制

- Status: Accepted
- Date: 2026-08-05

## Context

Desktop needs a UI; Agent must run headlessly for Web users and enterprise hosts. Merging into one binary couples upgrade and crash domains.

## Decision

- One Rust workspace, one protocol-core, one product version
- Two artifacts: `apivoy` (Desktop) and `apivoy-agent` (Agent)
- Desktop may bundle Agent as a Tauri sidecar
- Version handshake includes `desktopVersion`, `agentVersion`, `protocolApiVersion`

## Consequences

- Independent restart of Agent without killing Desktop UI
- Separate platform packages in each release
- Incompatible protocol API versions must fail closed with an upgrade prompt
