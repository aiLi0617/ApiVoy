# ADR-0001: Tauri 2 + Rust 统一协议内核

- Status: Accepted
- Date: 2026-08-05

## Context

ApiVoy needs a cross-platform desktop shell, a small install footprint, and one execution kernel reused by CLI, Local Agent, and (later) cloud runners.

## Decision

- Desktop shell: **Tauri 2** + system WebView → binary `apivoy`
- Protocol runtime: **Rust + Tokio** via Driver SPI
- Frontend: **React + TypeScript + Vite**, shared via `packages/*`
- Local Agent: separate binary `apivoy-agent`, same crates / version / release train
- License: **Apache-2.0** for all code in this repository

## Consequences

- Java collaboration services start in P2 as optional self-hosted OSS components in this repository
- Future separately hosted cloud services are out of scope for this repository
- Web reaches restricted protocols only through Local Agent
- Third-party plugins (P1+) are WASM-only
