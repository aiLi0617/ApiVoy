import assert from "node:assert/strict";
import {
  createHttpGetRequest,
  createHttpRequest,
  PROTOCOL_API_VERSION,
  reduceCompletedResponsePreview,
  selectResponsePreview,
} from "./index";

const request = createHttpRequest({ url: "https://api.example.com/items", method: "post" });
assert.equal(request.protocolId, "http");
assert.equal(request.payload.type, "http");
assert.equal(request.payload.type === "http" && request.payload.method, "POST");
assert.equal(request.timeoutMs, 30_000);
assert.equal(request.tls.verify, true);

const get = createHttpGetRequest("List items", "https://api.example.com/items");
assert.equal(get.name, "List items");
assert.equal(get.payload.type === "http" && get.payload.method, "GET");
assert.equal(PROTOCOL_API_VERSION, "1");

assert.equal(
  reduceCompletedResponsePreview(null, {
    type: "response_chunk",
    size: 0,
    preview: "",
    done: true,
  }),
  "",
);
assert.equal(
  reduceCompletedResponsePreview("streamed data", {
    type: "response_chunk",
    size: 0,
    preview: null,
    done: true,
  }),
  "streamed data",
);
assert.equal(selectResponsePreview("", "fallback"), "");
assert.equal(selectResponsePreview(null, undefined), null);

console.log("request-model tests passed");
