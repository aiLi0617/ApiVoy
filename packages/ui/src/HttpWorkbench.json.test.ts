import assert from "node:assert/strict";
import test from "node:test";
import { formatJsonBody } from "./HttpWorkbench";

test("formats a JSON request body with two-space indentation", () => {
  assert.equal(formatJsonBody('{"user":{"name":"Ada"},"active":true}'), '{\n  "user": {\n    "name": "Ada"\n  },\n  "active": true\n}');
});

test("keeps an empty JSON request body unchanged", () => {
  assert.equal(formatJsonBody("   "), "   ");
});

test("rejects malformed JSON", () => {
  assert.throws(() => formatJsonBody('{"name":}'), SyntaxError);
});
