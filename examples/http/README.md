# HTTP examples

Public endpoints only — no credentials.

## Simple GET

Import or recreate in the HTTP workbench:

- File: [get.http.json](./get.http.json)
- URL: `https://httpbin.org/get`
- Method: GET

## With environment variable

See [with-env.apivoy.json](./with-env.apivoy.json) — uses `{{baseUrl}}` resolved from an environment.

## With assertion

See [with-assertion.apivoy.json](./with-assertion.apivoy.json) — expects `status == 200`.

## CLI

```bash
apivoy-cli http-get https://httpbin.org/get
```
