import { useEffect, useState, type CSSProperties } from "react";
import { consumeHydrate } from "./openRequestPipeline";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";

export type RpcProtocol = "soap" | "jsonrpc";

export interface RpcWorkbenchRequest {
  protocol: RpcProtocol;
  name: string;
  url: string;
  headers: Array<[string, string]>;
  timeoutMs: number;
  soapVersion: "1.1" | "1.2";
  action: string;
  envelope: string;
  rpcMethod: string;
  params: unknown;
  id: string | number | null;
}

export interface RpcWorkbenchProps {
  onSend: (request: RpcWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onSave?: (request: RpcWorkbenchRequest) => Promise<void>;
  onCancel?: (executionId: string) => Promise<void>;
}

export function RpcWorkbench({ onSend, onSave, onCancel }: RpcWorkbenchProps) {
  const [protocol, setProtocol] = useState<RpcProtocol>("jsonrpc");
  const [name, setName] = useState("RPC request");
  const [url, setUrl] = useState("https://example.com/rpc");
  const [headers, setHeaders] = useState("");
  const [action, setAction] = useState("urn:GetUser");
  const [version, setVersion] = useState<"1.1" | "1.2">("1.2");
  const [envelope, setEnvelope] = useState(
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">\n  <soap:Body>\n  </soap:Body>\n</soap:Envelope>',
  );
  const [rpcMethod, setRpcMethod] = useState("users.list");
  const [params, setParams] = useState('{\n  "page": 1\n}');
  const [id, setId] = useState("1");
  const [result, setResult] = useState<HttpRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const listener = (event: Event) => {
      const requestEnvelope = (event as CustomEvent).detail;
      const payload = requestEnvelope?.payload;
      if (payload?.type !== "raw" || !["soap", "jsonrpc"].includes(requestEnvelope.protocolId)) return;

      const raw = payload.value ?? payload;
      setProtocol(requestEnvelope.protocolId);
      setName(requestEnvelope.name);
      setUrl(requestEnvelope.target);
      setHeaders((raw.headers ?? []).map(([key, value]: [string, string]) => `${key}: ${value}`).join("\n"));
      if (requestEnvelope.protocolId === "soap") {
        setVersion(raw.version ?? "1.2");
        setAction(raw.action ?? "");
        setEnvelope(raw.envelope ?? "");
      } else {
        setRpcMethod(raw.method ?? "");
        setParams(JSON.stringify(raw.params ?? {}, null, 2));
        setId(raw.id == null ? "null" : String(raw.id));
      }
    };
    const pending = consumeHydrate("rpc");
    if (pending) listener(new CustomEvent("apivoy-open-request", { detail: pending.envelope }) as Event);
    const onHydrate = (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (d?.workbenchId !== "rpc") return;
      listener(new CustomEvent("apivoy-open-request", { detail: d.envelope }) as Event);
    };
    window.addEventListener("apivoy-open-request", listener);
    window.addEventListener("apivoy-hydrate-request", onHydrate);
    return () => {
      window.removeEventListener("apivoy-open-request", listener);
      window.removeEventListener("apivoy-hydrate-request", onHydrate);
    };
  }, []);

  function buildRequest(): RpcWorkbenchRequest {
    return {
      protocol,
      name,
      url,
      headers: headers
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf(":");
          if (index < 1) throw new Error(`Header 格式错误：${line}`);
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
      timeoutMs: 30_000,
      soapVersion: version,
      action,
      envelope,
      rpcMethod,
      params: JSON.parse(params || "{}"),
      id: id === "null" ? null : Number.isNaN(Number(id)) ? id : Number(id),
    };
  }

  async function send() {
    setLoading(true);
    setResult(null);
    try {
      const value = await onSend(buildRequest(), { onStarted: setExecutionId, onChunk: () => {} });
      setResult(value);
      setMessage("执行完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setExecutionId(null);
    }
  }

  async function save() {
    if (!onSave) return;
    try {
      await onSave(buildRequest());
      setMessage("已保存到集合");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section style={styles.root}>
      <header style={styles.header}>
        <div><small style={styles.eyebrow}>HTTP-BASED RPC</small><h2 style={styles.title}>SOAP / JSON-RPC</h2></div>
        <div style={styles.segment}>
          <button style={protocol === "jsonrpc" ? styles.active : styles.segmentButton} onClick={() => setProtocol("jsonrpc")}>JSON-RPC 2.0</button>
          <button style={protocol === "soap" ? styles.active : styles.segmentButton} onClick={() => setProtocol("soap")}>SOAP</button>
        </div>
      </header>
      <div style={styles.target}>
        <input style={styles.name} value={name} onChange={(event) => setName(event.target.value)} />
        <input style={styles.url} value={url} onChange={(event) => setUrl(event.target.value)} />
        <button style={styles.send} disabled={loading} onClick={() => void send()}>{loading ? "发送中…" : "发送"}</button>
        {loading && onCancel && <button style={styles.stop} onClick={() => executionId && void onCancel(executionId)}>取消</button>}
      </div>
      <div style={styles.columns}>
        <div style={styles.card}>
          {protocol === "jsonrpc" ? <>
            <label style={styles.label}>METHOD<input style={styles.input} value={rpcMethod} onChange={(event) => setRpcMethod(event.target.value)} /></label>
            <label style={styles.label}>REQUEST ID<input style={styles.input} value={id} onChange={(event) => setId(event.target.value)} /></label>
            <label style={styles.label}>PARAMS JSON<textarea style={styles.editor} value={params} onChange={(event) => setParams(event.target.value)} /></label>
          </> : <>
            <div style={styles.inline}>
              <label style={styles.label}>SOAP VERSION<select style={styles.input} value={version} onChange={(event) => setVersion(event.target.value as "1.1" | "1.2")}><option>1.1</option><option>1.2</option></select></label>
              <label style={styles.label}>SOAP ACTION<input style={styles.input} value={action} onChange={(event) => setAction(event.target.value)} /></label>
            </div>
            <label style={styles.label}>XML ENVELOPE<textarea style={styles.editor} value={envelope} onChange={(event) => setEnvelope(event.target.value)} /></label>
          </>}
          <label style={styles.label}>EXTRA HEADERS<textarea style={styles.headers} value={headers} onChange={(event) => setHeaders(event.target.value)} placeholder="X-Correlation-Id: {{traceId}}" /></label>
          {onSave && <button style={styles.secondary} onClick={() => void save()}>保存到集合</button>}
        </div>
        <div style={styles.response}>
          <div style={styles.responseHeader}><b>Response</b>{result?.responseMeta && <span>{result.responseMeta.status} · {result.summary.durationMs} ms</span>}</div>
          <pre>{result?.preview ?? "响应正文与 RPC 错误会显示在这里"}</pre>
        </div>
      </div>
      {message && <div style={styles.notice}>{message}</div>}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  root: { border: "1px solid var(--apivoy-border)", borderRadius: 18, background: "var(--apivoy-panel)", padding: 22 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }, eyebrow: { letterSpacing: 2, color: "#67d8cf", fontSize: 10, fontWeight: 800 }, title: { fontSize: 26, margin: "5px 0 0" },
  segment: { display: "flex", background: "#070c12", borderRadius: 9, padding: 3 }, segmentButton: { border: 0, borderRadius: 7, background: "transparent", color: "var(--apivoy-muted)", padding: "8px 12px", cursor: "pointer" }, active: { border: 0, borderRadius: 7, background: "rgba(36,197,183,.14)", color: "#c9fffa", padding: "8px 12px", cursor: "pointer" },
  target: { display: "grid", gridTemplateColumns: "180px 1fr auto auto", gap: 8, marginBottom: 12 }, name: { border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "#090f17", color: "var(--apivoy-text)", padding: "10px" }, url: { border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "#090f17", color: "#bfe5ff", padding: "10px", fontFamily: "var(--apivoy-mono)" },
  send: { border: 0, borderRadius: 8, background: "var(--apivoy-panel)", color: "white", fontWeight: 750, padding: "10px 16px", cursor: "pointer" }, stop: { border: "1px solid rgba(240,113,120,.4)", borderRadius: 8, background: "rgba(240,113,120,.1)", color: "#ffbdc0", padding: "9px" },
  columns: { display: "grid", gridTemplateColumns: "minmax(380px,1fr) minmax(380px,1fr)", gap: 12 }, card: { border: "1px solid var(--apivoy-border)", borderRadius: 12, background: "rgba(5,10,16,.48)", padding: 14 }, label: { display: "grid", gap: 6, color: "var(--apivoy-muted)", fontSize: 10, fontWeight: 700, marginBottom: 10 }, input: { width: "100%", border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "#080e15", color: "var(--apivoy-text)", padding: "9px" }, inline: { display: "grid", gridTemplateColumns: "130px 1fr", gap: 8 },
  editor: { width: "100%", minHeight: 220, resize: "vertical", border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "#060b11", color: "#cbe9e5", padding: 11, fontFamily: "var(--apivoy-mono)", lineHeight: 1.55 }, headers: { width: "100%", minHeight: 70, resize: "vertical", border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "#060b11", color: "#aebfd0", padding: 10, fontFamily: "var(--apivoy-mono)" }, secondary: { border: "1px solid rgba(36,197,183,.35)", borderRadius: 8, background: "rgba(36,197,183,.08)", color: "#bff5ef", padding: "9px 12px", cursor: "pointer" },
  response: { border: "1px solid var(--apivoy-border)", borderRadius: 12, background: "#060b10", overflow: "hidden" }, responseHeader: { display: "flex", justifyContent: "space-between", padding: 12, borderBottom: "1px solid var(--apivoy-border)" }, notice: { marginTop: 12, borderLeft: "3px solid #24c5b7", background: "rgba(36,197,183,.08)", padding: "10px 13px" },
};
