# apivoy-plugin-sdk

WASM Component plugin SDK for ApiVoy.

Third-party plugins must be WASM. Native sidecars are not part of the public plugin surface.

The first stable interface is defined in `apivoy-plugin.wit`:

```wit
world transformer {
  export transform: func(input: string) -> string;
}

world protocol {
  export execute: func(request-json: string) -> string;
}

world auth {
  export apply-auth: func(request-json: string) -> string;
}

world importer {
  export import: func(document: string) -> string;
}
```

Plugin packages contain a Component binary and manifest:

```json
{
  "id": "example-transform",
  "name": "Example Transform",
  "version": "1.0.0",
  "kind": "transformer",
  "permissions": []
}
```

The host validates Component format and SHA-256, applies a 32 MiB memory limit
and fuel budget, and links no WASI APIs by default. Requested permissions must
be explicitly granted by the host; arbitrary native executables are rejected.

## Publisher signatures

Production Agent/Desktop hosts require an Ed25519 publisher signature. Add
`publisherKeyId` and `signatureBase64` to the manifest. The signed payload is
produced by `plugin_runtime::plugin_signature_payload(manifest, componentBytes)`;
it binds the Component SHA-256 to the plugin identity, version, kind,
permissions, description and publisher key ID.

Trusted public keys are configured as Base64-encoded 32-byte Ed25519 keys:

```text
APIVOY_PLUGIN_TRUSTED_KEYS={"official":"<base64-public-key>"}
```

Unsigned plugins are rejected by default. Development builds may explicitly
set `APIVOY_ALLOW_UNSIGNED_PLUGINS=1`; this should never be used for production
packages.
