import { chromium } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "images");
const baseUrl = process.env.APIVOY_SCREENSHOT_BASE ?? "http://127.0.0.1:5180";

const workspaceTree = {
  workspaces: [{ id: "ws-1", name: "Demo Workspace", archived: false, lastOpenedAt: new Date().toISOString() }],
  projects: [{ id: "default-project", workspaceId: "ws-1", name: "Demo Project", sortOrder: 0 }],
  collections: [{ id: "default-collection", projectId: "default-project", parentId: null, name: "Examples", sortOrder: 0, tags: [] }],
  requests: [],
};

const health = {
  service: "apivoy-agent",
  version: "0.1.0",
  agentVersion: "0.1.0",
  protocolApiVersion: "1",
  minProtocolApiVersion: "1",
  maxProtocolApiVersion: "1",
  authRequired: true,
};

function mockAgent(route) {
  const req = route.request();
  const url = new URL(typeof req.url === "function" ? req.url() : req.url);
  const pathname = url.pathname;

  if (pathname === "/health") {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(health) });
  }
  if (pathname === "/v1/session") {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ token: "screenshot-session-token" }) });
  }
  if (pathname === "/v1/workspace-tree") {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(workspaceTree) });
  }
  if (pathname === "/v1/environments/default") {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "default", variables: {}, secretRefs: [] }) });
  }
  if (pathname.startsWith("/v1/history")) {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  }
  if (pathname.startsWith("/v1/plugins")) {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  }
  if (pathname.startsWith("/v1/mock-rules")) {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  }
  if (pathname.startsWith("/v1/capture/")) {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ running: false, bind: "127.0.0.1:39219", count: 0 }) });
  }
  if (pathname === "/v1/executions" && route.request().method() === "POST") {
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ executionId: "demo-exec-1", state: "running" }),
    });
  }
  if (pathname.endsWith("/events")) {
    const body = [
      "event: message",
      'data: {"type":"response_meta","status":200,"contentType":"application/json","headers":{"content-type":"application/json"}}',
      "",
      "event: message",
      'data: {"type":"response_chunk","preview":"{\\"url\\":\\"https://httpbin.org/get\\",\\"args\\":{}}","done":true}',
      "",
      "event: message",
      'data: {"type":"completed","summary":{"executionId":"demo-exec-1","requestId":"req-1","protocolId":"http","state":"completed","status":200,"durationMs":142,"bytesSent":0,"bytesReceived":48,"startedAt":"2026-01-01T00:00:00.000Z","finishedAt":"2026-01-01T00:00:00.142Z"}}',
      "",
    ].join("\n");
    return route.fulfill({ contentType: "text/event-stream", body });
  }
  if (pathname.includes("/body")) {
    return route.fulfill({ contentType: "text/plain", body: '{"url":"https://httpbin.org/get","args":{}}' });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
}

async function preparePage(page) {
  await page.addInitScript(() => {
    localStorage.setItem("apivoy:locale", "en-US");
    localStorage.setItem("apivoy-agent-token", "screenshot-bootstrap-token");
    document.documentElement.lang = "en-US";
    const uiState = { state: { collapsedNavigation: false, collapsedExplorer: false, themeMode: "dark", activeWorkbench: "http" }, version: 3 };
    localStorage.setItem("apivoy:ui-state", JSON.stringify(uiState));
  });
  await page.route("http://127.0.0.1:39217/**", mockAgent);
}

async function openWorkbench(page, id) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.evaluate((workbenchId) => {
    window.dispatchEvent(new CustomEvent("apivoy-create-workbench", { detail: workbenchId }));
  }, id);
  await page.waitForTimeout(800);
}

async function expandProtocolNav(page) {
  const deck = page.locator(".workbench-deck");
  if (await deck.evaluate((node) => node.classList.contains("protocol-nav-collapsed"))) {
    await page.getByRole("button", { name: "Toggle workbench navigation" }).click();
    await page.waitForTimeout(300);
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(outDir, "_video"), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await preparePage(page);

  await openWorkbench(page, "http");
  await expandProtocolNav(page);
  await page.screenshot({ path: path.join(outDir, "overview.png") });

  await page.keyboard.press("Control+K");
  await page.locator(".command-palette").waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, "protocol-list.png") });
  await page.keyboard.press("Escape");

  await page.locator("#http-target-url").fill("https://httpbin.org/get");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, "http-workbench.png") });

  await openWorkbench(page, "grpc");
  await page.screenshot({ path: path.join(outDir, "grpc-workbench.png") });

  await openWorkbench(page, "plugins");
  await page.screenshot({ path: path.join(outDir, "plugins-or-runner.png") });

  await openWorkbench(page, "http");
  await page.locator("#http-target-url").fill("https://httpbin.org/get");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, "response-timeline.png") });

  const video = page.video();
  await page.close();
  await context.close();

  if (video) {
    const webmPath = await video.path();
    const gifPath = path.join(outDir, "demo.gif");
    const { spawnSync } = await import("node:child_process");
    const ffmpeg = spawnSync(
      "ffmpeg",
      ["-y", "-i", webmPath, "-vf", "fps=8,scale=960:-1:flags=lanczos", "-t", "30", gifPath],
      { stdio: "inherit" },
    );
    if (ffmpeg.status !== 0) {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(webmPath, path.join(outDir, "demo.webm"));
      console.warn("ffmpeg not available; wrote demo.webm instead of demo.gif");
    }
  }

  await browser.close();
  console.log(`Screenshots written to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
