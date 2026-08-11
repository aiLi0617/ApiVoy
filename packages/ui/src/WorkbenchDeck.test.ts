import assert from "node:assert/strict";
import { resolveWorkbenchId, type WorkbenchTab } from "./WorkbenchDeck";

const tabs: WorkbenchTab[] = [
  { id: "http", label: "HTTP", protocol: "http" },
  { id: "mqtt", label: "MQTT", protocol: "mqtt" },
];

assert.equal(resolveWorkbenchId(tabs, "mqtt"), "mqtt", "restores a valid workbench");
assert.equal(resolveWorkbenchId(tabs, "removed"), "http", "falls back when a stored workbench was removed");
assert.equal(resolveWorkbenchId(tabs, null), "http", "defaults to the primary workbench");
assert.equal(resolveWorkbenchId([], "http"), "", "handles an empty deck");

console.log("WorkbenchDeck tests passed");
