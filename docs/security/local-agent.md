# Local Agent security

The Local Agent exposes protocol execution over HTTP on your machine.

## Defaults

| Setting | Value |
|---------|-------|
| Bind address | `127.0.0.1:39217` |
| Authentication | Bearer token (pairing for Web) |
| Web Origin | Restricted to local Web dev origin |

## Threat summary

A process on the same machine that obtains a valid Agent token can execute arbitrary supported protocols using the user's network access and resolved secrets.

Mitigations:

- Loopback binding by default
- Token required on every request
- Session token expiry and pairing flow for Web
- Non-loopback bind requires explicit configuration

## Operator guidance

- Do not expose Agent ports to the public internet without TLS and strong auth.
- Treat paired tokens like passwords on shared workstations.
- Stop Agent when not debugging.

Full model: [THREAT_MODEL.md](../THREAT_MODEL.md)

Report vulnerabilities: [SECURITY.md](../../SECURITY.md)
