import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#view=settings");
});

test("separates page actions from the shared settings save", async ({ page }) => {
  const settings = page.locator(".project-settings-view");
  const saveButton = settings.getByRole("button", { name: "保存更改" });

  await expect(settings.locator(".project-settings-project-icon")).toBeVisible();
  await expect(settings.locator(".project-settings-project-icon svg")).not.toHaveAttribute("data-icon", "gitBranch");
  await expect(settings.getByRole("button", { name: "项目资源", exact: true })).toHaveCount(1);
  await expect(saveButton).toBeDisabled();

  await settings.getByRole("button", { name: "响应校验设置" }).click();
  await settings.locator(".http-switch").first().click();
  await expect(settings.getByText("1 项设置有未保存的更改")).toBeVisible();
  await expect(saveButton).toBeEnabled();

  await saveButton.click();
  await expect(settings.getByText("所有更改已保存")).toBeVisible();
  await expect(saveButton).toBeDisabled();
});
