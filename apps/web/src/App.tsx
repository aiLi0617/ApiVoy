import { AppShell, HttpWorkbench } from "@apivoy/ui";
import {
  cancelViaAgent,
  executeViaAgent,
  getEnvironmentViaAgent,
  getHistoryItemViaAgent,
  listHistoryViaAgent,
  loadLatestRequestViaAgent,
  putSecretViaAgent,
  saveEnvironmentViaAgent,
  saveRequestViaAgent,
} from "./agentClient";

export function App() {
  return (
    <AppShell channelLabel="Web → Local Agent">
      <HttpWorkbench
        onSend={executeViaAgent}
        onCancel={cancelViaAgent}
        onPutSecret={putSecretViaAgent}
        onSave={saveRequestViaAgent}
        onLoad={loadLatestRequestViaAgent}
        onLoadEnvironment={getEnvironmentViaAgent}
        onSaveEnvironment={saveEnvironmentViaAgent}
        onListHistory={listHistoryViaAgent}
        onReplayHistory={getHistoryItemViaAgent}
      />
      <p style={{ color: "var(--apivoy-muted)", fontSize: 13, marginTop: 24 }}>
        请先运行 <code>cargo run -p apivoy-local-agent</code>，并设置{" "}
        <code>VITE_APIVOY_AGENT_TOKEN</code> 为 Agent 配对令牌。环境/历史经 Agent 写入本地 SQLite；密钥经{" "}
        <code>PUT /v1/secrets</code> 写入 Keychain。
      </p>
    </AppShell>
  );
}
