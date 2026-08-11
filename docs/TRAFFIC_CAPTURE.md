# Traffic capture

ApiVoy includes an explicit debugging proxy in both Desktop and the authenticated Local Agent.

## Safety model

- The proxy is stopped by default and binds `127.0.0.1:39219` unless the caller explicitly opts into a different address.
- Non-loopback binding is rejected unless `allowRemote=true` is supplied by an authenticated host integration.
- HTTP exchanges include headers and up to 64 KiB of request/response preview. Bodies larger than 32 MiB are rejected rather than retained without a bound.
- `Authorization`, proxy authorization, cookies, API keys and common auth-token headers are forwarded unchanged but masked as `***` in capture records.
- HTTPS uses standard `CONNECT` tunneling. ApiVoy records destination, status, timing and tunnel errors, but does not decrypt content or silently install a root CA.
- Captures are process-memory only, capped at 500 exchanges, and can be cleared from the UI. They are not synchronized to team workspaces.

## Use

1. Open **Capture**, choose a loopback bind address and start capture.
2. Configure the application under test with `HTTP_PROXY=http://127.0.0.1:39219` and `HTTPS_PROXY=http://127.0.0.1:39219`.
3. Select a captured HTTP exchange to inspect headers and previews.
4. Choose **生成 HTTP 请求** to copy a sanitized, editable request into the HTTP workbench.
5. Stop and clear capture when debugging is complete.

For HTTPS payload inspection, send the request directly from ApiVoy. Managed MITM certificate deployment is intentionally outside the default capture path because it changes device trust and requires explicit organizational governance.
