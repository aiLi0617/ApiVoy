import { expect, test } from "@playwright/test";

const workbenchIds = ["http", "grpc", "websocket", "sse", "socket", "mqtt", "amqp", "kafka", "redis", "sql", "mock", "runner", "gateway", "capture", "plugins", "ai"];

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=http");
});

test("opens the grouped protocol workspace without horizontal overflow", async ({ page }) => {
  await expect(page).toHaveTitle("ApiVoy");
  await expect(page.locator(".workbench-tabs")).toBeVisible();
  await expect(page.getByTestId("workbench-http").first()).toHaveAttribute("aria-current", "page");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const separator = page.getByRole("separator");
  await expect(separator).toBeVisible();
  const initialRatio = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(initialRatio + 5));
});

test("switches workbenches and preserves URL and stored state", async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "redis" })));
  await expect(page.getByTestId("workbench-redis").first()).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/#workbench=redis/);
  await expect.poll(() => page.evaluate(() => {
    const persisted = localStorage.getItem("apivoy:ui-state");
    if (!persisted) return null;
    try { return (JSON.parse(persisted) as { state?: { activeWorkbench?: string } }).state?.activeWorkbench ?? null; } catch { return null; }
  })).toBe("redis");
  await page.reload();
  await expect(page.getByTestId("workbench-redis").first()).toHaveAttribute("aria-current", "page");
});

test("switches theme and keeps visible keyboard focus", async ({ page }) => {
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Control+K");
  await expect(page.locator(".command-palette")).toBeVisible();
  await expect(page.locator(".command-input-wrap input")).toBeFocused();
});

test("HTTP target URL has an accessible label and neutral empty state", async ({ page }) => {
  const input = page.locator("#http-target-url");
  await expect(input).toHaveAttribute("aria-label");
  await expect(input).toHaveAttribute("placeholder");
  await expect(input).toHaveValue("");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});

test("all protocol workbenches keep semantic frame and viewport bounds", async ({ page }) => {
  for (const id of workbenchIds) {
    await page.goto(`/#workbench=${id}`);
    await expect(page.locator(".workbench-frame").first()).toBeVisible();
    await expect(page.locator(".workbench-frame h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});

test("all protocol workbenches keep light theme bounds", async ({ page }) => {
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const id of workbenchIds) {
    await page.goto(`/#workbench=${id}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} light horizontal overflow`).toBeLessThanOrEqual(1);
  }
});

test("HTTP workbench exposes busy state semantics", async ({ page }) => {
  const frame = page.locator(".workbench-frame").first();
  await expect(frame).not.toHaveAttribute("aria-busy", "true");
  await expect(frame).toHaveAttribute("aria-labelledby", /workbench-title-http/);
});
