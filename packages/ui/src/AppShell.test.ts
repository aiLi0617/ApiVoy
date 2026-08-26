import assert from "node:assert/strict";
import { calculateExplorerWidth } from "./AppShell";

assert.equal(calculateExplorerWidth(368, 68, 500), 300, "project rail offset must not be included in explorer width");
assert.equal(calculateExplorerWidth(40, 68, 500), 0, "dragging left of the explorer collapses its transient width");
assert.equal(calculateExplorerWidth(800, 68, 420), 420, "explorer width must remain capped");

console.log("AppShell resize tests passed");
