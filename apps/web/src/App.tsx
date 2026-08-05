import { AppShell, HttpWorkbench } from "@apivoy/ui";
import type { ExecutionSummary } from "@apivoy/request-model";

const AGENT_BASE =
  (import.meta.env.VITE_APIVOY_AGENT_URL as string | undefined) ?? "http://127.0.0.1:39217";

const AGENT_TOKEN = import.meta.env.VITE_APIVOY_AGENT_TOKEN as string | undefined;

function agentHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (AGENT_TOKEN) {
    headers.Authorization = `Bearer ${AGENT_TOKEN}`;
  }
  return headers;
}

export function App() {
  return (
    <AppShell channelLabel="Web → Local Agent">
      <HttpWorkbench
        onSend={async (url) => {
          const res = await fetch(`${AGENT_BASE}/v1/debug/http-get`, {
            method: "POST",
            headers: agentHeaders(),
            body: JSON.stringify({ url }),
          });
          if (!res.ok) {
            throw new Error(await res.text());
          }
          const data = (await res.json()) as {
            summary: ExecutionSummary;
            eventCount: number;
            executionId?: string;
          };
          return {
            summary: data.summary,
            eventCount: data.eventCount,
            preview: JSON.stringify(data.summary, null, 2),
          };
        }}
      />
      <p style={{ color: "var(--apivoy-muted)", fontSize: 13, marginTop: 24 }}>
        请先运行 <code>cargo run -p apivoy-local-agent</code>，并设置{" "}
        <code>VITE_APIVOY_AGENT_TOKEN</code> 为 Agent 配对令牌。Agent 仅监听 127.0.0.1。
      </p>
    </AppShell>
  );
}
