import {
  CLIENT_VERSION,
  PROTOCOL_API_VERSION,
  createHttpRequest,
  type ExecutionEvent,
  type ExecutionSummary,
  type RequestEnvelope,
  type ResponseMeta,
  reduceCompletedResponsePreview,
  selectResponsePreview,
} from "@apivoy/request-model";
import type { AssertionResultEvent } from "@apivoy/request-model";
import type {
  HistoryFilter,
  HistoryItem,
  HttpRunResult,
  HttpSendHooks,
  HttpWorkbenchRequest,
  WorkspaceTree,
  MockRule,
  InstalledPlugin,
  PluginManifest,
  AiAssistRequest,
  AiAssistResponse,
  CaptureStatus,
  CapturedExchange,
  CollectionRunCase,
  TcpSessionConnection,
} from "@apivoy/ui";

const runtime = (window as Window & { __APIVOY_CONFIG__?: { agentUrl?: string; agentToken?: string } }).__APIVOY_CONFIG__;

function agentBase(): string {
  try {
    const override = localStorage.getItem("apivoy:agent-url")?.trim();
    if (override) return override;
  } catch { /* ignore */ }
  return runtime?.agentUrl ?? (import.meta.env.VITE_APIVOY_AGENT_URL as string | undefined) ?? "http://127.0.0.1:39217";
}

function configuredAgentToken(): string | undefined {
  try {
    const override = localStorage.getItem("apivoy-agent-token");
    if (override) return override;
  } catch { /* ignore */ }
  return runtime?.agentToken ?? (import.meta.env.VITE_APIVOY_AGENT_TOKEN as string | undefined);
}

let activeAgentToken = configuredAgentToken();
let sessionPromise: Promise<void> | null = null;
const bootstrapToken = configuredAgentToken();
if (bootstrapToken) {
  try { localStorage.setItem("apivoy-agent-token", bootstrapToken); } catch { /* ignore */ }
}

export interface AgentHealth {
  service: string;
  version: string;
  agentVersion: string;
  protocolApiVersion: string;
  minProtocolApiVersion: string;
  maxProtocolApiVersion: string;
  authRequired: boolean;
}

