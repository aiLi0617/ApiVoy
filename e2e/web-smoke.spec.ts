import { expect, test, type Page } from "@playwright/test";

const workbenchIds = ["http", "grpc", "websocket", "sse", "tcp", "udp", "mqtt", "amqp", "kafka", "redis", "sql", "mock", "runner", "gateway", "capture", "plugins", "ai"];

async function expectActiveWorkbench(page: Page, id: string) {
  await expect(page.getByTestId(`workbench-${id}`).first()).toHaveAttribute("aria-current", "page");
  const frame = page.locator(".workbench-panel:not([hidden]) .workbench-frame");
  await expect(frame).toBeVisible();
  await expect(frame.locator("h1")).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:39217/**", (route) => route.abort());
  await page.goto("/#workbench=http");
});

test("opens the grouped protocol workspace without horizontal overflow", async ({ page }) => {
  await expect(page).toHaveTitle("ApiVoy");
  await expect(page.locator(".workbench-tabs")).toBeVisible();
  await expectActiveWorkbench(page, "http");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const separator = page.getByRole("separator", { name: /请求配置和响应检查器/ });
  await expect(separator).toBeVisible();
  const initialRatio = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(initialRatio + 5));
});

test("switches workbenches and preserves URL and stored state", async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "redis" })));
  await expectActiveWorkbench(page, "redis");
  await expect(page).toHaveURL(/#workbench=redis/);
  await expect.poll(() => page.evaluate(() => {
    const persisted = localStorage.getItem("apivoy:ui-state");
    if (!persisted) return null;
    try { return (JSON.parse(persisted) as { state?: { activeWorkbench?: string } }).state?.activeWorkbench ?? null; } catch { return null; }
  })).toBe("redis");
  await page.reload();
  await expectActiveWorkbench(page, "redis");
});

test("switches theme and keeps visible keyboard focus", async ({ page }) => {
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Control+K");
  await expect(page.locator(".command-palette")).toBeVisible();
  await expect(page.locator(".command-input-wrap input")).toBeFocused();
});

test("keeps project settings separate from application settings", async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-open-project-settings")));
  const projectSettings = page.getByRole("dialog", { name: "项目设置" });
  await expect(projectSettings).toContainText("项目级");
  await expect(projectSettings).toContainText("环境与变量");
  await projectSettings.getByRole("button", { name: "完成" }).click();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("apivoy-open-settings")));
  const applicationSettings = page.locator(".settings-dialog").filter({ hasText: /软件级|Application-wide/ });
  await expect(applicationSettings).toContainText(/软件级|Application-wide/);
  await expect(applicationSettings).toContainText(/不随项目切换|do not change with projects/);
  await expect(applicationSettings).not.toContainText("环境与变量");
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
    await expectActiveWorkbench(page, id);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});

test("all protocol workbenches keep light theme bounds", async ({ page }) => {
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const id of workbenchIds) {
    await page.goto(`/#workbench=${id}`);
    await expectActiveWorkbench(page, id);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} light horizontal overflow`).toBeLessThanOrEqual(1);
  }
});

test("HTTP workbench exposes busy state semantics", async ({ page }) => {
  const frame = page.locator(".workbench-panel:not([hidden]) .workbench-frame");
  await expect(frame).not.toHaveAttribute("aria-busy", "true");
  await expect(frame).toHaveAttribute("aria-labelledby", /workbench-title-http/);
});

test("broker and database workbenches keep save action compact and request content visible", async ({ page }) => {
  for (const id of ["mqtt", "amqp", "kafka", "redis", "sql"]) {
    await page.evaluate((workbenchId) => window.dispatchEvent(new CustomEvent("apivoy-create-workbench", { detail: workbenchId })), id);
    await expectActiveWorkbench(page, id);
    const frame = page.locator(".workbench-panel:not([hidden]) .workbench-frame");
    const save = frame.getByRole("button", { name: "保存", exact: true });
    await expect(save).toBeVisible();
    expect((await save.boundingBox())?.height).toBeLessThanOrEqual(40);
    const content = frame.locator(".protocol-request-content");
    await expect(content).toBeVisible();
    expect((await content.boundingBox())?.height).toBeGreaterThan(80);
  }
});
