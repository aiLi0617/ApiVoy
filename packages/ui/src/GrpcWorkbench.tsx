import { useEffect, useRef, useState } from "react";
import type { ExecutionEvent, ResponseMeta } from "@apivoy/request-model";
import { useWorkbenchHydration } from "./useWorkbenchHydration";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { KeyValueRows, createQueryRow, type HeaderRow } from "./KeyValueEditor";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";
import { useI18n } from "./i18n";
import { SplitPane } from "./WorkbenchFrame";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { Icon } from "./Icons";
import { MessageDetailActions, MessageInspector, MessageSummary, MessageToolbar } from "./MessageInspector";
import { RovingTabList } from "./RovingTabList";
import { useMessageDetailResize } from "./useMessageDetailResize";

export interface GrpcWorkbenchRequest { name: string; target: string; service: string; method: string; messageBase64: string; messageJson?: string | null; descriptorSetBase64?: string | null; mode: "unary" | "server_streaming" | "client_streaming" | "bidi_streaming"; metadata: Array<[string, string]>; timeoutMs: number }
export interface GrpcWorkbenchProps { onSend: (request: GrpcWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>; onCancel: (executionId: string) => Promise<void>; onSave?: (request: GrpcWorkbenchRequest) => Promise<void>; externalRequest?: GrpcWorkbenchRequest | null; onTitleChange?: (title: string) => void }
type RequestTab = "message" | "metadata" | "settings";
type ResponseTab = "messages" | "headers" | "request";
type GrpcResponseMessage = { id: string; index: number; time: string; preview: string; dataBase64: string; size: number };

function metadataRows(entries: Array<[string, string]>): HeaderRow[] { return [...entries.map(([key, value]) => createQueryRow(key, value)), createQueryRow()]; }

export function GrpcWorkbench({ onSend, onCancel, onSave, externalRequest, onTitleChange }: GrpcWorkbenchProps) {
  const { t } = useI18n();
  const [target, setTarget] = useState("http://127.0.0.1:50051");
  const [service, setService] = useState("package.Service");
  const [method, setMethod] = useState("Method");
  const [mode, setMode] = useState<GrpcWorkbenchRequest["mode"]>("unary");
  const [messageMode, setMessageMode] = useState<"json" | "base64">("base64");
  const [message, setMessage] = useState("");
  const [descriptorSetBase64, setDescriptorSetBase64] = useState("");
  const [descriptorName, setDescriptorName] = useState("");
  const [metadata, setMetadata] = useState<HeaderRow[]>(() => [createQueryRow()]);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [responseMessages, setResponseMessages] = useState<GrpcResponseMessage[]>([]);
  const [responseMeta, setResponseMeta] = useState<ResponseMeta | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [responseTab, setResponseTab] = useState<ResponseTab>("messages");
  const [messageQuery, setMessageQuery] = useState("");
  const [detailFormat, setDetailFormat] = useState<"pretty" | "raw" | "hexdump" | "base64">("pretty");
  const [detailWordWrap, setDetailWordWrap] = useState(true);
  const [responseNotice, setResponseNotice] = useState("");
  const [hasResponse, setHasResponse] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestTab, setRequestTab] = useState<RequestTab>("message");
  const detailEditorRef = useRef<CodeEditorHandle | null>(null);
  const { stacked: responseDetailsStacked } = useMessageDetailResize("apivoy-grpc-message-list-ratio", Boolean(selectedMessageId), ".grpc-response .websocket-message-browser.has-detail");

  function applyRequest(value: GrpcWorkbenchRequest) { setTarget(value.target); setService(value.service); setMethod(value.method); setMode(value.mode); const json = value.messageJson; setMessageMode(json != null ? "json" : "base64"); setMessage(json ?? value.messageBase64); setDescriptorSetBase64(value.descriptorSetBase64 ?? ""); setDescriptorName(value.descriptorSetBase64 ? "DescriptorSet" : ""); setMetadata(metadataRows(value.metadata)); setTimeoutMs(value.timeoutMs); }
  useEffect(() => { if (externalRequest) applyRequest(externalRequest); else { const draft = readWorkbenchDraft<GrpcWorkbenchRequest>("grpc"); if (draft) applyRequest(draft); } }, [externalRequest]);
  useWorkbenchHydration("grpc", (detail) => { const envelope = detail as { name: string; target: string; timeoutMs: number; payload?: Partial<GrpcWorkbenchRequest> & { type?: string } }; const payload = envelope.payload; if (payload?.type !== "grpc") return; applyRequest({ name: envelope.name, target: envelope.target, service: payload.service ?? "", method: payload.method ?? "", messageBase64: payload.messageBase64 ?? "", messageJson: payload.messageJson, descriptorSetBase64: payload.descriptorSetBase64, mode: payload.mode ?? "unary", metadata: payload.metadata ?? [], timeoutMs: envelope.timeoutMs }); });

