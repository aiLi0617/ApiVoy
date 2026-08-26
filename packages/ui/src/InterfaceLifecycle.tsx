import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { CodeEditor } from "./CodeEditor";
import { HttpWorkbench, type HttpWorkbenchRequest } from "./HttpWorkbench";
import { readWorkbenchDraft } from "./draftRecovery";
import { peekHydrate, stashHydrate } from "./openRequestPipeline";

export type InterfaceLifecycleTab =
  | "debug"
  | "definition"
  | "examples"
  | "docs"
  | "mock";

interface LifecycleTabDefinition {
  id: InterfaceLifecycleTab;
  label: string;
  icon: IconName;
}

const TABS: Record<InterfaceLifecycleTab, LifecycleTabDefinition> = {
  debug: { id: "debug", label: "\u8c03\u8bd5", icon: "send" },
  definition: { id: "definition", label: "\u8bbe\u8ba1", icon: "code" },
  examples: { id: "examples", label: "测试用例", icon: "archive" },
  docs: { id: "docs", label: "\u6587\u6863\u9884\u89c8", icon: "copy" },
  mock: { id: "mock", label: "Mock", icon: "bolt" },
};

const PROTOCOL_LIFECYCLE: Record<string, InterfaceLifecycleTab[]> = {
  http: ["debug", "definition", "examples", "docs", "mock"],
  graphql: ["debug", "definition", "examples", "docs", "mock"],
  grpc: ["debug", "definition", "examples", "docs", "mock"],
  rpc: ["debug", "definition", "examples", "docs", "mock"],
  websocket: ["debug", "examples", "docs", "mock"],
  sse: ["debug", "examples", "docs", "mock"],
  tcp: ["debug", "examples"],
  udp: ["debug", "examples"],
  mqtt: ["debug", "definition", "examples", "docs", "mock"],
  amqp: ["debug", "definition", "examples", "docs", "mock"],
  kafka: ["debug", "definition", "examples", "docs", "mock"],
  redis: ["debug", "examples", "docs"],
  sql: ["debug", "definition", "examples", "docs"],
};

export function lifecycleTabsFor(workbenchId: string): InterfaceLifecycleTab[] {
  return PROTOCOL_LIFECYCLE[workbenchId] ?? [];
}

const EMPTY_COPY: Record<
  Exclude<InterfaceLifecycleTab, "debug">,
  { title: string; description: string; action: string; event: string }
> = {
  definition: {
    title: "\u5c1a\u672a\u8bbe\u8ba1\u63a5\u53e3",
    description:
      "\u8bbe\u8ba1\u5f53\u524d\u63a5\u53e3\u7684\u8bf7\u6c42\u3001\u54cd\u5e94\u4e0e\u6570\u636e\u7ea6\u675f\u3002",
    action: "\u5f00\u59cb\u8bbe\u8ba1",
    event: "apivoy-bind-interface-definition",
  },
  examples: {
    title: "\u5c1a\u672a\u4fdd\u5b58\u63a5\u53e3\u7528\u4f8b",
    description:
      "\u4fdd\u5b58\u8bf7\u6c42\u548c\u54cd\u5e94\uff0c\u4f9b\u6587\u6863\u3001Mock \u548c\u81ea\u52a8\u5316\u6d4b\u8bd5\u590d\u7528\u3002",
    action: "\u65b0\u5efa\u7528\u4f8b",
    event: "apivoy-create-interface-example",
  },
  docs: {
    title: "\u6682\u65e0\u53ef\u9884\u89c8\u7684\u63a5\u53e3\u6587\u6863",
    description:
      "\u5b8c\u6210\u63a5\u53e3\u8bbe\u8ba1\u540e\uff0c\u8fd9\u91cc\u4f1a\u751f\u6210\u53ea\u8bfb\u6587\u6863\u3002",
    action: "\u524d\u5f80\u8bbe\u8ba1",
    event: "apivoy-bind-interface-definition",
  },
  mock: {
    title: "\u5c1a\u672a\u521b\u5efa Mock \u573a\u666f",
    description:
      "\u4ece\u63a5\u53e3\u5b9a\u4e49\u6216\u5df2\u4fdd\u5b58\u793a\u4f8b\u751f\u6210\u53ef\u91cd\u7528\u7684 Mock \u54cd\u5e94\u3002",
    action: "\u521b\u5efa Mock",
    event: "apivoy-create-interface-mock",
  },
};

export interface InterfaceLifecycleShellProps {
  workbenchId: string;
  sessionId: string;
  title: string;
  children: ReactNode;
  projectId?: string;
  requestId?: string;
  definitionClient?: InterfaceDefinitionClient;
  /** Saved cases are runnable configurations, not interface lifecycle roots. */
  caseMode?: boolean;
  caseInterfaceName?: string;
  caseName?: string;
  cases?: InterfaceCaseSummary[];
  onOpenCase?: (caseId: string) => void;
  onSaveCase?: (caseId: string | null, input: { name: string; group: string; tags: string[]; request?: HttpWorkbenchRequest }) => Promise<void>;
  onDeleteCase?: (caseId: string) => Promise<void>;
  onDuplicateCase?: (caseId: string) => Promise<void>;
  onRunCases?: (caseIds: string[]) => Promise<Record<string, InterfaceCaseRunOutcome>>;
  onCopyCurl?: (caseId: string) => Promise<string>;
  onLoadCase?: (caseId: string) => Promise<HttpWorkbenchRequest | null>;
  onRunRequest?: (request: HttpWorkbenchRequest) => Promise<import("./HttpWorkbench").HttpRunResult>;
}

export interface InterfaceCaseSummary {
  id: string;
  name: string;
  method?: string;
  target?: string;
  metadata?: Record<string, unknown>;
  projectId?: string;
  collectionId?: string;
}
export interface InterfaceCaseRunOutcome { passed: boolean; error?: string; status?: number | null; durationMs?: number; body?: string | null; headers?: Array<[string, string]> }

export type InterfaceCaseCategory = "positive" | "negative" | "boundary" | "security" | "other";
export function interfaceCaseCategory(metadata?: Record<string, unknown>): InterfaceCaseCategory {
  const value = metadata?.__apivoyCaseGroup;
  if (value == null || value === "") return "positive";
  return ["positive", "negative", "boundary", "security"].includes(String(value))
    ? String(value) as InterfaceCaseCategory
    : "other";
}

export interface ApiDefinition {
  id: string;
  projectId: string;
  moduleId?: string | null;
  name: string;
  format: string;
  fileName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
export interface RequestDefinitionBinding {
  requestId: string;
  definitionId: string;
  operationRef?: string | null;
  updatedAt: string;
}
export interface InterfaceDefinitionClient {
  list(projectId: string): Promise<ApiDefinition[]>;
  save(input: {
    id?: string;
    projectId: string;
    name: string;
    format: string;
    fileName: string;
    content: string;
  }): Promise<ApiDefinition>;
  binding(requestId: string): Promise<RequestDefinitionBinding | null>;
  bind(
    requestId: string,
    definitionId: string,
    operationRef?: string,
  ): Promise<RequestDefinitionBinding>;
  unbind(requestId: string): Promise<void>;
}

export function readableDefinitionError(error: unknown, fallback: string) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
  // Single-pass decode avoids CodeQL js/double-escaping (&amp;lt; must stay &lt;, not <).
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
  };
  const decoded = raw
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot);/gi, (entity, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return entity;
        try {
          return String.fromCodePoint(code);
        } catch {
          return entity;
        }
      }
      return named[body.toLowerCase()] ?? entity;
    })
    .trim();
  return decoded && decoded !== "{}" ? decoded : fallback;
}

function agentDefinitionClient(): InterfaceDefinitionClient | undefined {
  if (typeof window === "undefined") return undefined;
  const base =
    localStorage.getItem("apivoy:agent-url")?.trim() ||
    "http://127.0.0.1:39217";
  const headers = () => {
    const value: Record<string, string> = {
      "Content-Type": "application/json",
      "X-ApiVoy-Protocol-Api-Version": "1",
      "X-ApiVoy-Client": "ui",
      "X-ApiVoy-Client-Version": "0.1.0",
    };
    const token = localStorage.getItem("apivoy-agent-token");
    if (token) value.Authorization = `Bearer ${token}`;
    return value;
  };
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(base + path, {
      ...init,
      headers: { ...headers(), ...(init?.headers ?? {}) },
    });
    if (!response.ok)
      throw new Error(
        readableDefinitionError(
          await response.text(),
          `Request failed (HTTP ${response.status})`,
        ),
      );
    return response.status === 204 ? (undefined as T) : response.json();
  }
  return {
    list: (projectId) =>
      json(`/v1/api-definitions?projectId=${encodeURIComponent(projectId)}`),
    save: (input) =>
      json("/v1/api-definitions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    binding: (requestId) =>
      json(`/v1/requests/${requestId}/definition-binding`),
    bind: (requestId, definitionId, operationRef) =>
      json(`/v1/requests/${requestId}/definition-binding`, {
        method: "PUT",
        body: JSON.stringify({ definitionId, operationRef }),
      }),
    unbind: (requestId) =>
      json(`/v1/requests/${requestId}/definition-binding`, {
        method: "DELETE",
      }),
  };
}

