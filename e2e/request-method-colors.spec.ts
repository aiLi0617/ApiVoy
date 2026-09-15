import { expect, test } from "@playwright/test";

test("resource tree distinguishes HTTP request methods by color", async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (pathname === "/health") {
      await route.fulfill({
        headers,
        json: {
          service: "apivoy-agent",
          version: "0.2.0",
          agentVersion: "0.2.0",
          protocolApiVersion: "1",
          minProtocolApiVersion: "1",
          maxProtocolApiVersion: "1",
          authRequired: false,
        },
      });
      return;
    }
    if (pathname === "/v1/session") {
      await route.fulfill({ headers, json: { token: "ui-preview-session" } });
      return;
    }
    if (pathname === "/v1/workspace-tree") {
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
      await route.fulfill({
        headers,
        json: {
          workspaces: [{ id: "default-workspace", name: "本地工作区" }],
          projects: [{ id: "default-project", workspaceId: "default-workspace", name: "方法颜色预览" }],
          modules: [{ id: "m1", projectId: "default-project", name: "接口", isDefault: true }],
          collections: [{ id: "default-collection", projectId: "default-project", moduleId: "m1", name: "测试1", parentId: null, sortOrder: 0 }],
          requests: methods.map((method, index) => ({
            id: `r-${method.toLowerCase()}`,
            projectId: "default-project",
            collectionId: "default-collection",
            name: ["获取状态码", "回显 POST JSON", "更新资源", "局部更新", "删除资源", "读取响应头", "查询能力"][index],
            method,
            target: `/method/${method.toLowerCase()}`,
          })),
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });

  await page.goto("/#project=default-project&collection=default-collection&view=resources");
  const labels = page.locator(".tree-request-method");
  await expect(labels).toHaveCount(7);
  const colors = await labels.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
  expect(new Set(colors).size).toBe(7);
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  const lightColors = await labels.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
  expect(new Set(lightColors).size).toBe(7);
});
