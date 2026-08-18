# Your first HTTP request

This guide uses the public [httpbin.org](https://httpbin.org) service — no API key required.

## Desktop or Web

1. Open ApiVoy and create or select a **local workspace**.
2. Open the **HTTP** workbench.
3. Set method to **GET**.
4. Enter URL: `https://httpbin.org/get`
5. Click **Send**.

## What to inspect

- **Response body** — JSON echo of your request metadata
- **Timeline** — DNS, connect, TLS, and transfer events
- **Status** — should be `200`

## Optional: add an assertion

In the assertions panel, add:

```text
status == 200
```

Re-send and confirm the assertion passes.

## CLI equivalent

```bash
apivoy-cli http-get https://httpbin.org/get
```

## Next steps

- [Environments and variables](../guides/environments.md)
- [Secret management](../guides/secrets.md)
- [HTTP protocol reference](../protocols/http.md)
