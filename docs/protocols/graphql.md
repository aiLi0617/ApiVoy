# GraphQL

## Workbench

GraphQL requests are available in two places:

1. **HTTP workbench** — set body mode to **GraphQL** (query, variables, operation name)
2. **GraphQL driver** — dedicated protocol path for subscriptions over WebSocket

## Features (Beta)

- Query and mutation over HTTP
- Variables JSON editor and schema introspection helpers
- WebSocket subscriptions (via GraphQL driver)
- Code generation: cURL, Fetch

## Quick test

URL: `https://countries.trevorblades.com/graphql`

Query:

```graphql
query {
  __typename
}
```

## Verification

- Driver: `crates/driver-graphql`
- Tests: tokio tests with mock HTTP server
- Example: [examples/graphql/typename.query.json](../../examples/graphql/typename.query.json)
