import { AppShell, HttpWorkbench } from "@apivoy/ui";
import { cancelViaAgent, executeViaAgent } from "./agentClient";

export function App() {
  return (
    <AppShell channelLabel="Web → Local Agent">
      <HttpWorkbench onSend={executeViaAgent} onCancel={cancelViaAgent} />
      <p style={{ color: "var(--apivoy-muted)", fontSize: 13, marginTop: 24 }}>
        请先运行 <code>cargo run -p apivoy-local-agent</code>，并设置{" "}
        <code>VITE_APIVOY_AGENT_TOKEN</code> 为 Agent 配对令牌。主路径为{" "}
        <code>POST /v1/executions</code> + SSE 事件流。
      </p>
    </AppShell>
  );
}
