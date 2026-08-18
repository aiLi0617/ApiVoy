# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub Issues.

Use GitHub Private Vulnerability Reporting:

https://github.com/aiLi0617/ApiVoy/security/advisories/new

Please include:

- Affected component and version
- Reproduction steps
- Expected security impact
- Proof of concept, if available
- Suggested remediation, if available

## Security scope

Security-sensitive areas include:

- Local Agent authentication
- OS keychain and secret storage
- OAuth credentials
- TLS certificates
- Traffic capture and proxying
- QuickJS scripts
- WASM plugins
- Import and export processing
- Protocol parsers

We aim to acknowledge valid reports within 72 hours.

See also [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) and [docs/DEPENDENCY_SECURITY.md](docs/DEPENDENCY_SECURITY.md).
