# WASM plugin example

This folder documents how to build a minimal **transformer** plugin. ApiVoy does not ship pre-built `.wasm` binaries in the repository.

## Manifest (`manifest.json`)

```json
{
  "id": "example-uppercase",
  "name": "Example Uppercase",
  "version": "0.1.0",
  "kind": "transformer",
  "permissions": []
}
```

## WIT interface

See [plugins/sdk/apivoy-plugin.wit](../../plugins/sdk/apivoy-plugin.wit) — implement the `transformer` world export `transform`.

## Build (outline)

1. Install [Rust](https://rustup.rs/) and `wasm32-wasip2` target (Component model).
2. Create a Rust crate that implements the WIT transformer export.
3. Build a WebAssembly Component artifact.
4. Compute SHA-256 of the component bytes.
5. Sign with Ed25519 for production installs (`APIVOY_PLUGIN_TRUSTED_KEYS`).

## Install

Use the **Plugins** workbench in Desktop or Web (via Agent) to install the package directory containing `manifest.json` and the component file.

## Status

Plugin ecosystem is **Experimental**. Expect WIT and host API changes before v1.0.

See [docs/guides/wasm-plugins.md](../../docs/guides/wasm-plugins.md).
