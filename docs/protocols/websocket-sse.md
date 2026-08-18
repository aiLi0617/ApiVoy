# WebSocket and SSE

## WebSocket workbench

- `ws://` and `wss://` connections
- Text and binary frames, subprotocols, ping/pong
- Persistent session with bidirectional timeline
- Code generation: JavaScript WebSocket snippet

Public test endpoint (may be rate-limited):

```text
wss://echo.websocket.events
```

## SSE workbench

- `text/event-stream` over HTTP
- Last-Event-ID, retry, and auto-reconnect options
- Code generation: cURL and EventSource

Public sample:

```text
GET https://stream.wikimedia.org/v2/stream/recentchange
Accept: text/event-stream
```

## Verification

- Drivers: `crates/driver-websocket`, `crates/driver-sse`
- Tests: tokio tests with local mock servers
- Examples: [examples/websocket/](../../examples/websocket/)
