import assert from "node:assert/strict";
import { calculateSplitCollapseThreshold } from "./WorkbenchFrame";

assert.equal(calculateSplitCollapseThreshold(0, 140, 44), .94);
assert.equal(calculateSplitCollapseThreshold(600, 140, 44), 416 / 600);
assert.equal(calculateSplitCollapseThreshold(300, 240, 44), .25);
assert.equal(calculateSplitCollapseThreshold(10_000, 10, 24), .99);

console.log("WorkbenchFrame tests passed");
