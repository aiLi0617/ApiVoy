import assert from "node:assert/strict";
import { readableDefinitionError } from "./InterfaceLifecycle";

assert.equal(readableDefinitionError(new Error("&#x20;"), "fallback"), "fallback");
assert.equal(readableDefinitionError("request&#x20;not&#x20;found", "fallback"), "request not found");
assert.equal(readableDefinitionError({}, "fallback"), "fallback");
// Single-pass decode must not turn &amp;lt; into <
assert.equal(readableDefinitionError("a &amp;lt; b", "fallback"), "a &lt; b");
assert.equal(readableDefinitionError("use &quot;quotes&quot;", "fallback"), 'use "quotes"');

console.log("Interface lifecycle error tests passed");
