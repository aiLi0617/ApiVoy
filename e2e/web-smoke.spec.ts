import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=http");
});

test("opens the grouped protocol workspace without horizontal overflow", async ({ page }) => {
  await expect(page).toHaveTitle("ApiVoy");
  const tabs = page.getByRole("tablist");
  await expect(tabs).toBeVisible();
  await expect(page.getByTestId("workbench-http").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("workbench-mqtt")).toBeAttached();
  await expect(page.getByTestId("workbench-sql")).toBeAttached();
  await expect(page.getByTestId("workbench-capture")).toBeAttached();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const separator = page.getByRole("separator");
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "55");
});

test("switches workbenches and preserves URL and stored state", async ({ page }) => {
  await page.getByTestId("workbench-redis").first().click();
  await expect(page.getByTestId("workbench-redis").first()).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#workbench=redis/);
  await expect.poll(() => page.evaluate(() => {
    const persisted = localStorage.getItem("apivoy:ui-state");
    if (!persisted) return null;
    try { return (JSON.parse(persisted) as { state?: { activeWorkbench?: string } }).state?.activeWorkbench ?? null; } catch { return null; }
  })).toBe("redis");
  await page.reload();
  await expect(page.getByTestId("workbench-redis").first()).toHaveAttribute("aria-selected", "true");
});

test("switches theme and keeps visible keyboard focus", async ({ page }) => {
  const theme = page.getByRole("button", { name: "切换主题" });
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "命令面板" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索命令" })).toBeFocused();
});

test("HTTP target URL exposes accessible help text", async ({ page }) => {
  const input = page.locator("#http-target-url");
  await expect(input).toHaveAttribute("aria-describedby", "http-target-url-help");
  await expect(page.locator("label.http-target-field")).toContainText("目标 URL");
  await expect(page.locator("#http-target-url-help")).toBeVisible();
});
test("all protocol workbenches keep semantic frame and viewport bounds", async ({ page }) => {
  const ids = ["http", "graphql", "grpc", "rpc", "websocket", "sse", "socket", "mqtt", "amqp", "kafka", "redis", "sql", "mock", "gateway", "capture", "plugins", "ai", "team", "comments", "sso"];
  for (const id of ids) {
    await page.goto(`/#workbench=${id}`);
    await expect(page.locator(".workbench-frame").first()).toBeVisible();
    await expect(page.locator(".workbench-frame h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});