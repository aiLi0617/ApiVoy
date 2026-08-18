# ApiVoy Threat Model

This document outlines security-sensitive areas, existing mitigations, and planned improvements. It complements [SECURITY.md](../SECURITY.md).

## Scope

Applies to Desktop, Web + Local Agent, CLI, WASM plugins, QuickJS scripts, import/export, traffic capture, and optional self-hosted services in this repository.

---

### 1. Malicious import files

| | |
|---|---|
| **Asset** | User workspace, secrets, execution environment |
| **Threat** | Postman/OpenAPI/HAR/ApiVoy package triggers unexpected requests, exfiltration, or parser crashes |
| **Existing mitigation** | Structured parsers in `packages/import-export`; sensitive field scanning on export; user confirms imports |
| **Remaining risk** | Complex `$ref` graphs or malformed payloads may still cause high CPU use |
| **Planned improvement** | Stricter size limits, fuzz tests, import sandbox previews |

---

### 2. SSRF via protocol drivers

| | |
|---|---|
| **Asset** | Internal network, cloud metadata endpoints |
| **Threat** | User or script sends requests to `169.254.169.254`, RFC1918 hosts, or file URLs |
| **Existing mitigation** | Explicit user-entered targets; Agent loopback-only default; no implicit proxy escalation |
| **Remaining risk** | Desktop/CLI can reach any URL the OS allows |
| **Planned improvement** | Optional blocklists for private IP ranges in enterprise/self-hosted policy |

---

### 3. Token and secret leakage

| | |
|---|---|
| **Asset** | API keys, OAuth tokens, TLS private keys |
| **Threat** | Secrets written to SQLite, logs, history, exports, or screenshots |
| **Existing mitigation** | Keychain/`secret_ref` model; capture header masking; export sensitive scan |
| **Remaining risk** | User may paste secrets into plain text fields; some workbench strings still log errors verbosely ([ISS-007](ISSUES.md)) |
| **Planned improvement** | Redact Agent error surfaces; warn on plaintext secret patterns |

---

### 4. Log and history sensitive data

| | |
|---|---|
| **Asset** | Execution history, event timeline, debug output |
| **Threat** | Authorization headers or cookies persisted in history blobs |
| **Existing mitigation** | Masking pipeline for known sensitive header names in capture; secret refs not stored as values |
| **Remaining risk** | Custom header names or body payloads may still contain secrets |
| **Planned improvement** | History scrubbing option; default omit auth headers from saved history |

---

### 5. Local Agent unauthorized access

| | |
|---|---|
| **Asset** | Local protocol execution, filesystem via drivers, secret store |
| **Threat** | Another local process or remote host invokes Agent without authentication |
| **Existing mitigation** | Default bind `127.0.0.1`; Bearer token required; Origin limited for Web; pairing flow |
| **Remaining risk** | Token in browser storage if machine is compromised; misconfigured remote bind |
| **Planned improvement** | Document threat model for Web pairing; tighten session rotation |

See [security/local-agent.md](./security/local-agent.md).

---

### 6. Malicious QuickJS scripts

| | |
|---|---|
| **Asset** | Request/response mutation, variables, limited crypto API |
| **Threat** | Infinite loops, memory exhaustion, subtle request tampering |
| **Existing mitigation** | 500 ms timeout, 16 MiB memory cap, restricted API surface |
| **Remaining risk** | Logic bugs in binding layer |
| **Planned improvement** | Script audit logging; org policy hooks (self-hosted preview) |

---

### 7. Malicious WASM plugins

| | |
|---|---|
| **Asset** | Request transformation, custom protocol/auth/importer hooks |
| **Threat** | Unsigned or tampered plugin executes with excessive permissions |
| **Existing mitigation** | Component-only Wasmtime; SHA-256 check; Ed25519 trust chain; permission declarations; fuel/memory limits |
| **Remaining risk** | User enables `APIVOY_ALLOW_UNSIGNED_PLUGINS=1` in production |
| **Planned improvement** | Example signed plugin; publisher documentation |

---

### 8. Capture and proxy data leakage

| | |
|---|---|
| **Asset** | HTTP exchanges observed through debugging proxy |
| **Threat** | Sensitive traffic retained or exposed on shared machine |
| **Existing mitigation** | Loopback default; 500-entry cap; in-memory only; masked auth headers; no default HTTPS MITM |
| **Remaining risk** | Operator leaves capture running; shared desktop session |
| **Planned improvement** | Auto-stop idle capture; clearer UI warnings |

See [TRAFFIC_CAPTURE.md](./TRAFFIC_CAPTURE.md).

---

### 9. TLS certificate handling

| | |
|---|---|
| **Asset** | Client certificates, custom CAs, server trust decisions |
| **Threat** | Private keys written to disk; trust-all TLS disables verification |
| **Existing mitigation** | Client certs merged via keychain refs; user must opt into insecure TLS |
| **Remaining risk** | Misconfigured CA bundles in CI/headless environments |
| **Planned improvement** | Certificate lifecycle docs; stricter warnings in UI |

---

### 10. Supply chain dependencies

| | |
|---|---|
| **Asset** | Build and runtime dependency tree |
| **Threat** | Vulnerable crates or npm packages |
| **Existing mitigation** | `cargo audit` in CI with reviewed exceptions; CycloneDX SBOM; locked manifests |
| **Remaining risk** | Transitive GTK/Tauri advisories documented as accepted exceptions |
| **Planned improvement** | Review exceptions each release; upgrade Tauri stack when advisories clear |

See [DEPENDENCY_SECURITY.md](./DEPENDENCY_SECURITY.md).

---

### 11. Desktop webview Content Security Policy

| | |
|---|---|
| **Asset** | Desktop UI, Tauri IPC bridge, user credentials in memory |
| **Threat** | Malicious HTML in API responses executes in the webview, accesses Tauri APIs, or loads remote scripts |
| **Existing mitigation** | Baseline CSP in `apps/desktop/src-tauri/tauri.conf.json` (`default-src 'self'`, restricted `script-src`, no `frame-src`) |
| **Remaining risk** | `'unsafe-inline'` styles remain for the UI framework; HTML response preview is not yet fully sandboxed in an iframe |
| **Planned improvement** | Sandbox HTML previews; tighten CSP for production builds; block response HTML from reaching privileged Tauri contexts |

---

## Reporting

Report vulnerabilities via [GitHub Private Vulnerability Reporting](https://github.com/aiLi0617/ApiVoy/security/advisories/new) once enabled in repository settings, not public issues.
