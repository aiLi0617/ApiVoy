import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIpAddresses, normalizeMockConditions } from "./MockWorkbench";

test("normalizes visual Mock conditions including client IP and existence checks", () => {
  assert.deepEqual(normalizeMockConditions([
    { source: "ip", name: "", operator: "equals", value: " 127.0.0.1 " },
    { source: "body", name: " $.user.id ", operator: "exists", value: "ignored" },
  ]), [
    { source: "ip", name: "clientIp", operator: "equals", value: "127.0.0.1" },
    { source: "body", name: "$.user.id", operator: "exists", value: null },
  ]);
  assert.throws(() => normalizeMockConditions([
    { source: "query", name: "", operator: "equals", value: "1" },
  ]), /完整填写/);
  assert.deepEqual(normalizeMockConditions([
    { active: false, source: "query", name: "", operator: "equals", value: "" },
  ]), []);
});

test("normalizes multiple IP values without duplicates", () => {
  assert.deepEqual(normalizeIpAddresses("127.0.0.1, 192.168.1.8\n127.0.0.1"), ["127.0.0.1", "192.168.1.8"]);
});
