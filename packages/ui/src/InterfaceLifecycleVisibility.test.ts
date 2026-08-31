import assert from "node:assert/strict";
import test from "node:test";
import { visibleLifecycleTabsFor } from "./InterfaceLifecycle";

test("places test cases after the documentation preview for saved interfaces", () => {
  assert.deepEqual(visibleLifecycleTabsFor("http", true), ["debug", "definition", "docs", "examples", "mock"]);
  assert.deepEqual(visibleLifecycleTabsFor("websocket", true), ["debug", "docs", "examples", "mock"]);
});

test("hides test cases and Mock until a new interface has been saved", () => {
  assert.deepEqual(visibleLifecycleTabsFor("http", false), ["debug", "definition", "docs"]);
  assert.deepEqual(visibleLifecycleTabsFor("websocket", false), ["debug", "docs"]);
  assert.deepEqual(visibleLifecycleTabsFor("tcp", false), ["debug"]);
});
