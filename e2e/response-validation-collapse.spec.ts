import { expect, test } from "@playwright/test";

test("collapsed response validation shows its expand control, label, and failure state", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("apivoy:agent-url", location.origin); localStorage.removeItem("apivoy-agent-token"); });
  const json = { "content-type": "application/json" };
  await page.route("http://127.0.0.1:5180/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/health") return route.fulfill({ headers: json, body: JSON.stringify({ service: "apivoy-agent", version: "test", agentVersion: "test", protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false }) });
    if (path === "/v1/session") return route.fulfill({ headers: json, body: JSON.stringify({ token: "test" }) });
    if (path === "/v1/executions") return route.fulfill({ headers: json, body: JSON.stringify({ executionId: "collapse-e2e", state: "running" }) });
    if (path === "/v1/executions/collapse-e2e/events") {
      const summary = { executionId: "collapse-e2e", requestId: "request-e2e", protocolId: "http", state: "completed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 12, bytesReceived: 2, status: 404 };
      const events = [
        { type: "response_meta", status: 404, statusText: "Not Found", headers: [["content-type", "application/json"]], contentType: "application/json", sizeHint: 2 },
        { type: "assertion_result", ruleId: "designed-response-status", name: "接口设计 · HTTP 状态码", passed: false, expected: "200", actual: "404" },
        { type: "completed", summary },
      ];
      return route.fulfill({ headers: { "content-type": "text/event-stream" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
    }
    if (path === "/v1/history") return route.fulfill({ headers: json, body: "[]" });
    if (path === "/v1/cookies") return route.fulfill({ headers: json, body: "[]" });
    return route.continue();
  });

  await page.goto("/#workbench=http");
  await page.getByLabel("目标 URL").fill("https://example.test/not-found");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const separator = page.getByRole("separator", { name: "调整返回响应和校验响应区域大小" });
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "99");
  await expect(page.getByRole("button", { name: "展开校验响应" })).toBeVisible();
  await expect(separator.locator(".split-response-toggle-label")).toHaveText("校验响应");
  await expect(separator.locator(".split-response-collapsed-meta")).toContainText("失败");
});
