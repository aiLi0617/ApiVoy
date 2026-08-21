import { useEffect, useState, type CSSProperties } from "react";
import type { HttpRunResult, HttpSendHooks, HttpWorkbenchRequest } from "./HttpWorkbench";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";
import { useWorkbenchHydration } from "./useWorkbenchHydration";

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
  onSendMessage?: (request: HttpWorkbenchRequest) => Promise<HttpRunResult>;
  onCancel: (executionId: string) => Promise<void>;
  onSave?: (request: SseWorkbenchRequest) => Promise<void>;
  externalRequest?: SseWorkbenchRequest | null;
}

const HTTP_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export function SseWorkbench({ onConnect, onSendMessage, onCancel, onSave, externalRequest }: SseWorkbenchProps) {
  const [url, setUrl] = useState("https://");
  const [lastEventId, setLastEventId] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [reconnectMax, setReconnectMax] = useState(3);
  const [reconnectDelayMs, setReconnectDelayMs] = useState(1000);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [output, setOutput] = useState("尚未连接");
  const [busy, setBusy] = useState(false);
  const [messageMethod, setMessageMethod] = useState<(typeof HTTP_METHODS)[number]>("POST");
  const [messageUrl, setMessageUrl] = useState("");
  const [messageHeaders, setMessageHeaders] = useState("Content-Type: application/json");
  const [messageBody, setMessageBody] = useState("{\n  \"message\": \"\"\n}");
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageResult, setMessageResult] = useState("尚未发送配套请求");
  useEffect(() => {
    const apply = (value: SseWorkbenchRequest) => {
      setUrl(value.url);
      setHeaderText(value.headers.map(([name, item]) => `${name}: ${item}`).join("\n"));
      setLastEventId(value.lastEventId ?? "");
      setReconnectMax(value.reconnectMax);
      setReconnectDelayMs(value.reconnectDelayMs);
    };
    if (externalRequest) apply(externalRequest);
    else {
      const draft = readWorkbenchDraft<SseWorkbenchRequest>("sse");
      if (draft) apply(draft);
    }
  }, [externalRequest]);
  useWorkbenchHydration("sse", (envelope) => {
    const detail = envelope as { name?: string; target?: string; timeoutMs?: number; payload?: { type?: string; headers?: Array<[string, string]>; lastEventId?: string | null; reconnectMax?: number; reconnectDelayMs?: number } };
    if (detail?.payload?.type !== "sse") return;
    setUrl(detail.target ?? "https://");
    setHeaderText((detail.payload.headers ?? []).map(([name, item]) => `${name}: ${item}`).join("\n"));
    setLastEventId(detail.payload.lastEventId ?? "");
    setReconnectMax(detail.payload.reconnectMax ?? 3);
    setReconnectDelayMs(detail.payload.reconnectDelayMs ?? 1000);
  });
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

  async function sendMessage() {
    if (!messageUrl.trim()) return;
    setMessageBusy(true);
    setMessageResult("正在发送…");
    try {
      const headers = parseHeaders(messageHeaders);
      if (onSendMessage) {
        const result = await onSendMessage({ name: `${messageMethod} ${messageUrl}`, url: messageUrl.trim(), method: messageMethod, headers, body: messageBody, bodyEncoding: "text", timeoutMs: 30_000, variables: {}, assertions: [], auth: null, followRedirects: true, retryMax: 0, retryBackoffMs: 250, proxy: null, tlsVerify: true });
        const status = result.responseMeta?.status ? `HTTP ${result.responseMeta.status}` : result.summary.state;
        setMessageResult(result.error ? `发送失败：${result.error}` : `${status}\n${result.preview ?? "请求已完成，没有响应正文"}`);
      } else {
        const response = await fetch(messageUrl.trim(), { method: messageMethod, headers: new Headers(headers), body: messageBody });
        const body = await response.text();
        setMessageResult(`HTTP ${response.status} ${response.statusText}\n${body || "请求已完成，没有响应正文"}`);
      }
    } catch (error) { setMessageResult(`发送失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setMessageBusy(false); }
  }

  return <section style={styles.root}>
    <div style={styles.title}><div><small style={styles.eyebrow}>STREAMING PROTOCOL</small><h2 style={styles.h2}>Server-Sent Events</h2></div><span style={styles.badge}>{busy ? "CONNECTED" : "IDLE"}</span></div>
    <div style={styles.target}><label style={styles.targetLabel}>SSE 接收地址<input aria-label="SSE 接收地址" style={styles.url} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/events" /></label><button style={styles.connect} disabled={busy || !url.trim()} onClick={() => void connect()}>连接</button>{onSave && <button style={styles.cancel} disabled={busy} onClick={() => void onSave(request())}>保存</button>}{runningId && <button style={styles.cancel} onClick={() => void onCancel(runningId)}>断开</button>}</div>
    <div style={styles.grid}><label style={styles.label}>Last-Event-ID<input style={styles.input} value={lastEventId} onChange={(event) => setLastEventId(event.target.value)} placeholder="可选，用于断线续传" /></label><label style={styles.label}>请求头（每行 Name: Value）<textarea style={styles.headers} value={headerText} onChange={(event) => setHeaderText(event.target.value)} placeholder="Authorization: Bearer {{token}}" /></label></div>
    <div style={styles.grid}><label style={styles.label}>最大重连次数<input style={styles.input} type="number" min={0} value={reconnectMax} onChange={(event) => setReconnectMax(Math.max(0, Number(event.target.value) || 0))} /></label><label style={styles.label}>重连间隔（ms）<input style={styles.input} type="number" min={0} max={60000} value={reconnectDelayMs} onChange={(event) => setReconnectDelayMs(Math.max(0, Number(event.target.value) || 0))} /></label></div>
    <section style={styles.companion} aria-labelledby="sse-companion-title">
      <div style={styles.companionHeader}><div><strong id="sse-companion-title">配套发送接口</strong><div style={styles.hint}>通过独立 HTTP 请求发送消息；SSE 连接继续负责接收事件。</div></div><button type="button" style={styles.sendMessage} disabled={messageBusy || !messageUrl.trim()} onClick={() => void sendMessage()}>{messageBusy ? "发送中…" : "发送"}</button></div>
      <div style={styles.messageTarget}><select aria-label="请求方法" style={styles.select} value={messageMethod} onChange={(event) => setMessageMethod(event.target.value as (typeof HTTP_METHODS)[number])}>{HTTP_METHODS.map((method) => <option key={method}>{method}</option>)}</select><input aria-label="配套发送接口 URL" style={styles.url} value={messageUrl} onChange={(event) => setMessageUrl(event.target.value)} placeholder="https://example.com/messages" /></div>
      <div style={styles.messageGrid}><label style={styles.label}>请求头（每行 Name: Value）<textarea style={styles.messageHeaders} value={messageHeaders} onChange={(event) => setMessageHeaders(event.target.value)} /></label><label style={styles.label}>请求正文<textarea style={styles.messageBody} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} /></label></div>
      <div style={styles.messageResultTitle}>发送结果</div><pre role="status" aria-live="polite" style={styles.messageResult}>{messageResult}</pre>
    </section>
    <ProtocolCodeGenerator input={{ protocol: "sse", request: request() }} /><div style={styles.responseTitle}>事件流</div><pre role="status" aria-live="polite" style={styles.output}>{output}</pre>
  </section>;
}

function parseHeaders(value: string): Array<[string, string]> {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const index = line.indexOf(":"); return index < 0 ? [line, ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()]; });
}

const styles: Record<string, CSSProperties> = {
  targetLabel: { display: "contents" }, root: { marginTop: 22, border: "1px solid var(--apivoy-border)", borderRadius: 14, padding: 18, background: "var(--apivoy-panel)" },
  title: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }, eyebrow: { color: "var(--apivoy-accent)", letterSpacing: 1.4 }, h2: { margin: "3px 0 0", fontSize: 18 }, badge: { fontSize: 10, color: "#65d6a6", border: "1px solid #265b49", padding: "4px 7px", borderRadius: 999 },
  target: { display: "flex", gap: 8 }, url: { flex: 1, minWidth: 0, background: "#0b1119", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: "10px 12px" }, connect: { border: 0, borderRadius: 8, padding: "0 18px", fontWeight: 700, background: "var(--apivoy-accent)", color: "#06121d", cursor: "pointer" }, cancel: { border: "1px solid #71434a", borderRadius: 8, background: "#2b171b", color: "#ff9ca8", padding: "0 12px" },
  grid: { display: "grid", gridTemplateColumns: "minmax(180px,.45fr) 1fr", gap: 12, marginTop: 12 }, label: { display: "flex", flexDirection: "column", gap: 6, color: "var(--apivoy-muted)", fontSize: 11 }, input: { background: "#0b1119", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9 }, headers: { minHeight: 58, resize: "vertical", background: "#0b1119", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9 }, responseTitle: { marginTop: 15, color: "var(--apivoy-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }, output: { minHeight: 110, maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap", background: "#080d13", border: "1px solid var(--apivoy-border)", borderRadius: 9, padding: 12, color: "#b9d5e8", fontSize: 12 },
  companion: { marginTop: 16, padding: 14, border: "1px solid var(--apivoy-border)", borderRadius: 10, background: "#0a1118" }, companionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }, hint: { marginTop: 4, color: "var(--apivoy-muted)", fontSize: 11 }, sendMessage: { minHeight: 36, border: 0, borderRadius: 8, padding: "0 18px", background: "var(--apivoy-accent)", color: "#06121d", fontWeight: 700, cursor: "pointer" }, messageTarget: { display: "flex", gap: 8, marginTop: 12 }, select: { background: "#111a25", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: "8px 10px" }, messageGrid: { display: "grid", gridTemplateColumns: "minmax(220px,.7fr) 1fr", gap: 12, marginTop: 12 }, messageHeaders: { minHeight: 92, resize: "vertical", background: "#080d13", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9, fontFamily: "monospace" }, messageBody: { minHeight: 92, resize: "vertical", background: "#080d13", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9, fontFamily: "monospace" }, messageResultTitle: { marginTop: 12, color: "var(--apivoy-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }, messageResult: { minHeight: 44, maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap", marginBottom: 0, background: "#060b10", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 10, color: "#b9d5e8", fontSize: 12 },
};
