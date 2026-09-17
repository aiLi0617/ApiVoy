import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("edits response headers as parameter name and value rows", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  let createdHeaders: Record<string, string> | undefined;
  await page.route("http://127.0.0.1:39217/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (pathname === "/health") return route.fulfill({ headers, json: { protocolApiVersion: "1", minProtocolApiVersion: "1", maxProtocolApiVersion: "1", authRequired: false } });
    if (pathname === "/v1/session") return route.fulfill({ headers, json: { token: "mock-response-headers-test" } });
    if (pathname === "/v1/workspace-tree") return route.fulfill({ headers, json: { workspaces: [], projects: [], modules: [], collections: [], requests: [] } });
    if (pathname === "/v1/mock-server/status") return route.fulfill({ headers, json: { running: false, bind: "127.0.0.1:39218", requestCount: 0, activeWebsockets: 0 } });
    if (pathname === "/v1/mock-rules" && route.request().method() === "POST") {
      createdHeaders = (route.request().postDataJSON() as { headers: Record<string, string> }).headers;
      return route.fulfill({ status: 201, headers, json: {} });
    }
    if (pathname === "/v1/mock-rules") return route.fulfill({ headers, json: [] });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await page.goto("/#workbench=mock");
  await page.locator(".mock-rule-browser").getByRole("button", { name: "新建" }).click();
  await expect(page.getByLabel("规则名称")).toHaveValue("");
  await page.getByLabel("规则名称").fill("响应头测试");
  await page.getByRole("tab", { name: "Headers" }).click();

  const editor = page.getByRole("table", { name: "响应头参数" });
  if (testInfo.project.name === "desktop-chromium") {
    await expect(editor.getByRole("columnheader")).toHaveText(["参数名", "参数值"]);
  }
  await expect(editor.locator(".mock-header-row")).toHaveCount(1);
  await expect(editor.getByLabel("响应头 1 参数名")).toHaveValue("");
  await expect(editor.getByLabel("响应头 1 参数名")).toHaveAttribute("placeholder", "");
  if (testInfo.project.name === "desktop-chromium") {
    const cells = editor.locator(".mock-header-row").first().getByRole("cell");
    await expect(cells.first()).toHaveCSS("opacity", "0");
    await expect(cells.nth(1)).toHaveCSS("opacity", "0");
    await cells.first().hover();
    await expect(cells.first()).toHaveCSS("opacity", "1");
    await expect(cells.nth(1)).toHaveCSS("opacity", "0");
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({ path: "output/playwright/mock-response-header-name-hover.png", fullPage: true });
    await cells.nth(1).hover();
    await expect(cells.first()).toHaveCSS("opacity", "0");
    await expect(cells.nth(1)).toHaveCSS("opacity", "1");
    await page.screenshot({ path: "output/playwright/mock-response-header-value-hover.png", fullPage: true });
  }
  await editor.getByLabel("响应头 1 参数名").fill("Bad Header");
  await expect(editor.getByLabel("响应头 1 参数名")).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByLabel("响应头 1 参数值")).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByText("参数名包含非法字符", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("响应头 1 参数值")).toHaveAttribute("placeholder", "参数值不能为空");
  await expect(editor.getByText("参数值不能为空", { exact: true })).toHaveClass(/is-sr-only/);
  await expect(editor.getByLabel("响应头 1 参数名")).toHaveAttribute("aria-describedby", /-name-error$/);
  await expect(editor.getByLabel("响应头 1 参数值")).toHaveAttribute("aria-describedby", /-value-error$/);
  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: "output/playwright/mock-response-header-validation.png", fullPage: true });
  }
  await editor.getByLabel("响应头 1 参数名").fill("");
  await expect(editor.getByLabel("响应头 1 参数名")).toHaveAttribute("placeholder", "参数名不能为空");
  await expect(editor.getByText("参数名不能为空", { exact: true })).toHaveClass(/is-sr-only/);
  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: "output/playwright/mock-response-header-empty-errors.png", fullPage: true });
  }
  await editor.getByLabel("响应头 1 参数名").fill("Bad Header");
  await expect(editor.getByLabel("响应头 1 参数名")).toHaveAttribute("placeholder", "");
  await expect(editor.getByLabel("响应头 1 参数值")).toHaveAttribute("placeholder", "参数值不能为空");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByText(/响应头参数名格式不正确/)).toBeVisible();
  expect(createdHeaders).toBeUndefined();
  await editor.getByLabel("响应头 1 参数名").fill("X-Request-Id");
  await expect(editor.getByLabel("响应头 1 参数名")).toHaveAttribute("aria-invalid", "false");
  await editor.getByLabel("响应头 1 参数值").fill("demo-id");
  await expect(editor.getByLabel("响应头 1 参数值")).toHaveAttribute("aria-invalid", "false");
  await expect(editor.getByText("参数名包含非法字符", { exact: true })).toHaveCount(0);
  await expect(editor.getByText("参数值不能为空", { exact: true })).toHaveCount(0);
  await expect(editor.locator(".mock-header-row")).toHaveCount(2);
  await expect(editor.getByLabel("响应头 2 参数名")).toHaveAttribute("placeholder", "");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect.poll(() => createdHeaders).toEqual({ "X-Request-Id": "demo-id" });
});

test("does not infer response headers from an interface response definition", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=mock");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-create-mock-rule", { detail: { seed: {
    interfaceName: "查询用户",
    method: "GET",
    path: "/v1/users/10001",
    responses: [
      { id: "ok", name: "成功", statusCode: "200", contentType: "application/json", fields: [] },
      { id: "missing", name: "未找到", statusCode: "404", contentType: "application/json", fields: [] },
    ],
  } } })));
  await expect(page.getByLabel("规则名称")).toHaveValue("");
  await page.getByRole("tab", { name: "Headers" }).click();
  await expect(page.getByRole("table", { name: "响应头参数" }).locator(".mock-header-row")).toHaveCount(1);
  await expect(page.getByLabel("响应头 1 参数名")).toHaveValue("");
  await page.getByRole("tab", { name: "设置" }).click();
  await page.getByLabel("HTTP 状态码").fill("404");
  await page.getByRole("tab", { name: "Headers" }).click();
  await expect(page.getByLabel("响应头 1 参数名")).toHaveValue("");
});
