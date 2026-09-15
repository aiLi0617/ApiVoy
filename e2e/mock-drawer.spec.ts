import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=mock");
});

test("opens the create drawer without adding another workbench tab", async ({ page }) => {
  const tabsBefore = await page.locator(".workbench-tab").count();
  await page.getByRole("button", { name: "新建场景" }).click();
  await expect(page.getByRole("dialog", { name: "\u65b0\u5efa\u81ea\u5b9a\u4e49 Mock \u573a\u666f" })).toBeVisible();
  await expect(page.locator(".workbench-tab")).toHaveCount(tabsBefore);
  await page.getByRole("button", { name: "关闭场景编辑器" }).click();
  await expect(page.getByRole("dialog", { name: "\u65b0\u5efa\u81ea\u5b9a\u4e49 Mock \u573a\u666f" })).toHaveCount(0);
});
