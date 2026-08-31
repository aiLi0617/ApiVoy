import { expect, test } from "@playwright/test";

test("restores the live request detail layout", async ({ page }, testInfo) => {
  if (testInfo.project.name === "desktop-chromium") await page.setViewportSize({ width: 1600, height: 1400 });
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
  await page.route("http://127.0.0.1:39217/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (pathname === "/health") {
      await route.fulfill({ headers: cors, json: { service: "apivoy-agent", version: "test", agentVersion: "test", protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false } });
      return;
    }
    if (pathname === "/v1/session" && request.method() === "POST") {
      await route.fulfill({ headers: cors, json: { token: "e2e-session-token" } });
      return;
    }
    if (pathname === "/v1/executions" && request.method() === "POST") {
      await route.fulfill({ headers: cors, json: { executionId: "live-layout-test", state: "running" } });
      return;
    }
    if (pathname === "/v1/executions/live-layout-test/events") {
      const now = new Date().toISOString();
      const events = [
        { type: "response_meta", status: 404, statusText: "Not Found", headers: [["Content-Type", "text/plain"]], contentType: "text/plain", sizeHint: 9 },
        { type: "response_chunk", contentType: "text/plain", size: 9, preview: "Not Found", done: true },
        { type: "completed", summary: { executionId: "live-layout-test", requestId: "live-layout-request", protocolId: "http", state: "completed", startedAt: now, finishedAt: now, durationMs: 18, bytesReceived: 9, status: 404 } },
      ];
      await route.fulfill({ headers: cors, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
      return;
    }
    if (pathname === "/v1/history/live-layout-test/body") {
      await route.fulfill({ headers: cors, contentType: "text/plain", body: "Not Found" });
      return;
    }
    if (pathname === "/v1/history" && request.method() === "GET") {
      await route.fulfill({ headers: cors, json: [] });
      return;
    }
    await route.abort();
  });

  await page.goto("/#workbench=http");
  await page.getByLabel("\u76ee\u6807 URL").fill("https://httpbin.org/status/404");
  await page.getByRole("tab", { name: "Headers", exact: true }).click();
  await page.getByLabel("Header 1 \u540d\u79f0").fill("Accept");
  await page.getByLabel("Header 1 \u503c").fill("*/*");
  await page.getByRole("checkbox", { name: "\u6821\u9a8c\u54cd\u5e94" }).uncheck({ force: true });
  await page.getByRole("button", { name: /^(\u53d1\u9001|Send)$/ }).click();
  await expect(page.locator(".http-status-code").first()).toContainText("404");
  await page.getByRole("tab", { name: "\u5b9e\u65f6\u8bf7\u6c42", exact: true }).first().dispatchEvent("click");

  const liveRequest = page.locator(".http-live-request");
  await expect(liveRequest).toBeVisible();
  await expect(liveRequest.getByText("\u8bf7\u6c42 URL:")).toBeVisible();
  await expect(liveRequest.locator(".http-request-summary")).toContainText("GEThttps://httpbin.org/status/404");
  await expect(liveRequest.getByRole("table", { name: "\u5b9e\u65f6\u8bf7\u6c42 Header" })).toContainText("\u540d\u79f0\u503cAccept*/*");
  await expect(liveRequest.getByText("Body")).toBeVisible();
  await expect(liveRequest.getByText("\u8bf7\u6c42\u4ee3\u7801")).toBeVisible();
  await expect(liveRequest.locator(".interface-case-preview-split")).toHaveCount(0);
  if (testInfo.project.name === "desktop-chromium") await liveRequest.screenshot({ path: "output/playwright/http-live-request-layout.png" });
});
