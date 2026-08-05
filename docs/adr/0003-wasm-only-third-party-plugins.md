# ADR-0003: 第三方插件仅 WASM

- Status: Accepted
- Date: 2026-08-05

## Decision

P1 third-party plugins accept **WASM Components** only (Wasmtime + WASI capabilities).

| Type | Allowed |
|------|---------|
| Third-party WASM | Yes |
| Official WASM | Yes |
| Official built-in native drivers | Yes |
| Official signed Sidecar | Internal only |
| Third-party native Sidecar | No |
| Arbitrary shell plugins | No |

## Rationale

Native sidecars raise file/network/credential and crash-isolation risk. Vendor SDKs / serial drivers may ship as official native adapters without opening a general native plugin API.
