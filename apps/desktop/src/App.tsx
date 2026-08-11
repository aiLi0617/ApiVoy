import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AppShell,
  HttpWorkbench,
  SseWorkbench,
  SocketWorkbench,
  GraphqlWorkbench,
  WebSocketWorkbench,
  GrpcWorkbench,
  PluginCenter,
  MockWorkbench,
  CollectionRunner,
  WorkbenchDeck,
  TeamWorkbench,
  CommentsWorkbench,
  SsoWorkbench,
  AiWorkbench,
  RpcWorkbench,
  type RpcWorkbenchRequest,
  RedisWorkbench,
  type RedisWorkbenchRequest,
  MqttWorkbench,
  type MqttWorkbenchRequest,
  CaptureWorkbench,
  type CaptureStatus,
  type CapturedExchange,
  type AiAssistRequest,
  type AiAssistResponse,
  exportTeamSnapshot,
  restoreTeamSnapshot,
  WorkspaceExplorer,
  type HistoryFilter,
  type HttpWorkbenchRequest,
  type WorkspaceTree,
  type InstalledPlugin,
  type PluginManifest,
  type MockRule,
  type CollectionRunCase,
} from "@apivoy/ui";
import type {
  AssertionResultEvent,
  ExecutionSummary,
  ExecutionEvent,
  RequestEnvelope,
  ResponseMeta,
} from "@apivoy/request-model";
import { useEffect, useState } from "react";

const AGENT_BASE_URL = (import.meta.env.VITE_APIVOY_AGENT_URL as string | undefined) ?? "http://127.0.0.1:39217";
const AGENT_TOKEN = import.meta.env.VITE_APIVOY_AGENT_TOKEN as string | undefined;
let activeAgentToken = AGENT_TOKEN;
let agentSessionPromise: Promise<void> | null = null;
if (AGENT_TOKEN) localStorage.setItem("apivoy-agent-token", AGENT_TOKEN);

function agentHeaders(): Headers {
  const headers = new Headers({ "Content-Type": "application/json", "X-ApiVoy-Protocol-Api-Version": "1", "X-ApiVoy-Client": "desktop", "X-ApiVoy-Client-Version": "0.1.0" });
  if (activeAgentToken) headers.set("Authorization", `Bearer ${activeAgentToken}`);
  return headers;
}

