import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=mock");
});

test("creates a contract-driven draft and switches scenario templates", async ({ page }, testInfo) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-create-mock-rule", { detail: { seed: {
    interfaceName: "查询用户",
    method: "GET",
    path: "/v1/users/10001",
    responses: [
      { id: "ok", name: "成功", statusCode: "200", contentType: "application/json", fields: [{ id: "email", name: "email", type: "string" }] },
      { id: "error", name: "未找到", statusCode: "404", contentType: "application/json", fields: [{ id: "message", name: "message", type: "string", example: '"用户不存在"' }] },
    ],
  } } })));

  await expect(page.getByText("接口契约", { exact: true })).toBeVisible();
  await expect(page.locator(".mock-code-input")).toHaveValue("/v1/users/10001");
  await expect(page.locator(".mock-body")).toHaveValue(/user@example\.com/);
  await page.getByRole("button", { name: "异常", exact: true }).click();
  await expect(page.locator(".mock-contract-controls select")).toHaveValue("error");
  await expect(page.locator('input[type="number"]').first()).toHaveValue("404");
  await expect(page.locator(".mock-body")).toHaveValue(/用户不存在/);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: `output/playwright/mock-contract-${testInfo.project.name}.png`, fullPage: true });
});