export function InterfaceLifecycleShell({
  workbenchId,
  sessionId,
  title,
  children,
  projectId,
  requestId,
  definitionClient,
  caseMode = false,
  caseInterfaceName,
  caseName,
  cases = [],
  onOpenCase,
  onSaveCase,
  onDeleteCase,
  onDuplicateCase,
  onRunCases,
  onCopyCurl,
  onLoadCase,
  onRunRequest,
}: InterfaceLifecycleShellProps) {
  const availableTabs = lifecycleTabsFor(workbenchId);
  const [activeTab, setActiveTab] = useState<InterfaceLifecycleTab>("debug");
  const client = definitionClient ?? agentDefinitionClient();
  const pendingDebugHydrate =
    activeTab === "debug" ? peekHydrate(workbenchId) : null;
  useEffect(() => {
    if (activeTab !== "debug") return;
    if (!pendingDebugHydrate) return;
    queueMicrotask(() =>
      window.dispatchEvent(
        new CustomEvent("apivoy-hydrate-request", {
          detail: pendingDebugHydrate,
        }),
      ),
    );
  }, [activeTab, pendingDebugHydrate, workbenchId]);
  useEffect(() => {
    const openTab = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; tab?: InterfaceLifecycleTab }>).detail;
      if (detail?.sessionId === sessionId && detail.tab && availableTabs.includes(detail.tab)) setActiveTab(detail.tab);
    };
    window.addEventListener("apivoy-open-lifecycle-tab", openTab);
    return () => window.removeEventListener("apivoy-open-lifecycle-tab", openTab);
  }, [availableTabs, sessionId]);
  if (!availableTabs.length) return children;

  if (caseMode) {
    return (
      <section className="interface-lifecycle interface-case-workspace has-commandbar" aria-label={`${title} \u7528\u4f8b\u5de5\u4f5c\u53f0`}>
        <header className="interface-case-header">
          <span className="interface-case-header-icon" aria-hidden="true"><Icon name="bolt" /></span>
          <span className="interface-case-header-copy">
            <span className="interface-case-breadcrumb" aria-label="用例所属接口">
              <span>{caseInterfaceName || "所属接口"}</span>
              <Icon name="chevron" />
              <strong>{caseName || "用例详情"}</strong>
            </span>
            <small>继承接口结构，独立保存参数值、前后置操作与断言</small>
          </span>
          <span className="interface-case-badge"><i aria-hidden="true" />已关联接口</span>
        </header>
        <div id={`interface-commandbar-${sessionId}`} className="interface-lifecycle-commandbar" />
        <div className="interface-lifecycle-content interface-lifecycle-debug" role="region" aria-label="用例配置">
          {children}
        </div>
      </section>
    );
  }

  const active = availableTabs.includes(activeTab) ? activeTab : "debug";
  return (
    <section
      className={`interface-lifecycle${active === "debug" || active === "definition" ? " has-commandbar" : ""}`}
      aria-label={`${title} \u63a5\u53e3\u5de5\u4f5c\u53f0`}
    >
      <div
        className="interface-lifecycle-tabs"
        role="tablist"
        aria-label="\u63a5\u53e3\u751f\u547d\u5468\u671f"
      >
        {availableTabs.map((id) => {
          const tab = TABS[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active === id}
              aria-controls={`interface-lifecycle-${sessionId}-${id}`}
              className={active === id ? "is-active" : ""}
              onClick={() => setActiveTab(id)}
            >
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div id={`interface-commandbar-${sessionId}`} data-active-tab={active} className={`interface-lifecycle-commandbar${active === "debug" || active === "definition" ? "" : " is-hidden"}`} />
      <div
        id={`interface-lifecycle-${sessionId}-debug`}
        className={`interface-lifecycle-content interface-lifecycle-debug${active === "debug" ? "" : " is-hidden"}`}
        role="tabpanel"
        aria-label={TABS.debug.label}
      >{children}</div>
      {active !== "debug" ? <div
        id={`interface-lifecycle-${sessionId}-${active}`}
        className="interface-lifecycle-content"
        role="tabpanel"
        aria-label={TABS[active].label}
      >
        {active === "definition" && client && projectId && requestId ? (
          <DefinitionPanel client={client} projectId={projectId} requestId={requestId} workbenchId={workbenchId} title={title} />
        ) : active === "docs" && client && projectId && requestId ? (
          <DocumentPreviewPanel client={client} projectId={projectId} requestId={requestId} workbenchId={workbenchId} title={title} onOpenDesign={() => setActiveTab("definition")} />
        ) : active === "examples" ? (
          <InterfaceCasesPanel requestId={requestId} cases={cases} onOpenCase={onOpenCase} onSaveCase={onSaveCase} onDeleteCase={onDeleteCase} onDuplicateCase={onDuplicateCase} onRunCases={onRunCases} onRunRequest={onRunRequest} onCopyCurl={onCopyCurl} onLoadCase={onLoadCase} />
        ) : (
          <LifecycleEmptyState tab={active} workbenchId={workbenchId} sessionId={sessionId} />
        )}
      </div> : null}
    </section>
  );
}

function InterfaceCasesPanel({ requestId, cases, onOpenCase, onSaveCase, onDeleteCase, onDuplicateCase, onRunCases, onRunRequest, onCopyCurl, onLoadCase }: Pick<InterfaceLifecycleShellProps, "requestId" | "cases" | "onOpenCase" | "onSaveCase" | "onDeleteCase" | "onDuplicateCase" | "onRunCases" | "onRunRequest" | "onCopyCurl" | "onLoadCase">) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "positive" | "negative" | "boundary" | "security" | "other">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<InterfaceCaseSummary | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", group: "positive", tags: "" });
  const [results, setResults] = useState<Record<string, "running" | "passed" | "failed">>({});
  const [runDetails, setRunDetails] = useState<Record<string, InterfaceCaseRunOutcome>>({});
  const [previewTab, setPreviewTab] = useState<"params" | "body" | "headers" | "auth" | "pre" | "post" | "settings">("body");
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewRequest, setPreviewRequest] = useState<HttpWorkbenchRequest | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState("");
  const previewLoadId = useRef(0);
  useEffect(() => {
    if (!drawer || drawer === "new") return;
    setDraft({ name: drawer.name, group: interfaceCaseCategory(drawer.metadata), tags: Array.isArray(drawer.metadata?.__apivoyCaseTags) ? drawer.metadata.__apivoyCaseTags.join(", ") : "" });
  }, [drawer]);
  useEffect(() => {
    const updateTags = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; tags?: string[] }>).detail;
      const item = (cases ?? []).find((candidate) => candidate.id === detail?.id);
      if (item && Array.isArray(detail.tags)) void saveInline(item, { tags: detail.tags });
    };
    window.addEventListener("apivoy-update-test-case-tags", updateTags);
    return () => window.removeEventListener("apivoy-update-test-case-tags", updateTags);
  }, [cases, onSaveCase]);
  const normalized = query.trim().toLocaleLowerCase();
  const items = cases ?? [];
  const categoryOf = (item: InterfaceCaseSummary) => interfaceCaseCategory(item.metadata);
  const categories = [["all", "全部"], ["positive", "正向"], ["negative", "负向"], ["boundary", "边界值"], ["security", "安全性"], ["other", "其他"]] as const;
  const visibleCases = items.filter((item) => (category === "all" || categoryOf(item) === category) && (!normalized || `${item.name} ${item.metadata?.__apivoyCaseGroup ?? ""} ${(item.metadata?.__apivoyCaseTags as string[] | undefined)?.join(" ") ?? ""}`.toLocaleLowerCase().includes(normalized)));
  function edit(item: InterfaceCaseSummary | "new") { setDrawer(item); setDraft(item === "new" ? { name: "", group: "positive", tags: "" } : { name: item.name, group: interfaceCaseCategory(item.metadata), tags: Array.isArray(item.metadata?.__apivoyCaseTags) ? item.metadata.__apivoyCaseTags.join(", ") : "" }); }
  async function run(ids: string[]) { if (!ids.length || busy) return; setBusy(true); setResults((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, "running"])) })); try { const next = await onRunCases?.(ids) ?? Object.fromEntries(ids.map((id) => [id, { passed: false, error: "当前执行端不可用" }])); setRunDetails((current) => ({ ...current, ...next })); setResults((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, next[id]?.passed ? "passed" : "failed"])) })); } finally { setBusy(false); } }
  async function saveInline(item: InterfaceCaseSummary, patch: Partial<{ name: string; group: string; tags: string[] }>) { await onSaveCase?.(item.id, { name: patch.name ?? item.name, group: patch.group ?? interfaceCaseCategory(item.metadata), tags: patch.tags ?? (Array.isArray(item.metadata?.__apivoyCaseTags) ? item.metadata.__apivoyCaseTags.filter((tag): tag is string => typeof tag === "string") : []) }); }
  async function togglePreview(item: InterfaceCaseSummary) { const loadId = ++previewLoadId.current; if (expandedId === item.id) { setExpandedId(null); setPreviewRequest(null); return; } setExpandedId(item.id); setPreviewRequest(null); const request = await onLoadCase?.(item.id) ?? null; if (previewLoadId.current === loadId) setPreviewRequest(request); }
  function caseForRow(row: HTMLElement | null): InterfaceCaseSummary | undefined { if (!row) return undefined; const rows = Array.from(row.parentElement?.parentElement?.querySelectorAll<HTMLElement>(".interface-case-table-row") ?? []); return visibleCases[rows.indexOf(row)]; }
  return <section className="interface-cases-panel" aria-label="测试用例">
    <nav className="interface-case-categories" aria-label="测试用例分类">{categories.map(([id, label]) => { const count = id === "all" ? items.length : items.filter((item) => categoryOf(item) === id).length; return <button key={id} type="button" className={category === id ? "is-active" : ""} aria-pressed={category === id} onClick={() => setCategory(id)}>{label} <span>({count})</span></button>; })}</nav>
    <header className="interface-cases-toolbar">
      <div className="interface-cases-actions">
        {items.length ? <label className="interface-cases-search"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、分组或标签" aria-label="搜索测试用例"/></label> : null}
        {items.length ? selected.length ? <button type="button" className="ui-button secondary" disabled={busy} onClick={() => void run(selected)}><Icon name="bolt"/>运行选中</button> : <button type="button" className="ui-button secondary" disabled={busy} onClick={() => void run(items.map((item) => item.id))}><Icon name="send"/>全部运行</button> : null}
        <button type="button" className="ui-button primary" onClick={() => edit("new")}><Icon name="plus"/>添加测试用例</button>
      </div>
    </header>
    {visibleCases.length ? <div className="interface-case-table" role="table" aria-label="测试用例列表" onClick={(event) => { const target = event.target as HTMLElement; if (target.closest("button,input,select")) return; const item = caseForRow(target.closest<HTMLElement>(".interface-case-table-row")); if (item) void togglePreview(item); }}>
      <div className="interface-case-table-head" role="row"><span><input type="checkbox" aria-label="选择全部用例" checked={visibleCases.length > 0 && visibleCases.every((item) => selected.includes(item.id))} onChange={(event) => setSelected(event.target.checked ? visibleCases.map((item) => item.id) : [])}/></span><span>名称</span><span>分组</span><span className="interface-case-inline-tags">标签</span><span>运行结果</span><span>操作</span></div>
      {visibleCases.map((item) => {
        const tags = Array.isArray(item.metadata?.__apivoyCaseTags) ? item.metadata.__apivoyCaseTags.filter((tag): tag is string => typeof tag === "string") : [];
        const result = results[item.id];
        const expanded = expandedId === item.id;
        return <div key={item.id} className={`interface-case-record${expanded ? " is-expanded" : ""}`}><div role="row" className="interface-case-table-row"><span><input type="checkbox" aria-label={`选择 ${item.name}`} checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))}/></span><span className="interface-case-name-cell">{editingNameId === item.id ? <input autoFocus value={inlineName} onChange={(event) => setInlineName(event.target.value)} onBlur={() => { if (inlineName.trim() && inlineName.trim() !== item.name) void saveInline(item, { name: inlineName.trim() }); setEditingNameId(null); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditingNameId(null); }}/> : <><button type="button" className="interface-case-name" aria-expanded={expanded} onClick={() => void togglePreview(item)}>{item.name}</button><button type="button" className="interface-case-inline-edit" aria-label={`修改 ${item.name} 名称`} onClick={() => { setInlineName(item.name); setEditingNameId(item.id); }}><Icon name="edit"/></button></>}</span><span><select aria-label={`${item.name} 分组`} value={String(item.metadata?.__apivoyCaseGroup ?? "positive")} onChange={(event) => void saveInline(item, { group: event.target.value })}><option value="positive">正向</option><option value="negative">负向</option><option value="boundary">边界值</option><option value="security">安全性</option><option value="other">其他</option></select></span><span className="interface-case-inline-tags"><input aria-label={`${item.name} 标签`} defaultValue={tags.join(", ")} placeholder="添加标签" onBlur={(event) => void saveInline(item, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })}/></span><span><i className={`interface-case-result${result ? ` is-${result}` : ""}`}>{result === "running" ? "运行中" : result === "passed" ? "通过" : result === "failed" ? "失败" : "未运行"}</i></span><span className="interface-case-row-actions"><button type="button" title="运行" onClick={() => void run([item.id])}><Icon name="send"/></button><button type="button" title="在新页签打开" onClick={() => onOpenCase?.(item.id)}><Icon name="external"/></button><button type="button" title="复制用例" onClick={() => void onDuplicateCase?.(item.id)}><Icon name="copy"/></button><button type="button" title="复制 cURL" onClick={async () => { const value = await onCopyCurl?.(item.id); if (value) await navigator.clipboard.writeText(value); }}><Icon name="command"/></button><button type="button" title="删除" className="is-danger" onClick={() => void onDeleteCase?.(item.id)}><Icon name="trash"/></button></span></div>{expanded ? <InterfaceCasePreview request={previewRequest} outcome={runDetails[item.id]} activeTab={previewTab} onTabChange={setPreviewTab}/> : null}</div>;
      })}
    </div> : items.length ? <div className="interface-cases-no-results"><Icon name="search"/><strong>没有匹配的测试用例</strong><span>请尝试其他关键词。</span></div> : <div className="interface-cases-empty"><span><Icon name="archive"/></span><strong>还没有测试用例</strong><p>在右侧抽屉中创建第一条测试用例。</p><button type="button" className="ui-button primary" onClick={() => edit("new")}><Icon name="plus"/>添加测试用例</button></div>}
    {drawer === "new" ? <TestCaseCreateDrawer requestId={requestId} draft={draft} onDraftChange={setDraft} onClose={() => setDrawer(null)} onLoadCase={onLoadCase} onRunRequest={onRunRequest} onSaveCase={onSaveCase}/> : drawer ? <div className="interface-case-drawer-backdrop" onMouseDown={() => setDrawer(null)}><aside className="interface-case-drawer" role="dialog" aria-modal="true" aria-label="测试用例预览" onMouseDown={(event) => event.stopPropagation()}><header><div><strong>测试用例预览</strong><small>可直接修改当前用例信息</small></div><button type="button" className="ui-icon-button" aria-label="关闭" onClick={() => setDrawer(null)}><Icon name="close"/></button></header><div className="interface-case-drawer-body"><label><span>名称</span><input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}/></label><label><span>分组</span><input value={draft.group} onChange={(event) => setDraft((current) => ({ ...current, group: event.target.value }))}/></label><label><span>标签</span><input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}/></label><button type="button" className="ui-button secondary" onClick={() => onOpenCase?.(drawer.id)}>打开完整配置</button></div><footer><button type="button" className="ui-button secondary" onClick={() => setDrawer(null)}>取消</button><button type="button" className="ui-button primary" disabled={!draft.name.trim()} onClick={async () => { await onSaveCase?.(drawer.id, { name: draft.name.trim(), group: draft.group.trim() || "未分组", tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); setDrawer(null); }}>保存</button></footer></aside></div> : null}
  </section>;
}

function TestCaseCreateDrawer({ requestId, draft, onDraftChange, onClose, onLoadCase, onRunRequest, onSaveCase }: {
  requestId?: string;
  draft: { name: string; group: string; tags: string };
  onDraftChange: (updater: (current: { name: string; group: string; tags: string }) => { name: string; group: string; tags: string }) => void;
  onClose: () => void;
  onLoadCase?: (id: string) => Promise<HttpWorkbenchRequest | null>;
  onRunRequest?: InterfaceLifecycleShellProps["onRunRequest"];
  onSaveCase?: InterfaceLifecycleShellProps["onSaveCase"];
}) {
  const [request, setRequest] = useState<HttpWorkbenchRequest | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { let active = true; if (requestId && onLoadCase) void onLoadCase(requestId).then((value) => { if (active) setRequest(value); }); return () => { active = false; }; }, [requestId, onLoadCase]);
  const save = async (edited: HttpWorkbenchRequest) => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try { await onSaveCase?.(null, { name: draft.name.trim(), group: draft.group || "positive", tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), request: edited }); onClose(); }
    finally { setSaving(false); }
  };
  const editorSessionId = `create-test-case-${request?.id ?? "draft"}`;
  return <div className="interface-case-drawer-backdrop" onMouseDown={onClose}><aside className="interface-case-drawer interface-case-create-workbench" role="dialog" aria-modal="true" aria-label="添加测试用例" onMouseDown={(event) => event.stopPropagation()}><div className="interface-case-create-topbar"><button type="button" className="ui-icon-button" aria-label="关闭" onClick={onClose}><Icon name="close"/></button><input autoFocus className="interface-case-create-name" aria-label="用例名称" value={draft.name} onChange={(event) => onDraftChange((current) => ({ ...current, name: event.target.value }))} placeholder="用例名称"/><button type="button" className="ui-button primary interface-case-create-save" disabled={!draft.name.trim() || !request || saving} onClick={() => window.dispatchEvent(new CustomEvent("apivoy-save-interface-draft", { detail: { requestId: request?.id, sessionId: editorSessionId } }))}>{saving ? "保存中…" : "保存"}</button><label><Icon name="archive"/><select aria-label="分类" value={draft.group === "未分组" ? "positive" : draft.group} onChange={(event) => onDraftChange((current) => ({ ...current, group: event.target.value }))}><option value="positive">正向</option><option value="negative">负向</option><option value="boundary">边界值</option><option value="security">安全性</option><option value="other">其他</option></select></label><label><Icon name="tag"/><input aria-label="标签" value={draft.tags} onChange={(event) => onDraftChange((current) => ({ ...current, tags: event.target.value }))} placeholder="添加标签"/></label></div><div className="interface-case-create-editor">{request && onRunRequest ? <HttpWorkbench externalRequest={request} fixedSplitDirection="vertical" workbenchSessionId={editorSessionId} onSend={onRunRequest} onSave={save}/> : <div className="interface-case-preview-loading">正在加载请求配置…</div>}</div></aside></div>;
}

