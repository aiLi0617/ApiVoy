import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppShell, HttpWorkbench, type HttpWorkbenchRequest } from "@apivoy/ui";
import type { ExecutionSummary, ProtocolPayload } from "@apivoy/request-model";
import { useEffect } from "react";

interface ExecuteResponse {
  executionId: string;
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
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
  };
}

function toInvokeRequest(request: HttpWorkbenchRequest) {
  return {
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body ?? null,
    timeoutMs: request.timeoutMs,
  };
}

export function App() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("execution-started", (event) => {
      // Reserved for future live timeline; kept to exercise event channel.
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

          // Fire-and-forget listener for early cancel enablement: Tauri command is
          // await-until-done, so we also listen for execution-started.
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
          };
        }}
      />
    </AppShell>
  );
}
