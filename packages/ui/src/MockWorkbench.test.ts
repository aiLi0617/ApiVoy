import assert from "node:assert/strict";
import test from "node:test";
import { parseMockHeaders } from "./MockWorkbench";

test("parses string-valued Mock response headers", () => {
  assert.deepEqual(parseMockHeaders('{"Content-Type":"application/json","X-Test":"yes"}'), {
    "Content-Type": "application/json",
    "X-Test": "yes",
  });
});

test("rejects non-object or non-string Mock response headers", () => {
  assert.throws(() => parseMockHeaders("[]"), /JSON 对象/);
  assert.throws(() => parseMockHeaders('{"Retry-After":3}'), /必须是字符串/);
});