async function agentJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (AGENT_TOKEN && !agentSessionPromise) agentSessionPromise = (async () => { const response = await fetch(`${AGENT_BASE_URL}/v1/session`, { method: "POST", headers: { Authorization: `Bearer ${AGENT_TOKEN}`, "X-ApiVoy-Protocol-Api-Version": "1" } }); if (!response.ok) throw new Error(`Local Agent session ${response.status}`); const session = await response.json() as { token: string }; activeAgentToken = session.token; localStorage.setItem("apivoy-agent-token", session.token); })();
  await agentSessionPromise;
  const response = await fetch(`${AGENT_BASE_URL}${path}`, { ...init, headers: agentHeaders() });
  if (!response.ok) throw new Error(`Local Agent ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

interface ExecuteResponse {
  executionId: string;
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
  responseBody?: string | null;
  assertions?: AssertionResultEvent[];
  responseMeta?: ResponseMeta | null;
  protocolApiVersion: string;
  desktopVersion: string;
}

interface StoredRequest {
  id: string;
  name: string;
  target: string;
  envelope: RequestEnvelope;
}

interface HistoryRecord {
  id: string;
  protocolId: string;
  state: string;
  status?: number | null;
  durationMs: number;
  startedAt: string;
  requestSnapshot?: RequestEnvelope | null;
  preview?: string | null;
}

interface EnvironmentRecord {
  id: string;
  variables: Record<string, string>;
  secretRefs?: string[];
}

function toInvokeRequest(request: HttpWorkbenchRequest) {
  const auth = request.auth
    ? {
        kind: request.auth.kind,
        secretRef: request.auth.secret_ref ?? null,
        username: request.auth.username ?? null,
        headerName: request.auth.header_name ?? null,
        tokenUrl: request.auth.token_url ?? null,
        scope: request.auth.scope ?? null,
        audience: request.auth.audience ?? null,
        authorizationUrl: request.auth.authorization_url ?? null,
        redirectUri: request.auth.redirect_uri ?? null,
        authorizationCodeRef: request.auth.authorization_code_ref ?? null,
        codeVerifierRef: request.auth.code_verifier_ref ?? null,
      }
    : null;
  return {
    name: request.name ?? `${request.method} ${request.url}`,
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body ?? null,
    multipart: request.multipart ?? [],
    timeoutMs: request.timeoutMs,
    variables: request.variables,
    assertions: request.assertions,
    auth,
    followRedirects: request.followRedirects,
    retryMax: request.retryMax,
    retryBackoffMs: request.retryBackoffMs,
    proxy: request.proxy ?? null,
    tlsVerify: request.tlsVerify,
    tlsClientCertRef: request.tlsClientCertRef ?? null,
    preScripts: request.preScripts ?? [],
    postScripts: request.postScripts ?? [],
  };
}

function fromEnvelope(envelope: RequestEnvelope, fallbackTarget?: string): HttpWorkbenchRequest {
  const payload = envelope.payload;
  if (payload.type !== "http") {
    throw new Error("仅支持 HTTP 请求重放");
  }
  return {
    name: envelope.name,
    url: envelope.target || fallbackTarget || "",
    method: payload.method,
    headers: payload.headers,
    body: payload.body ?? undefined,
    multipart: payload.multipart ?? [],
    timeoutMs: envelope.timeoutMs,
    variables: envelope.variables ?? {},
    assertions: envelope.assertions ?? [],
    auth: envelope.authRef ?? null,
    followRedirects: payload.followRedirects,
    retryMax: envelope.retryPolicy.max_retries,
    retryBackoffMs: envelope.retryPolicy.backoff_ms,
    proxy: envelope.proxy ?? null,
    tlsVerify: envelope.tls.verify,
    tlsClientCertRef: envelope.tls.client_cert_ref ?? null,
    preScripts: envelope.preScripts ?? [],
    postScripts: envelope.postScripts ?? [],
  };
}

export function App() {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("default-project");
  const [selectedCollectionId, setSelectedCollectionId] = useState("default-collection");
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const rpcEnvelope=(request:RpcWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:request.protocol,name:request.name,target:request.url,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:request.protocol==="soap"?{version:request.soapVersion,action:request.action,envelope:request.envelope,headers:request.headers}:{method:request.rpcMethod,params:request.params,id:request.id,headers:request.headers}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const redisEnvelope=(request:RedisWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:"redis",name:request.name,target:request.target,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:{username:request.username,passwordRef:request.passwordRef,database:request.database,commands:request.commands}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const mqttEnvelope=(request:MqttWorkbenchRequest):RequestEnvelope=>({id:crypto.randomUUID(),protocolId:"mqtt",name:request.name,target:request.target,environmentRef:"default-env",authRef:null,timeoutMs:request.timeoutMs,retryPolicy:{max_retries:0,backoff_ms:0},proxy:null,tls:{verify:true,client_cert_ref:null},metadata:{},payload:{type:"raw",value:{mode:request.mode,clientId:request.clientId,username:request.username,passwordRef:request.passwordRef,cleanSession:request.cleanSession,keepAliveSeconds:request.keepAliveSeconds,topic:request.topic,payload:request.payload,encoding:request.encoding,qos:request.qos,retain:request.retain,receiveLimit:request.receiveLimit}},preScripts:[],postScripts:[],assertions:[],variables:{},createdAt:new Date().toISOString()});
  const [externalRequest, setExternalRequest] = useState<HttpWorkbenchRequest | null>(null);

  async function refreshTree() {
    const raw = await invoke<Omit<WorkspaceTree, "requests"> & { requests: Array<WorkspaceTree["requests"][number] & { envelope?: RequestEnvelope }> }>("get_workspace_tree");
    setTree({ ...raw, requests: raw.requests.map((item) => ({ ...item, method: item.envelope?.payload.type === "http" ? item.envelope.payload.method : item.method })) });
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("execution-started", (event) => {
      console.debug("execution-started", event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    void refreshTree();
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <AppShell channelLabel="Desktop → Rust Core" explorer={<WorkspaceExplorer tree={tree} selectedCollectionId={selectedCollectionId} selectedRequestId={selectedRequestId}
      onSelectCollection={(projectId, collectionId) => { setSelectedProjectId(projectId); setSelectedCollectionId(collectionId); }}
      onOpenRequest={async (id) => { const stored = await invoke<StoredRequest | null>("get_request", { id }); setSelectedRequestId(id); if (stored) window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: stored.envelope })); setExternalRequest(stored?.envelope.payload.type === "http" ? fromEnvelope(stored.envelope, stored.target) : null); }}
      onCreateWorkspace={async (name) => { await invoke("create_workspace", { name, rootPath: null }); await refreshTree(); }}
      onRenameWorkspace={async (id, name) => { await invoke("rename_workspace", { id, name }); await refreshTree(); }}
      onArchiveWorkspace={async (id, archived) => { await invoke("archive_workspace", { id, archived }); await refreshTree(); }}
      onTouchWorkspace={async (id) => { await invoke("touch_workspace", { id }); await refreshTree(); }}
      onDeleteWorkspace={async (id) => { await invoke("delete_workspace", { id }); await refreshTree(); }}
      onCreateProject={async (workspaceId, name) => { await invoke("create_project", { workspaceId, name }); await refreshTree(); }}
      onRenameProject={async (id, name) => { await invoke("rename_project", { id, name }); await refreshTree(); }}
      onDeleteProject={async (id) => { await invoke("delete_project", { id }); await refreshTree(); }}
      onCreateCollection={async (projectId, parentId, name) => { await invoke("create_collection", { projectId, parentId, name }); await refreshTree(); }}
      onRenameCollection={async (collection, name) => { await invoke("update_collection", { id: collection.id, name, parentId: collection.parentId ?? null, sortOrder: collection.sortOrder }); await refreshTree(); }}
      onUpdateCollectionTags={async (collection, tags) => { await invoke("update_collection_tags", { id: collection.id, tags }); await refreshTree(); }}
      onDeleteCollection={async (id) => { await invoke("delete_collection", { id }); await refreshTree(); }}
      onMoveCollection={async (collection, projectId, parentId) => { if (projectId !== collection.projectId) throw new Error("暂不支持跨项目移动集合"); await invoke("update_collection", { id: collection.id, name: collection.name, parentId, sortOrder: collection.sortOrder }); await refreshTree(); }}
      onSwapCollections={async (first, second) => { await invoke("update_collection", { id: first.id, name: first.name, parentId: first.parentId ?? null, sortOrder: second.sortOrder }); await invoke("update_collection", { id: second.id, name: second.name, parentId: second.parentId ?? null, sortOrder: first.sortOrder }); await refreshTree(); }}
      onMoveRequest={async (id, projectId, collectionId) => { await invoke("move_request", { id, projectId, collectionId }); await refreshTree(); }}
      onImportRequests={async (projectId, collectionId, requests) => { const paths = new Map<string, string>(); for (const request of requests) { let parentId = collectionId; let key = collectionId; for (const segment of request.collectionPath ?? []) { key += `/${segment}`; let id = paths.get(key); if (!id) { const existing = tree?.collections.find((item) => item.projectId === projectId && (item.parentId ?? null) === parentId && item.name === segment); const created = existing ?? await invoke<WorkspaceTree["collections"][number]>("create_collection", { projectId, parentId, name: segment }); id = created.id; paths.set(key, id); } parentId = id; } await invoke("save_request", { request: toInvokeRequest({ name: request.name, url: request.url, method: request.method, headers: Object.entries(request.headers), body: request.body, timeoutMs: 30000, variables: request.variables ?? {}, assertions: [], auth: null, followRedirects: true, retryMax: 0, retryBackoffMs: 250, proxy: null, tlsVerify: true }), projectId, collectionId: parentId }); } await refreshTree(); }}
      onExportProject={async (project) => { const items = tree?.requests.filter((item) => item.projectId === project.id) ?? []; return Promise.all(items.map(async (item) => { const stored = await invoke<StoredRequest | null>("get_request", { id: item.id }); const request = stored ? fromEnvelope(stored.envelope, stored.target) : null; return { name: item.name, method: request?.method ?? item.method ?? "GET", url: request?.url ?? item.target, headers: Object.fromEntries(request?.headers ?? []), body: request?.body }; })); }}
      onDeleteRequest={async (id) => { await invoke("delete_request", { id }); if (selectedRequestId === id) setSelectedRequestId(null); await refreshTree(); }} />}>
      <WorkbenchDeck tabs={[{ id: "http", label: "HTTP", protocol: "http" }, { id: "sse", label: "SSE", protocol: "sse" }, { id: "socket", label: "TCP / UDP", protocols: ["tcp", "udp"] }, { id: "graphql", label: "GraphQL", protocol: "graphql" }, { id: "websocket", label: "WebSocket", protocol: "websocket" }, { id: "grpc", label: "gRPC", protocol: "grpc" }, { id: "rpc", label: "SOAP / RPC", protocols: ["soap", "jsonrpc"] }, { id: "redis", label: "Redis", protocol: "redis" }, { id: "mqtt", label: "MQTT", protocol: "mqtt" }, { id: "plugins", label: "Plugins" }, { id: "mock", label: "Mock" }, { id: "runner", label: "Runner" }, { id: "team", label: "Team" }, { id: "comments", label: "Comments" }, { id: "sso", label: "SSO" }, { id: "ai", label: "AI" }, { id: "capture", label: "Capture" }]}>
      <HttpWorkbench
        externalRequest={externalRequest}
        onSend={async (request, hooks) => {
          const version = await invoke<{
            desktopVersion: string;
            protocolApiVersion: string;
          }>("version_info");
          if (version.protocolApiVersion !== "1") {
            throw new Error(
              `协议版本不兼容：Desktop 期望 1，当前 ${version.protocolApiVersion}`,
            );
          }

          let activeExecutionId: string | null = null;
          const stop = await listen<string>("execution-started", (event) => {
            activeExecutionId = event.payload;
            hooks?.onStarted?.(event.payload);
          });
          const stopEvents = await listen<{ executionId: string; event: ExecutionEvent }>("execution-event", ({ payload }) => {
            if (activeExecutionId !== payload.executionId) return;
            hooks?.onEvent?.(payload.event);
            if (payload.event.type === "response_chunk" && payload.event.preview) hooks?.onChunk?.(payload.event.preview);
          });
          try {
            const data = await invoke<ExecuteResponse>("execute_request", {
              request: toInvokeRequest(request),
            });
            hooks?.onStarted?.(data.executionId);
            return {
              summary: data.summary,
              eventCount: data.eventCount,
              preview: data.responseBody ?? data.preview ?? JSON.stringify(data.summary, null, 2),
              executionId: data.executionId,
              assertions: data.assertions ?? [],
              responseMeta: data.responseMeta ?? null,
            };
          } finally {
            stop();
            stopEvents();
          }
        }}
        onCancel={async (executionId) => {
          await invoke<boolean>("cancel_execution", { id: executionId });
        }}
        onSave={async (request) => {
          await invoke("save_request", { request: toInvokeRequest(request), projectId: selectedProjectId, collectionId: selectedCollectionId });
          await refreshTree();
        }}
        onLoad={async () => {
          const stored = await invoke<StoredRequest | null>("load_latest_request");
          if (!stored) {
            return null;
          }
          const payload = stored.envelope.payload;
          if (payload.type !== "http") {
            throw new Error("最近保存的请求不是 HTTP");
          }
          return {
            url: stored.target,
            method: payload.method,
            headers: payload.headers,
            body: payload.body ?? undefined,
            timeoutMs: stored.envelope.timeoutMs,
            variables: stored.envelope.variables ?? {},
            assertions: stored.envelope.assertions ?? [],
            auth: stored.envelope.authRef ?? null,
            followRedirects: payload.followRedirects,
            retryMax: stored.envelope.retryPolicy?.max_retries ?? 0,
            retryBackoffMs: stored.envelope.retryPolicy?.backoff_ms ?? 250,
            proxy: stored.envelope.proxy ?? null,
            tlsVerify: stored.envelope.tls?.verify ?? true,
          };
        }}
        onLoadEnvironment={async () => {
          const env = await invoke<EnvironmentRecord>("get_environment");
          return {
            variables: env.variables ?? {},
            secretRefs: env.secretRefs ?? [],
          };
        }}
        onSaveEnvironment={async (variables, secretRefs) => {
          await invoke("save_environment", {
            request: { variables, secretRefs },
          });
        }}
        onPutSecret={async (name, value) => {
          await invoke("put_secret", { request: { name, value } });
        }}
        onListCookies={(url) => invoke<Array<{ name: string; value: string }>>("list_cookies", { url })}
        onSetCookie={async (url, name, value) => { await invoke("set_cookie", { url, name, value }); }}
        onDeleteCookie={async (url, name) => { await invoke("delete_cookie", { url, name }); }}
        onListHistory={async (filter?: HistoryFilter) => {
          const rows = await invoke<HistoryRecord[]>("list_history", {
            limit: 30,
            filter: filter
              ? {
                  state: filter.state ?? null,
                  status: filter.status ?? null,
                  protocolId: filter.protocolId ?? null,
                  requestId: filter.requestId ?? null,
                }
              : null,
          });
          return rows.map((r) => ({
            id: r.id,
            protocolId: r.protocolId,
            state: r.state,
            status: r.status,
            durationMs: r.durationMs,
            startedAt: r.startedAt,
            target: r.requestSnapshot?.target,
            preview: r.preview ?? undefined,
          }));
        }}
        onReplayHistory={async (id) => {
          const item = await invoke<HistoryRecord | null>("get_history_item", { id });
          if (!item?.requestSnapshot) {
            return null;
          }
          return item.requestSnapshot.payload.type === "http" ? fromEnvelope(item.requestSnapshot) : item.requestSnapshot;
        }}
      />
      <SseWorkbench
        onConnect={async (request, hooks) => {
          let activeExecutionId: string | null = null;
          const stop = await listen<string>("execution-started", (event) => { activeExecutionId = event.payload; hooks?.onStarted?.(event.payload); });
          const stopEvents = await listen<{ executionId: string; event: ExecutionEvent }>("execution-event", ({ payload }) => { if (activeExecutionId === payload.executionId && payload.event.type === "response_chunk" && payload.event.preview) hooks?.onChunk?.(payload.event.preview); });
          try {
            const data = await invoke<ExecuteResponse>("execute_sse", { request: { ...request, variables: {} } });
            return { summary: data.summary, eventCount: data.eventCount, preview: data.responseBody ?? data.preview, executionId: data.executionId, assertions: [], responseMeta: data.responseMeta ?? null };
          } finally { stop(); stopEvents(); }
        }}
        onCancel={async (executionId) => { await invoke<boolean>("cancel_execution", { id: executionId }); }}
        onSave={async (request) => { const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: "sse", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "sse", headers: request.headers, lastEventId: request.lastEventId ?? null, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }; await invoke("save_envelope", { request: envelope, projectId: selectedProjectId, collectionId: selectedCollectionId }); await refreshTree(); }}
      />
      <SocketWorkbench
        onSend={async (request, hooks) => {
          const stop = await listen<string>("execution-started", (event) => hooks?.onStarted?.(event.payload));
          try {
            const data = await invoke<ExecuteResponse>("execute_socket", { request });
            return { summary: data.summary, eventCount: data.eventCount, preview: data.responseBody ?? data.preview, executionId: data.executionId, assertions: [], responseMeta: data.responseMeta ?? null };
          } finally { stop(); }
        }}
        onCancel={async (executionId) => { await invoke<boolean>("cancel_execution", { id: executionId }); }}
        onSave={async (request) => { const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: request.protocol, name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: request.protocol === "tcp" ? { type: "tcp", data: request.data, encoding: request.encoding, framing: request.framing, delimiter: request.delimiter, fixedLength: request.fixedLength, sendCount: request.sendCount, intervalMs: request.intervalMs, tls: request.tls, serverName: request.serverName, caCertRef: request.caCertRef } : { type: "udp", data: request.data, encoding: request.encoding, sendCount: request.sendCount, intervalMs: request.intervalMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }; await invoke("save_envelope", { request: envelope, projectId: selectedProjectId, collectionId: selectedCollectionId }); await refreshTree(); }}
      />
      <GraphqlWorkbench
        onSend={async (request, hooks) => {
          const stop = await listen<string>("execution-started", (event) => hooks?.onStarted?.(event.payload));
          try {
            const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: "graphql", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "graphql", query: request.query, variables: request.variables, operationName: request.operationName ?? null, headers: request.headers }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() };
            const data = await invoke<ExecuteResponse>("execute_protocol", { request: envelope });
            return { summary: data.summary, eventCount: data.eventCount, preview: data.responseBody ?? data.preview, executionId: data.executionId, assertions: [], responseMeta: data.responseMeta ?? null };
          } finally { stop(); }
        }}
        onCancel={async (executionId) => { await invoke<boolean>("cancel_execution", { id: executionId }); }}
        onSave={async (request) => { const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: "graphql", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "graphql", query: request.query, variables: request.variables, operationName: request.operationName ?? null, headers: request.headers }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }; await invoke("save_envelope", { request: envelope, projectId: selectedProjectId, collectionId: selectedCollectionId }); await refreshTree(); }}
      />
      <WebSocketWorkbench
        onConnect={async (request, hooks) => {
          let activeExecutionId: string | null = null;
          const stop = await listen<string>("execution-started", (event) => { activeExecutionId = event.payload; hooks?.onStarted?.(event.payload); });
          const stopEvents = await listen<{ executionId: string; event: ExecutionEvent }>("execution-event", ({ payload }) => { if (activeExecutionId === payload.executionId && payload.event.type === "response_chunk" && payload.event.preview) hooks?.onChunk?.(payload.event.preview); });
          try {
            const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: "websocket", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "websocket", headers: request.headers, subprotocols: request.subprotocols, messages: request.messages, receiveLimit: request.receiveLimit, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() };
            const data = await invoke<ExecuteResponse>("execute_protocol", { request: envelope });
            return { summary: data.summary, eventCount: data.eventCount, preview: data.responseBody ?? data.preview, executionId: data.executionId, assertions: [], responseMeta: data.responseMeta ?? null };
          } finally { stop(); stopEvents(); }
        }}
        onCancel={async (executionId) => { await invoke<boolean>("cancel_execution", { id: executionId }); }}
        onSave={async (request) => { const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: "websocket", name: request.name, target: request.url, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "websocket", headers: request.headers, subprotocols: request.subprotocols, messages: request.messages, receiveLimit: request.receiveLimit, reconnectMax: request.reconnectMax, reconnectDelayMs: request.reconnectDelayMs }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }; await invoke("save_envelope", { request: envelope, projectId: selectedProjectId, collectionId: selectedCollectionId }); await refreshTree(); }}
      />
      <GrpcWorkbench
        onSend={async (request, hooks) => {
          const stop = await listen<string>("execution-started", (event) => hooks?.onStarted?.(event.payload));
          try {
            const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: "grpc", name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "grpc", service: request.service, method: request.method, messageBase64: request.messageBase64, messageJson: request.messageJson, descriptorSetBase64: request.descriptorSetBase64, mode: request.mode, metadata: request.metadata }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() };
            const data = await invoke<ExecuteResponse>("execute_protocol", { request: envelope });
            return { summary: data.summary, eventCount: data.eventCount, preview: data.responseBody ?? data.preview, executionId: data.executionId, assertions: [], responseMeta: data.responseMeta ?? null };
          } finally { stop(); }
        }}
        onCancel={async (executionId) => { await invoke<boolean>("cancel_execution", { id: executionId }); }}
        onSave={async (request) => { const envelope: RequestEnvelope = { id: crypto.randomUUID(), protocolId: "grpc", name: request.name, target: request.target, environmentRef: "default-env", authRef: null, timeoutMs: request.timeoutMs, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "grpc", service: request.service, method: request.method, messageBase64: request.messageBase64, messageJson: request.messageJson, descriptorSetBase64: request.descriptorSetBase64, mode: request.mode, metadata: request.metadata }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() }; await invoke("save_envelope", { request: envelope, projectId: selectedProjectId, collectionId: selectedCollectionId }); await refreshTree(); }}
      />
      <RpcWorkbench onSend={async(request,hooks)=>{const stop=await listen<string>("execution-started",event=>hooks?.onStarted?.(event.payload));try{const data=await invoke<ExecuteResponse>("execute_protocol",{request:rpcEnvelope(request)});return{summary:data.summary,eventCount:data.eventCount,preview:data.responseBody??data.preview,executionId:data.executionId,assertions:[],responseMeta:data.responseMeta??null};}finally{stop();}}} onSave={async(request)=>{await invoke("save_envelope",{request:rpcEnvelope(request),projectId:selectedProjectId,collectionId:selectedCollectionId});await refreshTree();}} onCancel={async(executionId)=>{await invoke<boolean>("cancel_execution",{id:executionId});}} />
      <RedisWorkbench onSend={async(request,hooks)=>{const stop=await listen<string>("execution-started",event=>hooks?.onStarted?.(event.payload));try{const data=await invoke<ExecuteResponse>("execute_protocol",{request:redisEnvelope(request)});return{summary:data.summary,eventCount:data.eventCount,preview:data.responseBody??data.preview,executionId:data.executionId,assertions:[],responseMeta:data.responseMeta??null};}finally{stop();}}} onSave={async(request)=>{await invoke("save_envelope",{request:redisEnvelope(request),projectId:selectedProjectId,collectionId:selectedCollectionId});await refreshTree();}} onCancel={async(executionId)=>{await invoke<boolean>("cancel_execution",{id:executionId});}} />
      <MqttWorkbench onSend={async(request,hooks)=>{const stop=await listen<string>("execution-started",event=>hooks?.onStarted?.(event.payload));try{const data=await invoke<ExecuteResponse>("execute_protocol",{request:mqttEnvelope(request)});return{summary:data.summary,eventCount:data.eventCount,preview:data.responseBody??data.preview,executionId:data.executionId,assertions:[],responseMeta:data.responseMeta??null};}finally{stop();}}} onSave={async(request)=>{await invoke("save_envelope",{request:mqttEnvelope(request),projectId:selectedProjectId,collectionId:selectedCollectionId});await refreshTree();}} onCancel={async(executionId)=>{await invoke<boolean>("cancel_execution",{id:executionId});}} />
      <PluginCenter
        onList={() => invoke<InstalledPlugin[]>("list_plugins")}
        onInstall={async (manifest: PluginManifest, wasmBase64: string) => {
          await invoke("install_plugin", { request: { manifest, wasmBase64 } });
        }}
        onEnable={async (id, enabled) => {
          await invoke("set_plugin_enabled", { id, enabled });
        }}
        onDelete={async (id) => {
          await invoke("uninstall_plugin", { id });
        }}
        onInvoke={async (id, input) => {
          const response = await invoke<{ output: string }>("invoke_plugin", { id, input });
          return response.output;
        }}
      />
      <MockWorkbench
        baseUrl={AGENT_BASE_URL}
        onList={() => agentJson<MockRule[]>("/v1/mock-rules")}
        onCreate={async (rule) => { await agentJson<MockRule>("/v1/mock-rules", { method: "POST", body: JSON.stringify(rule) }); }}
        onDelete={async (id) => { await agentJson<void>(`/v1/mock-rules/${id}`, { method: "DELETE" }); }}
      />
      <CollectionRunner collectionId={selectedCollectionId} onRun={(collectionId, failFast) => invoke<CollectionRunCase[]>("run_collection", { collectionId, failFast })} />
      <TeamWorkbench onExportSnapshot={async () => { const snapshotTree = await invoke<WorkspaceTree>("get_workspace_tree"); return exportTeamSnapshot(snapshotTree, async (id) => (await invoke<StoredRequest | null>("get_request", { id }))?.envelope ?? null); }} onRestoreSnapshot={async (snapshot) => { await restoreTeamSnapshot(snapshot, { getTree: async () => invoke<WorkspaceTree>("get_workspace_tree"), createWorkspace: async (name) => invoke("create_workspace", { name, rootPath: null }), createProject: async (workspaceId, name) => invoke("create_project", { workspaceId, name }), createCollection: async (projectId, parentId, name) => invoke("create_collection", { projectId, parentId, name }), saveEnvelope: async (request, projectId, collectionId) => { await invoke("save_envelope", { request, projectId, collectionId }); } }); await refreshTree(); }} />
      <CommentsWorkbench />
      <SsoWorkbench />
      <AiWorkbench onAssist={(request:AiAssistRequest)=>invoke<AiAssistResponse>("run_ai_assistant",{request})} onPutSecret={(name,value)=>invoke("put_secret",{request:{name,value}})} />
      <CaptureWorkbench onStatus={()=>invoke<CaptureStatus>("capture_status")} onStart={(bind)=>invoke<CaptureStatus>("start_capture",{request:{bind,allowRemote:false}})} onStop={()=>invoke<CaptureStatus>("stop_capture")} onList={()=>invoke<CapturedExchange[]>("capture_exchanges")} onClear={()=>invoke("clear_capture")} />
      </WorkbenchDeck>
    </AppShell>
  );
}
