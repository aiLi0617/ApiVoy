# CLI collection runs

Use `apivoy-cli run` to execute collections in CI.

## Minimal collection

See [examples/collections/httpbin-smoke.json](../../examples/collections/httpbin-smoke.json).

## Run

```bash
apivoy-cli run examples/collections/httpbin-smoke.json --report report.json
```

## Options

| Flag | Description |
|------|-------------|
| `--concurrency N` | Parallel cases (default 1) |
| `--fail-fast` | Stop on first failure |
| `--report PATH` | Write JSON report |
| `--report-format junit` | JUnit XML for CI dashboards |
| `--data PATH` | JSON array or CSV for data-driven iterations |

## Exit codes

Non-zero exit indicates one or more failed cases or assertions — suitable for GitHub Actions and other CI systems.

## Portable vs full envelopes

Collections may be:

- An array of `{ "name", "url", "method", "headers", "body" }` portable objects, or
- Full `RequestEnvelope` JSON objects with `protocolId`