interface EnvironmentRecord {
  id: string;
  variables: Record<string, string>;
  secretRefs?: string[];
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

interface StoredRequest {
  id: string;
  target: string;
  envelope: RequestEnvelope;
}
export interface ApiDefinitionRecord { id: string; projectId: string; moduleId?: string | null; name: string; format: string; fileName: string; content: string; createdAt: string; updatedAt: string }
export interface RequestDefinitionBindingRecord { requestId: string; definitionId: string; operationRef?: string | null; updatedAt: string }
export async function loadEnvelopeViaAgent(id: string): Promise<RequestEnvelope | null> {
  await checkAgentHandshake();
  const response = await fetch(`${agentBase()}/v1/requests/${id}`, { headers: agentHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as StoredRequest | null)?.envelope ?? null;
}

export async function listApiDefinitionsViaAgent(projectId: string): Promise<ApiDefinitionRecord[]> { await checkAgentHandshake(); const response = await fetch(`${agentBase()}/v1/api-definitions?projectId=${encodeURIComponent(projectId)}`, { headers: agentHeaders() }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
export async function saveApiDefinitionViaAgent(input: { projectId: string; name: string; format: string; fileName: string; content: string }): Promise<ApiDefinitionRecord> { await checkAgentHandshake(); const response = await fetch(`${agentBase()}/v1/api-definitions`, { method: "POST", headers: agentHeaders(), body: JSON.stringify(input) }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
export async function getRequestDefinitionBindingViaAgent(requestId: string): Promise<RequestDefinitionBindingRecord | null> { await checkAgentHandshake(); const response = await fetch(`${agentBase()}/v1/requests/${requestId}/definition-binding`, { headers: agentHeaders() }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
export async function bindRequestDefinitionViaAgent(requestId: string, definitionId: string, operationRef?: string): Promise<RequestDefinitionBindingRecord> { await checkAgentHandshake(); const response = await fetch(`${agentBase()}/v1/requests/${requestId}/definition-binding`, { method: "PUT", headers: agentHeaders(), body: JSON.stringify({ definitionId, operationRef }) }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
export async function unbindRequestDefinitionViaAgent(requestId: string): Promise<void> { await checkAgentHandshake(); const response = await fetch(`${agentBase()}/v1/requests/${requestId}/definition-binding`, { method: "DELETE", headers: agentHeaders() }); if (!response.ok) throw new Error(await response.text()); }

function agentHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  headers.set("X-ApiVoy-Protocol-Api-Version", PROTOCOL_API_VERSION);
  headers.set("X-ApiVoy-Client", "web");
  headers.set("X-ApiVoy-Client-Version", CLIENT_VERSION);
  if (activeAgentToken) {
    headers.set("Authorization", `Bearer ${activeAgentToken}`);
  }
  return headers;
}

export async function checkAgentHandshake(): Promise<AgentHealth> {
  const res = await fetch(`${agentBase()}/health`);
  if (!res.ok) {
    throw new Error(`Agent health check failed: ${res.status}`);
  }
  const health = (await res.json()) as AgentHealth;
  if (health.protocolApiVersion !== PROTOCOL_API_VERSION) {
    throw new Error(
      `协议版本不兼容：Web=${PROTOCOL_API_VERSION}，Agent=${health.protocolApiVersion}。请升级客户端或 Agent。`,
    );
  }
  if (bootstrapToken && !sessionPromise) {
    sessionPromise = (async () => {
      const response = await fetch(`${agentBase()}/v1/session`, { method: "POST", headers: { "Authorization": `Bearer ${bootstrapToken}`, "X-ApiVoy-Protocol-Api-Version": PROTOCOL_API_VERSION } });
      if (!response.ok) throw new Error(`Agent session exchange failed: ${response.status}`);
      const session = await response.json() as { token: string };
      activeAgentToken = session.token;
    })();
  }
  await sessionPromise;
  return health;
}

export function toEnvelope(request: HttpWorkbenchRequest): RequestEnvelope {
  const envelope = createHttpRequest({
    name: request.name,
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body,
    bodyEncoding: request.bodyEncoding,
    bodySource: request.bodySource,
    multipart: request.multipart,
    timeoutMs: request.timeoutMs,
    variables: request.variables,
    assertions: request.assertions,
    auth: request.auth ?? null,
    environmentRef: "default-env",
    followRedirects: request.followRedirects,
    retryPolicy: { max_retries: request.retryMax, backoff_ms: request.retryBackoffMs },
    proxy: request.proxy ?? null,
    tls: { verify: request.tlsVerify, client_cert_ref: request.tlsClientCertRef ?? null },
    preScripts: request.preScripts,
    postScripts: request.postScripts,
  });
  envelope.metadata = { ...(envelope.metadata ?? {}), ...(request.metadata ?? {}) };
  if (request.id) envelope.id = request.id;
  return envelope;
}

export function fromEnvelope(envelope: RequestEnvelope, fallbackTarget?: string): HttpWorkbenchRequest {
  const payload = envelope.payload;
  if (payload.type !== "http") {
    throw new Error("仅支持 HTTP 请求重放");
  }
  return {
    id: envelope.id,
    name: envelope.name,
    url: envelope.target || fallbackTarget || "",
    method: payload.method,
    headers: payload.headers,
    body: payload.body ?? undefined,
    bodyEncoding: payload.bodyEncoding ?? "text",
    bodySource: payload.bodySource ?? undefined,
    multipart: payload.multipart ?? [],
    timeoutMs: envelope.timeoutMs,
    metadata: (envelope.metadata ?? {}) as Record<string, unknown>,
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

export async function putSecretViaAgent(name: string, value: string): Promise<void> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/secrets`, {
    method: "PUT",
    headers: agentHeaders(),
    body: JSON.stringify({ name, value }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function runAiAssistViaAgent(request:AiAssistRequest):Promise<AiAssistResponse>{await checkAgentHandshake();const response=await fetch(`${agentBase()}/v1/ai/assist`,{method:"POST",headers:agentHeaders(),body:JSON.stringify(request)});if(!response.ok)throw new Error(await response.text());return response.json();}
async function captureRequest<T>(path:string,method="GET",body?:unknown):Promise<T>{await checkAgentHandshake();const response=await fetch(`${agentBase()}${path}`,{method,headers:agentHeaders(),body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw new Error(await response.text());return response.status===204?undefined as T:response.json();}
export const captureStatusViaAgent=()=>captureRequest<CaptureStatus>("/v1/capture/status");
export const startCaptureViaAgent=(bind:string)=>captureRequest<CaptureStatus>("/v1/capture/start","POST",{bind,allowRemote:false});
export const stopCaptureViaAgent=()=>captureRequest<CaptureStatus>("/v1/capture/stop","POST");
export const listCapturesViaAgent=()=>captureRequest<CapturedExchange[]>("/v1/capture/exchanges");
export const clearCapturesViaAgent=()=>captureRequest<void>("/v1/capture/exchanges","DELETE");

export async function listCookiesViaAgent(url: string): Promise<Array<{ name: string; value: string }>> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/cookies?url=${encodeURIComponent(url)}`, { headers: agentHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function setCookieViaAgent(url: string, name: string, value: string): Promise<void> { await mutateWorkspace("/v1/cookies", "PUT", { url, name, value }); }
export async function deleteCookieViaAgent(url: string, name: string): Promise<void> { await mutateWorkspace("/v1/cookies", "DELETE", { url, name }); }

export async function getEnvironmentViaAgent(): Promise<{
  variables: Record<string, string>;
  secretRefs: string[];
}> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/environments/default`, {
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const env = (await res.json()) as EnvironmentRecord;
  return {
    variables: env.variables ?? {},
    secretRefs: env.secretRefs ?? [],
  };
}

export async function saveEnvironmentViaAgent(
  variables: Record<string, string>,
  secretRefs: string[],
): Promise<void> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/environments/default`, {
    method: "PUT",
    headers: agentHeaders(),
    body: JSON.stringify({ variables, secretRefs }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function listHistoryViaAgent(filter?: HistoryFilter): Promise<HistoryItem[]> {
  await checkAgentHandshake();
  const params = new URLSearchParams();
  params.set("limit", "30");
  if (filter?.state) params.set("state", filter.state);
  if (filter?.protocolId) params.set("protocolId", filter.protocolId);
  if (filter?.status != null) params.set("status", String(filter.status));
  if (filter?.requestId) params.set("requestId", filter.requestId);
  const res = await fetch(`${agentBase()}/v1/history?${params}`, {
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const rows = (await res.json()) as HistoryRecord[];
  return rows.map((r) => ({
    id: r.id,
    protocolId: r.protocolId,
    method: r.requestSnapshot?.payload.type === "http" ? r.requestSnapshot.payload.method : undefined,
    name: r.requestSnapshot?.name,
    state: r.state,
    status: r.status,
    durationMs: r.durationMs,
    startedAt: r.startedAt,
    target: r.requestSnapshot?.target,
    preview: r.preview ?? undefined,
  }));
}

export async function getHistoryItemViaAgent(id: string): Promise<HttpWorkbenchRequest | RequestEnvelope | null> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/history/${id}`, {
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const item = (await res.json()) as HistoryRecord | null;
  if (!item?.requestSnapshot) {
    return null;
  }
  return item.requestSnapshot.payload.type === "http" ? fromEnvelope(item.requestSnapshot) : item.requestSnapshot;
}

export async function saveRequestViaAgent(request: HttpWorkbenchRequest, projectId?: string, collectionId?: string): Promise<void> {
  await checkAgentHandshake();
  const query = new URLSearchParams();
  if (projectId) query.set("projectId", projectId);
  if (collectionId) query.set("collectionId", collectionId);
  const res = await fetch(`${agentBase()}/v1/requests${query.size ? `?${query}` : ""}`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify(toEnvelope(request)),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function saveEnvelopeViaAgent(envelope: RequestEnvelope, projectId?: string, collectionId?: string): Promise<void> {
  await checkAgentHandshake();
  const query = new URLSearchParams();
  if (projectId) query.set("projectId", projectId);
  if (collectionId) query.set("collectionId", collectionId);
  const response = await fetch(`${agentBase()}/v1/requests${query.size ? `?${query}` : ""}`, { method: "POST", headers: agentHeaders(), body: JSON.stringify(envelope) });
  if (!response.ok) throw new Error(await response.text());
}

export async function getWorkspaceTreeViaAgent(): Promise<WorkspaceTree> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/workspace-tree`, { headers: agentHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const raw = await res.json() as Omit<WorkspaceTree, "requests"> & { requests: Array<WorkspaceTree["requests"][number] & { envelope?: RequestEnvelope }> };
  return { ...raw, requests: raw.requests.map((item) => ({
    ...item,
    method: item.envelope?.payload.type === "http" ? item.envelope.payload.method : item.method,
  })) };
}

export async function runCollectionViaAgent(collectionId: string, failFast: boolean): Promise<CollectionRunCase[]> {
  const tree = await getWorkspaceTreeViaAgent();
  const requests = tree.requests.filter((item) => item.collectionId === collectionId);
  const cases: CollectionRunCase[] = [];
  for (const item of requests) {
    try {
      const envelope = await loadEnvelopeViaAgent(item.id);
      if (!envelope) {
        cases.push({ requestId: item.id, name: item.name, protocolId: "unknown", passed: false, status: null, durationMs: 0, error: "请求不存在", failedAssertions: [] });
        if (failFast) break;
        continue;
      }
      const result = await executeEnvelopeViaAgent(envelope);
      const failedAssertions = (result.assertions ?? []).filter((assertion) => !assertion.passed).map((assertion) => assertion.name);
      const passed = result.summary.state === "completed" && failedAssertions.length === 0;
      cases.push({
        requestId: item.id,
        name: item.name,
        protocolId: envelope.protocolId,
        passed,
        status: result.summary.status ?? null,
        durationMs: result.summary.durationMs,
        error: null,
        failedAssertions,
      });
      if (failFast && !passed) break;
    } catch (error) {
      cases.push({
        requestId: item.id,
        name: item.name,
        protocolId: "unknown",
        passed: false,
        status: null,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
        failedAssertions: [],
      });
      if (failFast) break;
    }
  }
  return cases;
}

async function mutateWorkspace(path: string, method: string, body?: unknown): Promise<void> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}${path}`, { method, headers: agentHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
}

async function createWorkspaceRecord<T>(path: string, body: unknown): Promise<T> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}${path}`, { method: "POST", headers: agentHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const createProjectViaAgent = (workspaceId: string, name: string) => createWorkspaceRecord<WorkspaceTree["projects"][number]>("/v1/projects", { workspaceId, name });
export const createModuleViaAgent = (projectId: string, name: string) => createWorkspaceRecord<NonNullable<WorkspaceTree["modules"]>[number]>("/v1/modules", { projectId, name });
export const createWorkspaceViaAgent = (name: string) => createWorkspaceRecord<WorkspaceTree["workspaces"][number]>("/v1/workspaces", { name });
export const renameWorkspaceViaAgent = (id: string, name: string) => mutateWorkspace(`/v1/workspaces/${id}`, "PATCH", { name });
export const archiveWorkspaceViaAgent = (id: string, archived: boolean) => mutateWorkspace(`/v1/workspaces/${id}/archive`, "PATCH", { archived });
export const touchWorkspaceViaAgent = (id: string) => mutateWorkspace(`/v1/workspaces/${id}/touch`, "POST");
export const deleteWorkspaceViaAgent = (id: string) => mutateWorkspace(`/v1/workspaces/${id}`, "DELETE");
export const renameProjectViaAgent = (id: string, name: string) => mutateWorkspace(`/v1/projects/${id}`, "PATCH", { name });
export const deleteProjectViaAgent = (id: string) => mutateWorkspace(`/v1/projects/${id}`, "DELETE");
export const createCollectionViaAgent = (projectId: string, parentId: string | null, name: string, moduleId?: string) => createWorkspaceRecord<WorkspaceTree["collections"][number]>("/v1/collections", { projectId, parentId, name, moduleId });
export const renameCollectionViaAgent = (id: string, name: string, parentId: string | null, sortOrder: number) => mutateWorkspace(`/v1/collections/${id}`, "PATCH", { name, parentId, sortOrder });
export const updateCollectionTagsViaAgent = (id: string, tags: string[]) => mutateWorkspace(`/v1/collections/${id}/tags`, "PATCH", { tags });
export const deleteCollectionViaAgent = (id: string) => mutateWorkspace(`/v1/collections/${id}`, "DELETE");
export const deleteRequestViaAgent = (id: string) => mutateWorkspace(`/v1/requests/${id}`, "DELETE");
export const moveRequestViaAgent = (id: string, projectId: string, collectionId: string) => mutateWorkspace(`/v1/requests/${id}`, "PATCH", { projectId, collectionId });

export async function listMockRulesViaAgent(): Promise<MockRule[]> { await checkAgentHandshake(); const res = await fetch(`${agentBase()}/v1/mock-rules`, { headers: agentHeaders() }); if (!res.ok) throw new Error(await res.text()); return res.json(); }
export async function createMockRuleViaAgent(rule: Omit<MockRule, "id">): Promise<void> { await mutateWorkspace("/v1/mock-rules", "POST", rule); }
export async function deleteMockRuleViaAgent(id: string): Promise<void> { await mutateWorkspace(`/v1/mock-rules/${id}`, "DELETE"); }
export const agentBaseUrl = agentBase();
export async function tcpSessionConnectionViaAgent(target: string): Promise<TcpSessionConnection> {
  await checkAgentHandshake();
  const response = await fetch(`${agentBase()}/v1/tcp-session-ticket`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ target }),
  });
  if (!response.ok) throw new Error(await response.text());
  const { ticket } = await response.json() as { ticket: string };
  return {
    url: `${agentBase().replace(/^http/, "ws")}/v1/tcp-session`,
    protocols: ["apivoy", `apivoy-ticket.${ticket}`],
  };
}
export async function listPluginsViaAgent(): Promise<InstalledPlugin[]> { await checkAgentHandshake(); const res = await fetch(`${agentBase()}/v1/plugins`, { headers: agentHeaders() }); if (!res.ok) throw new Error(await res.text()); return res.json(); }
export async function installPluginViaAgent(manifest: PluginManifest, wasmBase64: string): Promise<void> { await mutateWorkspace("/v1/plugins", "POST", { manifest, wasmBase64 }); }
export async function enablePluginViaAgent(id: string, enabled: boolean): Promise<void> { await mutateWorkspace(`/v1/plugins/${id}`, "PATCH", { enabled }); }
export async function deletePluginViaAgent(id: string): Promise<void> { await mutateWorkspace(`/v1/plugins/${id}`, "DELETE"); }
export async function invokePluginViaAgent(id: string, input: string): Promise<string> { await checkAgentHandshake(); const res = await fetch(`${agentBase()}/v1/plugins/${id}/invoke`, { method: "POST", headers: agentHeaders(), body: JSON.stringify({ input }) }); if (!res.ok) throw new Error(await res.text()); return ((await res.json()) as { output: string }).output; }

export async function loadRequestViaAgent(id: string): Promise<HttpWorkbenchRequest | null> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/requests/${id}`, { headers: agentHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const stored = await res.json() as StoredRequest | null;
  return stored ? fromEnvelope(stored.envelope, stored.target) : null;
}

export async function loadLatestRequestViaAgent(): Promise<HttpWorkbenchRequest | null> {
  await checkAgentHandshake();
  const res = await fetch(`${agentBase()}/v1/requests/latest`, {
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const stored = (await res.json()) as StoredRequest | null;
  if (!stored) {
    return null;
  }
  return fromEnvelope(stored.envelope, stored.target);
}

async function* readSseEvents(res: Response): AsyncGenerator<ExecutionEvent> {
  if (!res.body) {
    throw new Error("SSE response has no body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) {
        continue;
      }
      const payload = dataLines.join("\n");
      yield JSON.parse(payload) as ExecutionEvent;
    }
  }
}

export async function executeViaAgent(
  request: HttpWorkbenchRequest,
  hooks?: HttpSendHooks,
): Promise<HttpRunResult> {
  return executeEnvelopeViaAgent(toEnvelope(request), hooks);
}

export async function executeEnvelopeViaAgent(
  envelope: RequestEnvelope,
  hooks?: HttpSendHooks,
): Promise<HttpRunResult> {
  await checkAgentHandshake();
  const startRes = await fetch(`${agentBase()}/v1/executions`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify(envelope),
  });
  if (!startRes.ok) {
    throw new Error(await startRes.text());
  }

  const started = (await startRes.json()) as {
    executionId: string;
    state: string;
  };
  hooks?.onStarted?.(started.executionId);

  const eventsRes = await fetch(`${agentBase()}/v1/executions/${started.executionId}/events`, {
    headers: agentHeaders({ Accept: "text/event-stream" }),
  });
  if (!eventsRes.ok) {
    throw new Error(await eventsRes.text());
  }

  let summary: ExecutionSummary | null = null;
  let preview: string | null = null;
  let eventCount = 0;
  let error: string | undefined;
  const assertions: AssertionResultEvent[] = [];
  let responseMeta: ResponseMeta | null = null;

  for await (const event of readSseEvents(eventsRes)) {
    eventCount += 1;
    hooks?.onEvent?.(event);
    if (event.type === "response_chunk") {
      if (event.preview) hooks?.onChunk?.(event.preview);
      preview = reduceCompletedResponsePreview(preview, event);
    }
    if (event.type === "response_meta") responseMeta = event;
    if (event.type === "assertion_result") {
      assertions.push(event);
    }
    if (event.type === "completed") {
      summary = event.summary;
    }
    if (event.type === "failed") {
      error = `${event.code}: ${event.message}`;
    }
    if (event.type === "cancelled") {
      error = event.reason ?? "cancelled";
    }
  }

  const contentType = responseMeta?.contentType?.toLowerCase() ?? "";
  const isTextBody = contentType.startsWith("text/") || /json|xml|javascript|x-www-form-urlencoded/.test(contentType);
  if (isTextBody) {
    const bodyRes = await fetch(`${agentBase()}/v1/history/${started.executionId}/body`, { headers: agentHeaders() });
    if (bodyRes.ok) preview = await bodyRes.text();
  }

  if (!summary) {
    return {
      summary: {
        executionId: started.executionId,
        requestId: envelope.id,
        protocolId: envelope.protocolId,
        state: error ? "failed" : "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        bytesReceived: 0,
      },
      eventCount,
      preview,
      error: error ?? "execution finished without summary",
      executionId: started.executionId,
      assertions,
      responseMeta,
    };
  }

  return {
    summary,
    eventCount,
    preview: selectResponsePreview(preview),
    error,
    executionId: started.executionId,
    assertions,
    responseMeta,
  };
}

export async function cancelViaAgent(executionId: string): Promise<void> {
  const res = await fetch(`${agentBase()}/v1/executions/${executionId}/cancel`, {
    method: "POST",
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}
