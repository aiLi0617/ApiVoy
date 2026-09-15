import assert from "node:assert/strict";
import test from "node:test";
import { buildMockResponseBody, inferMockScenario, mockPathFromUrl, selectMockResponse, type MockSeedResponse } from "./mockGeneration";

const responses: MockSeedResponse[] = [
  {
    id: "ok", name: "成功", statusCode: "200", contentType: "application/json",
    fields: [
      { id: "user", name: "user", type: "object" },
      { id: "id", parentId: "user", name: "id", type: "integer" },
      { id: "email", parentId: "user", name: "email", type: "string" },
      { id: "roles", name: "roles", type: "array" },
      { id: "role", parentId: "roles", name: "items", type: "string", example: '"admin"' },
      { id: "unsafe", name: "__proto__", type: "object" },
    ],
  },
  { id: "error", name: "未授权", statusCode: "401", contentType: "application/json", fields: [] },
];

test("builds deterministic contract-driven Mock bodies", () => {
  assert.deepEqual(JSON.parse(buildMockResponseBody(responses[0], "smart", "success")), {
    user: { id: 1001, email: "user@example.com" },
    roles: ["admin"],
  });
  assert.deepEqual(JSON.parse(buildMockResponseBody(responses[0], "smart", "empty")), {
    user: { id: 0, email: "" },
    roles: [],
  });
});

test("selects defined error responses and rejects prototype field names", () => {
  assert.equal(selectMockResponse(responses, "error")?.id, "error");
  const value = JSON.parse(buildMockResponseBody(responses[0], "smart", "success"));
  assert.equal(Object.hasOwn(value, "__proto__"), false);
});

test("extracts a stable path from absolute and relative interface URLs", () => {
  assert.equal(mockPathFromUrl("https://api.example.com/v1/users?page=2"), "/v1/users");
  assert.equal(mockPathFromUrl("/health?verbose=1"), "/health");
});


test("uses a status encoded in the endpoint path as the initial scenario", () => {
  assert.deepEqual(inferMockScenario({ interfaceName: "status", method: "GET", path: "/status/401", responses }), { template: "error", responseId: "error" });
  assert.deepEqual(inferMockScenario({ interfaceName: "users", method: "GET", path: "/v1/users/10001", responses }), { template: "success" });
});