function InterfaceCasePreview({ request, outcome }: { request: HttpWorkbenchRequest | null; outcome?: InterfaceCaseRunOutcome; activeTab: unknown; onTabChange: unknown }) {
  if (!request) return <div className="interface-case-preview-loading">正在加载用例…</div>;
  const tags = Array.isArray(request.metadata?.__apivoyCaseTags) ? request.metadata.__apivoyCaseTags.filter((tag): tag is string => typeof tag === "string") : [];
  const requestWithResult = outcome ? {
    ...request,
    metadata: {
      ...(request.metadata ?? {}),
      __apivoySavedResponse: {
        status: outcome.status ?? null,
        durationMs: outcome.durationMs ?? 0,
        body: outcome.body ?? outcome.error ?? "",
        headers: outcome.headers ?? [],
        contentType: outcome.headers?.find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? null,
      },
    },
  } : request;
  return <div className="interface-case-workbench-preview"><div className="interface-case-preview-target"><b className={`is-${request.method.toLowerCase()}`}>{request.method}</b><code title={request.url}>{request.url}</code><label><Icon name="tag"/><input aria-label="测试用例标签" defaultValue={tags.join(", ")} placeholder="添加标签" onBlur={(event) => window.dispatchEvent(new CustomEvent("apivoy-update-test-case-tags", { detail: { id: request.id, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) } }))}/></label></div><div className="interface-case-preview-workbench"><HttpWorkbench embeddedPreview externalRequest={requestWithResult} workbenchSessionId={`test-case-preview-${request.id ?? "request"}`} onSend={async () => { throw new Error("请使用用例行上的运行操作"); }}/></div></div>;
}

const FORMAT_BY_PROTOCOL: Record<string, string> = {
  http: "openapi",
  grpc: "protobuf",
  graphql: "graphql-sdl",
  rpc: "wsdl",
  mqtt: "asyncapi",
  amqp: "asyncapi",
  kafka: "asyncapi",
  sql: "sql-ddl",
};
const FILE_BY_PROTOCOL: Record<string, string> = {
  http: "openapi.yaml",
  grpc: "service.proto",
  graphql: "schema.graphql",
  rpc: "service.wsdl",
  mqtt: "asyncapi.yaml",
  amqp: "asyncapi.yaml",
  kafka: "asyncapi.yaml",
  sql: "schema.sql",
};
type DefinitionScope =
  | "request.params"
  | "request.headers"
  | "request.cookies"
  | "request.body"
  | "response.headers"
  | "response.cookies"
  | "response.body";
export interface DefinitionField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
  parentId?: string;
  scope: DefinitionScope;
  status?: string;
}
function definitionScopeSupportsChildren(scope: DefinitionScope): boolean {
  return scope === "request.body" || scope === "response.body";
}
export function changeDefinitionFieldType(
  fields: DefinitionField[],
  fieldId: string,
  type: string,
): DefinitionField[] {
  const target = fields.find((field) => field.id === fieldId);
  if (!target) return fields;

  const descendantsOf = (id: string) => {
    const ids = new Set<string>();
    const pending = [id];
    while (pending.length) {
      const parentId = pending.pop();
      for (const field of fields) {
        if (field.parentId === parentId && !ids.has(field.id)) {
          ids.add(field.id);
          pending.push(field.id);
        }
      }
    }
    return ids;
  };

  let next = fields.map((field) =>
    field.id === fieldId ? { ...field, type } : field,
  );
  const children = fields.filter((field) => field.parentId === fieldId);

  // Params, headers and cookies are flat serialized values. They may use an
  // object/array type, but only JSON body schemas expose editable child fields.
  if (!definitionScopeSupportsChildren(target.scope)) {
    const removed = descendantsOf(fieldId);
    return next.filter((field) => !removed.has(field.id));
  }

  if (type === "array") {
    if (!children.length) {
      return [
        ...next,
        {
          id: crypto.randomUUID(),
          parentId: target.id,
          name: "items",
          type: "string",
          required: false,
          description: "",
          example: "",
          scope: target.scope,
          status: target.status,
        },
      ];
    }

    const [item, ...extraChildren] = children;
    const removed = new Set<string>();
    for (const child of extraChildren) {
      removed.add(child.id);
      descendantsOf(child.id).forEach((id) => removed.add(id));
    }
    next = next
      .filter((field) => !removed.has(field.id))
      .map((field) =>
        field.id === item.id ? { ...field, name: "items" } : field,
      );
  } else if (type !== "object") {
    const removed = descendantsOf(fieldId);
    next = next.filter((field) => !removed.has(field.id));
  }

  return next;
}type BodyDesignMode =
  | "none"
  | "form-data"
  | "urlencoded"
  | "json"
  | "xml"
  | "text"
  | "binary"
  | "graphql";
type SecurityAuthScheme = "none" | "bearer" | "apiKey" | "basic" | "oauth2";
interface SecurityDesignConfig {
  authScheme: SecurityAuthScheme;
  apiKeyName: string;
  apiKeyIn: "header" | "query" | "cookie";
  scopes: string;
  rateLimit: number;
  rateWindow: "second" | "minute" | "hour";
  maxBodyKb: number;
  requireHttps: boolean;
}
const DEFAULT_SECURITY_DESIGN: SecurityDesignConfig = { authScheme: "none", apiKeyName: "X-Api-Key", apiKeyIn: "header", scopes: "", rateLimit: 0, rateWindow: "minute", maxBodyKb: 0, requireHttps: true };
function parseSecurityDesign(content: string): SecurityDesignConfig {
  const source = content.match(/^x-apivoy-security:\s*(\{.*\})\s*$/m)?.[1];
  if (!source) return { ...DEFAULT_SECURITY_DESIGN };
  try { return { ...DEFAULT_SECURITY_DESIGN, ...(JSON.parse(source) as Partial<SecurityDesignConfig>) }; } catch { return { ...DEFAULT_SECURITY_DESIGN }; }
}

const BODY_DESIGN_MODES: Array<{
  id: BodyDesignMode;
  label: string;
  contentType?: string;
}> = [
  { id: "none", label: "none" },
  { id: "form-data", label: "form-data", contentType: "multipart/form-data" },
  {
    id: "urlencoded",
    label: "x-www-form-urlencoded",
    contentType: "application/x-www-form-urlencoded",
  },
  { id: "json", label: "JSON", contentType: "application/json" },
  { id: "xml", label: "XML", contentType: "application/xml" },
  { id: "text", label: "Text", contentType: "text/plain" },
  { id: "binary", label: "Binary", contentType: "application/octet-stream" },
  { id: "graphql", label: "GraphQL", contentType: "application/json" },
];
interface HttpDebugDraft {
  id?: string;
  name?: string;
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: string;
  bodyEncoding?: "text" | "base64";
  multipart?: Array<{
    name: string;
    value: string;
    fileName?: string;
    contentType?: string;
    base64?: boolean;
  }>;
  timeoutMs: number;
  variables: Record<string, string>;
  assertions: unknown[];
  auth?: unknown;
  followRedirects: boolean;
  retryMax: number;
  retryBackoffMs: number;
  proxy?: string | null;
  tlsVerify: boolean;
  [key: string]: unknown;
}
type OpenApiVersion = "2.0" | "3.0" | "3.1" | "3.2";
const FIELD_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "bytes",
  "enum",
  "file",
  "null",
];
const visualFieldCache = new Map<string, DefinitionField[]>();

export function detectOpenApiVersion(content: string): OpenApiVersion {
  if (
    /^\s*["']?swagger["']?\s*:\s*["']?2\.0/m.test(content) ||
    /["']swagger["']\s*:\s*["']2\.0/.test(content)
  )
    return "2.0";
  const match =
    content.match(/^\s*["']?openapi["']?\s*:\s*["']?(3\.[012])/m) ??
    content.match(/["']openapi["']\s*:\s*["'](3\.[012])/);
  return (match?.[1] as OpenApiVersion | undefined) ?? "3.1";
}

interface DefinitionParseIssue {
  severity: "error" | "warning";
  message: string;
  line?: number;
}

function validateDefinitionSource(
  content: string,
  protocol: string,
): DefinitionParseIssue[] {
  if (!content.trim())
    return [{ severity: "error", message: "定义内容不能为空", line: 1 }];
  const issues: DefinitionParseIssue[] = [];
  const lines = content.split(/\r?\n/);
  const tabLine = lines.findIndex((line) => /^\s*\t|\t/.test(line));
  if (tabLine >= 0 && ["http", "mqtt", "amqp", "kafka"].includes(protocol))
    issues.push({
      severity: "error",
      message: "YAML 缩进不能使用 Tab，请改为空格",
      line: tabLine + 1,
    });
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const position = Number(message.match(/position\s+(\d+)/)?.[1] ?? 0);
      const line = position
        ? content.slice(0, position).split(/\r?\n/).length
        : undefined;
      issues.push({
        severity: "error",
        message: `JSON syntax error: ${message}`,
        line,
      });
    }
  }
  if (
    protocol === "http" &&
    !/^\s*(?:openapi|swagger)\s*:/m.test(content) &&
    !/["'](?:openapi|swagger)["']\s*:/.test(content)
  )
    issues.push({
      severity: "error",
      message: "未找到 openapi 或 swagger 版本声明",
      line: 1,
    });
  if (
    protocol === "http" &&
    !/^\s*paths\s*:/m.test(content) &&
    !/["']paths["']\s*:/.test(content)
  )
    issues.push({ severity: "error", message: "未找到 paths 节点" });
  const pairs: Array<[string, string]> = [
    ["{", "}"],
    ["[", "]"],
  ];
  for (const [open, close] of pairs)
    if (content.split(open).length - 1 !== content.split(close).length - 1)
      issues.push({
        severity: "error",
        message: `${open}${close} count mismatch`,
      });
  if (/\$ref\s*:|["']\$ref["']\s*:/.test(content))
    issues.push({
      severity: "warning",
      message: "包含 $ref：引用会保留在源码中，但当前可视化只展开已解析字段",
    });
  if (/^\s*(?:callbacks|links|webhooks)\s*:/m.test(content))
    issues.push({
      severity: "warning",
      message: "包含高级 OpenAPI 节点，当前可视化可能无法完整呈现",
    });
  return issues;
}

function editorLanguageFor(protocol: string, content: string): string {
  if (protocol === "grpc") return "protobuf";
  if (protocol === "graphql") return "graphql";
  if (protocol === "rpc") return "xml";
  if (protocol === "sql") return "sql";
  return content.trimStart().startsWith("{") ? "json" : "yaml";
}

function formatDefinitionSource(content: string): string {
  if (
    content.trimStart().startsWith("{") ||
    content.trimStart().startsWith("[")
  ) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2) + "\n";
    } catch {
      return content;
    }
  }
  return (
    content
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/\s+$/, "")
          .replace(/^\t+/, (tabs) => "  ".repeat(tabs.length)),
      )
      .join("\n")
      .trimEnd() + "\n"
  );
}

