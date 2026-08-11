import test from "node:test";
import assert from "node:assert/strict";
import { generateProtocolCode, listCodeTemplates, registerCodeTemplate } from "./ProtocolCodeGenerator.js";
import { generateHttpCode, registerHttpCodeTemplate } from "./CodeGenerator.js";
import { setLocale, translate } from "./i18n.js";
import { exportTeamSnapshot, restoreTeamSnapshot } from "./teamSnapshot.js";
import { createHttpRequest } from "@apivoy/request-model";
import type { WorkspaceTree } from "./WorkspaceExplorer.js";

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

test("exports redacted team snapshots and restores hierarchy idempotently", async () => {
  const tree = { workspaces: [{ id: "w1", name: "Team" }], projects: [{ id: "p1", workspaceId: "w1", name: "API" }], collections: [{ id: "c1", projectId: "p1", name: "Root", parentId: null, sortOrder: 0 }], requests: [{ id: "r1", projectId: "p1", collectionId: "c1", name: "GET", method: "GET", target: "https://example.com" }] };
  const envelope = createHttpRequest({ name: "GET", url: "https://example.com", headers: [["Authorization", "Bearer literal"]], variables: { apiKey: "literal", safe: "visible" } });
  const snapshot = await exportTeamSnapshot(tree, async () => envelope);
  assert.equal((snapshot.requests[0].envelope.payload as { headers: Array<[string,string]> }).headers[0][1], "{{redacted}}");
  assert.equal(snapshot.requests[0].envelope.variables.apiKey, "{{redacted}}");
  assert.equal(snapshot.requests[0].envelope.variables.safe, "visible");
  const state: WorkspaceTree = { workspaces: [], projects: [], collections: [], requests: [] };
  const adapter = { getTree: async () => structuredClone(state), createWorkspace: async (name: string) => { const item={id:`w${state.workspaces.length+1}`,name};state.workspaces.push(item);return item; }, createProject: async (workspaceId: string,name: string) => {const item={id:`p${state.projects.length+1}`,workspaceId,name};state.projects.push(item);return item;}, createCollection: async (projectId:string,parentId:string|null,name:string)=>{const item={id:`c${state.collections.length+1}`,projectId,parentId,name,sortOrder:0};state.collections.push(item);return item;}, saveEnvelope: async (request: typeof envelope,projectId:string,collectionId:string)=>{state.requests=[{id:request.id,projectId,collectionId,name:request.name,target:request.target,method:"GET"}];} };
  const first = await restoreTeamSnapshot(snapshot, adapter); const second = await restoreTeamSnapshot(snapshot, adapter);
  assert.deepEqual(first,{workspaces:1,projects:1,collections:1,requests:1}); assert.deepEqual(second,first); assert.equal(state.workspaces.length,1); assert.equal(state.projects.length,1); assert.equal(state.collections.length,1);
});
