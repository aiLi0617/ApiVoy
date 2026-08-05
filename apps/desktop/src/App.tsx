import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AppShell,
  HttpWorkbench,
  type HistoryFilter,
  type HttpWorkbenchRequest,
} from "@apivoy/ui";
import type {
  Assertion,
  AssertionResultEvent,
  AuthRef,
  ExecutionSummary,
  ProtocolPayload,
  RequestEnvelope,
} from "@apivoy/request-model";
import { useEffect } from "react";

interface ExecuteResponse {
  executionId: string;
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
  assertions?: AssertionResultEvent[];
  protocolApiVersion: string;
  desktopVersion: string;
}

interface StoredRequest {
  id: string;
  name: string;
  target: string;
  envelope: {
    timeoutMs: number;
    payload: ProtocolPayload;
    variables?: Record<string, string>;
    assertions?: Assertion[];
    authRef?: AuthRef | null;
  };
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
      }
    : null;
  return {
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body ?? null,
    timeoutMs: request.timeoutMs,
    variables: request.variables,
    assertions: request.assertions,
    auth,
  };
}

function fromEnvelope(envelope: RequestEnvelope, fallbackTarget?: string): HttpWorkbenchRequest {
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

export function App() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("execution-started", (event) => {
      console.debug("execution-started", event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <AppShell channelLabel="Desktop → Rust Core">
      <HttpWorkbench
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

          const stop = await listen<string>("execution-started", (event) => {
            hooks?.onStarted?.(event.payload);
          });
          try {
            const data = await invoke<ExecuteResponse>("execute_request", {
              request: toInvokeRequest(request),
            });
            hooks?.onStarted?.(data.executionId);
            return {
              summary: data.summary,
              eventCount: data.eventCount,
              preview: data.preview ?? JSON.stringify(data.summary, null, 2),
              executionId: data.executionId,
              assertions: data.assertions ?? [],
            };
          } finally {
            stop();
          }
        }}
        onCancel={async (executionId) => {
          await invoke<boolean>("cancel_execution", { id: executionId });
        }}
        onSave={async (request) => {
          await invoke("save_request", { request: toInvokeRequest(request) });
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
          return fromEnvelope(item.requestSnapshot);
        }}
      />
    </AppShell>
  );
}
