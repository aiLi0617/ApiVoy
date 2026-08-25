import assert from "node:assert/strict";
import { readableDefinitionError } from "./InterfaceLifecycle";

assert.equal(readableDefinitionError(new Error("&#x20;"), "fallback"), "fallback");
assert.equal(readableDefinitionError("request&#x20;not&#x20;found", "fallback"), "request not found");
assert.equal(readableDefinitionError({}, "fallback"), "fallback");

console.log("Interface lifecycle error tests passed");
