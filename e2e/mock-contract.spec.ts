import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=mock");
});

test("creates a contract-driven draft and edits the response status", async ({ page }, testInfo) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-create-mock-rule", { detail: { seed: {
    interfaceName: "查询用户",
    method: "GET",
    path: "/v1/users/10001",
    responses: [
      { id: "ok", name: "成功", statusCode: "200", contentType: "application/json", fields: [{ id: "email", name: "email", type: "string" }] },
      { id: "error", name: "未找到", statusCode: "404", contentType: "application/json", fields: [{ id: "message", name: "message", type: "string", example: '"用户不存在"' }] },
    ],
  } } })));

  await expect(page.locator(".mock-code-input")).toHaveValue("/v1/users/10001");
  await expect(page.locator(".mock-body")).toHaveValue(/user@example\.com/);
  await expect(page.getByText("响应预设", { exact: true })).toHaveCount(0);
  await expect(page.getByText("返回内容来源", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("响应定义")).toHaveCount(0);
  await page.getByRole("tab", { name: "设置" }).click();
  await page.getByLabel("HTTP 状态码").click();
  await page.getByRole("option", { name: /^404 / }).click();
  await expect(page.getByLabel("HTTP 状态码")).toHaveValue("404");
  await page.getByRole("tab", { name: "Body" }).click();
  await expect(page.locator(".mock-body")).toHaveValue(/用户不存在/);
  await page.getByRole("tab", { name: "设置" }).click();
  await page.getByLabel("HTTP 状态码").fill("422");
  await expect(page.getByLabel("HTTP 状态码")).toHaveValue("422");
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: `output/playwright/mock-contract-${testInfo.project.name}.png`, fullPage: true });
});
