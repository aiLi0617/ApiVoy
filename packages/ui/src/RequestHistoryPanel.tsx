import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { RequestEnvelope } from "@apivoy/request-model";
import { Icon } from "./Icons";
import { Button, IconButton } from "./Components";
import { ClosableTabStrip } from "./ClosableTabStrip";
import { ModalFrame } from "./ModalFrame";
import { ProtocolHistoryWorkbench } from "./ProtocolHistoryWorkbench";
import "./RequestHistoryPanel.css";
import {
  HttpWorkbench,
  type HistoryFilter,
  type HistoryItem,
  type HttpRunResult,
  type HttpWorkbenchProps,
  type HttpWorkbenchRequest,
} from "./HttpWorkbench";

export interface HistoryInterfaceSummary {
  id: string;
  name: string;
  projectId: string;
  collectionId: string;
  method?: string;
  target: string;
  protocolId?: string;
}

export interface RequestHistoryEditorConfig {
  onSend: HttpWorkbenchProps["onSend"];
  onCancel?: HttpWorkbenchProps["onCancel"];
  onPutSecret?: HttpWorkbenchProps["onPutSecret"];
  onListCookies?: HttpWorkbenchProps["onListCookies"];
  onSetCookie?: HttpWorkbenchProps["onSetCookie"];
  onDeleteCookie?: HttpWorkbenchProps["onDeleteCookie"];
  onSaveInterface: (request: HttpWorkbenchRequest, collectionId: string) => Promise<void>;
  onSaveDebugCase: (request: HttpWorkbenchRequest, parent: HistoryInterfaceSummary) => Promise<void>;
  onOpenInterface: (id: string) => Promise<void> | void;
  onSendEnvelope?: (request: RequestEnvelope) => Promise<HttpRunResult>;
  onSaveEnvelopeInterface?: (request: RequestEnvelope, collectionId: string) => Promise<void>;
  onSaveEnvelopeDebugCase?: (request: RequestEnvelope, parent: HistoryInterfaceSummary) => Promise<void>;
  interfaces?: HistoryInterfaceSummary[];
  saveCollections?: NonNullable<HttpWorkbenchProps["saveCollections"]>;
  saveModules?: NonNullable<HttpWorkbenchProps["saveModules"]>;
  defaultSaveCollectionId?: string;
}

export interface RequestHistoryPanelProps {
  onList: (filter?: HistoryFilter) => Promise<HistoryItem[]>;
  onReplay?: (id: string) => Promise<HttpWorkbenchRequest | RequestEnvelope | null>;
  requestEditor?: RequestHistoryEditorConfig;
}

type DisplayHistoryItem = HistoryItem & { method?: string; name?: string };
interface HistoryGroup { key: string; label: string; items: DisplayHistoryItem[] }
interface DebugCaseDraft { request: HttpWorkbenchRequest | RequestEnvelope; result?: HttpRunResult | null; parent: HistoryInterfaceSummary }

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function groupHistory(items: DisplayHistoryItem[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  [...items].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)).forEach((item) => {
    const date = new Date(item.startedAt);
    const key = Number.isNaN(date.getTime()) ? "unknown" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const current = groups.get(key) ?? { key, label: Number.isNaN(date.getTime()) ? "时间未知" : dateFormatter.format(date), items: [] };
    current.items.push(item);
    groups.set(key, current);
  });
  return [...groups.values()];
}

