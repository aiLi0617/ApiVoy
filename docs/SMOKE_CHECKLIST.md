# 阶段 0 验收烟测清单

对照 [`PHASE_PLAN.md`](./PHASE_PLAN.md) §5 / §12。

## CLI

```bash
cargo run -p apivoy-cli -- http-get https://example.com
cargo run -p apivoy-cli -- drivers
```

期望：打印 `ExecutionSummary` JSON、`executionId`、events 计数；`drivers` 含 `http`。

## Local Agent + 正式执行 API

```bash
# 终端 1
cargo run -p apivoy-local-agent

# 终端 2（将 TOKEN 换成 Agent 打印的配对令牌）
curl -s http://127.0.0.1:39217/health
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-ApiVoy-Protocol-Api-Version: 1" \
  -H "X-ApiVoy-Client: cli-smoke" \
  -H "X-ApiVoy-Client-Version: 0.1.0-alpha.1" \
  -d "{\"id\":\"00000000-0000-4000-8000-000000000001\",\"protocolId\":\"http\",\"name\":\"smoke\",\"target\":\"https://example.com\",\"environmentRef\":null,\"authRef\":null,\"timeoutMs\":30000,\"retryPolicy\":{\"max_retries\":0,\"backoff_ms\":0},\"proxy\":null,\"tls\":{\"verify\":true,\"client_cert_ref\":null},\"metadata\":{},\"payload\":{\"type\":\"http\",\"method\":\"GET\",\"headers\":[],\"body\":null,\"followRedirects\":true},\"preScripts\":[],\"postScripts\":[],\"assertions\":[],\"createdAt\":\"2026-08-05T00:00:00Z\"}" \
  http://127.0.0.1:39217/v1/executions
```

期望：`/health` 含 `protocolApiVersion` / `agentVersion`；`POST /v1/executions` 返回 `202` + `executionId`。随后：

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  -H "X-ApiVoy-Protocol-Api-Version: 1" \
  http://127.0.0.1:39217/v1/executions/<executionId>/events
```

期望：SSE `event: execution` 流，含 `response_meta` / `completed`。

协议版本不兼容时（应 426）：

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-ApiVoy-Protocol-Api-Version: 999" \
  -d "{...同上...}" \
  http://127.0.0.1:39217/v1/executions
```

## Web + Agent

```bash
# 设置 VITE_APIVOY_AGENT_TOKEN 后
pnpm --filter @apivoy/web dev
```

期望：工作台可改 method / headers / body / timeout；发送走正式 API；取消按钮在执行中可用。

## Desktop

```bash
pnpm --filter @apivoy/desktop tauri dev
# 或
pnpm dev:desktop
```

期望：发送 HTTP；保存请求后「打开最近请求」可恢复；`version_info` 协议版本为 `1`。

## SQLite 单测

```bash
cargo test -p local-store
```
