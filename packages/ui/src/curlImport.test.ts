import assert from "node:assert/strict";
import test from "node:test";
import { parseCurl } from "./curlImport";

test("parses a cURL command into a complete HTTP request", () => {
  const request = parseCurl("curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' --data-raw '{\"name\":\"Ada\"}'");
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://api.example.com/users");
  assert.deepEqual(request.headers, [["Content-Type", "application/json"]]);
  assert.equal(request.body, '{"name":"Ada"}');
  assert.equal(request.name, "/users");
});

test("infers POST for cURL data and accepts curl.exe", () => {
  const request = parseCurl("curl.exe https://api.example.com/items --data value");
  assert.equal(request.method, "POST");
  assert.equal(request.body, "value");
});

test("rejects input without a cURL command or URL", () => {
  assert.throws(() => parseCurl("wget https://example.com"), /curl/i);
  assert.throws(() => parseCurl("curl -X GET"), /URL/);
});
