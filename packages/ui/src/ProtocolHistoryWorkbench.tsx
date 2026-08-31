import { useEffect, useMemo, useState } from "react";
import type { RequestEnvelope } from "@apivoy/request-model";
import { Icon } from "./Icons";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";

export interface ProtocolHistoryWorkbenchProps {
  request: RequestEnvelope;
  initialResult: HttpRunResult;
  historyStartedAt: string;
  interfaceName?: string;
  onOpenInterface?: () => void;
  onSend: (request: RequestEnvelope, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onSave: (request: RequestEnvelope, result?: HttpRunResult | null) => Promise<void> | void;
  saveActionLabel: string;
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function ProtocolHistoryWorkbench({ request, initialResult, historyStartedAt, interfaceName, onOpenInterface, onSend, onSave, saveActionLabel }: ProtocolHistoryWorkbenchProps) {
  const [name, setName] = useState(request.name);
  const [target, setTarget] = useState(request.target);
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(request.payload, null, 2));
  const [result, setResult] = useState<HttpRunResult | null>(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(request.name);
    setTarget(request.target);
    setPayloadText(JSON.stringify(request.payload, null, 2));
    setResult(initialResult);
    setError("");
  }, [initialResult, request]);

  const parsedPayload = useMemo(() => {
    try { return { value: JSON.parse(payloadText) as RequestEnvelope["payload"], error: "" }; }
    catch { return { value: null, error: "协议载荷不是有效的 JSON" }; }
  }, [payloadText]);

  function currentRequest(): RequestEnvelope | null {
    if (!parsedPayload.value) return null;
    return { ...request, name: name.trim() || request.name, target: target.trim(), payload: parsedPayload.value };
  }

  async function send() {
    const next = currentRequest();
    if (!next) return;
    setBusy(true);
    setError("");
    try { setResult(await onSend(next)); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  }

  const preview = result?.preview ?? "该记录没有可用的响应预览。";
  return <section className="protocol-history-workbench">
    <header className="protocol-history-commandbar">
      <span className="protocol-history-badge">{request.protocolId.toUpperCase()}</span>
      <input aria-label="请求名称" value={name} onChange={(event) => setName(event.target.value)}/>
      <button type="button" className="ui-button primary" disabled={busy || !target.trim() || Boolean(parsedPayload.error)} onClick={() => void send()}><Icon name="send"/>{busy ? "发送中…" : "发送"}</button>
      <button type="button" className="ui-button secondary" disabled={busy || Boolean(parsedPayload.error)} onClick={() => { const next = currentRequest(); if (next) void onSave(next, result); }}>{saveActionLabel}</button>
    </header>
    <div className="http-history-sent-at">
      {interfaceName && onOpenInterface ? <button type="button" className="http-history-interface-link" aria-label={`打开接口 ${interfaceName}`} onClick={onOpenInterface}><Icon name="folder"/><span>{interfaceName}</span></button> : null}
      <span className="http-history-time"><Icon name="activity"/><span>历史发送时间</span><time dateTime={historyStartedAt}>{formatHistoryTime(historyStartedAt)}</time></span>
    </div>
    <div className="protocol-history-editor">
      <label><span>请求目标</span><input aria-label="请求目标" value={target} onChange={(event) => setTarget(event.target.value)}/></label>
      <label className="protocol-history-payload"><span>协议载荷 <small>RequestEnvelope.payload</small></span><textarea aria-label="协议载荷" spellCheck={false} value={payloadText} onChange={(event) => setPayloadText(event.target.value)}/></label>
      {parsedPayload.error || error ? <div className="protocol-history-error" role="alert">{parsedPayload.error || error}</div> : null}
    </div>
    <section className="protocol-history-response">
      <header><div><strong>响应</strong><span>{result?.summary.state ?? "—"}</span></div><div><b>{result?.summary.status ?? "—"}</b><span>{result?.summary.durationMs ?? 0} ms</span></div></header>
      <pre>{preview}</pre>
    </section>
  </section>;
}
