import { expect, test } from "@playwright/test";

test("response validation divider is visible after a completed request", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("apivoy:agent-url", location.origin); localStorage.removeItem("apivoy-agent-token"); });
  const headers = { "content-type": "application/json" };
  await page.route("http://127.0.0.1:5180/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/health") return route.fulfill({ headers, body: JSON.stringify({ service: "apivoy-agent", version: "test", agentVersion: "test", protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false }) });
    if (path === "/v1/session") return route.fulfill({ headers, body: JSON.stringify({ token: "validation-e2e-token" }) });
    if (path === "/v1/executions") return route.fulfill({ headers, body: JSON.stringify({ executionId: "validation-e2e", state: "running" }) });
    if (path === "/v1/executions/validation-e2e/events") {
      const summary = { executionId: "validation-e2e", requestId: "request-e2e", protocolId: "http", state: "completed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 12, bytesReceived: 2, status: 404 };
      const events = [
        { type: "response_meta", status: 404, statusText: "Not Found", headers: [["content-type", "application/json"]], contentType: "application/json", sizeHint: 2 },
        { type: "response_chunk", contentType: "application/json", size: 2, preview: "{}", done: true },
        { type: "assertion_result", ruleId: "designed-response-status", name: "接口设计 · HTTP 状态码", passed: false, expected: "200", actual: "404", message: "实际状态码与所选返回响应不一致" },
        { type: "completed", summary },
      ];
      return route.fulfill({ headers: { "content-type": "text/event-stream" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
    }
    if (path === "/v1/history/validation-e2e/body") return route.fulfill({ headers, body: "{}" });
    if (path === "/v1/history") return route.fulfill({ headers, body: "[]" });
    if (path === "/v1/cookies") return route.fulfill({ headers, body: "[]" });
    return route.continue();
  });

  await page.goto("/#workbench=http");
  await page.getByLabel("目标 URL").fill("https://example.test/not-found");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const divider = page.getByRole("separator", { name: "调整返回响应和校验响应区域大小" });
  await expect(divider).toBeVisible();
  await expect(page.getByText("接口设计 · HTTP 状态码")).toBeVisible();
  const geometry = await divider.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const line = getComputedStyle(element);
    return { viewportWidth: document.documentElement.clientWidth, left: bounds.left, lineWidth: bounds.width, display: line.display, background: line.backgroundColor };
  });
  expect(geometry.left).toBeGreaterThan(0);
  expect(geometry.left).toBeLessThan(geometry.viewportWidth);
  expect(geometry.lineWidth).toBeGreaterThanOrEqual(1);
  expect(geometry.display).not.toBe("none");
  expect(geometry.background).not.toBe("rgba(0, 0, 0, 0)");
});
