# WASM plugins

Third-party ApiVoy plugins must ship as **WebAssembly Components** (not native binaries).

## SDK

- WIT definition: [plugins/sdk/apivoy-plugin.wit](../../plugins/sdk/apivoy-plugin.wit)
- Host runtime: `crates/plugin-runtime`
- UI: **Plugins** workbench (Desktop and Web via Agent)

## Plugin kinds

| Kind | Purpose |
|------|---------|
| `transformer` | Transform request/response text |
| `protocol` | Custom protocol execution hook |
| `auth` | Apply authentication to requests |
| `importer` | Import foreign document formats |

## Security

- SHA-256 integrity check on install
- Ed25519 publisher signatures required in production (`APIVOY_PLUGIN_TRUSTED_KEYS`)
- Memory and fuel limits enforced by Wasmtime
- Permissions must be declared in manifest and granted by host

## Example

Build instructions and minimal transformer source: [examples/plugins/](../../examples/plugins/README.md).

## Status

Plugin hosting is **Experimental** — expect breaking WIT revisions before v1.0.
