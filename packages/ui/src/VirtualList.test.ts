import assert from "node:assert/strict";
import { getVirtualRange } from "./VirtualList";

assert.deepEqual(getVirtualRange(1_000, 48, 360, 0, 5), { start: 0, end: 18 });
assert.deepEqual(getVirtualRange(1_000, 48, 360, 4_800, 5), { start: 95, end: 113 });
assert.deepEqual(getVirtualRange(8, 48, 360, 0, 5), { start: 0, end: 8 });
