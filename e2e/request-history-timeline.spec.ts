import { expect, test } from "@playwright/test";

const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };

function snapshot(id: string, name: string, target: string) {
  return { id, protocolId: "http", name, target, environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 250 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "http", method: "GET", headers: [], body: null, followRedirects: true }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: "2026-08-31T15:12:00+08:00" };
}

test("manages history tabs, links existing interfaces, and saves debug cases", async ({ page }) => {
  const interfaceEnvelope = snapshot("history-request", "用户详情接口", "https://api.example.com/users/42");
  const records = [
    { id: "latest", protocolId: "http", state: "completed", status: 200, durationMs: 83, startedAt: "2026-08-31T15:12:00+08:00", requestSnapshot: snapshot("history-request", "用户详情", "https://api.example.com/users/42"), preview: "{\"id\":42,\"name\":\"Ada\"}" },
    { id: "older", protocolId: "http", state: "failed", status: 404, durationMs: 121, startedAt: "2026-08-28T09:30:00+08:00", requestSnapshot: snapshot("older-request", "缺失资源", "https://api.example.com/missing"), preview: "Not Found" },
  ];
  const tree = { workspaces: [{ id: "default-workspace", name: "Local" }], projects: [{ id: "default-project", name: "Personal", workspaceId: "default-workspace" }], modules: [{ id: "default-module", name: "默认模块", projectId: "default-project", isDefault: true }], collections: [{ id: "default-collection", name: "默认目录", projectId: "default-project", moduleId: "default-module", parentId: null }], requests: [{ id: "history-request", name: "用户详情接口", projectId: "default-project", collectionId: "default-collection", method: "GET", protocolId: "http", target: "https://api.example.com/users/42", envelope: interfaceEnvelope }] };

  await page.route("**/health", (route) => route.fulfill({ headers, json: { service: "apivoy-agent", version: "test", agentVersion: "test", protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false } }));
  await page.route("**/v1/session", (route) => route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers }) : route.fulfill({ headers, json: { token: "test-session" } }));
  await page.route("**/v1/workspace-tree", (route) => route.fulfill({ headers, json: tree }));
  await page.route("**/v1/environments**", (route) => route.fulfill({ headers, json: new URL(route.request().url()).pathname.endsWith("/default") ? { variables: {}, secretRefs: [] } : [] }));
  await page.route("**/v1/history**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (new URL(route.request().url()).pathname.endsWith("/body")) return route.fulfill({ headers, body: "{\"sent\":true}" });
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({ headers, json: id === "history" ? records : records.find((record) => record.id === id) ?? null });
  });
  await page.route("**/v1/executions", (route) => route.fulfill({ headers, json: { executionId: "replay-execution", state: "running" } }));
  await page.route("**/v1/executions/replay-execution/events", (route) => route.fulfill({ headers: { ...headers, "content-type": "text/event-stream" }, body: `data: ${JSON.stringify({ type: "completed", summary: { executionId: "replay-execution", requestId: "history-request", protocolId: "http", state: "completed", status: 200, startedAt: "2026-08-31T15:13:00+08:00", finishedAt: "2026-08-31T15:13:00.025+08:00", durationMs: 25, bytesReceived: 13 } })}\n\n` }));
  await page.route("**/v1/requests**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (route.request().method() === "GET") return route.fulfill({ headers, json: { id: "history-request", name: "用户详情接口", target: interfaceEnvelope.target, envelope: interfaceEnvelope } });
    return route.fulfill({ headers, json: {} });
  });

  await page.goto("/#view=history");
  const timeline = page.getByRole("complementary", { name: "请求历史时间线" });
  await expect(timeline).toContainText("2026年8月31日");
  await expect(timeline).toContainText("2026年8月28日");
  await page.locator(".request-history-item").first().click();
  await expect(page.getByRole("tablist", { name: "已打开的历史请求" }).getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#http-target-url")).toHaveValue("https://api.example.com/users/42");
  await expect(page.getByRole("button", { name: "打开接口 用户详情接口" })).toBeVisible();
  await expect(page.locator(".http-request-name-field")).toBeHidden();
  await expect(page.locator(".http-history-sent-at")).toContainText("用户详情接口");
  const expectedSentAt = await page.evaluate(
    (iso) => new Date(iso).toLocaleString("zh-CN", { hour12: false }),
    records[0].startedAt,
  );
  await expect(page.locator(".http-history-sent-at time")).toHaveAttribute("dateTime", records[0].startedAt);
  await expect(page.locator(".http-history-sent-at")).toContainText(expectedSentAt);
  await page.screenshot({ path: "output/playwright/request-history-timeline/linked-interface-detail.png", fullPage: true });

  await page.locator(".request-history-item").nth(1).click();
  await expect(page.getByRole("tablist", { name: "已打开的历史请求" }).getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "更多页签操作" }).click();
  await page.getByRole("menuitem", { name: "关闭其他标签页" }).click();
  await expect(page.getByRole("tablist", { name: "已打开的历史请求" }).getByRole("tab")).toHaveCount(1);
  await page.getByRole("button", { name: "更多页签操作" }).click();
  await page.getByRole("menuitem", { name: "关闭全部标签页" }).click();
  await expect(page.getByRole("tablist", { name: "已打开的历史请求" })).toHaveCount(0);

  await page.locator(".request-history-item").first().click();
  const sent = page.waitForRequest((request) => request.url().endsWith("/v1/executions") && request.method() === "POST");
  await page.getByRole("button", { name: /Send|发送/ }).click();
  await sent;

  await page.getByRole("button", { name: "保存为用例" }).click();
  const dialog = page.getByRole("dialog", { name: "保存为用例" });
  await expect(dialog.getByRole("textbox", { name: "用例名称" })).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toBeChecked();
  await dialog.screenshot({ path: "output/playwright/request-history-timeline/save-debug-case-dialog.png" });
  await expect(dialog.getByText("用例类型", { exact: true })).toHaveCount(0);
  const saved = page.waitForRequest((request) => request.url().includes("/v1/requests?") && request.method() === "POST");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const savedEnvelope = (await saved).postDataJSON();
  expect(savedEnvelope.variables.__apivoyCaseOf).toBe("history-request");
  expect(savedEnvelope.metadata.__apivoyCaseType).toBe("debug");
  expect(savedEnvelope.metadata.__apivoySavedResponse.status).toBe(200);

  await page.getByRole("button", { name: "打开接口 用户详情接口" }).click();
  await expect(page.getByRole("button", { name: "接口管理" })).toHaveClass(/is-active/);
});
