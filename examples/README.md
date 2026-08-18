# ApiVoy examples

Public, credential-free samples for documentation and smoke testing.

| Directory | Description |
|-----------|-------------|
| [http/](http/) | HTTP GET, environment variables, assertions |
| [graphql/](graphql/) | Public GraphQL introspection query |
| [grpc/](grpc/) | Local gRPC echo setup guide |
| [websocket/](websocket/) | WebSocket echo sample |
| [mqtt/](mqtt/) | MQTT publish against local broker |
| [collections/](collections/) | CLI-runnable smoke collection |
| [plugins/](plugins/) | WASM plugin build outline |

Run the HTTP smoke collection:

```bash
apivoy-cli run examples/collections/httpbin-smoke.json
```

See [docs/getting-started/](../docs/getting-started/) for user-facing guides.
