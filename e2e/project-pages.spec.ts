import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#view=settings");
});

test("renders project settings in the main workspace", async ({ page }) => {
  await expect(page).toHaveURL(/view=settings/);
  await expect(page.locator(".project-settings-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "项目设置" })).toHaveCount(0);
});

test("renders request history in the main workspace", async ({ page }) => {
  await page.getByRole("button", { name: "请求历史" }).click();
  await expect(page).toHaveURL(/view=history/);
  await expect(page.locator(".request-history-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "请求历史" })).toBeVisible();
  await expect(page.locator(".execution-history-layer")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "执行历史" })).toHaveCount(0);
});
