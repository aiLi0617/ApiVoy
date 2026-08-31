import assert from "node:assert/strict";
import test from "node:test";
import { validateDesignedResponse } from "./designedResponseValidator";
import { DEFAULT_RESPONSE_VALIDATION_SETTINGS } from "./responseValidationSettings";

test("fails response validation when the actual HTTP status differs from the selected response", () => {
  const assertions = validateDesignedResponse(
    { status: "200", fields: [] },
    {
      summary: {
        executionId: "run-1",
        requestId: "request-1",
        protocolId: "http",
        state: "completed",
        status: 404,
        durationMs: 1,
        bytesReceived: 0,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:00.001Z",
      },
      eventCount: 0,
    },
    DEFAULT_RESPONSE_VALIDATION_SETTINGS,
  );

  assert.equal(assertions.length, 1);
  assert.equal(assertions[0]?.passed, false);
  assert.equal(assertions[0]?.expected, "200");
  assert.equal(assertions[0]?.actual, "404");
});
test("validates required response headers and their declared value types", () => {
  const assertions = validateDesignedResponse(
    { status: "200", fields: [
      { id: "rate", name: "X-Rate-Limit", type: "integer", required: true, scope: "response.headers" },
      { id: "trace", name: "X-Trace", type: "string", required: true, scope: "response.headers" },
    ] },
    { summary: { status: 200 }, responseMeta: { headers: [["x-rate-limit", "many"]] } },
    DEFAULT_RESPONSE_VALIDATION_SETTINGS,
  );

  assert.equal(assertions.find((item) => item.name.endsWith("X-Rate-Limit"))?.passed, false);
  assert.equal(assertions.find((item) => item.name.endsWith("X-Trace"))?.message, "缺少必需 Header");
});

test("validates the designed body media type and XML syntax without body fields", () => {
  const assertions = validateDesignedResponse(
    { status: "200", bodyType: "xml", contentType: "application/xml", fields: [] },
    { summary: { status: 200 }, preview: "<root><item></root>", responseMeta: { headers: [["Content-Type", "text/plain"]], contentType: "text/plain" } },
    DEFAULT_RESPONSE_VALIDATION_SETTINGS,
  );

  assert.equal(assertions.find((item) => item.name.endsWith("Content-Type"))?.passed, false);
  assert.equal(assertions.find((item) => item.name.endsWith("Body 格式"))?.message, "响应 Body 不是有效 XML");
});

test("validates every array item and rejects additional object properties when configured", () => {
  const settings = { ...DEFAULT_RESPONSE_VALIDATION_SETTINGS, allowAdditionalProperties: false };
  const assertions = validateDesignedResponse(
    { status: "200", bodyType: "json", fields: [
      { id: "users", name: "users", type: "array", required: true, scope: "response.body" },
      { id: "name", parentId: "users", name: "name", type: "string", required: true, scope: "response.body" },
    ] },
    { summary: { status: 200 }, preview: '{"users":[{"name":"Ada"},{"name":2,"extra":true}]}', responseMeta: { headers: [["Content-Type", "application/json"]], contentType: "application/json" } },
    settings,
  );

  assert.equal(assertions.find((item) => item.name.includes("users[1].name"))?.passed, false);
  assert.equal(assertions.find((item) => item.name.includes("users[1].extra"))?.message, "不允许额外属性");
});
test("keeps module switches independent from the legacy interface-run alias", () => {
  const assertions = validateDesignedResponse(
    { status: "200", fields: [] },
    { summary: { status: 500 } },
    { ...DEFAULT_RESPONSE_VALIDATION_SETTINGS, enabled: false, interfaceRun: false, singleCase: true },
  );

  assert.equal(assertions.find((item) => item.name.endsWith("HTTP 状态码"))?.passed, false);
});

test("stops body validation when the response exceeds the safety budget", () => {
  const assertions = validateDesignedResponse(
    { status: "200", bodyType: "json", fields: [{ id: "value", name: "value", type: "string", required: true, scope: "response.body" }] },
    { summary: { status: 200 }, preview: " ".repeat(1_000_001), responseMeta: { contentType: "application/json", headers: [] } },
    { ...DEFAULT_RESPONSE_VALIDATION_SETTINGS, bodyFormat: false },
  );

  assert.equal(assertions.find((item) => item.name.endsWith("Body 结构"))?.message, "响应 Body 过大，已跳过结构校验");
});
