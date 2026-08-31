import { expect, test } from "@playwright/test";

const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
const envelope = { id: "grpc-request", protocolId: "grpc", name: "查询用户", target: "https://grpc.example.com:443", environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 250 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "grpc", service: "users.UserService", method: "GetUser", messageBase64: null, messageJson: "{\"id\":42}", descriptorSetBase64: null, mode: "unary", metadata: [] }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: "2026-08-31T08:15:00+08:00" };
const record = { id: "grpc-history", protocolId: "grpc", state: "completed", status: null, durationMs: 42, startedAt: "2026-08-31T08:15:00+08:00", requestSnapshot: envelope, preview: "{\"name\":\"Ada\"}" };
const tree = { workspaces: [{ id: "default-workspace", name: "Local" }], projects: [{ id: "default-project", name: "Personal", workspaceId: "default-workspace" }], modules: [{ id: "default-module", name: "默认模块", projectId: "default-project", isDefault: true }], collections: [{ id: "default-collection", name: "默认目录", projectId: "default-project", moduleId: "default-module", parentId: null }], requests: [] };

test("replays a non-HTTP history snapshot with its original protocol envelope", async ({ page }) => {
  await page.route("**/health", (route) => route.fulfill({ headers, json: { service: "apivoy-agent", version: "test", agentVersion: "test", protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false } }));
  await page.route("**/v1/session", (route) => route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers }) : route.fulfill({ headers, json: { token: "test-session" } }));
  await page.route("**/v1/workspace-tree", (route) => route.fulfill({ headers, json: tree }));
  await page.route("**/v1/environments**", (route) => route.fulfill({ headers, json: new URL(route.request().url()).pathname.endsWith("/default") ? { variables: {}, secretRefs: [] } : [] }));
  await page.route("**/v1/history**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({ headers, json: id === "history" ? [record] : record });
  });
  await page.route("**/v1/executions", (route) => route.fulfill({ headers, json: { executionId: "grpc-replay", state: "running" } }));
  await page.route("**/v1/executions/grpc-replay/events", (route) => route.fulfill({ headers: { ...headers, "content-type": "text/event-stream" }, body: `data: ${JSON.stringify({ type: "completed", summary: { executionId: "grpc-replay", requestId: "grpc-request", protocolId: "grpc", state: "completed", status: null, startedAt: "2026-08-31T08:16:00+08:00", finishedAt: "2026-08-31T08:16:00.025+08:00", durationMs: 25, bytesReceived: 14 } })}\n\n` }));
  await page.route("**/v1/history/grpc-replay/body", (route) => route.fulfill({ headers, body: "{\"name\":\"Grace\"}" }));

  await page.goto("/#view=history");
  await page.locator(".request-history-item").click();
  await expect(page.locator(".protocol-history-badge")).toHaveText("GRPC");
  await expect(page.getByRole("textbox", { name: "请求目标" })).toHaveValue("https://grpc.example.com:443");
  await expect(page.getByRole("textbox", { name: "协议载荷" })).toContainText('"service": "users.UserService"');
  const sent = page.waitForRequest((request) => request.url().endsWith("/v1/executions") && request.method() === "POST" && request.postDataJSON().protocolId === "grpc");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await sent;
  await page.screenshot({ path: "output/playwright/request-history-protocols/grpc-history-detail.png", fullPage: true });
});
