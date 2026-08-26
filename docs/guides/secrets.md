# Secret management

ApiVoy uses the OS keychain or Agent secret store by default. HTTP Bearer auth also offers an explicit direct-token mode; tokens entered there are stored with the local request.

## How it works

1. Store a secret via the UI (**Save to keychain** / Agent secret store).
2. The project records a `secret_ref` identifier.
3. At execution time the engine resolves the ref into memory only.

For HTTP Bearer auth, choose **Direct token** only when saving the token in the local request is acceptable. Team snapshots redact this field, but local project exports must still be reviewed before sharing.

## Desktop vs Web

| Surface | Storage |
|---------|---------|
| Desktop | OS keychain via `crates/secret-store` |
| Web + Agent | Agent `PUT /v1/secrets` endpoint |

## TLS client certificates

Client certificates can reference keychain-stored PEM material without writing private keys into workspace files.

## Export safety

Project export runs a sensitive-field scan for common key names in headers, query params, and bodies. Always review exports before committing to Git.

## Reporting issues

If you believe secrets are persisted or logged incorrectly, report via [SECURITY.md](../../SECURITY.md) — do not file public issues with real credentials.
