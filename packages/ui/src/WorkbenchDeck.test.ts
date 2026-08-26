import assert from "node:assert/strict";
import { createNewPageSession, createProjectOverviewSession, resolveHashWorkbenchId, resolveInitialWorkbenchId, resolveWorkbenchId, type WorkbenchTab } from "./WorkbenchDeck";

const tabs: WorkbenchTab[] = [
  { id: "http", label: "HTTP", protocol: "http" },
  { id: "mqtt", label: "MQTT", protocol: "mqtt" },
];

assert.equal(resolveWorkbenchId(tabs, "mqtt"), "mqtt", "restores a valid workbench");
assert.equal(resolveWorkbenchId(tabs, "removed"), "http", "falls back when a stored workbench was removed");
assert.equal(resolveWorkbenchId(tabs, null), "http", "defaults to the primary workbench");
assert.equal(resolveWorkbenchId([], "http"), "", "handles an empty deck");
assert.equal(resolveHashWorkbenchId(tabs, "#workbench=mqtt"), "mqtt", "reads a valid hash workbench");
assert.equal(resolveHashWorkbenchId(tabs, "#workbench=http&request=1"), "http", "keeps hash workbench among other params");
assert.equal(resolveHashWorkbenchId(tabs, "#workbench=removed"), null, "rejects an unknown hash workbench");
assert.equal(resolveHashWorkbenchId(tabs, "#theme=dark"), null, "ignores hashes without a workbench");
assert.equal(resolveHashWorkbenchId(tabs, ""), null, "ignores an empty hash");
assert.equal(resolveInitialWorkbenchId(tabs, ""), "__new", "opens the project overview for a normal launch");
assert.equal(resolveInitialWorkbenchId(tabs, "#workbench=mqtt"), "mqtt", "preserves an explicit deep link");
assert.equal(resolveInitialWorkbenchId(tabs, "#project=p1&view=resources"), "__project", "restores the project page when no workbench is active");
assert.deepEqual(createNewPageSession("new-page"), { id: "new-page", workbenchId: "__project", title: "新建" }, "keeps new and replacement tabs on the project new page");
assert.deepEqual(createProjectOverviewSession("overview"), { id: "overview", workbenchId: "__new", title: "项目概览" }, "returns the main-window action to the project overview instead of a new workbench page");

console.log("WorkbenchDeck tests passed");