  useEffect(() => { onTitleChange?.(service.trim() && method.trim() ? `${service}/${method}` : "gRPC"); }, [method, onTitleChange, service]);

  async function loadDescriptor(file: File | null) { if (!file) return; const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); setDescriptorSetBase64(btoa(binary)); setDescriptorName(file.name); }
  const request = (): GrpcWorkbenchRequest => ({ name: `${service}/${method}`, target, service, method, messageBase64: messageMode === "base64" ? message : "", messageJson: messageMode === "json" ? message : null, descriptorSetBase64: descriptorSetBase64 || null, mode, metadata: metadata.filter((row) => row.enabled && row.key.trim()).map((row) => [row.key.trim(), row.value]), timeoutMs });
  useAutosaveDraft("grpc", request);
  function handleResponseEvent(event: ExecutionEvent) {
    if (event.type === "response_meta") setResponseMeta(event);
    if (event.type === "response_chunk" && (event.preview != null || event.dataBase64 != null) && event.size > 0) {
      setResponseMessages((current) => {
        const next: GrpcResponseMessage = { id: crypto.randomUUID(), index: current.length + 1, time: new Date().toLocaleTimeString([], { hour12: false }), preview: event.preview ?? event.dataBase64 ?? "", dataBase64: event.dataBase64 ?? "", size: event.size };
        return [...current, next];
      });
    }
    if (event.type === "warning") setResponseNotice(event.message);
  }
  async function send() {
    setBusy(true); setHasResponse(true); setResponseMessages([]); setResponseMeta(null); setSelectedMessageId(null); setResponseTab("messages"); setResponseNotice("正在调用 gRPC…");
    try {
      const result = await onSend(request(), { onStarted: setRunningId, onEvent: handleResponseEvent });
      setResponseMeta((current) => current ?? result.responseMeta ?? null);
      if (result.error) setResponseNotice(`调用失败：${result.error}`);
      else setResponseNotice(`调用完成，共收到 ${result.summary.bytesReceived} protobuf bytes`);
    } catch (error) { setResponseNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setRunningId(null); }
  }
  function formatMessage() { if (messageMode !== "json" || !message.trim()) return; try { setMessage(JSON.stringify(JSON.parse(message), null, 2)); } catch { /* Preserve invalid input for correction. */ } }

  const selectedMessage = responseMessages.find((item) => item.id === selectedMessageId) ?? null;
  const visibleMessages = responseMessages.filter((item) => !messageQuery.trim() || item.preview.toLocaleLowerCase().includes(messageQuery.trim().toLocaleLowerCase()));
  const prettyMessage = selectedMessage ? (() => { try { return JSON.stringify(JSON.parse(selectedMessage.preview), null, 2); } catch { return selectedMessage.preview; } })() : "";
  const messageBytes = selectedMessage?.dataBase64 ? (() => { try { return Uint8Array.from(atob(selectedMessage.dataBase64), (character) => character.charCodeAt(0)); } catch { return new TextEncoder().encode(selectedMessage.preview); } })() : new Uint8Array();
  const messageHexdump = Array.from({ length: Math.ceil(messageBytes.length / 16) }, (_, row) => { const offset = row * 16; const chunk = messageBytes.slice(offset, offset + 16); const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(47, " "); const ascii = Array.from(chunk, (byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join(""); return `${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`; }).join("\n");
  const selectedMessagePayload = !selectedMessage ? "" : detailFormat === "pretty" ? prettyMessage : detailFormat === "raw" ? selectedMessage.preview : detailFormat === "hexdump" ? messageHexdump : selectedMessage.dataBase64;
  const selectedMessageLanguage = detailFormat === "pretty" && (() => { try { JSON.parse(prettyMessage); return true; } catch { return false; } })() ? "json" : "plaintext";
  const actualRequest = request();
  function downloadSelectedMessage() { if (!selectedMessage) return; const blob = new Blob([selectedMessagePayload], { type: "text/plain;charset=utf-8" }); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `grpc-response-${selectedMessage.index}.txt`; anchor.click(); URL.revokeObjectURL(href); }

  const status = <span className={`grpc-status${busy ? " is-running" : hasResponse ? " is-complete" : ""}`}>{busy ? "调用中" : hasResponse ? "已完成" : "未调用"}</span>;
  const tabs: Array<[RequestTab, string]> = [["message", "Message"], ["metadata", "Metadata"], ["settings", "设置"]];
  return <div className="grpc-workbench-layout">
    <div className="grpc-commandbar"><input aria-label="gRPC 服务地址" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="http://host:50051" /><button className="grpc-primary" disabled={busy || !target.trim() || !service.trim() || !method.trim()} onClick={() => void send()}><Icon name="send" />{t("workbench.invoke")}</button>{onSave && <button className="grpc-secondary" disabled={busy} onClick={() => void onSave(request())}><Icon name="archive" />{t("action.save")}</button>}{runningId && <button className="grpc-danger" onClick={() => void onCancel(runningId)}>{t("action.cancel")}</button>}</div>
    <div className="grpc-workbench-split"><SplitPane id="grpc-workbench" direction="vertical" minPrimary={160} minSecondary={160} primaryLabel="gRPC 请求配置" secondaryLabel="响应检查器" secondaryActions={status} primary={<section className={`grpc-request-pane tab-${requestTab}`}>
      <div className="grpc-methodbar"><select aria-label="gRPC 调用模式" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="unary">Unary</option><option value="server_streaming">Server Streaming</option><option value="client_streaming">Client Streaming</option><option value="bidi_streaming">Bidirectional Streaming</option></select><input aria-label="gRPC Service" value={service} onChange={(event) => setService(event.target.value)} placeholder="package.Service" /><span>/</span><input aria-label="gRPC Method" value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Method" /></div>
      <RovingTabList className="grpc-request-tabs" ariaLabel="gRPC 请求配置">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={requestTab === id} tabIndex={requestTab === id ? 0 : -1} className={requestTab === id ? "is-active" : ""} onClick={() => setRequestTab(id)}>{label}</button>)}</RovingTabList>
      {requestTab === "message" && <section className="grpc-message-editor"><header><strong>请求消息</strong><select aria-label="消息格式" value={messageMode} onChange={(event) => setMessageMode(event.target.value as typeof messageMode)}><option value="base64">Protobuf Base64</option><option value="json">JSON</option></select><span className="grpc-editor-actions"><button type="button" aria-label="格式化 JSON" title="格式化" disabled={messageMode !== "json" || !message.trim()} onClick={formatMessage}><Icon name="code" /></button><button type="button" aria-label="清空请求消息" title="清空" disabled={!message} onClick={() => setMessage("")}><Icon name="broom" /></button></span></header><CodeEditor value={message} onChange={setMessage} language={messageMode === "json" ? "json" : "plaintext"} height="100%" bare /></section>}
      {requestTab === "metadata" && <section className="grpc-metadata-panel" data-title="请求 Metadata"><KeyValueRows rows={metadata} setRows={setMetadata} kind="Metadata" nameLabel="Metadata 名称" valueLabel="Metadata 值" addPlaceholder="添加 Metadata" loading={busy} /></section>}
      {requestTab === "settings" && <section className="grpc-panel grpc-settings"><label><span>超时</span><div className="grpc-number-field"><input type="number" min={1} value={timeoutMs} onChange={(event) => setTimeoutMs(+event.target.value)} /><em>ms</em></div></label><label className="grpc-descriptor"><span>FileDescriptorSet</span><div><label className="grpc-file-picker"><Icon name="archive" /><strong>{descriptorName || "选择 .bin / .pb 文件"}</strong><input type="file" accept=".bin,.pb" onChange={(event) => void loadDescriptor(event.target.files?.[0] ?? null)} /></label>{descriptorSetBase64 && <button type="button" onClick={() => { setDescriptorSetBase64(""); setDescriptorName(""); }}>移除</button>}</div><small>{descriptorSetBase64 ? "将使用已加载的 Descriptor" : "未加载时自动使用 Server Reflection"}</small></label></section>}
      <ProtocolCodeGenerator input={{ protocol: "grpc", request: request() }} />
    </section>} secondary={<section className={`websocket-response grpc-response${hasResponse ? " has-response" : ""}`}>{!hasResponse ? <div className="grpc-response-waiting"><Icon name="network" /><strong>等待调用</strong><span>调用 gRPC 方法后，响应消息和流式输出会显示在这里。</span></div> : <>
      <RovingTabList className="websocket-response-tabs" ariaLabel="gRPC 响应">{([['messages', `Messages ${responseMessages.length}`], ['headers', `Headers ${responseMeta?.headers.length ?? 0}`], ['request', '实际请求']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={responseTab === id} tabIndex={responseTab === id ? 0 : -1} className={responseTab === id ? "is-active" : ""} onClick={() => setResponseTab(id)}>{label}</button>)}</RovingTabList>
      <div className="websocket-frame-list" role="tabpanel">
        {responseTab === "messages" && <MessageInspector hasDetail={Boolean(selectedMessage)} stacked={responseDetailsStacked}><MessageSummary><MessageToolbar><input type="search" aria-label="搜索 gRPC 响应消息" value={messageQuery} onChange={(event) => setMessageQuery(event.target.value)} placeholder="搜索响应消息"/><span className="grpc-message-count">{responseMessages.length} 条消息</span><button type="button" className="websocket-clear-messages" aria-label="清空 gRPC 响应消息" title="清空消息" onClick={() => { setResponseMessages([]); setSelectedMessageId(null); }}><Icon name="archive"/></button></MessageToolbar><div className="websocket-message-list">{visibleMessages.map((item) => <button type="button" key={item.id} className={`websocket-frame websocket-frame-incoming${selectedMessageId === item.id ? " is-selected" : ""}`} onClick={() => setSelectedMessageId(item.id)}><b>←</b><code>{item.preview.replace(/\s+/g, " ").trim() || `Message #${item.index}`}</code><span className="grpc-frame-size">{item.size} B</span><time>{item.time}</time></button>)}{!responseMessages.length && <div className="grpc-response-empty">{responseNotice}</div>}</div></MessageSummary>{selectedMessage && <section className="websocket-frame-detail"><header><div className="websocket-frame-detail-options"><select aria-label="gRPC 消息展示格式" value={detailFormat} onChange={(event) => setDetailFormat(event.target.value as typeof detailFormat)}><option value="pretty">Pretty</option><option value="raw">Raw</option><option value="hexdump">Hexdump</option><option value="base64">Base64</option></select><button type="button" className={detailWordWrap ? "is-active" : ""} aria-label="切换自动换行" title="自动换行" onClick={() => setDetailWordWrap((current) => !current)}><Icon name="wrap"/></button></div><MessageDetailActions actions={[{ id: "download", label: "下载 gRPC 消息", icon: "download", onSelect: downloadSelectedMessage }, { id: "copy", label: "复制 gRPC 消息", icon: "copy", onSelect: () => void navigator.clipboard.writeText(selectedMessagePayload) }, { id: "search", label: "搜索 gRPC 消息内容", icon: "search", onSelect: () => detailEditorRef.current?.openFind() }]} closeLabel="关闭 gRPC 消息详情" onClose={() => setSelectedMessageId(null)}/></header><CodeEditor ref={detailEditorRef} value={selectedMessagePayload} onChange={() => {}} language={selectedMessageLanguage} height="100%" wordWrap={detailWordWrap} readOnly bare/></section>}</MessageInspector>}
        {responseTab === "headers" && (responseMeta?.headers.length ? <div className="websocket-response-table">{responseMeta.headers.map(([header, value], index) => <div key={`${header}-${index}`}><strong>{header}</strong><span>{value}</span></div>)}</div> : <div className="websocket-response-empty">没有响应 Header。</div>)}
        {responseTab === "request" && <div className="websocket-actual-request"><section><strong>调用地址</strong><code>{actualRequest.target}</code></section><section><strong>方法</strong><code>{actualRequest.service}/{actualRequest.method}</code></section><section><strong>调用模式</strong><code>{actualRequest.mode}</code></section><section><strong>请求 Metadata</strong><pre>{actualRequest.metadata.length ? actualRequest.metadata.map(([key, value]) => `${key}: ${value}`).join("\n") : "（空）"}</pre></section></div>}
      </div>
    </>}</section>} /></div>
  </div>;
}
