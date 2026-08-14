import assert from "node:assert/strict";
import { requestNameFromUrl } from "./HttpWorkbench";

assert.equal(requestNameFromUrl("https://api.example.com/users/42?include=team"), "/users/42");
assert.equal(requestNameFromUrl("/health?verbose=true"), "/health");
assert.equal(requestNameFromUrl(""), "未命名接口");

console.log("Request name tests passed");
