import {
  CLIENT_VERSION,
  PROTOCOL_API_VERSION,
  createHttpRequest,
  type ExecutionEvent,
  type ExecutionSummary,
  type RequestEnvelope,
} from "@apivoy/request-model";
import type { AssertionResultEvent } from "@apivoy/request-model";
import type {
  HistoryFilter,
  HistoryItem,
  HttpRunResult,
  HttpSendHooks,
  HttpWorkbenchRequest,
} from "@apivoy/ui";

const AGENT_BASE =
  (import.meta.env.VITE_APIVOY_AGENT_URL as string | undefined) ?? "http://127.0.0.1:39217";

const AGENT_TOKEN = import.meta.env.VITE_APIVOY_AGENT_TOKEN as string | undefined;

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

function agentHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  headers.set("X-ApiVoy-Protocol-Api-Version", PROTOCOL_API_VERSION);
  headers.set("X-ApiVoy-Client", "web");
  headers.set("X-ApiVoy-Client-Version", CLIENT_VERSION);
  if (AGENT_TOKEN) {
    headers.set("Authorization", `Bearer ${AGENT_TOKEN}`);
  }
  return headers;
}

export async function checkAgentHandshake(): Promise<AgentHealth> {
  const res = await fetch(`${AGENT_BASE}/health`);
  if (!res.ok) {
    throw new Error(`Agent health check failed: ${res.status}`);
  }
  const health = (await res.json()) as AgentHealth;
  if (health.protocolApiVersion !== PROTOCOL_API_VERSION) {
    throw new Error(
      `协议版本不兼容：Web=${PROTOCOL_API_VERSION}，Agent=${health.protocolApiVersion}。请升级客户端或 Agent。`,
    );
  }
  return health;
}

export function toEnvelope(request: HttpWorkbenchRequest): RequestEnvelope {
  return createHttpRequest({
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body,
    timeoutMs: request.timeoutMs,
    variables: request.variables,
    assertions: request.assertions,
    auth: request.auth ?? null,
    environmentRef: "default-env",
  });
}

export function fromEnvelope(envelope: RequestEnvelope, fallbackTarget?: string): HttpWorkbenchRequest {
  const payload = envelope.payload;
  if (payload.type !== "http") {
    throw new Error("仅支持 HTTP 请求重放");
  }
  return {
    url: envelope.target || fallbackTarget || "",
    method: payload.method,
    headers: payload.headers,
    body: payload.body ?? undefined,
    timeoutMs: envelope.timeoutMs,
    variables: envelope.variables ?? {},
    assertions: envelope.assertions ?? [],
    auth: envelope.authRef ?? null,
  };
}

export async function putSecretViaAgent(name: string, value: string): Promise<void> {
  await checkAgentHandshake();
  const res = await fetch(`${AGENT_BASE}/v1/secrets`, {
    method: "PUT",
    headers: agentHeaders(),
    body: JSON.stringify({ name, value }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function getEnvironmentViaAgent(): Promise<{
  variables: Record<string, string>;
  secretRefs: string[];
}> {
  await checkAgentHandshake();
  const res = await fetch(`${AGENT_BASE}/v1/environments/default`, {
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
  const res = await fetch(`${AGENT_BASE}/v1/environments/default`, {
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
  const res = await fetch(`${AGENT_BASE}/v1/history?${params}`, {
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const rows = (await res.json()) as HistoryRecord[];
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
}

export async function getHistoryItemViaAgent(id: string): Promise<HttpWorkbenchRequest | null> {
  await checkAgentHandshake();
  const res = await fetch(`${AGENT_BASE}/v1/history/${id}`, {
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const item = (await res.json()) as HistoryRecord | null;
  if (!item?.requestSnapshot) {
    return null;
  }
  return fromEnvelope(item.requestSnapshot);
}

export async function saveRequestViaAgent(request: HttpWorkbenchRequest): Promise<void> {
  await checkAgentHandshake();
  const res = await fetch(`${AGENT_BASE}/v1/requests`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify(toEnvelope(request)),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function loadLatestRequestViaAgent(): Promise<HttpWorkbenchRequest | null> {
  await checkAgentHandshake();
  const res = await fetch(`${AGENT_BASE}/v1/requests/latest`, {
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
  await checkAgentHandshake();

  const envelope = toEnvelope(request);
  const startRes = await fetch(`${AGENT_BASE}/v1/executions`, {
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

  const eventsRes = await fetch(`${AGENT_BASE}/v1/executions/${started.executionId}/events`, {
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

  for await (const event of readSseEvents(eventsRes)) {
    eventCount += 1;
    if (event.type === "response_chunk" && event.done && event.preview) {
      preview = event.preview;
    }
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

  if (!summary) {
    return {
      summary: {
        executionId: started.executionId,
        requestId: envelope.id,
        protocolId: "http",
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
    };
  }

  return {
    summary,
    eventCount,
    preview: preview ?? JSON.stringify(summary, null, 2),
    error,
    executionId: started.executionId,
    assertions,
  };
}

export async function cancelViaAgent(executionId: string): Promise<void> {
  const res = await fetch(`${AGENT_BASE}/v1/executions/${executionId}/cancel`, {
    method: "POST",
    headers: agentHeaders(),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}
