import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSE_BODY_TYPES, createResponseComponent, normalizeResponseBodyType } from "./responseComponents";

test("offers structured, streaming and binary response body types", () => {
  assert.deepEqual(RESPONSE_BODY_TYPES.map((item) => item.id), ["json", "xml", "html", "text", "binary", "msgpack", "event-stream", "none"]);
  assert.equal(RESPONSE_BODY_TYPES.find((item) => item.id === "msgpack")?.contentType, "application/msgpack");
  assert.equal(RESPONSE_BODY_TYPES.find((item) => item.id === "event-stream")?.contentType, "text/event-stream");
  assert.equal(normalizeResponseBodyType("sse"), "event-stream");
});

test("creates an optional response component with safe defaults", () => {
  const component = createResponseComponent();
  assert.equal(component.bodyType, "json");
  assert.equal(component.statusCode, undefined);
  assert.equal(component.addToNewInterfaces, false);
});
