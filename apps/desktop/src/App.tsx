import { invoke } from "@tauri-apps/api/core";
import { AppShell, HttpWorkbench } from "@apivoy/ui";
import type { ExecutionSummary } from "@apivoy/request-model";

interface HttpGetResponse {
  executionId: string;
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
}

export function App() {
  return (
    <AppShell channelLabel="Desktop → Rust Core">
      <HttpWorkbench
        onSend={async (url) => {
          const data = await invoke<HttpGetResponse>("http_get", { url });
          return {
            summary: data.summary,
            eventCount: data.eventCount,
            preview: data.preview ?? JSON.stringify(data.summary, null, 2),
          };
        }}
      />
    </AppShell>
  );
}
