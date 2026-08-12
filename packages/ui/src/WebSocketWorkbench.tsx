import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";

export interface WebSocketWorkbenchRequest { name: string; url: string; headers: Array<[string, string]>; subprotocols: string[]; messages: Array<{ encoding: "text" | "binary"; data: string }>; receiveLimit: number; timeoutMs: number; reconnectMax: number; reconnectDelayMs: number }
export interface WebSocketWorkbenchProps { onConnect: (request: WebSocketWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>; onCancel: (executionId: string) => Promise<void>; onSave?: (request: WebSocketWorkbenchRequest) => Promise<void>; externalRequest?: WebSocketWorkbenchRequest | null }

export function WebSocketWorkbench({ onConnect, onCancel, onSave, externalRequest }: WebSocketWorkbenchProps) {
  const [url, setUrl] = useState("ws://127.0.0.1:8080");
  const [encoding, setEncoding] = useState<"text" | "binary">("text");
  const [message, setMessage] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [subprotocols, setSubprotocols] = useState("");
  const [receiveLimit, setReceiveLimit] = useState(1);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [reconnectMax, setReconnectMax] = useState(3);
  const [reconnectDelayMs, setReconnectDelayMs] = useState(1000);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [output, setOutput] = useState("尚未连接");
  const [busy, setBusy] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  useEffect(() => { const apply = (value: WebSocketWorkbenchRequest) => { setUrl(value.url); setHeadersText(value.headers.map(([name, item]) => `${name}: ${item}`).join("\n")); setSubprotocols(value.subprotocols.join(", ")); const first = value.messages[0]; setEncoding(first?.encoding ?? "text"); setMessage(first?.data ?? ""); setReceiveLimit(value.receiveLimit); setTimeoutMs(value.timeoutMs); setReconnectMax(value.reconnectMax); setReconnectDelayMs(value.reconnectDelayMs); }; if (externalRequest) apply(externalRequest); else { const draft = readWorkbenchDraft<WebSocketWorkbenchRequest>("websocket"); if (draft) apply(draft); } const listener = (event: Event) => { const envelope = (event as CustomEvent).detail; const payload = envelope?.payload; if (payload?.type === "websocket") apply({ name: envelope.name, url: envelope.target, headers: payload.headers, subprotocols: payload.subprotocols, messages: payload.messages, receiveLimit: payload.receiveLimit ?? 1, timeoutMs: envelope.timeoutMs, reconnectMax: payload.reconnectMax, reconnectDelayMs: payload.reconnectDelayMs }); }; window.addEventListener("apivoy-open-request", listener); return () => window.removeEventListener("apivoy-open-request", listener); }, [externalRequest]);
  const request = (): WebSocketWorkbenchRequest => ({ name: `WebSocket ${url}`, url, headers: headersText.split("\n").filter(Boolean).map((line): [string, string] => { const index = line.indexOf(":"); return index < 0 ? [line.trim(), ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }), subprotocols: subprotocols.split(",").map((item) => item.trim()).filter(Boolean), messages: message ? [{ encoding, data: message }] : [], receiveLimit, timeoutMs, reconnectMax, reconnectDelayMs });
  useAutosaveDraft("websocket", request);
  async function connect() {
    setBusy(true); setOutput(message ? `→ ${encoding.toUpperCase()} ${message}\n` : "正在连接 WebSocket…");
    try { const result = await onConnect(request(), { onStarted: setRunningId, onChunk: (chunk) => setOutput((current) => `${current}\n← ${chunk}`) }); if (result.error) setOutput((current) => `${current}\n连接失败：${result.error}`); else if (!result.preview) setOutput((current) => `${current}\n连接结束，共收到 ${result.summary.bytesReceived} bytes`); }
    catch (error) { setOutput(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setRunningId(null); }
  }
  function appendFrame(direction: "→" | "←" | "•", value: string) { setOutput((current) => `${current === "尚未连接" ? "" : `${current}\n`}${new Date().toLocaleTimeString()} ${direction} ${value}`); }
  function connectInteractive() {
    if (socketRef.current) return;
    if (headersText.trim()) { setOutput("浏览器原生 WebSocket 无法设置自定义 Header；请使用批次执行。Token 可放入 URL 或子协议。"); return; }
    setOutput("正在建立持久 WebSocket 会话…");
    const socket = new WebSocket(url, subprotocols.split(",").map((item) => item.trim()).filter(Boolean));
    socket.binaryType = "arraybuffer";
    socket.onopen = () => { socketRef.current = socket; setInteractive(true); appendFrame("•", "CONNECTED"); };
    socket.onmessage = (event) => { if (typeof event.data === "string") appendFrame("←", `TEXT ${event.data}`); else { const bytes = new Uint8Array(event.data as ArrayBuffer); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); appendFrame("←", `BINARY ${btoa(binary)}`); } };
    socket.onerror = () => appendFrame("•", "ERROR");
    socket.onclose = (event) => { socketRef.current = null; setInteractive(false); appendFrame("•", `CLOSED ${event.code} ${event.reason}`); };
  }
  function sendInteractive() { const socket = socketRef.current; if (!socket || socket.readyState !== WebSocket.OPEN) return; if (encoding === "binary") { const binary = atob(message); socket.send(Uint8Array.from(binary, (char) => char.charCodeAt(0))); } else socket.send(message); appendFrame("→", `${encoding.toUpperCase()} ${message}`); }
  function closeInteractive() { socketRef.current?.close(1000, "closed by user"); }
  useEffect(() => () => socketRef.current?.close(1000, "workbench unmounted"), []);
  return <section style={styles.root}>
    <div style={styles.title}><div><small style={styles.eyebrow}>FULL DUPLEX</small><h2 style={styles.h2}>WebSocket</h2></div><span style={styles.status}>{busy ? "CONNECTED" : "IDLE"}</span></div>
    <div style={styles.row}><input style={styles.url} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="ws:// or wss://"/><button style={styles.connect} disabled={busy} onClick={() => void connect()}>连接并发送</button>{onSave && <button style={styles.secondary} disabled={busy} onClick={() => void onSave(request())}>保存</button>}{runningId && <button style={styles.cancel} onClick={() => void onCancel(runningId)}>断开</button>}</div>
    <div style={styles.sessionBar}><strong>持久交互会话</strong>{!interactive ? <button style={styles.secondary} onClick={connectInteractive}>建立连接</button> : <><button style={styles.connect} disabled={!message} onClick={sendInteractive}>发送当前帧</button><button style={styles.cancel} onClick={closeInteractive}>关闭连接</button></>}<span>{interactive ? "OPEN" : "CLOSED"}</span></div>
    <div style={styles.options}><label>帧类型<select value={encoding} onChange={(event) => setEncoding(event.target.value as "text" | "binary")}><option value="text">Text</option><option value="binary">Binary (Base64)</option></select></label><label>子协议<input value={subprotocols} onChange={(event) => setSubprotocols(event.target.value)} placeholder="graphql-transport-ws"/></label><label>接收帧数<input type="number" min={1} value={receiveLimit} onChange={(event) => setReceiveLimit(+event.target.value)}/></label><label>超时 ms<input type="number" min={1} value={timeoutMs} onChange={(event) => setTimeoutMs(+event.target.value)}/></label><label>重连次数<input type="number" min={0} value={reconnectMax} onChange={(event) => setReconnectMax(Math.max(0, +event.target.value))}/></label><label>重连间隔 ms<input type="number" min={0} value={reconnectDelayMs} onChange={(event) => setReconnectDelayMs(Math.max(0, +event.target.value))}/></label></div>
    <label style={styles.label}>Headers（每行 Name: Value）<textarea style={styles.headers} value={headersText} onChange={(event) => setHeadersText(event.target.value)} placeholder="Authorization: Bearer {{token}}"/></label>
    <textarea style={styles.message} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={encoding === "binary" ? "Base64 binary payload" : "Text frame payload"}/><ProtocolCodeGenerator input={{ protocol: "websocket", request: request() }} /><div style={styles.timelineTitle}>帧时间线 / 响应</div><pre style={styles.output}>{output}</pre>
  </section>;
}

const styles: Record<string, CSSProperties> = { root: { marginTop: 22, padding: 18, border: "1px solid var(--apivoy-border)", borderRadius: 14, background: "var(--apivoy-panel)" }, title: { display: "flex", justifyContent: "space-between" }, eyebrow: { color: "#5fd8df", letterSpacing: 1.4 }, h2: { margin: "3px 0 14px", fontSize: 18 }, status: { alignSelf: "center", color: "#68d9a9", fontSize: 10, border: "1px solid #285844", borderRadius: 999, padding: "4px 8px" }, row: { display: "flex", gap: 8 }, url: { flex: 1, minWidth: 0, background: "#071016", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 10 }, connect: { border: 0, borderRadius: 8, background: "#56cbd3", color: "#051417", fontWeight: 700, padding: "0 18px" }, secondary: { border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "#11212a", color: "#bfe8eb", padding: "0 12px" }, cancel: { border: "1px solid #71434a", borderRadius: 8, background: "#2b171b", color: "#ff9ca8" }, options: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10, color: "var(--apivoy-muted)", fontSize: 11 }, label: { display: "grid", gap: 5, marginTop: 10, color: "var(--apivoy-muted)", fontSize: 11 }, headers: { minHeight: 48, background: "#070e14", color: "#c8e4e8", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 8 }, message: { boxSizing: "border-box", width: "100%", minHeight: 90, marginTop: 10, resize: "vertical", background: "#070e14", color: "#c8e4e8", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 10, fontFamily: "monospace" }, timelineTitle: { marginTop: 12, color: "var(--apivoy-muted)", fontSize: 10, letterSpacing: 1 }, output: { minHeight: 80, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap", background: "#060b0f", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 10, color: "#bfe1e4" } };
