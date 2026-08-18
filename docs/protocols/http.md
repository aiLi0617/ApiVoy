# HTTP / HTTPS

## Workbench

Open the **HTTP** workbench for REST-style requests.

## Features (Beta)

- Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Headers, cookies, multipart, URL-encoded and raw bodies
- GraphQL, JSON-RPC, and SOAP body modes on the same workbench
- Authentication: Basic, Bearer, API Key, OAuth 2.0 flows
- Streaming responses with timeline and assertions
- Code generation: cURL, Fetch, Python, Go, Rust, Java

## Quick test

```text
GET https://httpbin.org/get
```

## Verification

- Driver: `crates/driver-http`
- Tests: integration tests with local TCP listener
- Example: [examples/http/get.http.json](../../examples/http/get.http.json)
