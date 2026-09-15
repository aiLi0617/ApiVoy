import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=http");
});

test("opens a focused Mock draft from the interface lifecycle action", async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-create-interface-mock", {
    detail: { workbenchId: "http", sessionId: "test-http" },
  })));

  await expect(page.getByTestId("workbench-mock").first()).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".mock-editor input").first()).toBeFocused();
});

test("the Mock workbench new action focuses the rule name", async ({ page }) => {
  await page.goto("/#workbench=mock");
  await page.locator(".mock-rule-browser").getByRole("button", { name: "新建" }).click();

  await expect(page.locator(".mock-editor input").first()).toBeFocused();
});


test("keeps interface context while creating a status-specific Mock scenario", async ({ page }) => {
  await page.route("**/health", (route) => route.fulfill({ json: { protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false } }));
  await page.route("**/v1/session", (route) => route.fulfill({ json: { token: "test-session-token" } }));
  await page.route("**/v1/requests/status-404", (route) => route.fulfill({ json: {
    id: "status-404", target: "https://httpbin.org/status/404", envelope: {
      id: "status-404", name: "\u6307\u5b9a\u72b6\u6001\u7801", protocolId: "http", target: "https://httpbin.org/status/404", environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 250 }, proxy: null, tls: { verify: true, client_cert_ref: null }, preScripts: [], postScripts: [], assertions: [], variables: {},
      payload: { type: "http", method: "GET", headers: [], body: null, followRedirects: true },
      metadata: { __apivoyResponseDefinitions: [
        { id: "100000001", name: "success", statusCode: "200", contentType: "application/json", fields: [] },
        { id: "100000002", name: "not found", statusCode: "404", contentType: "application/json", fields: [] },
      ] },
    },
  } }));
  await page.route("**/v1/api-definitions?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/v1/requests/status-404/definition-binding", (route) => route.fulfill({ json: {
    requestId: "status-404", definitionId: "definition-status-404", mockOperationId: "100000000", updatedAt: new Date().toISOString(),
  } }));
  let activatedPriority: number | undefined;
  await page.route("**/v1/mock-rules/*", async (route) => {
    activatedPriority = (route.request().postDataJSON() as { priority: number }).priority;
    await route.fulfill({ status: 200, json: {} });
  });
  await page.route("**/v1/mock-rules", (route) => route.fulfill({ json: [{ id: "error-rule", name: "404 error", method: "GET", path: "/status/404", status: 404, headers: {}, body: "{}", delayMs: 0, errorEvery: null, priority: 0, wsMessages: [], wsEcho: false, wsIntervalMs: 250 }, { id: "success-rule", name: "200 success", method: "GET", path: "/status/404", status: 200, headers: {}, body: "{}", delayMs: 0, errorEvery: null, priority: 0, wsMessages: [], wsEcho: false, wsIntervalMs: 250 }] }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: {
    id: "status-404", name: "status 404", protocolId: "http", target: "https://httpbin.org/status/404",
    payload: { type: "http", method: "GET", headers: [], body: null },
  } })));
  await page.getByRole("tab", { name: "Mock" }).click();
  await expect(page.locator(".mock-interface-context")).toContainText("/status/404");
  await expect(page.locator(".mock-design-response-list code").first()).toContainText("/100000000");
  await expect(page.locator(".mock-design-response-list")).toContainText("apivoyResponseId=100000001");
  await expect(page.getByText("无法确定当前命中场景")).toBeVisible();
  await expect(page.getByRole("button", { name: "设为当前" })).toHaveCount(2);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/mock-interface-scenes-desktop-chromium.png", fullPage: true });
  await page.getByRole("button", { name: "设为当前" }).first().click();
  await expect.poll(() => activatedPriority).toBe(1);
  const tabsBefore = await page.locator(".workbench-tab").count();
  await page.getByRole("button", { name: "\u6dfb\u52a0\u81ea\u5b9a\u4e49\u573a\u666f" }).click();
  await expect(page.locator(".mock-drawer-backdrop.is-embedded")).toBeVisible();
  await expect(page.locator(".mock-contract-controls select")).toHaveValue("100000002");
  await expect(page.locator('.mock-response-heading input[type="number"]')).toHaveValue("404");
  await expect(page.locator(".workbench-tab")).toHaveCount(tabsBefore);
  await expect(page.getByRole("tab", { name: "Mock" })).toHaveAttribute("aria-selected", "true");
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/mock-interface-drawer-desktop-chromium.png", fullPage: true });
});