function itemMethod(item: DisplayHistoryItem) {
  return (item.method || item.protocolId).toUpperCase();
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : timeFormatter.format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function requestPath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

function isHttpRequest(request: HttpWorkbenchRequest | RequestEnvelope): request is HttpWorkbenchRequest {
  return "url" in request && "method" in request;
}

function historyResult(item: DisplayHistoryItem, request: HttpWorkbenchRequest): HttpRunResult {
  const start = new Date(item.startedAt);
  const finished = Number.isNaN(start.getTime()) ? item.startedAt : new Date(start.getTime() + item.durationMs).toISOString();
  const state = (["queued", "running", "completed", "failed", "cancelled"].includes(item.state) ? item.state : "completed") as HttpRunResult["summary"]["state"];
  return {
    summary: { executionId: item.id, requestId: request.id ?? item.id, protocolId: item.protocolId, state, status: item.status ?? undefined, startedAt: item.startedAt, finishedAt: finished, durationMs: item.durationMs, bytesReceived: item.preview ? new TextEncoder().encode(item.preview).byteLength : 0 },
    eventCount: 0,
    preview: item.preview ?? null,
    executionId: item.id,
    assertions: [],
  };
}

function linkedInterface(request: HttpWorkbenchRequest, editor?: RequestHistoryEditorConfig) {
  const interfaces = editor?.interfaces ?? [];
  return interfaces.find((item) => item.id === request.id)
    ?? interfaces.find((item) => item.target === request.url && (!item.method || item.method.toUpperCase() === request.method.toUpperCase()));
}

function linkedEnvelopeInterface(request: RequestEnvelope, editor?: RequestHistoryEditorConfig) {
  const interfaces = editor?.interfaces ?? [];
  return interfaces.find((item) => item.id === request.id)
    ?? interfaces.find((item) => item.target === request.target && (!item.protocolId || item.protocolId === request.protocolId));
}

export function RequestHistoryPanel({ onList, onReplay, requestEditor }: RequestHistoryPanelProps) {
  const [items, setItems] = useState<DisplayHistoryItem[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [tabItems, setTabItems] = useState<Record<string, DisplayHistoryItem>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [requests, setRequests] = useState<Record<string, HttpWorkbenchRequest | RequestEnvelope | null>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveDraft, setSaveDraft] = useState<HttpWorkbenchRequest | RequestEnvelope | null>(null);
  const [saveName, setSaveName] = useState("");
  const [savePath, setSavePath] = useState("");
  const [keepFullUrl, setKeepFullUrl] = useState(false);
  const [saveCollectionId, setSaveCollectionId] = useState("");
  const [caseDraft, setCaseDraft] = useState<DebugCaseDraft | null>(null);
  const [caseName, setCaseName] = useState("成功");
  const [caseSaveResponse, setCaseSaveResponse] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);

  const load = useCallback(async (state = "", statusText = "") => {
    setLoading(true);
    setError("");
    try {
      const status = statusText.trim() ? Number(statusText.trim()) : undefined;
      const filter: HistoryFilter = {};
      if (state) filter.state = state;
      if (status != null && !Number.isNaN(status)) filter.status = status;
      setItems(await onList(filter.state || filter.status != null ? filter : undefined) as DisplayHistoryItem[]);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [onList]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!activeId || !onReplay || Object.prototype.hasOwnProperty.call(requests, activeId)) return;
    let active = true;
    setDetailLoadingId(activeId);
    setError("");
    void onReplay(activeId).then((request) => {
      if (!active) return;
      setRequests((current) => ({ ...current, [activeId]: request }));
      if (!request) setError("该历史记录没有可用的请求快照");
    }).catch((value) => {
      if (active) setError(value instanceof Error ? value.message : String(value));
    }).finally(() => {
      if (active) setDetailLoadingId((current) => current === activeId ? null : current);
    });
    return () => { active = false; };
  }, [activeId, onReplay, requests]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) => [item.name, item.target, item.method, item.protocolId, item.status].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalized)));
  }, [items, query]);
  const groups = useMemo(() => groupHistory(visibleItems), [visibleItems]);
  const collections = requestEditor?.saveCollections ?? [];
  const modules = requestEditor?.saveModules ?? [];

  function openHistory(item: DisplayHistoryItem) {
    setTabItems((current) => ({ ...current, [item.id]: item }));
    setOpenIds((current) => current.includes(item.id) ? current : [...current, item.id]);
    setActiveId(item.id);
  }

  function closeTab(id: string) {
    const index = openIds.indexOf(id);
    const remaining = openIds.filter((tabId) => tabId !== id);
    setOpenIds(remaining);
    if (activeId === id) setActiveId(remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null);
  }

  function closeAllTabs() {
    setOpenIds([]);
    setActiveId(null);
  }

  function closeOtherTabs() {
    if (!activeId) return;
    setOpenIds([activeId]);
  }

  function openSaveDialog(request: HttpWorkbenchRequest) {
    setSaveDraft(request);
    setSaveName(request.name?.trim() || requestPath(request.url).split("/").filter(Boolean).pop() || "未命名接口");
    setSavePath(requestPath(request.url));
    setKeepFullUrl(false);
    setSaveCollectionId(requestEditor?.defaultSaveCollectionId || collections[0]?.id || "");
  }

  function openEnvelopeSaveDialog(request: RequestEnvelope) {
    setSaveDraft(request);
    setSaveName(request.name?.trim() || `未命名 ${request.protocolId.toUpperCase()} 接口`);
    setSavePath(request.target);
    setKeepFullUrl(true);
    setSaveCollectionId(requestEditor?.defaultSaveCollectionId || collections[0]?.id || "");
  }

  function openCaseDialog(request: HttpWorkbenchRequest | RequestEnvelope, result: HttpRunResult | null | undefined, parent: HistoryInterfaceSummary) {
    setCaseDraft({ request, result, parent });
    setCaseName("成功");
    setCaseSaveResponse(Boolean(result));
  }

  async function saveInterface() {
    if (!saveDraft || !requestEditor || !saveName.trim() || !saveCollectionId) return;
    setSaveBusy(true);
    setError("");
    try {
      if (isHttpRequest(saveDraft)) await requestEditor.onSaveInterface({ ...saveDraft, id: crypto.randomUUID(), name: saveName.trim(), url: keepFullUrl ? saveDraft.url : savePath.trim() || requestPath(saveDraft.url) }, saveCollectionId);
      else if (requestEditor.onSaveEnvelopeInterface) await requestEditor.onSaveEnvelopeInterface({ ...saveDraft, id: crypto.randomUUID(), name: saveName.trim(), target: saveDraft.target }, saveCollectionId);
      else throw new Error("当前通道暂不支持保存该协议接口");
      setSaveDraft(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaveBusy(false);
    }
  }

  async function saveDebugCase() {
    if (!caseDraft || !requestEditor || !caseName.trim()) return;
    setSaveBusy(true);
    setError("");
    try {
      const metadata: Record<string, unknown> = { ...(caseDraft.request.metadata ?? {}) };
      delete metadata.__apivoySavedResponse;
      delete metadata.__apivoySavedActualRequest;
      if (caseSaveResponse && caseDraft.result) {
        metadata.__apivoySavedResponse = { status: caseDraft.result.summary.status ?? null, durationMs: caseDraft.result.summary.durationMs, body: caseDraft.result.preview ?? null, headers: caseDraft.result.responseMeta?.headers ?? [], contentType: caseDraft.result.responseMeta?.contentType ?? null };
        metadata.__apivoySavedActualRequest = { ...caseDraft.request, metadata: {} };
      }
      const nextRequest = {
        ...caseDraft.request,
        id: crypto.randomUUID(),
        name: caseName.trim(),
        variables: { ...(caseDraft.request.variables ?? {}), __apivoyCaseOf: caseDraft.parent.id, __apivoyCaseInterfaceName: caseDraft.parent.name },
        metadata: { ...metadata, __apivoyCaseType: "debug" },
      };
      if (isHttpRequest(nextRequest)) await requestEditor.onSaveDebugCase(nextRequest, caseDraft.parent);
      else if (requestEditor.onSaveEnvelopeDebugCase) await requestEditor.onSaveEnvelopeDebugCase(nextRequest, caseDraft.parent);
      else throw new Error("当前通道暂不支持保存该协议用例");
      setCaseDraft(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaveBusy(false);
    }
  }

  return <section className="request-history-page" aria-labelledby="request-history-title">
    <aside className="request-history-timeline" aria-label="请求历史时间线">
      <header className="request-history-sidebar-header"><div><h1 id="request-history-title">请求历史</h1><span>{items.length} 条本地记录</span></div><IconButton label="刷新请求历史" icon="activity" title="刷新" disabled={loading} onClick={() => void load(stateFilter, statusFilter)} /></header>
      <div className="request-history-source" aria-label="历史记录来源"><strong>本地</strong><span>当前项目</span></div>
      <label className="request-history-search"><span className="sr-only">搜索请求历史</span><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索请求或地址"/></label>
      <div className="request-history-compact-filters"><label><span className="sr-only">执行状态</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="">全部状态</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></select></label><label><span className="sr-only">HTTP 状态码</span><input inputMode="numeric" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} placeholder="状态码"/></label><Button variant="secondary" size="compact" disabled={loading} onClick={() => void load(stateFilter, statusFilter)}>筛选</Button></div>
      {error ? <div className="request-history-error" role="alert">{error}</div> : null}
      <div className="request-history-groups" aria-live="polite">
        {loading && !items.length ? <div className="request-history-list-empty">正在加载…</div> : null}
        {!loading && !error && !visibleItems.length ? <div className="request-history-list-empty">{items.length ? "没有匹配的记录" : "发送请求后，记录会显示在这里"}</div> : null}
        {groups.map((group) => <section className="request-history-group" key={group.key}><h2><Icon name="chevron"/><span>{group.label}</span><small>{group.items.length}</small></h2><div>{group.items.map((item) => <button type="button" className={`request-history-item${item.id === activeId ? " is-selected" : ""}`} aria-pressed={item.id === activeId} key={item.id} onClick={() => openHistory(item)}><span className={`request-history-method method-${itemMethod(item).toLowerCase()}`}>{itemMethod(item)}</span><span className="request-history-item-copy"><strong title={item.target}>{item.target || item.name || "未命名请求"}</strong><small>{formatTime(item.startedAt)} · {item.durationMs} ms</small></span><span className={`request-history-status state-${item.state}`}>{item.status ?? "—"}</span></button>)}</div></section>)}
      </div>
    </aside>

    <main className="request-history-detail">
      {openIds.length ? <ClosableTabStrip className="request-history-tabs" items={openIds.flatMap((id) => { const item = tabItems[id]; return item ? [{ id, title: item.name || item.target || "未命名请求", icon: "activity" as const }] : []; })} activeId={activeId} ariaLabel="已打开的历史请求" menuLabel="历史页签操作" onActivate={setActiveId} onClose={closeTab} onCloseAll={closeAllTabs} onCloseOthers={closeOtherTabs}/> : null}
      <div className="request-history-tab-panels">
        {openIds.map((id) => {
          const item = tabItems[id];
          const request = requests[id];
          if (!item) return null;
          if (detailLoadingId === id && id === activeId) return <div className="request-history-detail-empty" key={id}><span><Icon name="activity"/></span><strong>正在加载请求快照…</strong></div>;
          if (request && isHttpRequest(request) && requestEditor) {
            const parent = linkedInterface(request, requestEditor);
            return <div className="request-history-workbench" role="tabpanel" aria-label={item.name || item.target || "历史请求"} hidden={id !== activeId} key={id}><HttpWorkbench onSend={requestEditor.onSend} onCancel={requestEditor.onCancel} onSave={async (nextRequest, result) => { if (parent) openCaseDialog(nextRequest, result, parent); else openSaveDialog(nextRequest); }} onPutSecret={requestEditor.onPutSecret} onListCookies={requestEditor.onListCookies} onSetCookie={requestEditor.onSetCookie} onDeleteCookie={requestEditor.onDeleteCookie} externalRequest={request} initialResult={historyResult(item, request)} historyStartedAt={item.startedAt} historyInterfaceName={parent?.name} onOpenHistoryInterface={parent ? () => void requestEditor.onOpenInterface(parent.id) : undefined} saveActionLabel={parent ? "保存为用例" : "保存为接口"} fixedSplitDirection="vertical" workbenchSessionId={`history-${item.id}`}/></div>;
          }
          if (request && !isHttpRequest(request) && requestEditor?.onSendEnvelope) {
            const parent = linkedEnvelopeInterface(request, requestEditor);
            return <div className="request-history-workbench" role="tabpanel" aria-label={item.name || item.target || "历史请求"} hidden={id !== activeId} key={id}><ProtocolHistoryWorkbench request={request} initialResult={historyResult(item, { id: request.id, name: request.name, method: item.method ?? request.protocolId.toUpperCase(), url: request.target, headers: [], body: undefined, timeoutMs: request.timeoutMs, variables: request.variables ?? {}, assertions: [], auth: null, followRedirects: true, retryMax: 0, retryBackoffMs: 0, proxy: null, tlsVerify: request.tls.verify })} historyStartedAt={item.startedAt} interfaceName={parent?.name} onOpenInterface={parent ? () => void requestEditor.onOpenInterface(parent.id) : undefined} onSend={requestEditor.onSendEnvelope} onSave={(nextRequest, result) => { if (parent) openCaseDialog(nextRequest, result, parent); else openEnvelopeSaveDialog(nextRequest); }} saveActionLabel={parent ? "保存为用例" : "保存为接口"}/></div>;
          }
          return <article className="request-history-detail-card" role="tabpanel" hidden={id !== activeId} key={id}><header><div><span className={`request-history-method method-${itemMethod(item).toLowerCase()}`}>{itemMethod(item)}</span><h2>{item.name || item.target || "未命名请求"}</h2></div></header><div className="request-history-target-line" title={item.target}>{item.target ?? "未记录请求地址"}</div><dl className="request-history-summary"><div><dt>执行状态</dt><dd className={`state-${item.state}`}>{item.state}</dd></div><div><dt>响应状态</dt><dd>{item.status ?? "—"}</dd></div><div><dt>耗时</dt><dd>{item.durationMs} ms</dd></div><div><dt>请求时间</dt><dd>{formatDateTime(item.startedAt)}</dd></div></dl><section className="request-history-response"><div><h3>响应预览</h3><span>{item.protocolId.toUpperCase()}</span></div><pre>{item.preview ?? "该记录没有可用的响应预览。"}</pre></section></article>;
        })}
        {!openIds.length ? <div className="request-history-detail-empty"><span><Icon name="activity"/></span><strong>选择一条请求历史</strong><p>从左侧时间线打开记录，可在多个标签间切换、重新发送或保存。</p></div> : null}
      </div>
    </main>

    {saveDraft && requestEditor ? createPortal(<ModalFrame open onClose={() => !saveBusy && setSaveDraft(null)} closeOnBackdrop={!saveBusy} className="history-save-interface-dialog" ariaLabelledBy="history-save-interface-title" as="form" onSubmit={(event) => { event.preventDefault(); void saveInterface(); }}><header><h2 id="history-save-interface-title">保存为接口</h2><button type="button" className="ui-icon-button" aria-label="关闭" disabled={saveBusy} onClick={() => setSaveDraft(null)}><Icon name="close"/></button></header><div className="history-save-interface-fields"><label><span>接口名称 <i>*</i></span><input autoFocus required value={saveName} onChange={(event) => setSaveName(event.target.value)}/></label>{isHttpRequest(saveDraft) ? <><label><span>接口路径</span><input value={savePath} disabled={keepFullUrl} onChange={(event) => setSavePath(event.target.value)}/></label><label className="history-save-url-toggle"><span>保留完整 URL 路径</span><input type="checkbox" role="switch" checked={keepFullUrl} onChange={(event) => setKeepFullUrl(event.target.checked)}/></label></> : <label><span>请求目标</span><input value={saveDraft.target} disabled/></label>}<label><span>接口目录 <i>*</i></span><select required value={saveCollectionId} onChange={(event) => setSaveCollectionId(event.target.value)}><option value="" disabled>请选择接口目录</option>{collections.map((collection) => { const module = modules.find((item) => item.id === collection.moduleId); return <option key={collection.id} value={collection.id}>{module ? `${module.name} / ` : ""}{collection.name}</option>; })}</select></label></div><footer><button type="button" className="ui-button secondary" disabled={saveBusy} onClick={() => setSaveDraft(null)}>取消</button><button type="submit" className="ui-button primary" disabled={saveBusy || !saveName.trim() || !saveCollectionId}>{saveBusy ? "保存中…" : "保存"}</button></footer></ModalFrame>, document.body) : null}

    {caseDraft ? createPortal(<ModalFrame open onClose={() => !saveBusy && setCaseDraft(null)} closeOnBackdrop={!saveBusy} className="case-save-dialog history-debug-case-dialog" ariaLabelledBy="history-save-case-title" as="form" onSubmit={(event) => { event.preventDefault(); void saveDebugCase(); }}><header><div><h2 id="history-save-case-title">保存为用例</h2></div><button type="button" className="ui-icon-button" aria-label="关闭" disabled={saveBusy} onClick={() => setCaseDraft(null)}><Icon name="close"/></button></header><div className="case-save-fields"><label><span>用例名称 <i>*</i></span><div className="case-name-composer"><input autoFocus aria-label="用例名称" required value={caseName} onChange={(event) => setCaseName(event.target.value)} placeholder="请输入调试用例名称"/></div></label></div><label className={caseDraft.result ? "case-save-response" : "case-save-response is-disabled"}><input type="checkbox" checked={caseSaveResponse} disabled={!caseDraft.result || saveBusy} onChange={(event) => setCaseSaveResponse(event.target.checked)}/><span><strong>同时保存响应</strong><small>{caseDraft.result ? "包含状态码、Headers、Content-Type、耗时和响应正文" : "当前没有响应，仅保存请求配置"}</small></span></label><footer><button type="button" className="ui-button secondary" disabled={saveBusy} onClick={() => setCaseDraft(null)}>取消</button><button type="submit" className="ui-button primary" disabled={saveBusy || !caseName.trim()}>{saveBusy ? "保存中…" : "保存"}</button></footer></ModalFrame>, document.body) : null}
  </section>;
}
