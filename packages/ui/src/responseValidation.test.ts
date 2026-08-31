import assert from "node:assert/strict";
import test from "node:test";
import type { Assertion } from "@apivoy/request-model";
import { ASSERTION_SCHEMA_VERSION, assertionValid, generatedAssertions } from "./HttpWorkbench";

test("uses an explicit schema version and rejects incomplete rules", () => {
    assert.equal(ASSERTION_SCHEMA_VERSION, 2);
    const rule: Assertion = { id: "r", enabled: true, target: "json_path", operator: "equals", selector: "", expected: "1" };
    assert.equal(assertionValid(rule), false);
    assert.equal(assertionValid({ ...rule, selector: "$.id" }), true);
  });

test("generates nested object, first-array-element and array-length rules", () => {
    const result = generatedAssertions('{"data":{"items":[{"id":7},{"id":8}]}}', 200, [["content-type", "application/json"]]);
    assert.equal(result.warning, undefined);
    assert.ok(result.rules.some((rule) => rule.target === "status" && rule.expected === "200"));
    assert.ok(result.rules.some((rule) => rule.target === "header" && rule.selector === "content-type"));
    assert.ok(result.rules.some((rule) => rule.selector === "$.data.items" && rule.operator === "length_equals" && rule.expected === "2"));
    assert.ok(result.rules.some((rule) => rule.selector === "$.data.items[0].id" && rule.expected === "7"));
  });

test("stops expanding oversized untrusted responses", () => {
    const result = generatedAssertions(JSON.stringify({ value: "x".repeat(1_000_001) }), 200, []);
    assert.match(result.warning ?? "", /1 MB/);
    assert.equal(result.rules.length, 1);
  });
