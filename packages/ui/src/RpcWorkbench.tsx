import { useState } from "react";
import { useWorkbenchHydration } from "./useWorkbenchHydration";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { Button, SegmentedControl, Select, Textarea, TextInput } from "./Components";

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

  useWorkbenchHydration("rpc", (detail) => {
    const requestEnvelope = detail as { protocolId?: "soap" | "jsonrpc"; name?: string; target?: string; payload?: { type?: string; value?: Record<string, unknown> } & Record<string, unknown> };
    const payload = requestEnvelope.payload;
    if (payload?.type !== "raw" || !requestEnvelope.protocolId || !["soap", "jsonrpc"].includes(requestEnvelope.protocolId)) return;
    const raw = (payload.value ?? payload) as { headers?: Array<[string, string]>; version?: "1.1" | "1.2"; action?: string; envelope?: string; method?: string; params?: unknown; id?: unknown };
    setProtocol(requestEnvelope.protocolId); setName(requestEnvelope.name ?? ""); setUrl(requestEnvelope.target ?? "");
    setHeaders((raw.headers ?? []).map(([key, value]) => `${key}: ${value}`).join("\n"));
    if (requestEnvelope.protocolId === "soap") { setVersion(raw.version ?? "1.2"); setAction(raw.action ?? ""); setEnvelope(raw.envelope ?? ""); }
    else { setRpcMethod(raw.method ?? ""); setParams(JSON.stringify(raw.params ?? {}, null, 2)); setId(raw.id == null ? "null" : String(raw.id)); }
  });

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
    <section className="rpc-workbench">
      <header className="rpc-header">
        <div><small>HTTP-BASED RPC</small><h2>SOAP / JSON-RPC</h2></div>
        <SegmentedControl ariaLabel="RPC 协议" value={protocol} onValueChange={setProtocol} items={[{ value: "jsonrpc", label: "JSON-RPC 2.0" }, { value: "soap", label: "SOAP" }]} />
      </header>
      <div className="rpc-target">
        <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        <TextInput aria-label={protocol === "soap" ? "SOAP 服务地址" : "JSON-RPC 服务地址"} className="rpc-url" value={url} onChange={(event) => setUrl(event.target.value)} />
        <Button variant="primary" loading={loading} onClick={() => void send()}>发送</Button>
        {loading && onCancel && <Button variant="danger" onClick={() => executionId && void onCancel(executionId)}>取消</Button>}
      </div>
      <div className="rpc-columns">
        <div className="rpc-card">
          {protocol === "jsonrpc" ? <>
            <label className="rpc-field">METHOD<TextInput value={rpcMethod} onChange={(event) => setRpcMethod(event.target.value)} /></label>
            <label className="rpc-field">REQUEST ID<TextInput value={id} onChange={(event) => setId(event.target.value)} /></label>
            <label className="rpc-field">PARAMS JSON<Textarea className="rpc-editor" value={params} onChange={(event) => setParams(event.target.value)} /></label>
          </> : <>
            <div className="rpc-inline">
              <label className="rpc-field">SOAP VERSION<Select value={version} onChange={(event) => setVersion(event.target.value as "1.1" | "1.2")}><option>1.1</option><option>1.2</option></Select></label>
              <label className="rpc-field">SOAP ACTION<TextInput value={action} onChange={(event) => setAction(event.target.value)} /></label>
            </div>
            <label className="rpc-field">XML ENVELOPE<Textarea className="rpc-editor" value={envelope} onChange={(event) => setEnvelope(event.target.value)} /></label>
          </>}
          <label className="rpc-field">EXTRA HEADERS<Textarea className="rpc-headers" value={headers} onChange={(event) => setHeaders(event.target.value)} placeholder="X-Correlation-Id: {{traceId}}" /></label>
          {onSave && <Button variant="secondary" onClick={() => void save()}>保存到集合</Button>}
        </div>
        <div className="rpc-response">
          <div className="rpc-response-header"><b>Response</b>{result?.responseMeta && <span>{result.responseMeta.status} · {result.summary.durationMs} ms</span>}</div>
          <pre>{result?.preview ?? "响应正文与 RPC 错误会显示在这里"}</pre>
        </div>
      </div>
      {message && <div className="rpc-notice" role="status">{message}</div>}
    </section>
  );
}
