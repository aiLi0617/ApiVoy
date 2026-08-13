import assert from "node:assert/strict";
import { encodeMessagePack } from "./HttpWorkbench";

assert.deepEqual([...encodeMessagePack(null)], [0xc0]);
assert.deepEqual([...encodeMessagePack({})], [0x80]);
assert.deepEqual([...encodeMessagePack({ ok: true })], [0x81, 0xa2, 0x6f, 0x6b, 0xc3]);
assert.deepEqual([...encodeMessagePack([1, "x"])], [0x92, 0x01, 0xa1, 0x78]);

console.log("MessagePack tests passed");
