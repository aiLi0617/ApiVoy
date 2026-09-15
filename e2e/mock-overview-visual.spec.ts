import { test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("captures the Mock overview and create drawer", async ({ page }, testInfo) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=mock");
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: `output/playwright/mock-overview-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "新建场景" }).click();
  await page.screenshot({ path: `output/playwright/mock-drawer-${testInfo.project.name}.png`, fullPage: true });
});
