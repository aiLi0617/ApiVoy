import { useEffect, useRef, useState } from "react";
import { consumeHydrate } from "./openRequestPipeline";
import { KeyValueRows, createQueryRow, queryRowsFromUrl, urlWithQueryRows, type HeaderRow, type HttpRunResult, type HttpSendHooks } from "./HttpWorkbench";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";
import { SplitPane } from "./WorkbenchFrame";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { Icon } from "./Icons";
import { useAppStore } from "./appStore";

export interface WebSocketWorkbenchRequest { name: string; url: string; headers: Array<[string, string]>; subprotocols: string[]; messages: Array<{ encoding: "text" | "binary"; data: string }>; receiveLimit: number; timeoutMs: number; reconnectMax: number; reconnectDelayMs: number }
export interface WebSocketWorkbenchProps { onConnect: (request: WebSocketWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>; onCancel: (executionId: string) => Promise<void>; onSave?: (request: WebSocketWorkbenchRequest) => Promise<void>; externalRequest?: WebSocketWorkbenchRequest | null; onTitleChange?: (title: string) => void }
function rowsFromPairs(entries: Array<[string, string]>): HeaderRow[] {
  return [...entries.map(([key, value]) => createQueryRow(key, value)), createQueryRow()];
}

function cookieRowsFromHeaders(headers: Array<[string, string]>): HeaderRow[] {
  const cookies = headers.filter(([name]) => name.toLowerCase() === "cookie").flatMap(([, value]) => value.split(";")).flatMap((item) => {
    const separator = item.indexOf("=");
    return separator > 0 ? [createQueryRow(item.slice(0, separator).trim(), item.slice(separator + 1).trim())] : [];
  });
  return [...cookies, createQueryRow()];
}

export function WebSocketWorkbench({ onSave, externalRequest, onTitleChange }: WebSocketWorkbenchProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("ws://127.0.0.1:8080");
  const [queryRows, setQueryRows] = useState<HeaderRow[]>(() => queryRowsFromUrl("ws://127.0.0.1:8080"));
  const [messageFormat, setMessageFormat] = useState<"text" | "json" | "xml" | "html" | "binary">("text");
  const [binaryEncoding, setBinaryEncoding] = useState<"base64" | "hexadecimal">("base64");
  const [clearAfterSend, setClearAfterSend] = useState(false);
  const encoding: "text" | "binary" = messageFormat === "binary" ? "binary" : "text";
  const [message, setMessage] = useState("");
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => [createQueryRow()]);
  const [cookieRows, setCookieRows] = useState<HeaderRow[]>(() => [createQueryRow()]);
  const [subprotocols, setSubprotocols] = useState("");
  const [receiveLimit, setReceiveLimit] = useState(1);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [reconnectMax, setReconnectMax] = useState(3);
  const [reconnectDelayMs, setReconnectDelayMs] = useState(1000);
  const [frames, setFrames] = useState<Array<{ id: string; time: string; direction: "→" | "←" | "•"; type: string; payload: string }>>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [detailFormat, setDetailFormat] = useState<"pretty" | "hexdump" | "raw">("pretty");
  const [detailContentType, setDetailContentType] = useState<"auto" | "json" | "xml" | "html" | "javascript" | "text">("auto");
  const [detailCharset, setDetailCharset] = useState<"auto" | "utf-8" | "gb18030" | "utf-16le" | "utf-16be" | "windows-1252" | "iso-8859-1">("auto");
  const [detailWordWrap, setDetailWordWrap] = useState(true);
  const [frameQuery, setFrameQuery] = useState("");
  const [frameFilter, setFrameFilter] = useState<"all" | "incoming" | "outgoing">("all");
  const [connecting, setConnecting] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [requestTab, setRequestTab] = useState<"message" | "params" | "headers" | "cookies" | "settings">("message");
  const [responseTab, setResponseTab] = useState<"messages" | "headers" | "cookies" | "request">("messages");
  const [hasConnected, setHasConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const detailEditorRef = useRef<CodeEditorHandle | null>(null);
  const responseDetailsStacked = useAppStore((state) => state.splitDirection === "horizontal");
  useEffect(() => { const apply = (value: WebSocketWorkbenchRequest) => { setName(value.name ?? ""); setUrl(value.url); setQueryRows(queryRowsFromUrl(value.url)); setHeaderRows(rowsFromPairs(value.headers.filter(([header]) => header.toLowerCase() !== "cookie"))); setCookieRows(cookieRowsFromHeaders(value.headers)); setSubprotocols(value.subprotocols.join(", ")); const first = value.messages[0]; setMessageFormat(first?.encoding === "binary" ? "binary" : "text"); setMessage(first?.data ?? ""); setReceiveLimit(value.receiveLimit); setTimeoutMs(value.timeoutMs); setReconnectMax(value.reconnectMax); setReconnectDelayMs(value.reconnectDelayMs); }; if (externalRequest) apply(externalRequest); else { const draft = readWorkbenchDraft<WebSocketWorkbenchRequest>("websocket"); if (draft) apply(draft); } const listener = (event: Event) => { const envelope = (event as CustomEvent).detail; const payload = envelope?.payload; if (payload?.type === "websocket") apply({ name: envelope.name, url: envelope.target, headers: payload.headers, subprotocols: payload.subprotocols, messages: payload.messages, receiveLimit: payload.receiveLimit ?? 1, timeoutMs: envelope.timeoutMs, reconnectMax: payload.reconnectMax, reconnectDelayMs: payload.reconnectDelayMs }); }; const pending = consumeHydrate("websocket"); if (pending) listener(new CustomEvent("apivoy-open-request", { detail: pending.envelope }) as Event); const onHydrate = (event: Event) => { const d = (event as CustomEvent).detail; if (d?.workbenchId !== "websocket") return; listener(new CustomEvent("apivoy-open-request", { detail: d.envelope }) as Event); }; window.addEventListener("apivoy-open-request", listener); window.addEventListener("apivoy-hydrate-request", onHydrate); return () => { window.removeEventListener("apivoy-open-request", listener); window.removeEventListener("apivoy-hydrate-request", onHydrate); }; }, [externalRequest]);
  useEffect(() => { onTitleChange?.(name.trim() || "WebSocket"); }, [name, onTitleChange]);
  const request = (): WebSocketWorkbenchRequest => { const headers = headerRows.filter((row) => row.enabled && row.key.trim()).map((row): [string, string] => [row.key.trim(), row.value]); const cookies = cookieRows.filter((row) => row.enabled && row.key.trim()); if (cookies.length) headers.push(["Cookie", cookies.map((row) => `${row.key.trim()}=${row.value}`).join("; ")]); return { name: name.trim() || `WebSocket ${url}`, url, headers, subprotocols: subprotocols.split(",").map((item) => item.trim()).filter(Boolean), messages: message ? [{ encoding, data: message }] : [], receiveLimit, timeoutMs, reconnectMax, reconnectDelayMs }; };
  useAutosaveDraft("websocket", request);
  function appendFrame(direction: "→" | "←" | "•", value: string) {
    const match = value.match(/^(TEXT|BINARY(?:\s+(?:BASE64|HEX))?)\s+([\s\S]*)$/);
    setFrames((current) => [...current, { id: crypto.randomUUID(), time: new Date().toLocaleTimeString([], { hour12: false }), direction, type: match?.[1] ?? (direction === "•" ? "状态" : "TEXT"), payload: match?.[2] ?? value }]);
  }
  function connectInteractive() {
    if (socketRef.current) return;
    setConnecting(true);
    setFrames([]);
    setSelectedFrameId(null);
    appendFrame("•", "正在建立 WebSocket 会话…");
    let socket: WebSocket;
    try { socket = new WebSocket(url, subprotocols.split(",").map((item) => item.trim()).filter(Boolean)); }
    catch (error) { setConnecting(false); appendFrame("•", error instanceof Error ? error.message : String(error)); return; }
    socket.binaryType = "arraybuffer";
    socket.onopen = () => { socketRef.current = socket; setConnecting(false); setInteractive(true); setHasConnected(true); appendFrame("•", `已连接到 ${url}`); };
    socket.onmessage = (event) => { if (typeof event.data === "string") appendFrame("←", `TEXT ${event.data}`); else { const bytes = new Uint8Array(event.data as ArrayBuffer); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); appendFrame("←", `BINARY ${btoa(binary)}`); } };
    socket.onerror = () => { setConnecting(false); appendFrame("•", "ERROR"); };
    socket.onclose = (event) => { socketRef.current = null; setConnecting(false); setInteractive(false); appendFrame("•", `CLOSED ${event.code} ${event.reason}`); };
  }
  function sendInteractive() {
    const socket = socketRef.current; if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (encoding === "binary") {
      try {
        const bytes = binaryEncoding === "base64"
          ? Uint8Array.from(atob(message.trim()), (char) => char.charCodeAt(0))
          : (() => { const source = message.replace(/\s+/g, "").replace(/^0x/i, ""); if (!source || source.length % 2 || !/^[0-9a-f]+$/i.test(source)) throw new Error("Hexadecimal 内容必须由偶数个十六进制字符组成"); return Uint8Array.from(source.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16)); })();
        socket.send(bytes);
        appendFrame("→", `BINARY ${binaryEncoding === "base64" ? "BASE64" : "HEX"} ${message}`);
        if (clearAfterSend) setMessage("");
      } catch (error) { appendFrame("•", error instanceof Error ? error.message : "二进制内容格式无效"); }
      return;
    }
    socket.send(message); appendFrame("→", `TEXT ${message}`); if (clearAfterSend) setMessage("");
  }
  function closeInteractive() { socketRef.current?.close(1000, "closed by user"); }
  function formatMessage() {
    try {
      if (messageFormat === "json") setMessage(JSON.stringify(JSON.parse(message), null, 2));
      else if (messageFormat === "xml" || messageFormat === "html") {
        const source = message.replace(/>\s*</g, "><").trim();
        const tokens = source.replace(/</g, "\n<").trim().split("\n");
        let depth = 0;
        setMessage(tokens.map((token) => { if (/^<\//.test(token)) depth = Math.max(0, depth - 1); const line = `${"  ".repeat(depth)}${token.trim()}`; if (/^<[^!?/][^>]*[^/]?>$/.test(token) && !/<\/[^>]+>$/.test(token) && !/^(?:<area|<base|<br|<col|<embed|<hr|<img|<input|<link|<meta|<param|<source|<track|<wbr)\b/i.test(token)) depth += 1; return line; }).join("\n"));
      }
    } catch (error) { appendFrame("•", error instanceof Error ? error.message : "内容格式不正确"); }
  }
  useEffect(() => () => socketRef.current?.close(1000, "workbench unmounted"), []);
  const responseHeaders: Array<[string, string]> = [];
  const responseCookies: Array<[string, string]> = [];
  const actualRequest = request();
  const displayFramePayload = (payload: string) => { const source = payload.trim(); if (!source) return ""; try { return JSON.stringify(JSON.parse(source), null, 2); } catch { return payload; } };
  const frameBytes = (frame: { type: string; payload: string }) => {
    try {
      if (frame.type.includes("BASE64") || frame.type === "BINARY") return Uint8Array.from(atob(frame.payload.replace(/\s+/g, "")), (character) => character.charCodeAt(0));
      if (frame.type.includes("HEX")) return Uint8Array.from(frame.payload.replace(/\s+/g, "").match(/.{1,2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
    } catch { /* fall back to the visible payload */ }
    return new TextEncoder().encode(frame.payload);
  };
  const frameHexdump = (frame: { type: string; payload: string }) => {
    const bytes = frameBytes(frame);
    return Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) => {
      const offset = row * 16; const chunk = bytes.slice(offset, offset + 16);
      const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
      const ascii = Array.from(chunk, (byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join("");
      return `${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`;
    }).join("\n");
  };
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId && frame.direction !== "•") ?? null;
  const decodedFramePayload = selectedFrame?.type.startsWith("BINARY") ? (() => { try { return new TextDecoder(detailCharset === "auto" ? "utf-8" : detailCharset).decode(frameBytes(selectedFrame)); } catch { return selectedFrame.payload; } })() : selectedFrame?.payload ?? "";
  const selectedFramePayload = selectedFrame ? detailFormat === "hexdump" ? frameHexdump(selectedFrame) : detailFormat === "pretty" ? displayFramePayload(decodedFramePayload) : decodedFramePayload : "";
  const selectedFrameLanguage = detailFormat === "hexdump" || selectedFrame?.type.startsWith("BINARY") || detailContentType === "text" ? "plaintext" : detailContentType !== "auto" ? detailContentType : (() => { try { JSON.parse(selectedFrame?.payload ?? ""); return "json"; } catch { const source = selectedFrame?.payload.trimStart() ?? ""; if (/^<!doctype\s+html|^<html[\s>]/i.test(source)) return "html"; if (/^<\?xml|^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(source)) return "xml"; return "plaintext"; } })();
  const visibleFrames = frames.filter((frame) => (frameFilter === "all" || (frameFilter === "incoming" ? frame.direction === "←" : frame.direction === "→")) && (!frameQuery.trim() || `${frame.type} ${frame.payload}`.toLocaleLowerCase().includes(frameQuery.trim().toLocaleLowerCase())));
  const queryParamsInvalid = queryRows.some((row) => row.enabled && (!row.key.trim() || (row.required && !row.value.trim())));
  function downloadSelectedFrame() { if (!selectedFrame) return; const blob = new Blob([selectedFramePayload], { type: "text/plain;charset=utf-8" }); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `websocket-${selectedFrame.direction === "←" ? "received" : "sent"}-${selectedFrame.time.replace(/:/g, "-")}.txt`; anchor.click(); URL.revokeObjectURL(href); }
  async function copySelectedFrame() { if (!selectedFrame) return; await navigator.clipboard.writeText(selectedFramePayload); }
  const connectionStatus = <span className={`websocket-status ${interactive ? "is-open" : connecting ? "is-connecting" : ""}`}>{interactive ? "已连接" : connecting ? "连接中" : "未连接"}</span>;
  return <div className="websocket-workbench-layout"><SplitPane id="websocket-workbench" direction="vertical" minPrimary={304} minSecondary={160} primaryLabel="WebSocket 请求配置" secondaryLabel="响应检查器" secondaryActions={connectionStatus} primary={<section className={`websocket-workbench websocket-request-pane tab-${requestTab}`}>
    <input className="websocket-name" aria-label="接口名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="接口名称"/>
    <div className="websocket-commandbar"><input aria-label="WebSocket 地址" value={url} onChange={(event) => setUrl(event.target.value)} onBlur={(event) => setQueryRows(queryRowsFromUrl(event.target.value))} placeholder="WebSocket 接口地址（ws:// 或 wss://）"/>{!interactive ? <button className="websocket-primary" disabled={connecting || !url.trim() || queryParamsInvalid} onClick={connectInteractive}>{connecting ? "连接中…" : "连接"}</button> : <button className="websocket-danger" onClick={closeInteractive}>断开</button>}{onSave && <button className="websocket-secondary" onClick={() => void onSave(request())}>保存</button>}</div>
    <div className="websocket-request-tabs" role="tablist" aria-label="WebSocket 请求配置">{([['message','Message'],['params','Params'],['headers','Headers'],['cookies','Cookies'],['settings','设置']] as const).map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={requestTab === id} className={requestTab === id ? "is-active" : ""} onClick={() => setRequestTab(id)}>{label}</button>)}</div>
    {requestTab === "message" && <section className="websocket-message-editor"><header><strong>消息内容</strong><select aria-label="消息帧格式" value={messageFormat} onChange={(event) => setMessageFormat(event.target.value as typeof messageFormat)}><option value="text">Text</option><option value="json">JSON</option><option value="xml">XML</option><option value="html">HTML</option><option value="binary">Binary</option></select>{messageFormat === "binary" && <select aria-label="二进制编码" value={binaryEncoding} onChange={(event) => setBinaryEncoding(event.target.value as typeof binaryEncoding)}><option value="base64">Base64</option><option value="hexadecimal">Hexadecimal</option></select>}<div className="websocket-message-actions"><button type="button" className="websocket-message-tool" aria-label="格式化消息" title="格式化" disabled={!["json","xml","html"].includes(messageFormat) || !message.trim()} onClick={formatMessage}><Icon name="code"/></button><button type="button" className="websocket-message-tool" aria-label="清空消息内容" title="清空" disabled={!message} onClick={() => setMessage("")}><Icon name="broom"/></button></div></header><CodeEditor value={message} onChange={setMessage} language={messageFormat === "binary" || messageFormat === "text" ? "plaintext" : messageFormat} height="100%" bare/><footer><label className="websocket-clear-after-send"><input type="checkbox" checked={clearAfterSend} onChange={(event) => setClearAfterSend(event.target.checked)}/><span>发送后清空输入</span></label><button className="websocket-primary" disabled={!interactive || !message} onClick={sendInteractive}>发送</button></footer></section>}
    {requestTab === "params" && <section className="websocket-params-panel" data-title="Query 参数"><KeyValueRows rows={queryRows} setRows={setQueryRows} kind="Param" nameLabel="参数名" valueLabel="参数值" addPlaceholder="添加参数" loading={connecting || interactive} onRowsChange={(rows) => setUrl((current) => urlWithQueryRows(current, rows))}/></section>}
    {requestTab === "headers" && <section className="websocket-params-panel" data-title="请求 Headers"><KeyValueRows rows={headerRows} setRows={setHeaderRows} kind="Header" nameLabel="Header 名称" valueLabel="Header 值" addPlaceholder="添加 Header" loading={connecting || interactive}/></section>}
    {requestTab === "cookies" && <section className="websocket-params-panel" data-title="请求 Cookies"><KeyValueRows rows={cookieRows} setRows={setCookieRows} kind="Cookie" nameLabel="Cookie 名称" valueLabel="Cookie 值" addPlaceholder="添加 Cookie" loading={connecting || interactive}/></section>}
    {requestTab === "settings" && <section className="websocket-settings-panel"><div className="websocket-settings-fields websocket-settings-fields-single"><label><span>子协议</span><input value={subprotocols} onChange={(event) => setSubprotocols(event.target.value)} placeholder="graphql-transport-ws"/></label></div></section>}
    <ProtocolCodeGenerator input={{ protocol: "websocket", request: request() }} />
  </section>} secondary={<section className={`websocket-response${hasConnected ? " has-response" : ""}`}>
      {!hasConnected ? <div className="websocket-response-waiting"><strong>等待连接</strong><span>建立 WebSocket 连接后，消息、Header、Cookie 和实际请求会显示在这里。</span></div> : <>
      <div className="websocket-response-tabs" role="tablist" aria-label="WebSocket 响应">
        {([['messages', 'Messages'], ['headers', `Header ${responseHeaders.length}`], ['cookies', `Cookie ${responseCookies.length}`], ['request', '实际请求']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={responseTab === id} className={responseTab === id ? "is-active" : ""} onClick={() => setResponseTab(id)}>{label}</button>)}
      </div>
      <div className="websocket-frame-list" role="tabpanel">
        {responseTab === "messages" && <div className={`websocket-message-browser${selectedFrame ? " has-detail" : ""}${responseDetailsStacked ? " is-stacked" : ""}`}><section className="websocket-message-summary"><header className="websocket-message-toolbar"><input type="search" aria-label="搜索 WebSocket 消息" value={frameQuery} onChange={(event) => setFrameQuery(event.target.value)} placeholder="搜索消息"/><select aria-label="筛选 WebSocket 消息" value={frameFilter} onChange={(event) => setFrameFilter(event.target.value as typeof frameFilter)}><option value="all">全部消息</option><option value="incoming">仅接收</option><option value="outgoing">仅发送</option></select><button type="button" className="websocket-clear-messages" aria-label="清空消息" title="清空消息" onClick={() => { setFrames([]); setSelectedFrameId(null); }}><Icon name="archive"/></button></header><div className="websocket-message-list">{visibleFrames.map((frame) => <button type="button" key={frame.id} className={`websocket-frame websocket-frame-${frame.direction === "←" ? "incoming" : frame.direction === "→" ? "outgoing" : "status"}${selectedFrameId === frame.id ? " is-selected" : ""}`} aria-disabled={frame.direction === "•"} onClick={() => { if (frame.direction !== "•") setSelectedFrameId(frame.id); }}><b>{frame.direction === "•" ? "✓" : frame.direction}</b><code>{frame.payload ? displayFramePayload(frame.payload).replace(/\s+/g, " ").trim() : frame.type}</code><time>{frame.time}</time></button>)}</div></section>{selectedFrame && <section className="websocket-frame-detail"><header><div className="websocket-frame-detail-options"><select aria-label="消息展示格式" value={detailFormat} onChange={(event) => setDetailFormat(event.target.value as typeof detailFormat)}><option value="pretty">Pretty</option><option value="hexdump">Hexdump</option><option value="raw">Raw</option></select><select aria-label="消息内容类型" value={detailContentType} onChange={(event) => setDetailContentType(event.target.value as typeof detailContentType)}><option value="auto">Auto</option><option value="json">JSON</option><option value="xml">XML</option><option value="html">HTML</option><option value="javascript">JavaScript</option><option value="text">Text</option></select><select aria-label="消息字符编码" value={detailCharset} onChange={(event) => setDetailCharset(event.target.value as typeof detailCharset)}><option value="auto">Auto</option><option value="utf-8">UTF-8</option><option value="gb18030">GBK / GB18030</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="windows-1252">Windows-1252</option><option value="iso-8859-1">ISO-8859-1</option></select><button type="button" className={detailWordWrap ? "is-active" : ""} aria-label="切换自动换行" title="自动换行" onClick={() => setDetailWordWrap((current) => !current)}><Icon name="wrap"/></button></div><div className="websocket-frame-detail-actions"><button type="button" aria-label="下载消息" title="下载" onClick={downloadSelectedFrame}><Icon name="download"/></button><button type="button" aria-label="复制消息" title="复制" onClick={() => void copySelectedFrame()}><Icon name="copy"/></button><button type="button" aria-label="搜索消息内容" title="搜索" onClick={() => detailEditorRef.current?.openFind()}><Icon name="search"/></button><button type="button" aria-label="关闭消息详情" title="关闭" onClick={() => setSelectedFrameId(null)}><Icon name="close"/></button></div></header><CodeEditor ref={detailEditorRef} value={selectedFramePayload} onChange={() => {}} language={selectedFrameLanguage} height="100%" wordWrap={detailWordWrap} readOnly bare/></section>}</div>}
        {responseTab === "headers" && (responseHeaders.length ? <div className="websocket-response-table">{responseHeaders.map(([header, value], index) => <div key={`${header}-${index}`}><strong>{header}</strong><span>{value}</span></div>)}</div> : <div className="websocket-response-empty">浏览器 WebSocket API 不提供握手响应 Header。</div>)}
        {responseTab === "cookies" && (responseCookies.length ? <div className="websocket-response-table">{responseCookies.map(([header, value], index) => <div key={`${header}-${index}`}><strong>{header}</strong><span>{value}</span></div>)}</div> : <div className="websocket-response-empty">没有响应 Cookie。</div>)}
        {responseTab === "request" && <div className="websocket-actual-request"><section><strong>连接地址</strong><code>{actualRequest.url}</code></section><section><strong>子协议</strong><code>{actualRequest.subprotocols.join(", ") || "（空）"}</code></section><section><strong>请求 Header</strong><pre>{actualRequest.headers.length ? actualRequest.headers.map(([header, value]) => `${header}: ${value}`).join("\n") : "（空）"}</pre></section></div>}
      </div>
      </>}
    </section>}/></div>;
}
