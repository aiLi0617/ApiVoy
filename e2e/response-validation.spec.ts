import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=http");
});

test("response validation stays hidden before a request and disappears when disabled", async ({ page }) => {
  const validationToggle = page.getByRole("checkbox", { name: "校验响应" });
  const validationSeparator = page.getByRole("separator", { name: "调整响应内容和校验响应区域大小" });

  await expect(validationSeparator).toBeHidden();
  await expect(page.getByRole("button", { name: "收起校验响应" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展开校验响应" })).toHaveCount(0);

  await page.locator(".http-response-validation-control").first().click();
  await expect(validationToggle).not.toBeChecked();
  await expect(validationSeparator).toBeHidden();
  await expect(page.getByRole("combobox", { name: "选择接口设计返回响应" })).toHaveCount(0);
});
