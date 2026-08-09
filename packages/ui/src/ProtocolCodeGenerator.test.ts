import test from "node:test";
import assert from "node:assert/strict";
import { generateProtocolCode, listCodeTemplates, registerCodeTemplate } from "./ProtocolCodeGenerator.js";
import { generateHttpCode, registerHttpCodeTemplate } from "./CodeGenerator.js";
import { setLocale, translate } from "./i18n.js";

test("generates protocol-specific snippets for all non-HTTP MVP protocols", () => {
  for (const protocol of ["graphql", "grpc", "websocket", "sse", "tcp", "udp"] as const) assert.ok(listCodeTemplates(protocol).length > 0, protocol);
  const code = generateProtocolCode({ protocol: "tcp", request: { protocol: "tcp", name: "echo", target: "localhost:9000", data: "hello", encoding: "text", sendCount: 1, intervalMs: 0, timeoutMs: 1000, tls: false } }, "tcp.netcat");
  assert.match(code, /nc localhost 9000/);
});

test("registers and removes plugin code templates", () => {
  const removeProtocol = registerCodeTemplate({ id: "plugin.demo", label: "Demo", protocols: ["udp"], source: "plugin", generate: () => "plugin protocol" });
  assert.equal(generateProtocolCode({ protocol: "udp", request: { protocol: "udp", name: "demo", target: "localhost:9", data: "", encoding: "text", sendCount: 1, intervalMs: 0, timeoutMs: 1000, tls: false } }, "plugin.demo"), "plugin protocol");
  removeProtocol();
  assert.throws(() => generateProtocolCode({ protocol: "udp", request: { protocol: "udp", name: "demo", target: "localhost:9", data: "", encoding: "text", sendCount: 1, intervalMs: 0, timeoutMs: 1000, tls: false } }, "plugin.demo"));

  const removeHttp = registerHttpCodeTemplate({ id: "plugin.http", label: "HTTP plugin", generate: (request) => request.url });
  assert.equal(generateHttpCode({ method: "GET", url: "https://example.com", headers: [], timeoutMs: 30000, variables: {}, assertions: [], followRedirects: true, retryMax: 0, retryBackoffMs: 0, tlsVerify: true }, "plugin.http"), "https://example.com");
  removeHttp();
});

test("switches complete locale resources deterministically", () => {
  setLocale("en-US");
  assert.equal(translate("nav.collections"), "Collections");
  assert.equal(translate("region.fallback", { index: 2 }), "Section 2");
  setLocale("zh-CN");
  assert.equal(translate("nav.collections"), "集合");
});
