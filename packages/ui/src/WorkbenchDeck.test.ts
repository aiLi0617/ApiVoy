import assert from "node:assert/strict";
import { resolveHashWorkbenchId, resolveWorkbenchId, type WorkbenchTab } from "./WorkbenchDeck";

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

console.log("WorkbenchDeck tests passed");
