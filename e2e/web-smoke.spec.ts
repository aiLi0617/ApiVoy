import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/");
});

test("opens on the primary HTTP workbench and exposes every protocol", async ({ page }) => {
  await expect(page).toHaveTitle("ApiVoy");
  const tabs = page.getByRole("tablist");
  await expect(tabs).toBeVisible();
  await expect(page.getByRole("tab", { name: "HTTP", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "MQTT", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "SQL", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Capture", exact: true })).toBeVisible();

  const metrics = await tabs.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});

test("switches workbenches and persists the selection", async ({ page }) => {
  await page.getByRole("tab", { name: "Redis", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Redis", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("apivoy:active-workbench"))).toBe("redis");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Redis", exact: true })).toHaveAttribute("aria-selected", "true");
});
