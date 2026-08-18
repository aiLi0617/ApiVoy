# Environments and variables

ApiVoy supports scoped variables resolved at execution time with `{{name}}` syntax.

## Scopes

| Scope | Typical use |
|-------|-------------|
| Global | Defaults across projects |
| Environment | `dev`, `staging`, `prod` base URLs |
| Collection | Shared variables for a folder |
| Request | Overrides for a single request |

## Example

Environment variable:

| Name | Value |
|------|-------|
| `baseUrl` | `https://httpbin.org` |

Request URL:

```text
{{baseUrl}}/get
```

## Dynamic helpers

Built-in helpers include `$uuid`, `$timestamp`, and `$isoTimestamp` (see execution engine docs in code).

## Git-friendly exports

Environment definitions can be exported in ApiVoy project packages (`*.apivoy.json`). Use `secret_ref` for sensitive values — see [secrets.md](./secrets.md).
