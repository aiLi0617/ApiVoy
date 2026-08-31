import { expect, test } from "@playwright/test";

test("captures the request history workbench and save dialog", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop visual capture only");
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
  const requestSnapshot = { id: "history-request", protocolId: "http", name: "User detail", target: "https://api.example.com/users/42", environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 250 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "http", method: "GET", headers: [], body: null, followRedirects: true }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: "2026-08-31T15:12:00+08:00" };
  const records = [
    { id: "latest", protocolId: "http", state: "completed", status: 200, durationMs: 83, startedAt: "2026-08-31T15:12:00+08:00", requestSnapshot, preview: "{\"id\":42,\"name\":\"Ada Lovelace\"}" },
    { id: "second", protocolId: "http", state: "failed", status: 404, durationMs: 121, startedAt: "2026-08-31T14:40:00+08:00", requestSnapshot: { ...requestSnapshot, id: "second-request", name: "Missing resource", target: "https://api.example.com/missing" }, preview: "Not Found" },
  ];
  await page.route("**/health", (route) => route.fulfill({ headers, json: { service: "apivoy-agent", version: "test", agentVersion: "test", protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false } }));
  await page.route("**/v1/session", (route) => route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers }) : route.fulfill({ headers, json: { token: "test-session" } }));
  await page.route("**/v1/workspace-tree", (route) => route.fulfill({ headers, json: { workspaces: [{ id: "default-workspace", name: "Local" }], projects: [{ id: "default-project", name: "Personal", workspaceId: "default-workspace" }], collections: [{ id: "default-collection", name: "Default", projectId: "default-project", parentId: null, moduleId: "default-module" }], modules: [{ id: "default-module", name: "Default module", projectId: "default-project", isDefault: true }], requests: [] } }));
  await page.route("**/v1/environments**", (route) => route.fulfill({ headers, json: new URL(route.request().url()).pathname.endsWith("/default") ? { variables: {}, secretRefs: [] } : [] }));
  await page.route("**/v1/history**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({ headers, json: id === "history" ? records : records.find((record) => record.id === id) ?? null });
  });

  await page.setViewportSize({ width: 1538, height: 858 });
  await page.goto("/#view=history");
  await expect(page.locator(".request-history-item")).toHaveCount(2);
  await page.screenshot({ path: "output/playwright/request-history-timeline/empty.png", fullPage: true });
  await page.locator(".request-history-item").first().click();
  await expect(page.locator(".request-history-workbench")).toBeVisible();
  await page.screenshot({ path: "output/playwright/request-history-timeline/detail.png", fullPage: true });
  await page.getByRole("button", { name: "保存为接口" }).click();
  await expect(page.getByRole("dialog", { name: "保存为接口" })).toBeVisible();
  await page.screenshot({ path: "output/playwright/request-history-timeline/save-interface.png", fullPage: true });
  await page.getByRole("dialog", { name: "保存为接口" }).screenshot({ path: "output/playwright/request-history-timeline/save-interface-dialog.png" });
  expect(consoleErrors).toEqual([]);
});
