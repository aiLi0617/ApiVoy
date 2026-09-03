import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useWorkbenchHydration } from "./useWorkbenchHydration";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";
import { SplitPane } from "./WorkbenchFrame";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { Icon } from "./Icons";
import { MessageDetailActions, MessageInspector, MessageSummary, MessageToolbar } from "./MessageInspector";
import { RovingTabList } from "./RovingTabList";
import { encodeTcpPayload, formatTcpPayload, tcpPayloadLabel, tcpPayloadLanguage, type TcpPayloadFormat } from "./TcpPayloadCodec";
import { useMessageDetailResize } from "./useMessageDetailResize";

export interface SocketWorkbenchRequest { id?: string; protocol: "tcp" | "udp"; name: string; target: string; data: string; encoding: "text" | "hex"; format?: TcpPayloadFormat; sourceData?: string; framing?: string | null; delimiter?: string | null; fixedLength?: number | null; sendCount: number; intervalMs: number; timeoutMs: number; tls: boolean; serverName?: string | null; caCertRef?: string | null }
export interface TcpSessionConnection { url: string; protocols: string[] }
export interface SocketWorkbenchProps { onSend: (request: SocketWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>; onCancel: (executionId: string) => Promise<void>; onSave?: (request: SocketWorkbenchRequest) => Promise<void>; externalRequest?: SocketWorkbenchRequest | null; tcpSessionConnection?: (target: string) => Promise<TcpSessionConnection>; onTitleChange?: (title: string) => void }
export type TcpWorkbenchProps = SocketWorkbenchProps;
export type UdpWorkbenchProps = Omit<SocketWorkbenchProps, "tcpSessionConnection">;

function SocketWorkbench({ protocol, onSend, onCancel, onSave, externalRequest, tcpSessionConnection, onTitleChange }: SocketWorkbenchProps & { protocol: "tcp" | "udp" }) {
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const [name, setName] = useState("");
  const [target, setTarget] = useState("127.0.0.1:9000");
  const [data, setData] = useState("");
  const [encoding, setEncoding] = useState<TcpPayloadFormat>("text");
  const [responseFormat, setResponseFormat] = useState<TcpPayloadFormat | "auto">("auto");
  const [framing, setFraming] = useState("none");
  const [delimiter, setDelimiter] = useState("\\n");
  const [fixedLength, setFixedLength] = useState(1);
  const [sendCount, setSendCount] = useState(1);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [timeoutMs, setTimeoutMs] = useState(3000);
  const [tls, setTls] = useState(false);
  const [serverName, setServerName] = useState("");
  const [caCertRef, setCaCertRef] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const [requestTab, setRequestTab] = useState<"message" | "settings">("message");
  const [clearAfterSend, setClearAfterSend] = useState(false);

  const [frameQuery, setFrameQuery] = useState("");
  const [frameFilter, setFrameFilter] = useState<"all" | "incoming" | "outgoing">("all");
  const [detailFormat, setDetailFormat] = useState<"pretty" | "hexdump" | "raw">("pretty");
  const [detailWordWrap, setDetailWordWrap] = useState(true);
  const [frames, setFrames] = useState<Array<{ id: string; time: string; direction: "→" | "←" | "•"; type: string; payload: string; bytes?: Uint8Array }>>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const detailEditorRef = useRef<CodeEditorHandle | null>(null);
  const deferredFrameQuery = useDeferredValue(frameQuery);
  const sessionRef = useRef<WebSocket | null>(null);
  const closeReportedRef = useRef(false);
  useMessageDetailResize(`apivoy-${protocol}-message-list-ratio`, Boolean(selectedFrameId), `.${protocol}-workbench-layout .websocket-message-browser.has-detail`);
  function applyRequest(value: SocketWorkbenchRequest) { if (value.protocol !== protocol) return; if (value.id) requestIdRef.current = value.id; setName(value.name ?? ""); setTarget(value.target); setData(value.sourceData ?? value.data); setEncoding(value.format ?? value.encoding); setFraming(value.framing ?? "none"); setDelimiter(value.delimiter ?? "\n"); setFixedLength(value.fixedLength ?? 1); setSendCount(value.sendCount); setIntervalMs(value.intervalMs); setTimeoutMs(value.timeoutMs); setTls(value.tls); setServerName(value.serverName ?? ""); setCaCertRef(value.caCertRef ?? ""); }
  useEffect(() => { if (externalRequest) applyRequest(externalRequest); else { const draft = readWorkbenchDraft<SocketWorkbenchRequest>(protocol) ?? readWorkbenchDraft<SocketWorkbenchRequest>("socket"); if (draft) applyRequest(draft); } }, [externalRequest, protocol]);
  useWorkbenchHydration(protocol, (detail) => { const envelope = detail as { id?: string; name?: string; target?: string; timeoutMs?: number; metadata?: Record<string, string>; payload?: Record<string, unknown> & { type?: string } }; const payload = envelope.payload; if (payload?.type !== protocol) return; applyRequest({ id: envelope.id, protocol, name: envelope.name ?? "", target: envelope.target ?? "", data: String(payload.data ?? ""), encoding: (payload.encoding as "text" | "hex") ?? "text", format: (envelope.metadata?.socketPayloadFormat ?? envelope.metadata?.tcpPayloadFormat) as TcpPayloadFormat | undefined, sourceData: envelope.metadata?.socketSourceData ?? envelope.metadata?.tcpSourceData, framing: protocol === "tcp" ? String(payload.framing ?? "none") : null, delimiter: protocol === "tcp" ? String(payload.delimiter ?? "\n") : null, fixedLength: protocol === "tcp" ? Number(payload.fixedLength ?? 1) : null, sendCount: Number(payload.sendCount ?? 1), intervalMs: Number(payload.intervalMs ?? 0), timeoutMs: envelope.timeoutMs ?? 30_000, tls: protocol === "tcp" && Boolean(payload.tls), serverName: protocol === "tcp" ? String(payload.serverName ?? "") : null, caCertRef: protocol === "tcp" ? String(payload.caCertRef ?? "") : null }); });
  useEffect(() => { onTitleChange?.(name.trim() || protocol.toUpperCase()); }, [name, onTitleChange, protocol]);
  const wirePayload = (): { data: string; encoding: "text" | "hex" } => {
    try {
      const bytes = encodeTcpPayload(encoding, data);
      if (encoding === "text" || encoding === "json" || encoding === "xml") return { data, encoding: "text" };
      return { data: formatTcpPayload(bytes, "hex"), encoding: "hex" };
    } catch { return { data, encoding: encoding === "hex" ? "hex" : "text" }; }
  };
  const payloadError = (() => { try { if (data) encodeTcpPayload(encoding, data); return ""; } catch (error) { return error instanceof Error ? error.message : "消息格式无效"; } })();
  const request = (): SocketWorkbenchRequest => { const wire = wirePayload(); return { id: requestIdRef.current, protocol, name: name.trim() || (protocol === "udp" ? target : protocol.toUpperCase() + " " + target), target, data: wire.data, encoding: wire.encoding, format: encoding, sourceData: data, framing: protocol === "tcp" ? framing : null, delimiter: framing === "delimiter" ? delimiter.replace(/\\n/g, "\n").replace(/\\r/g, "\r") : null, fixedLength: framing === "fixed" ? fixedLength : null, sendCount, intervalMs, timeoutMs, tls: protocol === "tcp" && tls, serverName: serverName || null, caCertRef: caCertRef || null }; };
  useAutosaveDraft(protocol, request);
  async function send() {
    if (protocol !== "udp") return;
    setBusy(true); setHasConnected(true); setSelectedFrameId(null);
    try {
      const sentBytes = encodeTcpPayload(encoding, data);
      appendFrame("→", tcpPayloadLabel(encoding) + (sendCount > 1 ? " ×" + sendCount : ""), data, sentBytes);
      let received = false;
      const receive = (payload: string) => {
        if (!payload) return;
        received = true;
        const bytes = new TextEncoder().encode(payload);
        const detectedFormat = resolveResponseFormat(bytes);
        let display = payload;
        try { display = formatTcpPayload(bytes, detectedFormat); } catch { /* retain raw payload */ }
        appendFrame("←", tcpPayloadLabel(detectedFormat), display, bytes);
      };
      const result = await onSend(request(), { onStarted: setRunningId, onChunk: receive });
      if (result.error) appendFrame("•", "错误", result.error);
      else if (!received && result.preview) receive(result.preview);
      else if (!received && result.summary.bytesReceived === 0) appendFrame("•", "超时", timeoutMs + " ms 内未收到数据报");
      if (!result.error && clearAfterSend) setData("");
    } catch (error) { appendFrame("•", "错误", error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); setRunningId(null); }
  }
  function appendFrame(direction: "→" | "←" | "•", type: string, payload: string, bytes?: Uint8Array) { setFrames((current) => [...current, { id: crypto.randomUUID(), time: new Date().toLocaleTimeString([], { hour12: false }), direction, type, payload, bytes }]); }
  function detectTcpPayloadFormat(bytes: Uint8Array): TcpPayloadFormat {
    const decoded = new TextDecoder().decode(bytes).trim();
    if (decoded) {
      try { JSON.parse(decoded); return "json"; } catch { /* not JSON */ }
      if (/^<\?xml|^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(decoded)) return "xml";
      const printable = [...decoded].filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length;
      if (printable / decoded.length > 0.85) return "text";
    }
    return "hex";
  }
  function resolveResponseFormat(bytes?: Uint8Array): TcpPayloadFormat {
    return responseFormat === "auto" ? (bytes ? detectTcpPayloadFormat(bytes) : "text") : responseFormat;
  }
  function formattedInput(): string {
    const bytes = encodeTcpPayload(encoding, data);
    if (encoding === "text") return data;
    return formatTcpPayload(bytes, encoding);
  }
  function formatInputMessage() {
    try { setData(formattedInput()); }
    catch (error) { appendFrame("•", "错误", error instanceof Error ? error.message : "消息格式无效"); }
  }
  function tcpHexdump(bytes: Uint8Array): string {
    const rows: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const row = bytes.slice(offset, offset + 16);
      const hex = Array.from(row, (value) => value.toString(16).padStart(2, "0")).join(" ").padEnd(47);
      const ascii = Array.from(row, (value) => value >= 32 && value <= 126 ? String.fromCharCode(value) : ".").join("");
      rows.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
    }
    return rows.join("\n");
  }
  async function openSession() {
    if (protocol !== "tcp" || sessionRef.current) return;
    if (!tcpSessionConnection) { appendFrame("•", "错误", "当前执行端未提供安全的 TCP 会话连接"); return; }
    setConnecting(true); setHasConnected(true); setFrames([]); setSelectedFrameId(null); closeReportedRef.current = false;
    appendFrame("•", "状态", "正在建立 TCP 会话…");
    try {
      const connection = await tcpSessionConnection(target);
      const socket = new WebSocket(connection.url, connection.protocols);
      sessionRef.current = socket;
      socket.binaryType = "arraybuffer";
      socket.onopen = () => { setConnecting(false); setSessionOpen(true); appendFrame("•", "状态", "Local Agent 连接通道已建立，正在等待目标 TCP 确认"); };
      socket.onmessage = (event) => { if (typeof event.data === "string") { try { const control = JSON.parse(event.data) as { type?: string; reason?: string }; if (control.type === "connected") { setConnecting(false); setSessionOpen(true); setHasConnected(true); appendFrame("•", "状态", `已连接到 ${target}`); return; } if (control.type === "closed" || control.type === "error") { closeReportedRef.current = true; setConnecting(false); setSessionOpen(false); setHasConnected(true); appendFrame("•", control.type === "error" ? "错误" : "状态", control.reason ?? "TCP 会话已关闭"); return; } } catch { /* target payloads are relayed as binary; ignore unknown control text */ } } const bytes = new Uint8Array(event.data as ArrayBuffer); const detectedFormat = resolveResponseFormat(bytes); let value: string; try { value = formatTcpPayload(bytes, detectedFormat); } catch { value = formatTcpPayload(bytes, "text"); } appendFrame("←", tcpPayloadLabel(detectedFormat), value, bytes); };
      socket.onerror = () => { if (!closeReportedRef.current) { closeReportedRef.current = true; appendFrame("•", "错误", "Local Agent 会话连接错误"); } setConnecting(false); };
      socket.onclose = () => { sessionRef.current = null; setConnecting(false); setSessionOpen(false); if (!closeReportedRef.current) appendFrame("•", "状态", "TCP 会话已关闭"); };
    } catch (error) {
      setConnecting(false); setSessionOpen(false); closeReportedRef.current = true;
      appendFrame("•", "错误", error instanceof Error ? error.message : String(error));
    }
  }
  function sendSession() { const socket = sessionRef.current; if (!socket || socket.readyState !== WebSocket.OPEN) return; try { const bytes = encodeTcpPayload(encoding, data); socket.send(bytes); appendFrame("→", tcpPayloadLabel(encoding), data, bytes); if (clearAfterSend) setData(""); } catch (error) { appendFrame("•", "错误", error instanceof Error ? error.message : "发送内容格式无效"); } }
  function closeSession() { sessionRef.current?.close(1000, "closed by user"); }
  useEffect(() => () => sessionRef.current?.close(1000, "workbench unmounted"), []);
  if (protocol === "tcp") {
    const selectedFrame = frames.find((frame) => frame.id === selectedFrameId && frame.direction !== "•") ?? null;
    const selectedBytes = selectedFrame?.bytes ?? (selectedFrame ? new TextEncoder().encode(selectedFrame.payload) : new Uint8Array());
    const selectedContentFormat = resolveResponseFormat(selectedFrame?.bytes);
    let selectedFramePayload = selectedFrame?.payload ?? "";
    if (selectedFrame) {
      try {
        selectedFramePayload = detailFormat === "hexdump" ? tcpHexdump(selectedBytes) : detailFormat === "raw" ? selectedFrame.payload : formatTcpPayload(selectedBytes, selectedContentFormat);
      } catch (error) { selectedFramePayload = error instanceof Error ? `格式解析失败：${error.message}` : "格式解析失败"; }
    }
    const normalizedQuery = deferredFrameQuery.trim().toLocaleLowerCase();
    const visibleFrames = frames.filter((frame) => {
      if (frameFilter === "incoming" && frame.direction !== "←") return false;
      if (frameFilter === "outgoing" && frame.direction !== "→") return false;
      return !normalizedQuery || `${frame.type} ${frame.payload}`.toLocaleLowerCase().includes(normalizedQuery);
    });
    function downloadSelectedFrame() {
      if (!selectedFrame) return;
      const href = URL.createObjectURL(new Blob([selectedFramePayload], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `tcp-${selectedFrame.direction === "←" ? "received" : "sent"}-${selectedFrame.time.replace(/:/g, "-")}.txt`;
      anchor.click();
      URL.revokeObjectURL(href);
    }
    const connectionStatus = <span className={`websocket-status ${sessionOpen ? "is-open" : connecting ? "is-connecting" : ""}`}>{sessionOpen ? "已连接" : connecting ? "连接中" : "未连接"}</span>;
    return <div className="websocket-workbench-layout tcp-workbench-layout"><SplitPane id="tcp-workbench" direction="vertical" minPrimary={304} minSecondary={160} primaryLabel="TCP 请求配置" secondaryLabel="消息检查器" secondaryActions={connectionStatus} primary={<section className={`websocket-workbench websocket-request-pane tab-${requestTab}`}>
      <input className="websocket-name" aria-label="接口名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="接口名称"/>
      <div className="websocket-commandbar"><input aria-label="TCP 目标地址" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="主机:端口"/>{!sessionOpen ? <button className="websocket-primary" disabled={connecting || !target.trim()} onClick={openSession}>{connecting ? "连接中…" : "连接"}</button> : <button className="websocket-danger" onClick={closeSession}>断开</button>}{onSave && <button className="websocket-secondary" onClick={() => void onSave(request())}>保存</button>}</div>
      <RovingTabList className="websocket-request-tabs" ariaLabel="TCP 请求配置"><button type="button" role="tab" aria-selected={requestTab === "message"} tabIndex={requestTab === "message" ? 0 : -1} className={requestTab === "message" ? "is-active" : ""} onClick={() => setRequestTab("message")}>Message</button><button type="button" role="tab" aria-selected={requestTab === "settings"} tabIndex={requestTab === "settings" ? 0 : -1} className={requestTab === "settings" ? "is-active" : ""} onClick={() => setRequestTab("settings")}>设置</button></RovingTabList>
      {requestTab === "message" && <section className="websocket-message-editor"><header><strong>消息内容</strong><select aria-label="消息类型" value={encoding} onChange={(event) => setEncoding(event.target.value as TcpPayloadFormat)}><option value="text">Text</option><option value="json">JSON</option><option value="xml">XML</option><option value="hex">HEX</option><option value="base64">Base64</option><option value="msgpack">MessagePack</option></select>{payloadError && <span className="tcp-payload-error">{payloadError}</span>}<div className="websocket-message-actions"><button type="button" className="websocket-message-tool" aria-label="格式化消息" title="格式化" disabled={encoding === "text" || !data.trim() || Boolean(payloadError)} onClick={formatInputMessage}><Icon name="code"/></button><button type="button" className="websocket-message-tool" aria-label="清空消息内容" title="清空" disabled={!data} onClick={() => setData("")}><Icon name="broom"/></button></div></header><CodeEditor value={data} onChange={setData} language={tcpPayloadLanguage(encoding)} height="100%" bare/><footer><label className="websocket-clear-after-send"><input type="checkbox" checked={clearAfterSend} onChange={(event) => setClearAfterSend(event.target.checked)}/><span>发送后清空输入</span></label><button className="websocket-primary" disabled={!sessionOpen || !data || Boolean(payloadError)} onClick={sendSession}>发送</button></footer></section>}
      {requestTab === "settings" && <section className="websocket-settings-panel"><div className="websocket-settings-fields"><label><span>分帧方式</span><select value={framing} onChange={(event) => setFraming(event.target.value)}><option value="none">关闭 / 超时</option><option value="delimiter">分隔符</option><option value="fixed">固定长度</option></select></label>{framing === "delimiter" && <label><span>分隔符</span><input value={delimiter} onChange={(event) => setDelimiter(event.target.value)} placeholder="\\n"/></label>}{framing === "fixed" && <label><span>固定长度</span><input type="number" min={1} value={fixedLength} onChange={(event) => setFixedLength(+event.target.value)}/></label>}<label><span>接收超时 ms</span><input type="number" min={1} value={timeoutMs} onChange={(event) => setTimeoutMs(+event.target.value)}/></label><label><span>发送次数</span><input type="number" min={1} value={sendCount} onChange={(event) => setSendCount(+event.target.value)}/></label><label><span>间隔 ms</span><input type="number" min={0} value={intervalMs} onChange={(event) => setIntervalMs(+event.target.value)}/></label><label className="tcp-checkbox"><input type="checkbox" checked={tls} onChange={(event) => setTls(event.target.checked)}/><span>启用 TLS</span></label>{tls && <><label><span>SNI</span><input value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder="默认使用目标主机"/></label><label><span>自定义 CA 密钥引用</span><input value={caCertRef} onChange={(event) => setCaCertRef(event.target.value)} placeholder="可选 PEM"/></label></>}</div></section>}
      <ProtocolCodeGenerator input={{ protocol: "tcp", request: request() }} />
    </section>} secondary={<section className={`websocket-response${hasConnected ? " has-response" : ""}`}>
      {!hasConnected ? <div className="websocket-response-waiting"><strong>等待连接</strong><span>建立 TCP 连接后，发送和接收的消息会显示在这里。</span></div> : <><RovingTabList className="websocket-response-tabs" ariaLabel="TCP 响应"><button type="button" role="tab" tabIndex={0} aria-selected="true" className="is-active">Messages <span>{frames.filter((frame) => frame.direction !== "•").length}</span></button></RovingTabList><div className="websocket-frame-list"><MessageInspector hasDetail={Boolean(selectedFrame)}><MessageSummary><MessageToolbar><input type="search" aria-label="搜索 TCP 消息" value={frameQuery} onChange={(event) => setFrameQuery(event.target.value)} placeholder="搜索消息"/><select aria-label="筛选 TCP 消息" value={frameFilter} onChange={(event) => setFrameFilter(event.target.value as typeof frameFilter)}><option value="all">全部消息</option><option value="incoming">仅接收</option><option value="outgoing">仅发送</option></select><button type="button" className="websocket-clear-messages" aria-label="清空消息" title="清空消息" onClick={() => { setFrames([]); setSelectedFrameId(null); }}><Icon name="archive"/></button></MessageToolbar><div className="websocket-message-list">{visibleFrames.map((frame) => <button type="button" key={frame.id} className={`websocket-frame websocket-frame-${frame.direction === "←" ? "incoming" : frame.direction === "→" ? "outgoing" : "status"}${selectedFrameId === frame.id ? " is-selected" : ""}`} aria-disabled={frame.direction === "•"} onClick={() => frame.direction !== "•" && setSelectedFrameId(frame.id)}><b>{frame.direction === "•" ? "✓" : frame.direction}</b><code>{frame.payload.replace(/\s+/g, " ").trim() || frame.type}</code><time>{frame.time}</time></button>)}</div></MessageSummary>{selectedFrame && <section className="websocket-frame-detail"><header><div className="websocket-frame-detail-options"><select aria-label="消息展示格式" value={detailFormat} onChange={(event) => setDetailFormat(event.target.value as typeof detailFormat)}><option value="pretty">Pretty</option><option value="hexdump">Hexdump</option><option value="raw">Raw</option></select><select aria-label="消息内容类型" value={responseFormat} onChange={(event) => setResponseFormat(event.target.value as TcpPayloadFormat | "auto")}><option value="auto">Auto</option><option value="text">Text</option><option value="json">JSON</option><option value="xml">XML</option><option value="hex">HEX</option><option value="base64">Base64</option><option value="msgpack">MessagePack</option></select><button type="button" className={detailWordWrap ? "is-active" : ""} aria-label="切换自动换行" title="自动换行" onClick={() => setDetailWordWrap((current) => !current)}><Icon name="wrap"/></button></div><MessageDetailActions actions={[{ id: "download", label: "下载消息", icon: "download", onSelect: downloadSelectedFrame }, { id: "copy", label: "复制消息", icon: "copy", onSelect: () => void navigator.clipboard.writeText(selectedFramePayload) }, { id: "search", label: "搜索消息内容", icon: "search", onSelect: () => detailEditorRef.current?.openFind() }]} onClose={() => setSelectedFrameId(null)}/></header><CodeEditor ref={detailEditorRef} value={selectedFramePayload} onChange={() => {}} language={detailFormat === "pretty" ? tcpPayloadLanguage(selectedContentFormat) : "plaintext"} height="100%" wordWrap={detailWordWrap} readOnly bare/></section>}</MessageInspector></div></>}
    </section>} /></div>;
  }
  const udpSelectedFrame = frames.find((frame) => frame.id === selectedFrameId && frame.direction !== "•") ?? null;
  const udpSelectedBytes = udpSelectedFrame?.bytes ?? (udpSelectedFrame ? new TextEncoder().encode(udpSelectedFrame.payload) : new Uint8Array());
  const udpSelectedContentFormat = resolveResponseFormat(udpSelectedFrame?.bytes);
  let udpSelectedPayload = udpSelectedFrame?.payload ?? "";
  if (udpSelectedFrame) {
    try {
      udpSelectedPayload = detailFormat === "hexdump" ? tcpHexdump(udpSelectedBytes) : detailFormat === "raw" ? udpSelectedFrame.payload : formatTcpPayload(udpSelectedBytes, udpSelectedContentFormat);
    } catch (error) { udpSelectedPayload = error instanceof Error ? "格式解析失败：" + error.message : "格式解析失败"; }
  }
  const udpQuery = deferredFrameQuery.trim().toLocaleLowerCase();
  const udpVisibleFrames = frames.filter((frame) => {
    if (frameFilter === "incoming" && frame.direction !== "←") return false;
    if (frameFilter === "outgoing" && frame.direction !== "→") return false;
    return !udpQuery || (frame.type + " " + frame.payload).toLocaleLowerCase().includes(udpQuery);
  });
  const targetInvalid = !/^(?:udp:\/\/)?(?:\[[^\]]+\]|[^:\s/]+):\d+$/.test(target.trim());
  const payloadBytes = (() => { try { return encodeTcpPayload(encoding, data).length; } catch { return 0; } })();
  const udpStatus = <span className={"websocket-status " + (busy ? "is-connecting" : "")}>{busy ? "发送中" : "就绪"}</span>;
  function downloadUdpFrame() {
    if (!udpSelectedFrame) return;
    const href = URL.createObjectURL(new Blob([udpSelectedPayload], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "udp-" + (udpSelectedFrame.direction === "←" ? "received-" : "sent-") + udpSelectedFrame.time.replace(/:/g, "-") + ".txt";
    anchor.click();
    URL.revokeObjectURL(href);
  }
  return <div className="websocket-workbench-layout udp-workbench-layout"><SplitPane id="udp-workbench" direction="vertical" minPrimary={304} minSecondary={160} primaryLabel="UDP" secondaryLabel="数据报检查器" secondaryActions={udpStatus} primary={<section className={"websocket-workbench websocket-request-pane tab-" + requestTab}>
    <input className="websocket-name" aria-label="接口名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="接口名称"/>
    <div className="websocket-commandbar"><input aria-label="UDP 目标地址" aria-invalid={targetInvalid} title={targetInvalid ? "请输入 host:port 或 udp://host:port" : undefined} value={target} onChange={(event) => setTarget(event.target.value)} placeholder="host:port 或 udp://host:port"/>{onSave && <button className="websocket-secondary" disabled={busy || targetInvalid || Boolean(payloadError)} onClick={() => void onSave(request())}>保存</button>}{runningId && <button className="websocket-danger" onClick={() => void onCancel(runningId)}>取消</button>}</div>
    <RovingTabList className="websocket-request-tabs" ariaLabel="UDP 请求配置"><button type="button" role="tab" aria-selected={requestTab === "message"} tabIndex={requestTab === "message" ? 0 : -1} className={requestTab === "message" ? "is-active" : ""} onClick={() => setRequestTab("message")}>Message</button><button type="button" role="tab" aria-selected={requestTab === "settings"} tabIndex={requestTab === "settings" ? 0 : -1} className={requestTab === "settings" ? "is-active" : ""} onClick={() => setRequestTab("settings")}>设置</button></RovingTabList>
    {requestTab === "message" && <section className="websocket-message-editor"><header><strong>数据报内容</strong><select aria-label="发送格式" value={encoding} onChange={(event) => setEncoding(event.target.value as TcpPayloadFormat)}><option value="text">Text</option><option value="json">JSON</option><option value="xml">XML</option><option value="hex">HEX</option><option value="base64">Base64</option><option value="msgpack">MessagePack</option></select>{payloadError && <span className="tcp-payload-error">{payloadError}</span>}<div className="websocket-message-actions"><span className="udp-payload-size">{payloadBytes} bytes</span><button type="button" className="websocket-message-tool" aria-label="格式化数据报" title="格式化" disabled={encoding === "text" || !data.trim() || Boolean(payloadError)} onClick={formatInputMessage}><Icon name="code"/></button><button type="button" className="websocket-message-tool" aria-label="清空数据报内容" title="清空" disabled={!data} onClick={() => setData("")}><Icon name="broom"/></button></div></header><CodeEditor value={data} onChange={setData} language={tcpPayloadLanguage(encoding)} height="100%" bare/><footer><label className="websocket-clear-after-send"><input type="checkbox" checked={clearAfterSend} onChange={(event) => setClearAfterSend(event.target.checked)}/><span>发送后清空输入</span></label><button className="websocket-primary" disabled={busy || targetInvalid || Boolean(payloadError) || !data} onClick={() => void send()}>发送</button></footer></section>}
    {requestTab === "settings" && <section className="websocket-settings-panel"><div className="websocket-settings-fields"><label><span>发送次数</span><input type="number" min={1} value={sendCount} onChange={(event) => setSendCount(Math.max(1, +event.target.value))}/></label><label><span>发送间隔 ms</span><input type="number" min={0} value={intervalMs} onChange={(event) => setIntervalMs(Math.max(0, +event.target.value))}/></label><label><span>接收超时 ms</span><input type="number" min={1} value={timeoutMs} onChange={(event) => setTimeoutMs(Math.max(1, +event.target.value))}/></label></div></section>}
    <ProtocolCodeGenerator input={{ protocol: "udp", request: request() }} />
  </section>} secondary={<section className={"websocket-response" + (hasConnected ? " has-response" : "")}>
    {!hasConnected ? <div className="websocket-response-waiting"><strong>等待发送</strong><span>发送 UDP 数据报后，收发记录与超时状态会显示在这里。</span></div> : <><RovingTabList className="websocket-response-tabs" ariaLabel="UDP 数据报"><button type="button" role="tab" tabIndex={0} aria-selected="true" className="is-active">Datagrams <span>{frames.filter((frame) => frame.direction !== "•").length}</span></button></RovingTabList><div className="websocket-frame-list"><MessageInspector hasDetail={Boolean(udpSelectedFrame)}><MessageSummary><MessageToolbar><input type="search" aria-label="搜索 UDP 数据报" value={frameQuery} onChange={(event) => setFrameQuery(event.target.value)} placeholder="搜索数据报"/><select aria-label="筛选 UDP 数据报" value={frameFilter} onChange={(event) => setFrameFilter(event.target.value as typeof frameFilter)}><option value="all">全部数据报</option><option value="incoming">仅接收</option><option value="outgoing">仅发送</option></select><button type="button" className="websocket-clear-messages" aria-label="清空数据报" title="清空" onClick={() => { setFrames([]); setSelectedFrameId(null); }}><Icon name="archive"/></button></MessageToolbar><div className="websocket-message-list">{udpVisibleFrames.map((frame) => <button type="button" key={frame.id} className={"websocket-frame websocket-frame-" + (frame.direction === "←" ? "incoming" : frame.direction === "→" ? "outgoing" : "status") + (selectedFrameId === frame.id ? " is-selected" : "")} aria-disabled={frame.direction === "•"} onClick={() => frame.direction !== "•" && setSelectedFrameId(frame.id)}><b>{frame.direction === "•" ? "•" : frame.direction}</b><code>{frame.payload.replace(/\s+/g, " ").trim() || frame.type}</code><span className="udp-frame-meta">{frame.type}</span><time>{frame.time}</time></button>)}</div></MessageSummary>{udpSelectedFrame && <section className="websocket-frame-detail"><header><div className="websocket-frame-detail-options"><select aria-label="数据报展示格式" value={detailFormat} onChange={(event) => setDetailFormat(event.target.value as typeof detailFormat)}><option value="pretty">Pretty</option><option value="hexdump">Hexdump</option><option value="raw">Raw</option></select><select aria-label="数据报内容类型" value={responseFormat} onChange={(event) => setResponseFormat(event.target.value as TcpPayloadFormat | "auto")}><option value="auto">Auto</option><option value="text">Text</option><option value="json">JSON</option><option value="xml">XML</option><option value="hex">HEX</option><option value="base64">Base64</option><option value="msgpack">MessagePack</option></select><button type="button" className={detailWordWrap ? "is-active" : ""} aria-label="切换自动换行" title="自动换行" onClick={() => setDetailWordWrap((current) => !current)}><Icon name="wrap"/></button></div><MessageDetailActions actions={[{ id: "download", label: "下载数据报", icon: "download", onSelect: downloadUdpFrame }, { id: "copy", label: "复制数据报", icon: "copy", onSelect: () => void navigator.clipboard.writeText(udpSelectedPayload) }, { id: "search", label: "搜索数据报内容", icon: "search", onSelect: () => detailEditorRef.current?.openFind() }]} closeLabel="关闭数据报详情" onClose={() => setSelectedFrameId(null)}/></header><CodeEditor ref={detailEditorRef} value={udpSelectedPayload} onChange={() => {}} language={detailFormat === "pretty" ? tcpPayloadLanguage(udpSelectedContentFormat) : "plaintext"} height="100%" wordWrap={detailWordWrap} readOnly bare/></section>}</MessageInspector></div></>}
  </section>} /></div>;
}

export function TcpWorkbench(props: TcpWorkbenchProps) { return <SocketWorkbench {...props} protocol="tcp" />; }
export function UdpWorkbench(props: UdpWorkbenchProps) { return <SocketWorkbench {...props} protocol="udp" />; }
