import { useEffect, useState, type CSSProperties } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";

export interface SseWorkbenchRequest {
  name: string;
  url: string;
  headers: Array<[string, string]>;
  lastEventId?: string;
  reconnectMax: number;
  reconnectDelayMs: number;
  timeoutMs: number;
}

export interface SseWorkbenchProps {
  onConnect: (request: SseWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onCancel: (executionId: string) => Promise<void>;
  onSave?: (request: SseWorkbenchRequest) => Promise<void>;
  externalRequest?: SseWorkbenchRequest | null;
}

export function SseWorkbench({ onConnect, onCancel, onSave, externalRequest }: SseWorkbenchProps) {
  const [url, setUrl] = useState("https://");
  const [lastEventId, setLastEventId] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [reconnectMax, setReconnectMax] = useState(3);
  const [reconnectDelayMs, setReconnectDelayMs] = useState(1000);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [output, setOutput] = useState("尚未连接");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const apply = (value: SseWorkbenchRequest) => { setUrl(value.url); setHeaderText(value.headers.map(([name, item]) => `${name}: ${item}`).join("\n")); setLastEventId(value.lastEventId ?? ""); setReconnectMax(value.reconnectMax); setReconnectDelayMs(value.reconnectDelayMs); }; if (externalRequest) apply(externalRequest); else { const draft = readWorkbenchDraft<SseWorkbenchRequest>("sse"); if (draft) apply(draft); } const listener = (event: Event) => { const envelope = (event as CustomEvent).detail; if (envelope?.payload?.type === "sse") apply({ name: envelope.name, url: envelope.target, headers: envelope.payload.headers, lastEventId: envelope.payload.lastEventId ?? undefined, reconnectMax: envelope.payload.reconnectMax, reconnectDelayMs: envelope.payload.reconnectDelayMs, timeoutMs: envelope.timeoutMs }); }; window.addEventListener("apivoy-open-request", listener); return () => window.removeEventListener("apivoy-open-request", listener); }, [externalRequest]);
  const request = (): SseWorkbenchRequest => ({ name: `SSE ${url}`, url, headers: headerText.split("\n").filter(Boolean).map((line): [string, string] => { const index = line.indexOf(":"); return index < 0 ? [line.trim(), ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }), lastEventId: lastEventId || undefined, reconnectMax, reconnectDelayMs, timeoutMs: 0 });
  useAutosaveDraft("sse", request);

  async function connect() {
    setBusy(true); setOutput("正在连接 SSE…");
    try {
      const result = await onConnect(request(), { onStarted: setRunningId, onChunk: (chunk) => setOutput((current) => current === "正在连接 SSE…" ? chunk : current + chunk) });
      setOutput(result.error ? `连接失败：${result.error}` : result.preview ?? "连接已结束，没有收到事件");
    } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setRunningId(null); }
  }

  return <section style={styles.root}>
    <div style={styles.title}><div><small style={styles.eyebrow}>STREAMING PROTOCOL</small><h2 style={styles.h2}>Server-Sent Events</h2></div><span style={styles.badge}>{busy ? "CONNECTED" : "IDLE"}</span></div>
    <div style={styles.target}><input style={styles.url} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/events" /><button style={styles.connect} disabled={busy || !url.trim()} onClick={() => void connect()}>连接</button>{onSave && <button style={styles.cancel} disabled={busy} onClick={() => void onSave(request())}>保存</button>}{runningId && <button style={styles.cancel} onClick={() => void onCancel(runningId)}>断开</button>}</div>
    <div style={styles.grid}><label style={styles.label}>Last-Event-ID<input style={styles.input} value={lastEventId} onChange={(event) => setLastEventId(event.target.value)} placeholder="可选，用于断线续传" /></label><label style={styles.label}>请求头（每行 Name: Value）<textarea style={styles.headers} value={headerText} onChange={(event) => setHeaderText(event.target.value)} placeholder="Authorization: Bearer {{token}}" /></label></div>
    <div style={styles.grid}><label style={styles.label}>最大重连次数<input style={styles.input} type="number" min={0} value={reconnectMax} onChange={(event) => setReconnectMax(Math.max(0, Number(event.target.value) || 0))} /></label><label style={styles.label}>重连间隔（ms）<input style={styles.input} type="number" min={0} max={60000} value={reconnectDelayMs} onChange={(event) => setReconnectDelayMs(Math.max(0, Number(event.target.value) || 0))} /></label></div>
    <ProtocolCodeGenerator input={{ protocol: "sse", request: request() }} /><div style={styles.responseTitle}>事件流</div><pre style={styles.output}>{output}</pre>
  </section>;
}

const styles: Record<string, CSSProperties> = {
  root: { marginTop: 22, border: "1px solid var(--apivoy-border)", borderRadius: 14, padding: 18, background: "var(--apivoy-panel)" },
  title: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }, eyebrow: { color: "var(--apivoy-accent)", letterSpacing: 1.4 }, h2: { margin: "3px 0 0", fontSize: 18 }, badge: { fontSize: 10, color: "#65d6a6", border: "1px solid #265b49", padding: "4px 7px", borderRadius: 999 },
  target: { display: "flex", gap: 8 }, url: { flex: 1, minWidth: 0, background: "#0b1119", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: "10px 12px" }, connect: { border: 0, borderRadius: 8, padding: "0 18px", fontWeight: 700, background: "var(--apivoy-accent)", color: "#06121d", cursor: "pointer" }, cancel: { border: "1px solid #71434a", borderRadius: 8, background: "#2b171b", color: "#ff9ca8", padding: "0 12px" },
  grid: { display: "grid", gridTemplateColumns: "minmax(180px,.45fr) 1fr", gap: 12, marginTop: 12 }, label: { display: "flex", flexDirection: "column", gap: 6, color: "var(--apivoy-muted)", fontSize: 11 }, input: { background: "#0b1119", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9 }, headers: { minHeight: 58, resize: "vertical", background: "#0b1119", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9 }, responseTitle: { marginTop: 15, color: "var(--apivoy-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }, output: { minHeight: 110, maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap", background: "#080d13", border: "1px solid var(--apivoy-border)", borderRadius: 9, padding: 12, color: "#b9d5e8", fontSize: 12 },
};