function parseOpenApiFields(content: string): DefinitionField[] {
  const fields: DefinitionField[] = [];
  const parameterPattern =
    /^\s*- name:\s*([^\n]+)\n\s+in:\s*(query|path|header|cookie)\n\s+required:\s*(true|false)(?:\n\s+schema:)?\n\s+type:\s*([\w-]+)/gm;
  for (const match of content.matchAll(parameterPattern)) {
    const location = match[2];
    const scope: DefinitionScope =
      location === "header"
        ? "request.headers"
        : location === "cookie"
          ? "request.cookies"
          : "request.params";
    fields.push({
      id: crypto.randomUUID(),
      name: match[1].trim(),
      type: match[4],
      required: match[3] === "true",
      description: "",
      scope,
    });
  }
  const lines = content.split(/\r?\n/);
  let inResponses = false;
  let responseStatus = "200";
  let section:
    | "request.body"
    | "response.body"
    | "response.headers"
    | "response.cookies"
    | null = null;
  let sectionIndent = -1;
  let propertiesIndent = -1;
  let required = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (trimmed === "responses:") {
      inResponses = true;
      section = null;
      continue;
    }
    const statusMatch = inResponses
      ? trimmed.match(/^['"]?(\d{3}|default)['"]?:$/)
      : null;
    if (statusMatch) {
      responseStatus = statusMatch[1];
      section = null;
      continue;
    }
    if (trimmed === "requestBody:" || /^- name:\s*body$/.test(trimmed)) {
      section = "request.body";
      sectionIndent = indent;
      propertiesIndent = -1;
      required = new Set();
      continue;
    }
    if (inResponses && trimmed === "headers:") {
      section = "response.headers";
      sectionIndent = indent;
      propertiesIndent = -1;
      required = new Set();
      continue;
    }
    if (inResponses && trimmed === "x-response-cookies:") {
      section = "response.cookies";
      sectionIndent = indent;
      propertiesIndent = -1;
      required = new Set();
      continue;
    }
    if (inResponses && trimmed === "properties:") {
      section = "response.body";
      sectionIndent = indent;
      propertiesIndent = indent;
      required = new Set();
      continue;
    }
    if (
      !inResponses &&
      section === "request.body" &&
      trimmed === "properties:"
    ) {
      propertiesIndent = indent;
      continue;
    }
    if (
      section &&
      indent <= sectionIndent &&
      trimmed &&
      !trimmed.startsWith("- ")
    ) {
      section = null;
      propertiesIndent = -1;
    }
    if (!section) continue;
    const requiredMatch = trimmed.match(/^required:\s*\[([^\]]*)\]/);
    if (requiredMatch) {
      required = new Set(
        requiredMatch[1]
          .split(",")
          .map((item) => item.replace(/["']/g, "").trim()),
      );
      continue;
    }
    const nameMatch = trimmed.match(/^([\w.-]+):$/);
    if (!nameMatch) continue;
    const isProperty =
      propertiesIndent >= 0
        ? indent === propertiesIndent + 2
        : indent === sectionIndent + 2;
    if (!isProperty) continue;
    const details = lines.slice(index + 1, index + 6).join("\n");
    const type =
      details.match(/^\s*type:\s*([\w-]+)/m)?.[1] ??
      details.match(/^\s*schema:\s*\n\s*type:\s*([\w-]+)/m)?.[1];
    if (!type) continue;
    fields.push({
      id: crypto.randomUUID(),
      name: nameMatch[1],
      type,
      required:
        required.has(nameMatch[1]) || /^\s*required:\s*true/m.test(details),
      description:
        details.match(/^\s*description:\s*(.+)$/m)?.[1]?.trim() ?? "",
      scope: section,
      status: section.startsWith("response.") ? responseStatus : undefined,
    });
  }
  return fields;
}

function parseVisualFieldsExtension(content: string): DefinitionField[] | null {
  const source = content.match(/^x-apivoy-visual-fields:\s*(\[.*\])\s*$/m)?.[1];
  if (!source) return null;
  try {
    const value = JSON.parse(source) as unknown;
    if (!Array.isArray(value)) return null;
    const fields = value.filter((item): item is DefinitionField => {
      if (!item || typeof item !== "object") return false;
      const field = item as Partial<DefinitionField>;
      return typeof field.id === "string" && typeof field.name === "string" && typeof field.type === "string" && typeof field.scope === "string";
    });
    return fields.map((field) => ({ ...field }));
  } catch {
    return null;
  }
}

export function parseDefinitionFields(
  content: string,
  protocol: string,
): DefinitionField[] {
  if (!content.trim()) return [];
  if (protocol === "http") {
    const visualFields = parseVisualFieldsExtension(content);
    if (visualFields) return visualFields;
  }
  const cached = visualFieldCache.get(content);
  if (cached) return cached.map((field) => ({ ...field }));
  if (protocol === "http") {
    const openApiFields = parseOpenApiFields(content);
    if (openApiFields.length) return openApiFields;
  }
  if (protocol === "grpc")
    return [
      ...content.matchAll(
        /(?:repeated\s+)?(string|bool|bytes|int32|int64|float|double|[A-Z]\w*)\s+(\w+)\s*=\s*\d+/g,
      ),
    ].map((match) => ({
      id: crypto.randomUUID(),
      name: match[2],
      type:
        match[1] === "bool"
          ? "boolean"
          : match[1].startsWith("int")
            ? "integer"
            : match[1],
      required: false,
      description: "",
      scope: "request.body" as const,
    }));
  if (protocol === "graphql")
    return [
      ...content.matchAll(/^\s*(\w+)\s*(?:\([^)]*\))?\s*:\s*([\[\]!\w]+)/gm),
    ]
      .filter(
        (match) => !["type", "input", "query", "mutation"].includes(match[1]),
      )
      .map((match) => ({
        id: crypto.randomUUID(),
        name: match[1],
        type: match[2].replace(/[!\[\]]/g, "").toLowerCase(),
        required: match[2].includes("!"),
        description: "",
        scope: "request.body" as const,
      }));
  if (protocol === "sql")
    return [
      ...content.matchAll(
        /^\s*[`"]?(\w+)[`"]?\s+(varchar|text|int|integer|bigint|decimal|numeric|boolean|timestamp|date|json)\b([^,]*)/gim,
      ),
    ].map((match) => ({
      id: crypto.randomUUID(),
      name: match[1],
      type: /int/.test(match[2])
        ? "integer"
        : /decimal|numeric/.test(match[2])
          ? "number"
          : match[2] === "boolean"
            ? "boolean"
            : match[2] === "json"
              ? "object"
              : "string",
      required: /not\s+null/i.test(match[3]),
      description: "",
      scope: "response.body" as const,
      status: "success",
    }));
  const required = new Set<string>();
  const requiredBlock = content.match(/required\s*:\s*\[([^\]]+)\]/);
  requiredBlock?.[1]
    .split(",")
    .forEach((item) => required.add(item.replace(/["']/g, "").trim()));
  const structuralKeys = new Set([
    "openapi",
    "swagger",
    "info",
    "servers",
    "host",
    "basePath",
    "schemes",
    "consumes",
    "produces",
    "paths",
    "responses",
    "properties",
    "schema",
    "content",
    "type",
    "description",
    "required",
    "items",
    "format",
    "example",
    "examples",
    "requestBody",
    "parameters",
    "components",
    "definitions",
    "security",
    "securitySchemes",
    "tags",
    "summary",
    "operationId",
  ]);
  const documentKeys = new Set([
    "title",
    "version",
    "get",
    "put",
    "post",
    "delete",
    "patch",
    "head",
    "options",
    "trace",
  ]);
  return [
    ...content.matchAll(
      /^(\s{2,})(\w[\w.-]*)\s*:\s*(?:\{)?\s*(?:type\s*:\s*)?([\w-]+)?/gm,
    ),
  ]
    .filter(
      (match) =>
        !structuralKeys.has(match[2]) &&
        !(match[1].length <= 10 && documentKeys.has(match[2])) &&
        !/^\d{3}$/.test(match[2]),
    )
    .slice(0, 100)
    .map((match) => ({
      id: crypto.randomUUID(),
      name: match[2],
      type: FIELD_TYPES.includes(match[3] ?? "") ? match[3]! : "string",
      required: required.has(match[2]),
      description: "",
      scope: "request.body" as const,
    }));
}

export function mergeDesignIntoHttpDraft(
  draft: HttpDebugDraft,
  fields: DefinitionField[],
  bodyMode: BodyDesignMode = "json",
): HttpDebugDraft {
  const designedStatuses = [...new Set(fields.filter((field) => field.scope.startsWith("response.")).map((field) => field.status || "200"))];
  const responseStatuses = designedStatuses.length ? designedStatuses : ["200"];
  const next = {
    ...draft,
    headers: draft.headers.map((header) => [...header] as [string, string]),
    metadata: {
      ...(draft.metadata ?? {}),
      __apivoyResponseDefinitions: responseStatuses.map((status) => ({ status, fields: fields.filter((field) => field.scope.startsWith("response.") && (field.status || "200") === status) })),
    },
  };
  const url = new URL(draft.url || "/", "http://apivoy.local");
  for (const field of fields.filter(
    (item) => item.scope === "request.params" && item.name.trim(),
  ))
    if (!url.searchParams.has(field.name)) url.searchParams.set(field.name, "");
  const query = url.searchParams.toString();
  const base = draft.url.split(/[?#]/, 1)[0] || draft.url;
  next.url = `${base}${query ? `?${query}` : ""}`;
  for (const field of fields.filter(
    (item) => item.scope === "request.headers" && item.name.trim(),
  ))
    if (
      !next.headers.some(
        ([name]) => name.toLowerCase() === field.name.toLowerCase(),
      )
    )
      next.headers.push([field.name, ""]);
  const cookies = new Map(
    next.headers
      .filter(([name]) => name.toLowerCase() === "cookie")
      .flatMap(([, value]) => value.split(";"))
      .map((item) => item.trim().split("=", 2) as [string, string])
      .filter(([name]) => name),
  );
  for (const field of fields.filter(
    (item) => item.scope === "request.cookies" && item.name.trim(),
  ))
    if (!cookies.has(field.name)) cookies.set(field.name, "");
  next.headers = next.headers.filter(
    ([name]) => name.toLowerCase() !== "cookie",
  );
  if (cookies.size)
    next.headers.push([
      "Cookie",
      [...cookies].map(([name, value]) => `${name}=${value ?? ""}`).join("; "),
    ]);
  const bodyFields = fields.filter(
    (item) => item.scope === "request.body" && item.name.trim(),
  );
  const bodyRoots = bodyFields.filter(
    (field) =>
      !field.parentId || !bodyFields.some((item) => item.id === field.parentId),
  );
  const exampleFor = (field: DefinitionField): unknown => {
    if (field.example !== undefined && field.example !== "")
      return field.example;
    const children = bodyFields.filter((item) => item.parentId === field.id);
    if (field.type === "object")
      return Object.fromEntries(
        children.map((child) => [child.name, exampleFor(child)]),
      );
    if (field.type === "array")
      return children[0] ? [exampleFor(children[0])] : [];
    return field.type === "boolean"
      ? false
      : field.type === "integer" || field.type === "number"
        ? 0
        : "";
  };
  next.headers = next.headers.filter(
    ([name]) => name.toLowerCase() !== "content-type",
  );
  const contentType = BODY_DESIGN_MODES.find(
    (item) => item.id === bodyMode,
  )?.contentType;
  if (contentType && bodyMode !== "form-data")
    next.headers.push(["Content-Type", contentType]);
  if (bodyMode === "none") {
    next.body = "";
    next.multipart = [];
  } else if (bodyMode === "form-data") {
    next.body = "";
    next.multipart = bodyRoots.map((field) => ({
      name: field.name,
      value: field.example ?? "",
      fileName: field.type === "file" ? "" : undefined,
      contentType:
        field.type === "file" ? "application/octet-stream" : "text/plain",
      base64: false,
    }));
  } else if (bodyMode === "urlencoded")
    next.body = new URLSearchParams(
      bodyRoots.map((field) => [field.name, field.example ?? ""]),
    ).toString();
  else if (bodyMode === "binary") {
    next.body = "";
    next.bodyEncoding = "base64";
  } else if (bodyFields.length && !draft.body?.trim())
    next.body = JSON.stringify(
      Object.fromEntries(
        bodyRoots.map((field) => [field.name, exampleFor(field)]),
      ),
      null,
      2,
    );
  return next;
}

export function definitionFieldsFromHttpDraft(draft: HttpDebugDraft): DefinitionField[] {
  const fields: DefinitionField[] = [];
  try {
    const url = new URL(draft.url || "/", "http://apivoy.local");
    for (const name of new Set(url.searchParams.keys())) fields.push({ id: crypto.randomUUID(), name, scope: "request.params", type: "string", required: false, description: "" });
  } catch { /* Keep the design usable while the URL is incomplete. */ }
  const ignored = new Set(["authorization", "cookie", "content-type", "content-length", "host", "connection", "user-agent", "accept", "accept-encoding"]);
  for (const [name] of draft.headers) if (name.trim() && !ignored.has(name.trim().toLowerCase())) fields.push({ id: crypto.randomUUID(), name: name.trim(), scope: "request.headers", type: "string", required: false, description: "" });
  const fieldType = (value: unknown): DefinitionField["type"] => value === null ? "string" : Array.isArray(value) ? "array" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value === "boolean" ? "boolean" : typeof value === "object" ? "object" : "string";
  const addBodyField = (name: string, item: unknown, parentId?: string) => {
    const id = crypto.randomUUID();
    const type = fieldType(item);
    fields.push({ id, parentId, name, scope: "request.body", type, required: false, description: "", example: typeof item === "object" ? undefined : String(item ?? "") });
    if (Array.isArray(item)) {
      const exampleItem = item[0];
      addBodyField("items", exampleItem === undefined ? "" : exampleItem, id);
    } else if (item && typeof item === "object") {
      for (const [childName, child] of Object.entries(item as Record<string, unknown>)) addBodyField(childName, child, id);
    }
  };
  if (draft.body?.trim()) { try { const parsed = JSON.parse(draft.body) as unknown; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) for (const [name, item] of Object.entries(parsed as Record<string, unknown>)) addBodyField(name, item); else if (Array.isArray(parsed)) addBodyField("items", parsed); } catch { /* Raw bodies cannot be safely inferred as fields. */ } }
  return fields;
}

function syncDesignToDebug(
  workbenchId: string,
  fields: DefinitionField[],
  bodyMode: BodyDesignMode,
  security?: SecurityDesignConfig,
  projectId?: string,
) {
  if (workbenchId !== "http") return;
  const draft = readWorkbenchDraft<HttpDebugDraft>("http") ?? {
    url: "",
    method: "GET",
    headers: [],
    body: "",
    timeoutMs: 30000,
    variables: {},
    assertions: [],
    auth: null,
    followRedirects: true,
    retryMax: 0,
    retryBackoffMs: 250,
    proxy: null,
    tlsVerify: true,
  };
  const request = mergeDesignIntoHttpDraft(draft, fields, bodyMode);
  request.metadata = { ...(request.metadata ?? {}), __apivoyProjectId: projectId };
  if (security) {
    const existingAuth = request.auth && typeof request.auth === "object" ? request.auth as Record<string, unknown> : {};
    request.auth = security.authScheme === "none" ? null : {
      ...existingAuth,
      kind: security.authScheme === "apiKey" ? "api_key" : security.authScheme,
      ...(security.authScheme === "apiKey" ? { header_name: security.apiKeyName } : {}),
      token: null,
      secret_ref: typeof existingAuth.secret_ref === "string" ? existingAuth.secret_ref : null,
    };
  }
  const hydrate = { workbenchId: "http", envelope: { request } };
  stashHydrate(hydrate);
  queueMicrotask(() =>
    window.dispatchEvent(
      new CustomEvent("apivoy-hydrate-request", { detail: hydrate }),
    ),
  );
}

function fieldsToDefinition(
  fields: DefinitionField[],
  protocol: string,
  openApiVersion: OpenApiVersion = "3.1",
  bodyMode: BodyDesignMode = "none",
  security: SecurityDesignConfig = DEFAULT_SECURITY_DESIGN,
): string {
  const liveHttpDraft = protocol === "http" ? readWorkbenchDraft<HttpDebugDraft>("http") : null;
  const liveMethod = liveHttpDraft?.method?.toLowerCase() || "get";
  const livePath = (() => { try { return new URL(liveHttpDraft?.url || "/", "http://apivoy.local").pathname || "/"; } catch { return "/"; } })();
  if (protocol === "grpc")
    return `message Request {\n${fields.map((field, index) => `  ${field.type === "boolean" ? "bool" : field.type === "integer" ? "int64" : field.type === "number" ? "double" : field.type === "array" ? "repeated string" : field.type} ${field.name || `field_${index + 1}`} = ${index + 1};`).join("\n")}\n}`;
  if (protocol === "graphql")
    return `input RequestInput {\n${fields.map((field) => `  ${field.name || "field"}: ${field.type === "integer" ? "Int" : field.type === "number" ? "Float" : field.type === "boolean" ? "Boolean" : field.type === "object" ? "JSON" : "String"}${field.required ? "!" : ""}`).join("\n")}\n}`;
  if (protocol === "sql")
    return `CREATE TABLE result (\n${fields.map((field) => `  ${field.name || "field"} ${field.type === "integer" ? "BIGINT" : field.type === "number" ? "DECIMAL" : field.type === "boolean" ? "BOOLEAN" : field.type === "object" ? "JSON" : "VARCHAR(255)"}${field.required ? " NOT NULL" : ""}`).join(",\n")}\n);`;
  const renderSchemaField = (
    field: DefinitionField,
    indent: string,
  ): string => {
    const children = fields.filter((item) => item.parentId === field.id);
    const schemaType = field.type === "file" ? "string" : field.type;
    const metadata = `${field.type === "file" ? `\n${indent}format: binary` : ""}${field.description ? `\n${indent}description: ${field.description}` : ""}${field.example ? `\n${indent}example: ${field.example}` : ""}`;
    if (field.type === "array") {
      const item = children[0];
      return `${indent}type: array${metadata}\n${indent}items:\n${item ? renderSchemaField(item, `${indent}  `) : `${indent}  type: string`}`;
    }
    if (field.type === "object" && children.length)
      return `${indent}type: object${metadata}\n${
        children.some((item) => item.required)
          ? `${indent}required: [${children
              .filter((item) => item.required)
              .map((item) => item.name)
              .join(", ")}]\n`
          : ""
      }${indent}properties:\n${children.map((child) => `${indent}  ${child.name || "field"}:\n${renderSchemaField(child, `${indent}    `)}`).join("\n")}`;
    return `${indent}type: ${schemaType}${metadata}`;
  };
  const yamlSchema = (items: DefinitionField[], indent: string) => {
    const roots = items.filter(
      (field) =>
        !field.parentId || !items.some((item) => item.id === field.parentId),
    );
    return `${
      roots.some((field) => field.required)
        ? `${indent}required: [${roots
            .filter((field) => field.required)
            .map((field) => field.name)
            .join(", ")}]\n`
        : ""
    }${indent}properties:\n${roots.map((field) => `${indent}  ${field.name || "field"}:\n${renderSchemaField(field, `${indent}    `)}`).join("\n")}`;
  };
  const visualFieldsExtension = `x-apivoy-visual-fields: ${JSON.stringify(fields)}\n`;
  const securityExtension = `x-apivoy-security: ${JSON.stringify(security)}\n`;
  const params = fields.filter(
    (field) =>
      field.scope === "request.params" ||
      field.scope === "request.headers" ||
      field.scope === "request.cookies",
  );
  const requestBody = fields.filter((field) => field.scope === "request.body");
  const statuses = [
    ...new Set(
      fields
        .filter((field) => field.scope.startsWith("response."))
        .map((field) => field.status || "200"),
    ),
  ];
  if (openApiVersion === "2.0") {
    const regularParams = params.filter(
      (field) => field.scope !== "request.cookies",
    );
    const cookieParams = params.filter(
      (field) => field.scope === "request.cookies",
    );
    return `swagger: '2.0'\n${visualFieldsExtension}${securityExtension}info:\n  title: Current API\n  version: 1.0.0\nproduces: [application/json]\npaths:\n  ${livePath}:\n    ${liveMethod}:\n      parameters:\n${regularParams.map((field) => `        - name: ${field.name}\n          in: ${field.scope === "request.headers" ? "header" : "query"}\n          required: ${field.required}\n          type: ${field.type}`).join("\n")}${requestBody.length ? `${regularParams.length ? "\n" : ""}        - name: body\n          in: body\n          required: true\n          schema:\n            type: object\n${yamlSchema(requestBody, "            ")}` : ""}${cookieParams.length ? `\n      x-cookie-parameters:\n${cookieParams.map((field) => `        - name: ${field.name}\n          required: ${field.required}\n          type: ${field.type}`).join("\n")}` : ""}\n      responses:\n${(statuses.length
      ? statuses
      : ["200"]
    )
      .map((status) => {
        const responseFields = fields.filter(
          (field) => (field.status || "200") === status,
        );
        const headers = responseFields.filter(
          (field) => field.scope === "response.headers",
        );
        const cookies = responseFields.filter(
          (field) => field.scope === "response.cookies",
        );
        const body = responseFields.filter(
          (field) => field.scope === "response.body",
        );
        return `        '${status}':\n          description: Response ${status}${headers.length ? `\n          headers:\n${headers.map((field) => `            ${field.name}:\n              type: ${field.type}`).join("\n")}` : ""}${cookies.length ? `\n          x-response-cookies:\n${cookies.map((field) => `            ${field.name}:\n              type: ${field.type}`).join("\n")}` : ""}${body.length ? `\n          schema:\n            type: object\n${yamlSchema(body, "            ")}` : ""}`;
      })
      .join("\n")}`;
  }
  const versionLiteral =
    openApiVersion === "3.0"
      ? "3.0.4"
      : openApiVersion === "3.2"
        ? "3.2.0"
        : "3.1.2";
  const bodyContentType = BODY_DESIGN_MODES.find(
    (item) => item.id === bodyMode,
  )?.contentType;
  const requestBodyYaml =
    bodyMode === "none"
      ? ""
      : bodyMode === "binary"
        ? `      requestBody:\n        content:\n          application/octet-stream:\n            schema:\n              type: string\n              format: binary\n`
        : `      requestBody:\n        content:\n          ${bodyContentType ?? "application/json"}:\n            schema:\n              type: object\n${yamlSchema(requestBody, "              ")}\n`;
  return `openapi: ${versionLiteral}\nx-apivoy-body-mode: ${bodyMode}\n${visualFieldsExtension}${securityExtension}info:\n  title: Current API\n  version: 1.0.0\npaths:\n  ${livePath}:\n    ${liveMethod}:\n${params.length ? `      parameters:\n${params.map((field) => `        - name: ${field.name}\n          in: ${field.scope.split(".")[1] === "params" ? "query" : field.scope.split(".")[1] === "headers" ? "header" : "cookie"}\n          required: ${field.required}\n          schema:\n            type: ${field.type}`).join("\n")}\n` : ""}${requestBodyYaml}      responses:\n${(statuses.length
    ? statuses
    : ["200"]
  )
    .map((status) => {
      const responseFields = fields.filter(
        (field) => (field.status || "200") === status,
      );
      const headers = responseFields.filter(
        (field) => field.scope === "response.headers",
      );
      const cookies = responseFields.filter(
        (field) => field.scope === "response.cookies",
      );
      const body = responseFields.filter(
        (field) => field.scope === "response.body",
      );
      return `        '${status}':\n          description: Response ${status}${headers.length ? `\n          headers:\n${headers.map((field) => `            ${field.name}:\n              required: ${field.required}\n              schema:\n                type: ${field.type}`).join("\n")}` : ""}${cookies.length ? `\n          x-response-cookies:\n${cookies.map((field) => `            ${field.name}:\n              type: ${field.type}`).join("\n")}` : ""}${body.length ? `\n          content:\n            application/json:\n              schema:\n                type: object\n${yamlSchema(body, "                ")}` : ""}`;
    })
    .join("\n")}`;
}

function DefinitionPanel({
  client,
  projectId,
  requestId,
  workbenchId,
  title,
}: {
  client: InterfaceDefinitionClient;
  projectId: string;
  requestId: string;
  workbenchId: string;
  title: string;
}) {
  const [definitionId, setDefinitionId] = useState("");
  const [content, setContent] = useState("");
  const [fields, setFields] = useState<DefinitionField[]>([]);
  const [openApiVersion, setOpenApiVersion] = useState<OpenApiVersion>("3.1");
  const [bodyMode, setBodyMode] = useState<BodyDesignMode>("none");
  const [security, setSecurity] = useState<SecurityDesignConfig>({ ...DEFAULT_SECURITY_DESIGN });
  const [mode, setMode] = useState<"visual" | "source">("visual");
  const [structureOpen, setStructureOpen] = useState(true);
  const [structureWidth, setStructureWidth] = useState(300);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const lastVisualContent = useRef("");
  const lastValidFields = useRef<DefinitionField[]>([]);
  const sourceBaseline = useRef("");
  const sourceDirty = useRef(false);
  const [parseIssues, setParseIssues] = useState<DefinitionParseIssue[]>([]);
  const [revealLine, setRevealLine] = useState<number | undefined>();
  const parsedFields = useMemo(
    () => parseDefinitionFields(content, workbenchId),
    [content, workbenchId],
  );
  async function reload() {
    const [items, linked] = await Promise.all([
      client.list(projectId),
      client.binding(requestId),
    ]);
    const current = items.find((item) => item.id === linked?.definitionId);
    const liveDraft = workbenchId === "http" ? readWorkbenchDraft<HttpDebugDraft>("http") : null;
    const inferredFields = !current && liveDraft ? definitionFieldsFromHttpDraft(liveDraft) : [];
    const inferredBodyMode: BodyDesignMode = liveDraft?.body?.trim() ? "json" : "none";
    const nextContent = current?.content ?? (inferredFields.length ? fieldsToDefinition(inferredFields, workbenchId, "3.1", inferredBodyMode) : "");
    const nextFields = inferredFields.length ? inferredFields : parseDefinitionFields(nextContent, workbenchId);
    setDefinitionId(current?.id ?? "");
    setContent(nextContent);
    setFields(nextFields);
    setSecurity(parseSecurityDesign(nextContent));
    setBodyMode(
      (nextContent.match(/^\s*x-apivoy-body-mode:\s*([\w-]+)/m)?.[1] as
        | BodyDesignMode
        | undefined) ?? (inferredFields.length ? inferredBodyMode : /requestBody\s*:/.test(nextContent) ? "json" : "none"),
    );
    lastVisualContent.current = nextContent;
    if (workbenchId === "http")
      setOpenApiVersion(detectOpenApiVersion(nextContent));
    if (workbenchId === "http") syncDesignToDebug(workbenchId, nextFields, (nextContent.match(/^\s*x-apivoy-body-mode:\s*([\w-]+)/m)?.[1] as BodyDesignMode | undefined) ?? inferredBodyMode, parseSecurityDesign(nextContent), projectId);
  }
  useEffect(() => {
    void reload().catch((error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
    );
  }, [projectId, requestId]);
  useEffect(() => {
    if (mode === "source")
      lastValidFields.current = fields.map((field) => ({ ...field }));
  }, [mode]);
  useEffect(() => {
    if (lastSavedAt)
      syncDesignToDebug(
        workbenchId,
        parseDefinitionFields(content, workbenchId),
        bodyMode,
        security,
        projectId,
      );
  }, [lastSavedAt]);
  async function saveDefinition() {
    const issues = validateDefinitionSource(content, workbenchId);
    setParseIssues(issues);
    const error = issues.find((issue) => issue.severity === "error");
    if (error) {
      setRevealLine(error.line);
      setMode("source");
      setMessage("定义存在解析错误，修复后才能保存");
      return;
    }
    setBusy(true);
    setMessage("正在保存接口定义…");
    let saved: ApiDefinition;
    try {
      saved = await client.save({
        id: definitionId || undefined,
        projectId,
        name: `${title} 定义`,
        format: FORMAT_BY_PROTOCOL[workbenchId] ?? workbenchId,
        fileName: FILE_BY_PROTOCOL[workbenchId] ?? `${workbenchId}.txt`,
        content,
      });
      setDefinitionId(saved.id);
      setLastSavedAt(saved.updatedAt || new Date().toISOString());
    } catch (error) {
      setMessage(
        `保存定义失败：${readableDefinitionError(error, "保存服务未返回错误详情，请检查 Agent 状态后重试")}`,
      );
      setBusy(false);
      return;
    }
    try {
      await client.bind(requestId, saved.id);
      const [definitions, binding] = await Promise.all([
        client.list(projectId),
        client.binding(requestId),
      ]);
      if (
        !definitions.some((item) => item.id === saved.id) ||
        binding?.definitionId !== saved.id
      )
        throw new Error("关联校验失败，请重试");
      setMessage(
        issues.length
          ? "接口定义已保存，同时保留了未完全可视化的高级结构"
          : "接口定义已保存，文档、Mock 和校验可以直接复用",
      );
      if (workbenchId === "http") window.dispatchEvent(new CustomEvent("apivoy-save-interface-draft", { detail: { requestId } }));
    } catch (error) {
      const detail = readableDefinitionError(error, "关联服务未返回错误详情");
      setMessage(
        /foreign key|request.*not found|constraint/i.test(detail)
          ? "接口定义已保存，但当前接口尚未保存；请先保存接口，再重新关联定义"
          : `接口定义已保存，但关联当前接口失败：${detail}`,
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const save = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string }>).detail;
      if (detail?.requestId === requestId && !busy && content.trim()) void saveDefinition();
    };
    window.addEventListener("apivoy-save-interface-definition", save);
    return () => window.removeEventListener("apivoy-save-interface-definition", save);
  }, [requestId, content, fields, bodyMode, security, definitionId, busy]);
  function updateFields(next: DefinitionField[]) {
    const generated = fieldsToDefinition(
      next,
      workbenchId,
      openApiVersion,
      bodyMode,
      security,
    );
    visualFieldCache.set(
      generated,
      next.map((field) => ({ ...field })),
    );
    setFields(next);
    setContent(generated);
    lastVisualContent.current = generated;
    syncDesignToDebug(workbenchId, next, bodyMode, security, projectId);
  }
  function changeOpenApiVersion(next: OpenApiVersion) {
    setOpenApiVersion(next);
    if (fields.length) {
      const generated = fieldsToDefinition(fields, workbenchId, next, bodyMode, security);
      visualFieldCache.set(
        generated,
        fields.map((field) => ({ ...field })),
      );
      setContent(generated);
      lastVisualContent.current = generated;
    }
    setMessage(
      next === "2.0"
        ? "已切换为 OpenAPI 2.0；Cookie 等 3.x 能力将通过 x-* 扩展保留"
        : `已切换输出版本为 OpenAPI ${next}`,
    );
  }
  function changeBodyMode(next: BodyDesignMode) {
    setBodyMode(next);
    const generated = fieldsToDefinition(
      fields,
      workbenchId,
      openApiVersion,
      next,
      security,
    );
    visualFieldCache.set(
      generated,
      fields.map((field) => ({ ...field })),
    );
    setContent(generated);
    lastVisualContent.current = generated;
    syncDesignToDebug(workbenchId, fields, next, security, projectId);
    setMessage(
      `请求 Body 已切换为 ${BODY_DESIGN_MODES.find((item) => item.id === next)?.label ?? next}`,
    );
  }
  function changeSecurity(next: SecurityDesignConfig) {
    setSecurity(next);
    const generated = fieldsToDefinition(fields, workbenchId, openApiVersion, bodyMode, next);
    visualFieldCache.set(generated, fields.map((field) => ({ ...field })));
    setContent(generated);
    lastVisualContent.current = generated;
    syncDesignToDebug(workbenchId, fields, bodyMode, next, projectId);
  }
  function validateSource(showSuccess = true): DefinitionParseIssue[] {
    const issues = validateDefinitionSource(content, workbenchId);
    setParseIssues(issues);
    const firstError = issues.find((issue) => issue.severity === "error");
    setRevealLine(firstError?.line);
    if (showSuccess && !issues.length) setMessage("定义校验通过");
    return issues;
  }
  function enterSourceMode() {
    sourceBaseline.current = content;
    sourceDirty.current = false;
    setParseIssues([]);
    setRevealLine(undefined);
    setMode("source");
  }
  function enterVisualMode() {
    if (!sourceDirty.current) {
      setParseIssues([]);
      setMode("visual");
      return;
    }
    const issues = validateSource(false);
    const error = issues.find((issue) => issue.severity === "error");
    if (error) {
      setFields(lastValidFields.current.map((field) => ({ ...field })));
      setMode("source");
      setMessage("源码解析失败，已保留原可视化定义");
      return;
    }
    const next =
      content === lastVisualContent.current
        ? fields
        : parseDefinitionFields(content, workbenchId);
    setFields(next);
    lastVisualContent.current = content;
    sourceBaseline.current = content;
    sourceDirty.current = false;
    setMode("visual");
    setMessage(
      issues.length ? "已解析定义，但存在暂不支持的高级结构" : "定义已重新解析",
    );
  }
  function formatSource() {
    const next = formatDefinitionSource(content);
    setContent(next);
    setParseIssues(validateDefinitionSource(next, workbenchId));
  }
  const structureFields = mode === "visual" ? fields : parsedFields;
  function resizeStructure(clientX: number) {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const maxWidth = Math.max(240, bounds.width - 320);
    setStructureWidth(Math.min(maxWidth, Math.max(240, bounds.right - clientX)));
  }
  return (
    <section
      className={`interface-definition-panel${structureOpen ? " has-structure" : ""}`}
    >
      <header>
        <div>
          <strong>接口定义</strong>
          <p>结构、类型和约束将被文档、Mock 与校验复用</p>
        </div>
        <div className="interface-definition-actions">
          {workbenchId === "http" ? (
            <label className="interface-openapi-version">
              <span>规范版本</span>
              <select
                aria-label="OpenAPI 规范版本"
                value={openApiVersion}
                onChange={(event) =>
                  changeOpenApiVersion(event.target.value as OpenApiVersion)
                }
              >
                <option value="2.0">OpenAPI 2.0</option>
                <option value="3.0">OpenAPI 3.0</option>
                <option value="3.1">OpenAPI 3.1</option>
                <option value="3.2">OpenAPI 3.2</option>
              </select>
            </label>
          ) : null}
          <div
            className="interface-definition-mode"
            role="tablist"
            aria-label="定义编辑模式"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "visual"}
              className={mode === "visual" ? "is-active" : ""}
              onClick={enterVisualMode}
            >
              可视化
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "source"}
              className={mode === "source" ? "is-active" : ""}
              onClick={enterSourceMode}
            >
              源码
            </button>
          </div>
          <button
            type="button"
            className={`ui-button secondary${structureOpen ? " is-active" : ""}`}
            aria-expanded={structureOpen}
            onClick={() => setStructureOpen((value) => !value)}
          >
            <Icon name="network" />
            接口结构
          </button>
          <button
            type="button"
            className="ui-button secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            导入
          </button>
        </div>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept=".yaml,.yml,.json,.proto,.graphql,.graphqls,.gql,.wsdl,.xml,.sql"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file)
              void file.text().then((value) => {
                setContent(value);
                setFields(parseDefinitionFields(value, workbenchId));
                if (workbenchId === "http")
                  setOpenApiVersion(detectOpenApiVersion(value));
                setMessage(
                  `${file.name} 已载入，已自动识别规范版本，保存后应用到当前接口`,
                );
              });
            event.currentTarget.value = "";
          }}
        />
      </header>
      <div ref={workspaceRef} className="interface-definition-workspace" style={{ "--interface-structure-width": `${structureWidth}px` } as CSSProperties}>
        <div className="interface-definition-main">
          {mode === "source" ? (
            <div className="interface-source-workspace">
              <div className="interface-source-toolbar">
                <span>
                  {editorLanguageFor(workbenchId, content).toUpperCase()}
                </span>
                <button type="button" onClick={formatSource}>
                  <Icon name="code" />
                  格式化
                </button>
                <button type="button" onClick={() => validateSource()}>
                  <Icon name="bolt" />
                  校验
                </button>
                <button type="button" onClick={enterVisualMode}>
                  <Icon name="sliders" />
                  重新解析
                </button>
              </div>
              <CodeEditor
                value={content}
                onChange={(value) => {
                  setContent(value);
                  sourceDirty.current = value !== sourceBaseline.current;
                  if (sourceDirty.current) setParseIssues([]);
                  if (workbenchId === "http")
                    setOpenApiVersion(detectOpenApiVersion(value));
                }}
                language={editorLanguageFor(workbenchId, content)}
                height="100%"
                bare
                wordWrap={false}
                revealLine={revealLine}
              />
              {parseIssues.length ? (
                <div className="interface-parse-issues" role="status">
                  {parseIssues.map((issue, index) => (
                    <button
                      type="button"
                      key={`${issue.severity}-${index}`}
                      className={`is-${issue.severity}`}
                      onClick={() => issue.line && setRevealLine(issue.line)}
                    >
                      <Icon
                        name={issue.severity === "error" ? "close" : "bolt"}
                      />
                      <span>
                        {issue.line ? `第 ${issue.line} 行 · ` : ""}
                        {issue.message}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <VisualDefinitionEditor
              fields={fields}
              bodyMode={bodyMode}
              security={security}
              onSecurityChange={changeSecurity}
              onBodyModeChange={changeBodyMode}
              onChange={updateFields}
            />
          )}
        </div>
        {structureOpen ? <>
          <button type="button" className="interface-structure-resizer" aria-label="调整接口结构面板宽度" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={Math.max(240, (workspaceRef.current?.clientWidth ?? 560) - 320)} aria-valuenow={Math.round(structureWidth)} role="separator"
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeStructure(event.clientX); }}
            onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const step = event.shiftKey ? 40 : 12; const max = Math.max(240, (workspaceRef.current?.clientWidth ?? 560) - 320); setStructureWidth((width) => Math.min(max, Math.max(240, width + (event.key === "ArrowLeft" ? step : -step)))); }} />
          <StructurePanel fields={structureFields} />
        </> : null}
      </div>
      <div className="interface-definition-feedback">
        {message ? (
          <p className="interface-definition-message" role="status">
            {message}
          </p>
        ) : null}
        {lastSavedAt ? (
          <time dateTime={lastSavedAt}>
            上次保存 {new Date(lastSavedAt).toLocaleTimeString()}
          </time>
        ) : null}
      </div>
    </section>
  );
}

const SCOPE_LABELS: Array<[DefinitionScope, string]> = [
  ["request.params", "请求参数"],
  ["request.headers", "请求 Headers"],
  ["request.cookies", "请求 Cookies"],
  ["request.body", "请求 Body"],
  ["response.headers", "响应 Headers"],
  ["response.cookies", "响应 Cookies"],
  ["response.body", "响应 Body"],
];

function VisualDefinitionEditor({
  fields,
  bodyMode,
  security,
  onSecurityChange,
  onBodyModeChange,
  onChange,
}: {
  fields: DefinitionField[];
  bodyMode: BodyDesignMode;
  security: SecurityDesignConfig;
  onSecurityChange: (security: SecurityDesignConfig) => void;
  onBodyModeChange: (mode: BodyDesignMode) => void;
  onChange: (fields: DefinitionField[]) => void;
}) {
  const [area, setArea] = useState<"request" | "response" | "security">(
    "request",
  );
  const [requestPart, setRequestPart] = useState<
    "params" | "headers" | "cookies" | "body"
  >("params");
  const [responsePart, setResponsePart] = useState<
    "headers" | "cookies" | "body"
  >("body");
  const [status, setStatus] = useState("200");
  const [newStatus, setNewStatus] = useState("");
  const [responseStatuses, setResponseStatuses] = useState<string[]>(["200"]);
  const [draftFieldId, setDraftFieldId] = useState(() => crypto.randomUUID());
  function update(id: string, patch: Partial<DefinitionField>) {
    if (id === draftFieldId) {
      const committedId = draftFieldId;
      setDraftFieldId(crypto.randomUUID());
      onChange([
        ...fields,
        {
          id: committedId,
          name: "",
          type: "string",
          required: false,
          description: "",
          example: "",
          scope,
          status: responseScope ? status : undefined,
          ...patch,
        },
      ]);
      return;
    }
    onChange(
      fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    );
  }
  function descendantsOf(id: string): Set<string> {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const field of fields)
        if (field.parentId && ids.has(field.parentId) && !ids.has(field.id)) {
          ids.add(field.id);
          changed = true;
        }
    }
    return ids;
  }
  function isArrayItemsField(field: DefinitionField): boolean {
    if (!field.parentId) return false;
    return fields.some((parent) => parent.id === field.parentId && parent.type === "array");
  }
  function addChild(parent: DefinitionField) {
    if (!definitionScopeSupportsChildren(parent.scope)) return;
    const nextFields = parent.type === "object"
      ? fields
      : fields.map((field) => field.id === parent.id ? { ...field, type: "object" } : field);
    onChange([
      ...nextFields,
      {
        id: crypto.randomUUID(),
        parentId: parent.id,
        name: "",
        type: "string",
        required: false,
        description: "",
        example: "",
        scope: parent.scope,
        status: parent.status,
      },
    ]);
  }
  const scope =
    `${area === "response" ? "response" : "request"}.${area === "response" ? responsePart : requestPart}` as DefinitionScope;
  const responseScope = area === "response";
  const scoped =
    area === "security"
      ? []
      : fields.filter(
          (field) =>
            field.scope === scope &&
            (!responseScope || (field.status || "200") === status),
        );
  const visible: Array<{ field: DefinitionField; depth: number }> = [];
  const appendBranch = (parentId: string | undefined, depth: number) =>
    scoped
      .filter(
        (field) =>
          field.parentId === parentId ||
          (!parentId &&
            field.parentId &&
            !scoped.some((item) => item.id === field.parentId)),
      )
      .forEach((field) => {
        visible.push({ field, depth });
        appendBranch(field.id, depth + 1);
      });
  appendBranch(undefined, 0);
  const fieldResponseStatuses = fields
    .filter((field) => field.scope.startsWith("response."))
    .map((field) => field.status || "200");
  useEffect(() => {
    setResponseStatuses((current) => [...new Set([...current, "200", ...fieldResponseStatuses])]);
  }, [fieldResponseStatuses.join("\u0000")]);
  const normalizedNewStatus = newStatus.trim();
  const validNewStatus = /^(?:[1-5]\d{2}|default)$/i.test(normalizedNewStatus);
  const requestTabs = [
    ["params", "参数"],
    ["headers", "Headers"],
    ["cookies", "Cookies"],
    ["body", "Body"],
  ] as const;
  const responseTabs = [
    ["headers", "Headers"],
    ["cookies", "Cookies"],
    ["body", "Body"],
  ] as const;
  return (
    <div className="interface-visual-editor">
      <div
        className="interface-contract-primary"
        role="tablist"
        aria-label="接口定义区域"
      >
        <button
          type="button"
          role="tab"
          aria-selected={area === "request"}
          className={area === "request" ? "is-active" : ""}
          onClick={() => setArea("request")}
        >
          请求
          <small>
            {
              fields.filter((field) => field.scope.startsWith("request."))
                .length
            }
          </small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={area === "response"}
          className={area === "response" ? "is-active" : ""}
          onClick={() => setArea("response")}
        >
          响应
          <small>
            {
              fields.filter((field) => field.scope.startsWith("response."))
                .length
            }
          </small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={area === "security"}
          className={area === "security" ? "is-active" : ""}
          onClick={() => setArea("security")}
        >
          安全与约权
        </button>
      </div>
      {area === "response" ? (
        <div className="interface-response-scenes" aria-label="响应场景">
          {responseStatuses.map((item) => (
            <button
              type="button"
              key={item}
              className={status === item ? "is-active" : ""}
              onClick={() => setStatus(item)}
            >
              <b>{item}</b>
              <span>
                {item.startsWith("2")
                  ? "成功"
                  : item === "400"
                    ? "参数错误"
                    : item === "401"
                      ? "未授权"
                      : item === "404"
                        ? "未找到"
                        : item.startsWith("5")
                          ? "服务异常"
                          : "响应"}
              </span>
            </button>
          ))}
          <label>
            <input
              aria-label="新增响应状态码"
              value={newStatus}
              onChange={(event) => setNewStatus(event.target.value.replace(/\s/g, ""))}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !validNewStatus) return;
                event.preventDefault();
                const next = normalizedNewStatus.toLowerCase() === "default" ? "default" : normalizedNewStatus;
                setResponseStatuses((items) => items.includes(next) ? items : [...items, next]);
                setStatus(next);
                setNewStatus("");
              }}
              aria-invalid={Boolean(normalizedNewStatus) && !validNewStatus}
              title={normalizedNewStatus && !validNewStatus ? "请输入 100–599，或 default" : "支持 100–599 和 default"}
              placeholder="如 201、400"
              inputMode="numeric"
            />
            <button
              type="button"
              disabled={!validNewStatus}
              onClick={() => {
                const next = normalizedNewStatus.toLowerCase() === "default" ? "default" : normalizedNewStatus;
                setResponseStatuses((items) => items.includes(next) ? items : [...items, next]);
                setStatus(next);
                setNewStatus("");
              }}
            >
              + 新响应
            </button>
          </label>
        </div>
      ) : null}
      {area !== "security" ? (
        <div
          className="interface-contract-nav"
          role="tablist"
          aria-label={area === "request" ? "请求内容" : "响应内容"}
        >
          {(area === "request" ? requestTabs : responseTabs).map(
            ([id, label]) => {
              const tabScope = `${area}.${id}` as DefinitionScope;
              const count = fields.filter(
                (field) =>
                  field.scope === tabScope &&
                  (area !== "response" || (field.status || "200") === status),
              ).length;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={
                    (area === "request" ? requestPart : responsePart) === id
                  }
                  className={
                    (area === "request" ? requestPart : responsePart) === id
                      ? "is-active"
                      : ""
                  }
                  key={id}
                  onClick={() =>
                    area === "request"
                      ? setRequestPart(id as typeof requestPart)
                      : setResponsePart(id as typeof responsePart)
                  }
                >
                  {label}
                  <small>{count}</small>
                </button>
              );
            },
          )}
        </div>
      ) : null}
      {area === "request" && requestPart === "body" ? (
        <div
          className="interface-body-mode-design"
          role="group"
          aria-label="请求 Body 类型"
        >
          <strong>Body 类型</strong>
          <div>
            {BODY_DESIGN_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={bodyMode === item.id ? "is-active" : ""}
                onClick={() => onBodyModeChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <small>
            {bodyMode === "none"
              ? "此接口不发送请求体"
              : bodyMode === "form-data"
                ? "字段可使用 Text 或 File 类型"
                : bodyMode === "urlencoded"
                  ? "字段将编码为键值对"
                  : bodyMode === "binary"
                    ? "请求体为单个二进制文件"
                    : `Content-Type: ${BODY_DESIGN_MODES.find((item) => item.id === bodyMode)?.contentType ?? "自定义"}`}
          </small>
        </div>
      ) : null}
      {area === "security" ? (
        <div className="interface-security-design">
          <section className="interface-security-card">
            <header><Icon name="settings" /><div><strong>认证方式</strong><small>定义调用接口时使用的身份凭证</small></div></header>
            <div className="interface-security-grid">
              <label>认证方案<select value={security.authScheme} onChange={(event) => onSecurityChange({ ...security, authScheme: event.target.value as SecurityAuthScheme })}><option value="none">无需认证</option><option value="bearer">Bearer Token</option><option value="apiKey">API Key</option><option value="basic">Basic Auth</option><option value="oauth2">OAuth 2.0</option></select></label>
              {security.authScheme === "apiKey" ? <><label>参数名称<input value={security.apiKeyName} onChange={(event) => onSecurityChange({ ...security, apiKeyName: event.target.value })} placeholder="X-Api-Key" /></label><label>传递位置<select value={security.apiKeyIn} onChange={(event) => onSecurityChange({ ...security, apiKeyIn: event.target.value as SecurityDesignConfig["apiKeyIn"] })}><option value="header">Header</option><option value="query">Query</option><option value="cookie">Cookie</option></select></label></> : null}
              {security.authScheme === "oauth2" ? <label className="is-wide">权限范围<input value={security.scopes} onChange={(event) => onSecurityChange({ ...security, scopes: event.target.value })} placeholder="例如 users:read, users:write" /></label> : null}
            </div>
          </section>
          <section className="interface-security-card">
            <header><Icon name="sliders" /><div><strong>访问约束</strong><small>记录网关、Mock 和校验可复用的限制</small></div></header>
            <div className="interface-security-grid">
              <label>请求频率<input type="number" min="0" title="0 表示不限制" aria-description="0 表示不限制" value={security.rateLimit} onChange={(event) => onSecurityChange({ ...security, rateLimit: Math.max(0, Number(event.target.value)) })} /></label>
              <label>统计窗口<select value={security.rateWindow} onChange={(event) => onSecurityChange({ ...security, rateWindow: event.target.value as SecurityDesignConfig["rateWindow"] })}><option value="second">每秒</option><option value="minute">每分钟</option><option value="hour">每小时</option></select></label>
              <label>Body 上限（KB）<input type="number" min="0" title="0 表示不限制" aria-description="0 表示不限制" value={security.maxBodyKb} onChange={(event) => onSecurityChange({ ...security, maxBodyKb: Math.max(0, Number(event.target.value)) })} /></label>
              <div className="interface-security-toggle-field"><span>传输安全</span><label className="interface-security-toggle" title="拒绝不安全的明文传输"><input type="checkbox" checked={security.requireHttps} onChange={(event) => onSecurityChange({ ...security, requireHttps: event.target.checked })} /><span><b>仅允许 HTTPS</b></span></label></div>
            </div>
          </section>
        </div>
      ) : area === "request" &&
        requestPart === "body" &&
        (bodyMode === "none" || bodyMode === "binary") ? (
        <div className="interface-body-mode-empty">
          <Icon name={bodyMode === "binary" ? "archive" : "code"} />
          <strong>
            {bodyMode === "binary" ? "Binary 请求体" : "无请求体"}
          </strong>
          <p>
            {bodyMode === "binary"
              ? "调试时、择要上传的文件；设计中记录 Content-Type 和二进制约束。"
              : "选择其他 Body 类型后可继续设计字段与示例。"}
          </p>
        </div>
      ) : (
        <>
          <div className="interface-definition-kv http-kv-editor" aria-label="接口字段">
            <div className="http-param-header">
              <span /><span>字段名称</span><span>示例值</span>
              <span className="http-type-header"><span>类型</span></span>
              <span /><span>说明</span><span>操作</span>
            </div>
            {[
              ...visible.map((item) => ({ ...item, draft: false })),
              { field: { id: draftFieldId, name: "", type: "string", required: false, description: "", example: "", scope, status: responseScope ? status : undefined } satisfies DefinitionField, depth: 0, draft: true },
            ].map(({ field, depth, draft }) => (
              <div className={`http-param-row http-apifox-row${draft ? " is-new" : " has-content is-entry"}${depth ? " is-child" : ""}`} data-depth={depth} key={field.id}>
                <span className="interface-field-spacer" aria-hidden="true" />
                <div className="http-param-name-cell interface-field-name-cell" style={{ paddingLeft: `${depth * 24}px` }}>
                  {depth ? <span className="interface-field-branch" aria-hidden="true" /> : null}
                  {isArrayItemsField(field) ? (
                    <code className="interface-array-items-label">items</code>
                  ) : (
                    <input aria-label="字段名称" value={field.name} onChange={(event) => update(field.id, { name: event.target.value })} placeholder={draft ? "添加字段" : ""} spellCheck={false} />
                  )}
                </div>
                <div className="http-param-value-cell">
                  <input aria-label={`${field.name || "字段"} 示例值`} value={field.example ?? ""} onChange={(event) => update(field.id, { example: event.target.value })} placeholder="" spellCheck={false} />
                </div>
                <div className="http-param-type-cell">
                  <select className="http-param-type" aria-label={`${field.name || "字段"} 类型`} value={FIELD_TYPES.includes(field.type) ? field.type : "object"} onChange={(event) => draft ? update(field.id, { type: event.target.value }) : onChange(changeDefinitionFieldType(fields, field.id, event.target.value))}>
                    {FIELD_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </div>
                <span className="http-required-row">
                  <button type="button" className={field.required ? "is-required" : ""} aria-pressed={field.required} aria-label={`${field.name || "字段"} ${field.required ? "取消必填" : "设为必填"}`} title={field.required ? "取消必填" : "设为必填"} onClick={() => update(field.id, { required: !field.required })}>*</button>
                </span>
                <input aria-label={`${field.name || "字段"} 说明`} value={field.description} onChange={(event) => update(field.id, { description: event.target.value })} placeholder="" />
                <div className="interface-field-actions">
                  {(field.type === "object" || isArrayItemsField(field)) && definitionScopeSupportsChildren(field.scope) && !draft ? (
                    <button type="button" className="interface-field-child-add ui-icon-button compact" aria-label={`为 ${field.name || "Object"} 添加子字段`} title="添加子字段" onClick={() => addChild(field)}><Icon name="plus" /></button>
                  ) : null}
                  {!draft ? (
                    <button type="button" className="http-kv-delete" aria-label={`删除 ${field.name}`} title="删除字段" onClick={() => { const removed = descendantsOf(field.id); onChange(fields.filter((item) => !removed.has(item.id))); }}><Icon name="trash" /></button>
                  ) : <span className="http-kv-delete-placeholder" aria-hidden="true" />}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StructurePanel({ fields }: { fields: DefinitionField[] }) {
  const renderFields = (items: DefinitionField[], parentId?: string, depth = 0): ReactNode => items
    .filter((field) => field.parentId === parentId)
    .map((field) => {
      const children = items.filter((item) => item.parentId === field.id);
      return <div key={field.id} className="interface-structure-field">
        <div role="treeitem" aria-level={depth + 3} className="interface-structure-node" style={{ "--structure-depth": depth } as CSSProperties}>
          <span className="interface-structure-branch" />
          <Icon name={children.length || field.type === "object" || field.type === "array" ? "folder" : "code"} />
          <span title={field.name || "未命名字段"}>{field.name || "未命名字段"}</span>
          {field.required ? <em>必填</em> : null}<small>{field.type}</small>
        </div>
        {children.length ? <div role="group">{renderFields(items, field.id, depth + 1)}</div> : null}
      </div>;
    });
  const renderScope = (scope: DefinitionScope, label: string, status?: string) => {
    const scoped = fields.filter((field) => field.scope === scope && (!status || (field.status || "200") === status));
    if (!scoped.length) return null;
    return <details className="interface-structure-group" open key={`${scope}-${status ?? ""}`}><summary><span>{label}</span><small>{scoped.length}</small></summary><div role="group">{renderFields(scoped)}</div></details>;
  };
  const requestCount = fields.filter((field) => field.scope.startsWith("request.")).length;
  const responseCount = fields.filter((field) => field.scope.startsWith("response.")).length;
  const responseStatuses = [...new Set(fields.filter((field) => field.scope.startsWith("response.")).map((field) => field.status || "200"))];
  const responseStatusMeta = (value: string) => {
    if (value === "default") return { tone: "default", label: "默认响应" };
    if (value.startsWith("2")) return { tone: "success", label: "成功响应" };
    if (value.startsWith("3")) return { tone: "redirect", label: "重定向" };
    if (value.startsWith("4")) return { tone: "client-error", label: "客户端错误" };
    if (value.startsWith("5")) return { tone: "server-error", label: "服务端错误" };
    return { tone: "info", label: "信息响应" };
  };
  return (
    <aside className="interface-structure-panel" aria-label="接口结构">
      <header>
        <Icon name="network" />
        <strong>接口结构</strong>
        <small>{fields.length} 个字段</small>
      </header>
      <div className="interface-structure-tree" role="tree">
        {requestCount ? <details className="interface-structure-section" open><summary><Icon name="send" /><strong>请求</strong><small>{requestCount}</small></summary><div>{renderScope("request.params", "Query / Path 参数")}{renderScope("request.headers", "Headers")}{renderScope("request.cookies", "Cookies")}{renderScope("request.body", "Body")}</div></details> : null}
        {responseCount ? <details className="interface-structure-section" open><summary><Icon name="archive" /><strong>响应</strong><small>{responseCount}</small></summary><div>{responseStatuses.map((status) => { const meta = responseStatusMeta(status); return <details className={`interface-structure-status is-${meta.tone}`} open key={status}><summary><b>{status}</b><span>{meta.label}</span></summary><div>{renderScope("response.headers", "Headers", status)}{renderScope("response.cookies", "Cookies", status)}{renderScope("response.body", "Body", status)}</div></details>; })}</div></details> : null}
        {!fields.length ? (
          <p>保存或导入定义后，这里会展示请求、响应和错误结构。</p>
        ) : null}
      </div>
    </aside>
  );
}

function documentOperation(content: string, workbenchId: string, request: HttpDebugDraft | null) {
  if (workbenchId === "http" && request?.url?.trim())
    return { method: request.method?.toUpperCase() || "HTTP", path: request.url.trim(), live: true };
  if (workbenchId !== "http")
    return { method: workbenchId.toUpperCase(), path: "Current operation", live: false };
  const lines = content.split(/\r?\n/);
  const pathsIndex = lines.findIndex((line) => /^\s*paths\s*:\s*$/.test(line));
  if (pathsIndex < 0) return { method: "HTTP", path: "/current", live: false };
  for (let index = pathsIndex + 1; index < lines.length; index += 1) {
    const pathMatch = lines[index].match(/^\s{2}([^\s][^:]*)\s*:\s*$/);
    if (!pathMatch) continue;
    const path = pathMatch[1].replace(/^['"]|['"]$/g, "");
    for (let operationIndex = index + 1; operationIndex < lines.length; operationIndex += 1) {
      const methodMatch = lines[operationIndex].match(/^\s{4}(get|post|put|patch|delete|head|options|trace)\s*:\s*$/i);
      if (methodMatch) return { method: methodMatch[1].toUpperCase(), path, live: false };
      if (/^\s{2}\S/.test(lines[operationIndex])) break;
    }
  }
  return { method: "HTTP", path: "/current", live: false };
}

interface DocumentAuthRef {
  kind?: string;
  header_name?: string | null;
  token_url?: string | null;
  authorization_url?: string | null;
  scope?: string | null;
  audience?: string | null;
}

function documentAuth(request: HttpDebugDraft | null, policy: SecurityDesignConfig) {
  const auth = (request?.auth ?? null) as DocumentAuthRef | null;
  const kind = auth?.kind && auth.kind !== "none" ? auth.kind : policy.authScheme;
  const labels: Record<string, string> = {
    none: "无需认证", bearer: "Bearer Token", basic: "Basic Auth", api_key: "API Key",
    apiKey: "API Key", oauth2: "OAuth 2.0", oauth2_client_credentials: "OAuth 2.0 Client Credentials",
    oauth2_authorization_code: "OAuth 2.0 Authorization Code",
  };
  return {
    kind: kind || "none",
    label: labels[kind || "none"] ?? kind,
    apiKeyName: auth?.header_name || policy.apiKeyName,
    apiKeyIn: auth?.kind === "api_key" ? "header" : policy.apiKeyIn,
    tokenUrl: auth?.token_url,
    authorizationUrl: auth?.authorization_url,
    scopes: auth?.scope || policy.scopes,
    audience: auth?.audience,
  };
}

function fieldExample(field: DefinitionField) {
  if (field.example) return field.example;
  if (field.type === "boolean") return "true";
  if (["integer", "number"].includes(field.type)) return "0";
  if (field.type === "array") return "[]";
  if (field.type === "object") return "{}";
  return '"string"';
}

function documentExampleValue(field: DefinitionField): unknown {
  const raw = field.example?.trim();
  if (raw) {
    try { return JSON.parse(raw); } catch { return raw.replace(/^['"]|['"]$/g, ""); }
  }
  if (field.type === "boolean") return true;
  if (field.type === "integer" || field.type === "number") return 0;
  if (field.type === "array") return [];
  if (field.type === "object") return {};
  return "string";
}

export function buildDocumentObjectExample(fields: DefinitionField[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const objects = new Map<string, Record<string, unknown>>();
  for (const field of fields) {
    if (!field.name) continue;
    const parent = field.parentId ? objects.get(field.parentId) : result;
    if (!parent) continue;
    const value = documentExampleValue(field);
    parent[field.name] = value;
    if (field.type === "object" && value && typeof value === "object" && !Array.isArray(value))
      objects.set(field.id, value as Record<string, unknown>);
  }
  return result;
}

function DocumentCodeExample({ title, language, value }: { title: string; language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return <div className="interface-document-code">
    <header><div><strong>{title}</strong><span>{language}</span></div><button type="button" onClick={() => void copy()} aria-label={`复制${title}`}><Icon name="copy" />{copied ? "已复制" : "复制"}</button></header>
    <pre><code>{value}</code></pre>
  </div>;
}

function DocumentPreviewPanel({
  client,
  projectId,
  requestId,
  workbenchId,
  title,
  onOpenDesign,
}: {
  client: InterfaceDefinitionClient;
  projectId: string;
  requestId: string;
  workbenchId: string;
  title: string;
  onOpenDesign: () => void;
}) {
  const [definition, setDefinition] = useState<ApiDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([client.list(projectId), client.binding(requestId)])
      .then(([items, binding]) => {
        if (active)
          setDefinition(
            items.find((item) => item.id === binding?.definitionId) ?? null,
          );
      })
      .catch((reason) => {
        if (active) setError(readableDefinitionError(reason, "文档加载失败"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, projectId, requestId]);
  if (loading)
    return (
      <div className="interface-lifecycle-empty" role="status">
        <span>
          <Icon name="copy" />
        </span>
        <strong>正在生成文档预览…</strong>
      </div>
    );
  if (!definition)
    return (
      <div className="interface-lifecycle-empty">
        <span>
          <Icon name="copy" />
        </span>
        <strong>暂无可预览的接口文档</strong>
        <p>{error || "请先在“设计”中补充请求、响应和字段说明。"}</p>
        <button
          type="button"
          className="ui-button primary"
          onClick={onOpenDesign}
        >
          <Icon name="code" />
          前往设计
        </button>
      </div>
    );
  const fields = parseDefinitionFields(definition.content, workbenchId);
  const request = workbenchId === "http" ? readWorkbenchDraft<HttpDebugDraft>("http") : null;
  const security = parseSecurityDesign(definition.content);
  const auth = documentAuth(request, security);
  const operation = documentOperation(definition.content, workbenchId, request);
  const requestFields = fields.filter((field) => field.scope.startsWith("request."));
  const requestParameterFields = requestFields.filter((field) => field.scope !== "request.body");
  const responseFields = fields.filter((field) => field.scope.startsWith("response."));
  const responseStatuses = [...new Set(responseFields.map((field) => field.status || "200"))];
  const requestBodyFields = requestFields.filter((field) => field.scope === "request.body");
  const requestBodyExample = buildDocumentObjectExample(requestBodyFields);
  return (
    <article className="interface-document-preview">
      <header className="interface-document-toolbar">
        <div>
          <strong>文档预览</strong>
          <span>只读 · 与接口设计同步</span>
        </div>
        <div>
          <button
            type="button"
            className="ui-button secondary"
            onClick={onOpenDesign}
          >
            <Icon name="code" />
            编辑设计
          </button>
        </div>
      </header>
      <div className="interface-document-page">
        <div className="interface-document-heading">
          <span className="interface-document-kicker">API REFERENCE</span>
          <h1>{title}</h1>
          <p>接口定义、请求参数与响应模型的标准参考文档。</p>
          <div className="interface-document-meta">
            <span>{definition.format}</span>
            {workbenchId === "http" ? <span>OpenAPI {detectOpenApiVersion(definition.content)}</span> : null}
            <time dateTime={definition.updatedAt}>更新于 {new Date(definition.updatedAt).toLocaleDateString()}</time>
          </div>
        </div>

        <section className="interface-document-section" aria-labelledby="document-endpoint-title">
          <h2 id="document-endpoint-title">端点</h2>
          <div className="interface-document-endpoint">
            <b data-method={operation.method}>{operation.method}</b>
            <code>{operation.path}</code>
          </div>
          <p className="interface-document-description">{operation.live ? "端点来自当前请求配置。" : "端点来自接口定义。"} 调用此端点以执行“{title}”操作。</p>
        </section>

        <section className="interface-document-section" aria-labelledby="document-security-title">
          <h2 id="document-security-title">安全策略</h2>
          <div className="interface-document-security">
            <div><span>认证方式</span><strong>{auth.label}</strong><small>{auth.kind === "none" ? "调用时不需要提供身份凭证" : "凭证值已隐藏，不会写入文档"}</small></div>
            {auth.kind === "api_key" || auth.kind === "apiKey" ? <div><span>凭证位置</span><strong><code>{auth.apiKeyName}</code> · {auth.apiKeyIn}</strong><small>通过指定位置传递 API Key</small></div> : null}
            {auth.tokenUrl ? <div><span>Token Endpoint</span><strong><code>{auth.tokenUrl}</code></strong></div> : null}
            {auth.authorizationUrl ? <div><span>Authorization Endpoint</span><strong><code>{auth.authorizationUrl}</code></strong></div> : null}
            {auth.scopes ? <div><span>权限范围</span><strong>{auth.scopes}</strong></div> : null}
            {auth.audience ? <div><span>Audience</span><strong>{auth.audience}</strong></div> : null}
            <div><span>传输安全</span><strong>{security.requireHttps ? "仅允许 HTTPS" : "允许 HTTP / HTTPS"}</strong><small>{request?.tlsVerify === false ? "当前请求已关闭 TLS 证书校验" : "当前请求启用 TLS 证书校验"}</small></div>
            <div><span>请求频率</span><strong>{security.rateLimit > 0 ? `${security.rateLimit} 次 / ${security.rateWindow === "second" ? "秒" : security.rateWindow === "hour" ? "小时" : "分钟"}` : "未限制"}</strong></div>
            <div><span>请求体上限</span><strong>{security.maxBodyKb > 0 ? `${security.maxBodyKb} KB` : "未限制"}</strong></div>
          </div>
        </section>

        <section className="interface-document-section" aria-labelledby="document-request-parameters-title">
          <h2 id="document-request-parameters-title">请求参数</h2>
          {requestParameterFields.length ? <DocumentFieldTable fields={requestParameterFields} /> : <p className="interface-document-empty">此端点没有定义 Path、Query、Header 或 Cookie 参数。</p>}
          <div className="interface-document-subsection">
            <h3>请求体</h3>
            {requestBodyFields.length ? <>
              <DocumentFieldTable fields={requestBodyFields} />
              <DocumentCodeExample title="请求体示例" language="application/json" value={JSON.stringify(requestBodyExample, null, 2)} />
            </> : <p className="interface-document-empty">此端点没有定义请求体。</p>}
            <p className="interface-document-description">字段与示例均来自 OpenAPI <code>requestBody</code>；优先使用 <code>example</code>，未提供时根据 Schema 生成占位值。</p>
          </div>
        </section>

        <section className="interface-document-section" aria-labelledby="document-responses-title">
          <h2 id="document-responses-title">响应</h2>
          {responseStatuses.length ? responseStatuses.map((status) => {
            const statusFields = responseFields.filter((field) => (field.status || "200") === status);
            return <div className="interface-document-response" key={status}>
              <header><code>{status}</code><span>{status.startsWith("2") ? "成功响应" : "响应"}</span></header>
              <div className="interface-document-response-content">
                <DocumentFieldTable fields={statusFields} />
                <DocumentCodeExample title="响应体" language="application/json" value={JSON.stringify(buildDocumentObjectExample(statusFields.filter((field) => field.scope === "response.body")), null, 2)} />
              </div>
            </div>;
          }) : <p className="interface-document-empty">此端点尚未定义响应模型。</p>}
        </section>

      </div>
    </article>
  );
}

function DocumentFieldTable({ fields }: { fields: DefinitionField[] }) {
  return <div className="interface-document-table" role="table" aria-label="字段定义">
    <div className="is-heading" role="row"><span>字段</span><span>位置</span><span>类型</span><span>说明</span></div>
    {fields.map((field) => <div key={field.id} role="row">
      <div><code>{field.name || "未命名字段"}</code>{field.required ? <small>必填</small> : null}</div>
      <span>{SCOPE_LABELS.find(([scope]) => scope === field.scope)?.[1] ?? field.scope}</span>
      <code>{field.type}</code>
      <span>{field.description || <span className="interface-document-muted">暂无说明</span>}<code className="interface-document-example">示例：{fieldExample(field)}</code></span>
    </div>)}
  </div>;
}

function LifecycleEmptyState({
  tab,
  workbenchId,
  sessionId,
}: {
  tab: Exclude<InterfaceLifecycleTab, "debug">;
  workbenchId: string;
  sessionId: string;
}) {
  const copy = EMPTY_COPY[tab];
  return (
    <div className="interface-lifecycle-empty">
      <span>
        <Icon name={TABS[tab].icon} />
      </span>
      <strong>{copy.title}</strong>
      <p>{copy.description}</p>
      <button
        type="button"
        className="ui-button primary"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent(copy.event, { detail: { workbenchId, sessionId } }),
          )
        }
      >
        <Icon name="plus" />
        {copy.action}
      </button>
    </div>
  );
}
