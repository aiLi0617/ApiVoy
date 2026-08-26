import assert from "node:assert/strict";
import test from "node:test";
import { parseCurl, parseCurlWithWarnings } from "./curlImport";
import { sanitizeHttpRequestForPersistence } from "./HttpWorkbench";

test("parses a complete HTTP request", () => { const r = parseCurl("curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' --data-raw '{\"name\":\"Ada\"}'"); assert.equal(r.method, "POST"); assert.equal(r.url, "https://api.example.com/users"); assert.deepEqual(r.headers, [["Content-Type", "application/json"]]); assert.equal(r.body, '{"name":"Ada"}'); assert.equal(r.name, "/users"); });
test("infers POST and accepts curl.exe", () => { const r = parseCurl("curl.exe https://api.example.com/items --data value"); assert.equal(r.method, "POST"); assert.equal(r.body, "value"); });
test("rejects invalid input", () => { assert.throws(() => parseCurl("wget https://example.com"), /curl/i); assert.throws(() => parseCurl("curl -X GET"), /URL/); });
test("imports transport options without persisting auth or cookies", () => { const r = parseCurlWithWarnings("curl --url https://api.example.com/private -u ada:secret -b 'sid=123' -L -k -x http://proxy.test:8080 --max-time 2"); assert.equal(r.request.url, "https://api.example.com/private"); assert.deepEqual(r.request.auth, { kind: "basic", username: "ada", secret_ref: null }); assert.deepEqual(r.request.headers, []); assert.match(r.warnings.join("\n"), /Cookie.*未导入/); assert.equal(r.request.followRedirects, true); assert.equal(r.request.tlsVerify, false); assert.equal(r.request.proxy, "http://proxy.test:8080"); assert.equal(r.request.timeoutMs, 2000); });
test("drops credential headers and keeps ordinary headers", () => { const r = parseCurlWithWarnings("curl https://api.example.com -H 'Authorization: Bearer top-secret' -H 'X-Api-Key: top-secret' -H 'Accept: application/json'"); assert.deepEqual(r.request.headers, [["Accept", "application/json"]]); assert.match(r.warnings.join("\n"), /Authorization Header 未导入/); assert.match(r.warnings.join("\n"), /X-Api-Key Header 未导入/); });
test("moves data to query string for --get", () => { const r = parseCurl("curl https://api.example.com/search --get --data-urlencode 'q=hello world'"); assert.equal(r.method, "GET"); assert.equal(r.url, "https://api.example.com/search?q=hello%20world"); assert.equal(r.body, undefined); });
test("reports unsupported and file-backed options", () => { const r = parseCurlWithWarnings("curl https://api.example.com/upload --data-binary @payload.json --cert client.pem"); assert.match(r.warnings.join("\n"), /\u6587\u4ef6\u5f15\u7528/); assert.match(r.warnings.join("\n"), /--cert/); });
test("sanitizes transient credentials before persistence", () => {
  const request = parseCurl("curl https://api.example.com -H 'Accept: application/json'");
  request.headers.push(
    ["Authorization", "Bearer top-secret"],
    ["Cookie", "sid=top-secret"],
    ["X-Csrf-Token", "top-secret"],
  );
  request.auth = { kind: "bearer", token: "top-secret" };
  request.metadata = {
    __apivoySavedActualRequest: {
      auth: { token: "top-secret", secret_ref: "vault-token" },
      headers: [["X-Api-Key", "top-secret"], ["Accept", "application/json"]],
    },
  };

  const saved = sanitizeHttpRequestForPersistence(request);

  assert.deepEqual(saved.headers, [["Accept", "application/json"]]);
  assert.equal(saved.auth?.token, null);
  assert.deepEqual(saved.metadata, {
    __apivoySavedActualRequest: {
      auth: { secret_ref: "vault-token" },
      headers: [["Accept", "application/json"]],
    },
  });
  assert.equal(request.auth.token, "top-secret");
  assert.equal((request.metadata.__apivoySavedActualRequest as { auth: { token: string } }).auth.token, "top-secret");
});
