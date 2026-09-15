import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, LoadingState, useFeedback } from "./Feedback";
import { Button, Checkbox, Field, IconButton, InlineAlert, SegmentedControl, Select, StatusBadge, Textarea, TextInput } from "./Components";
import { ModalFrame } from "./ModalFrame";
import { buildMockResponseBody, inferMockScenario, selectMockResponse, type MockDraftSeed, type MockResponseSource, type MockScenarioTemplate, type MockSeedResponse } from "./mockGeneration";

export interface MockRule {
  id: string;
  source?: "custom" | "design";
  projectKey: string;
  serviceKey: string;
  operationId?: string | null;
  responseId?: string | null;
  enabled: boolean;
  name: string;
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  matchConditions: {
    query: Record<string, string>;
    headers: Record<string, string>;
    cookies: Record<string, string>;
    bodyContains?: string | null;
  };
  delayMs: number;
  errorEvery?: number | null;
  priority: number;
  wsMessages: string[];
  wsEcho: boolean;
  wsIntervalMs: number;
}

export interface MockServerStatus {
  running: boolean;
  bind: string;
  requestCount: number;
  activeWebsockets: number;
  lastError?: string | null;
}

export type MockRuleInput = Omit<MockRule, "id">;
export type InterfaceMockSeed = MockDraftSeed & { projectKey?: string; serviceKey?: string; operationId?: string; persisted?: boolean };

export interface MockWorkbenchProps {
  baseUrl: string;
  onList: () => Promise<MockRule[]>;
  onCreate: (rule: MockRuleInput) => Promise<void>;
  onUpdate: (id: string, rule: MockRuleInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onStatus: () => Promise<MockServerStatus>;
  onStart: (bind: string, allowRemote: boolean) => Promise<MockServerStatus>;
  onStop: () => Promise<MockServerStatus>;
  projectKey?: string;
  serviceKey?: string;
  variant?: "project" | "interface";
  contextSeed?: InterfaceMockSeed;
}

interface MockRuleDraft {
  name: string;
  method: string;
  path: string;
  status: number;
  priority: number;
  headers: string;
  body: string;
  delayMs: number;
  errorEvery: number;
  wsMessages: string;
  wsEcho: boolean;
  wsIntervalMs: number;
  matchQuery: string;
  matchHeaders: string;
  matchCookies: string;
  bodyContains: string;
}

const NEW_RULE: MockRuleDraft = {
  name: "Example mock",
  method: "GET",
  path: "/example",
  status: 200,
  priority: 0,
  headers: '{\n  "Content-Type": "application/json"\n}',
  body: '{"ok":true}',
  delayMs: 0,
  errorEvery: 0,
  wsMessages: "connected",
  wsEcho: true,
  wsIntervalMs: 250,
  matchQuery: "{}",
  matchHeaders: "{}",
  matchCookies: "{}",
  bodyContains: "",
};

export function parseMockHeaders(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("响应头必须是 JSON 对象");
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(parsed)) {
    if (!name.trim() || typeof headerValue !== "string") throw new Error("响应头名称和值都必须是字符串");
    headers[name] = headerValue;
  }
  return headers;
}

function parseMatchRecord(value: string, label: string): Record<string, string> {
  try { return parseMockHeaders(value); }
  catch { throw new Error(`${label}必须是键和值均为字符串的 JSON 对象`); }
}

function draftFromRule(rule: MockRule): MockRuleDraft {
  return {
    ...rule,
    headers: JSON.stringify(rule.headers, null, 2),
    errorEvery: rule.errorEvery ?? 0,
    wsMessages: rule.wsMessages.join("\n"),
    matchQuery: JSON.stringify(rule.matchConditions.query, null, 2),
    matchHeaders: JSON.stringify(rule.matchConditions.headers, null, 2),
    matchCookies: JSON.stringify(rule.matchConditions.cookies, null, 2),
    bodyContains: rule.matchConditions.bodyContains ?? "",
  };
}

function inputFromRule(rule: MockRule): MockRuleInput {
  const { id: _id, ...input } = rule;
  return input;
}

function mockBaseUrl(status: MockServerStatus | null): string {
  const bind = status?.bind || "127.0.0.1:39218";
  const reachableBind = bind.startsWith("0.0.0.0:")
    ? bind.replace("0.0.0.0:", "127.0.0.1:")
    : bind.startsWith("[::]:") ? bind.replace("[::]:", "[::1]:") : bind;
  return `http://${reachableBind}`;
}

function requestUrl(baseUrl: string, rule: Pick<MockRule, "method" | "path" | "projectKey" | "serviceKey" | "operationId">): string {
  const root = baseUrl.replace(/\/$/, "");
  const schemeRoot = rule.method === "WS" ? root.replace(/^http/, "ws") : root;
  return `${schemeRoot}/m1/${encodeURIComponent(rule.projectKey)}/${encodeURIComponent(rule.serviceKey)}${rule.path}`;
}

function statusTone(status: number): "success" | "info" | "warning" | "danger" {
  if (status >= 500) return "danger";
  if (status >= 400) return "warning";
  if (status >= 300) return "info";
  return "success";
}

function responseStatus(response: MockSeedResponse | undefined, template: MockScenarioTemplate): number {
  const parsed = Number(response?.statusCode);
  if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 999) return parsed;
  return template === "error" ? 500 : 200;
}

export function MockWorkbench({ onList, onCreate, onUpdate, onDelete, onStatus, onStart, onStop, projectKey = "default-project", serviceKey = "default", variant = "project", contextSeed }: MockWorkbenchProps) {
  const { confirm, notify } = useFeedback();
  const [rules, setRules] = useState<MockRule[]>([]);
  const [draft, setDraft] = useState<MockRuleDraft>(NEW_RULE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<MockServerStatus | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverBind, setServerBind] = useState("127.0.0.1:39218");
  const [seed, setSeed] = useState<InterfaceMockSeed | null>(null);
  const [responseSource, setResponseSource] = useState<MockResponseSource>("smart");
  const [scenarioTemplate, setScenarioTemplate] = useState<MockScenarioTemplate>("success");
  const [selectedResponseId, setSelectedResponseId] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ruleId: string; status: number; matchedRuleId?: string; body: string } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [responseTab, setResponseTab] = useState<"body" | "headers">("body");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const editingRule = useMemo(() => rules.find((rule) => rule.id === editingId), [editingId, rules]);
  const visibleRules = useMemo(() => rules.filter((rule) => {
    if (rule.source === "design") return false;
    const seedProject = contextSeed?.projectKey ?? projectKey;
    const seedService = contextSeed?.serviceKey ?? serviceKey;
    if (rule.projectKey !== seedProject || rule.serviceKey !== seedService) return false;
    if (!contextSeed) return true;
    return contextSeed.operationId && rule.operationId
      ? rule.operationId === contextSeed.operationId
      : rule.method === contextSeed.method && rule.path === contextSeed.path;
  }), [contextSeed, projectKey, rules, serviceKey]);
  const enabledVisibleRules = visibleRules.filter((rule) => rule.enabled);
  const highestVisiblePriority = enabledVisibleRules.length ? Math.max(...enabledVisibleRules.map((rule) => rule.priority)) : -1;
  const leadingRules = variant === "interface" ? visibleRules.filter((rule) => rule.enabled && rule.priority === highestVisiblePriority) : [];
  const priorityConflict = leadingRules.length > 1;
  const activeRuleId = leadingRules.length === 1 ? leadingRules[0].id : null;
  const matchedTestRule = testResult?.matchedRuleId ? rules.find((rule) => rule.id === testResult.matchedRuleId) : undefined;

  async function refresh() {
    setLoading(true);
    setLoadError("");
    try {
      const loaded = await onList();
      setRules(loaded.map((rule) => ({
        ...rule,
        projectKey: rule.projectKey ?? projectKey,
        serviceKey: rule.serviceKey ?? serviceKey,
        enabled: rule.enabled !== false,
        matchConditions: rule.matchConditions ?? { query: {}, headers: {}, cookies: {}, bodyContains: null },
      })));
    }
    catch (error) { setLoadError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }

  async function refreshServerStatus() {
    try {
      const status = await onStatus();
      setServerStatus(status);
      setServerBind(status.bind);
    } catch (error) {
      setServerStatus({ running: false, bind: serverBind, requestCount: 0, activeWebsockets: 0, lastError: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => { void Promise.all([refresh(), refreshServerStatus()]); }, []);

  async function toggleServer() {
    setServerBusy(true);
    try {
      if (serverStatus?.running) {
        setServerStatus(await onStop());
        notify("Mock 服务已停止", "success");
      } else {
        const address = serverBind.trim();
        const remote = !address.startsWith("127.0.0.1:") && !address.startsWith("localhost:") && !address.startsWith("[::1]:");
        if (remote) {
          const accepted = await confirm({ title: "允许局域网访问 Mock？", description: "该监听地址可能向同一网络中的其他设备暴露 Mock 响应，请确认响应中不包含敏感数据。", confirmLabel: "确认并启动", tone: "danger" });
          if (!accepted) return;
        }
        setServerStatus(await onStart(address, remote));
        notify("Mock 服务已启动", "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setServerStatus((current) => ({ running: false, bind: current?.bind || serverBind, requestCount: 0, activeWebsockets: 0, lastError: message }));
      notify(message, "danger");
    } finally { setServerBusy(false); }
  }

  async function toggleRule(rule: MockRule) {
    try {
      await onUpdate(rule.id, { ...inputFromRule(rule), enabled: !rule.enabled });
      await refresh();
      notify(rule.enabled ? "Mock 场景已停用" : "Mock 场景已启用", "success");
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "danger"); }
  }

  function updateDraft<K extends keyof MockRuleDraft>(key: K, value: MockRuleDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError("");
  }

  function startCreate() {
    if (contextSeed) {
      const inferred = inferMockScenario(contextSeed);
      applySeed(contextSeed, inferred.template, "smart", inferred.responseId);
      return;
    }
    setEditingId(null);
    setDraft(NEW_RULE);
    setSeed(null);
    setResponseSource("smart");
    setScenarioTemplate("success");
    setSelectedResponseId("");
    setAdvancedOpen(false);
    setResponseTab("body");
    setEditorOpen(true);
    setFormError("");
    window.requestAnimationFrame(() => { nameInputRef.current?.focus(); nameInputRef.current?.select(); });
  }
  function startEdit(rule: MockRule) { setEditingId(rule.id); setDraft(draftFromRule(rule)); setSeed(null); setResponseSource("custom"); setSelectedResponseId(rule.responseId ?? ""); setAdvancedOpen(Boolean(rule.priority || rule.delayMs || rule.errorEvery)); setResponseTab("body"); setEditorOpen(true); setFormError(""); }

  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
    setSeed(null);
    setFormError("");
  }

  function applySeed(nextSeed: InterfaceMockSeed, template: MockScenarioTemplate = "success", source: MockResponseSource = "smart", responseId?: string) {
    const response = nextSeed.responses.find((item) => item.id === responseId) ?? selectMockResponse(nextSeed.responses, template);
    setEditingId(null);
    setSeed(nextSeed);
    setResponseSource(source);
    setScenarioTemplate(template);
    setSelectedResponseId(response?.id ?? "");
    setAdvancedOpen(false);
    setResponseTab("body");
    setEditorOpen(true);
    setDraft({
      ...NEW_RULE,
      name: `${nextSeed.interfaceName} · ${template === "success" ? "成功" : template === "empty" ? "空数据" : "异常"}`,
      method: nextSeed.method || "GET",
      path: nextSeed.path || "/",
      status: responseStatus(response, template),
      priority: contextSeed ? highestVisiblePriority + 1 : NEW_RULE.priority,
      headers: JSON.stringify({ "Content-Type": response?.contentType || "application/json" }, null, 2),
      body: buildMockResponseBody(response, source, template),
    });
    setFormError("");
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  useEffect(() => {
    if (variant !== "project") return;
    const createRule = (event: Event) => {
      const nextSeed = (event as CustomEvent<{ seed?: InterfaceMockSeed }>).detail?.seed;
      if (nextSeed) applySeed(nextSeed);
      else startCreate();
    };
    window.addEventListener("apivoy-create-mock-rule", createRule);
    return () => window.removeEventListener("apivoy-create-mock-rule", createRule);
  }, [variant]);

  function changeTemplate(template: MockScenarioTemplate) {
    if (!seed) return setScenarioTemplate(template);
    applySeed(seed, template, responseSource === "custom" ? "smart" : responseSource);
  }

  function changeResponseSource(source: MockResponseSource) {
    setResponseSource(source);
    if (!seed || source === "custom") return;
    const response = seed.responses.find((item) => item.id === selectedResponseId) ?? selectMockResponse(seed.responses, scenarioTemplate);
    setDraft((current) => ({ ...current, body: buildMockResponseBody(response, source, scenarioTemplate) }));
  }

  function changeSelectedResponse(responseId: string) {
    if (!seed) return;
    const response = seed.responses.find((item) => item.id === responseId);
    if (!response) return;
    setSelectedResponseId(responseId);
    setDraft((current) => ({
      ...current,
      status: responseStatus(response, scenarioTemplate),
      headers: JSON.stringify({ "Content-Type": response.contentType || "application/json" }, null, 2),
      body: responseSource === "custom" ? current.body : buildMockResponseBody(response, responseSource, scenarioTemplate),
    }));
  }

  async function testRule(rule: MockRule) {
    if (rule.method === "WS") return notify("WebSocket 规则请使用连接工具测试", "info");
    if (!serverStatus?.running) return notify("请先启动 Mock 服务", "info");
    setTestingId(rule.id);
    setTestResult(null);
    try {
      const headers = new Headers({ "X-ApiVoy-Protocol-Api-Version": "1" });
      const token = localStorage.getItem("apivoy-agent-token");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(`${requestUrl(mockBaseUrl(serverStatus), rule)}?apivoyScenarioId=${encodeURIComponent(rule.id)}`, { method: rule.method === "*" ? "GET" : rule.method, headers });
      const body = (await response.text()).slice(0, 1200);
      setTestResult({ ruleId: rule.id, status: response.status, matchedRuleId: response.headers.get("X-ApiVoy-Mock-Scenario") ?? undefined, body });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "danger");
    } finally { setTestingId(null); }
  }

  async function makeCurrent(rule: MockRule) {
    if (!rule.enabled) return notify("请先启用该 Mock 场景", "info");
    setActivatingId(rule.id);
    try {
      await onUpdate(rule.id, { ...inputFromRule(rule), priority: highestVisiblePriority + 1 });
      await refresh();
      setTestResult(null);
      notify(`已将“${rule.name}”设为当前命中场景`, "success");
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "danger"); }
    finally { setActivatingId(null); }
  }

  async function save() {
    const name = draft.name.trim();
    const path = draft.path.trim();
    if (!name) return setFormError("请输入规则名称");
    if (!path) return setFormError("请输入匹配路径");
    if (draft.status < 100 || draft.status > 999) return setFormError("状态码必须在 100 到 999 之间");
    let headers: Record<string, string>;
    let matchQuery: Record<string, string>;
    let matchHeaders: Record<string, string>;
    let matchCookies: Record<string, string>;
    try {
      headers = parseMockHeaders(draft.headers);
      matchQuery = parseMatchRecord(draft.matchQuery, "查询参数");
      matchHeaders = parseMatchRecord(draft.matchHeaders, "请求头");
      matchCookies = parseMatchRecord(draft.matchCookies, "Cookie");
    }
    catch (error) { return setFormError(error instanceof Error ? error.message : String(error)); }
    const rule: MockRuleInput = {
      projectKey: seed?.projectKey ?? contextSeed?.projectKey ?? projectKey,
      serviceKey: seed?.serviceKey ?? contextSeed?.serviceKey ?? serviceKey,
      operationId: seed?.operationId ?? contextSeed?.operationId ?? null,
      responseId: selectedResponseId || null,
      enabled: editingRule?.enabled ?? true,
      name,
      method: draft.method,
      path: path.startsWith("/") ? path : `/${path}`,
      status: draft.status,
      priority: draft.priority,
      headers,
      body: draft.body,
      matchConditions: { query: matchQuery, headers: matchHeaders, cookies: matchCookies, bodyContains: draft.bodyContains.trim() || null },
      delayMs: Math.max(0, draft.delayMs),
      errorEvery: draft.errorEvery > 0 ? draft.errorEvery : null,
      wsMessages: draft.method === "WS" ? draft.wsMessages.split("\n").filter(Boolean) : [],
      wsEcho: draft.method === "WS" && draft.wsEcho,
      wsIntervalMs: Math.max(0, draft.wsIntervalMs),
    };
    setSaving(true);
    setFormError("");
    try {
      if (editingId) await onUpdate(editingId, rule);
      else await onCreate(rule);
      await refresh();
      notify(editingId ? "Mock 规则已更新" : "Mock 规则已创建", "success");
      closeEditor();
    } catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }

  async function remove(rule: MockRule) {
    const accepted = await confirm({ title: "删除 Mock 规则？", description: `“${rule.name}”删除后无法恢复。`, confirmLabel: "删除规则", tone: "danger" });
    if (!accepted) return;
    setDeletingId(rule.id);
    try {
      await onDelete(rule.id);
      if (editingId === rule.id) closeEditor();
      await refresh();
      notify("Mock 规则已删除", "success");
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "danger"); }
    finally { setDeletingId(null); }
  }

  const serviceRoot = mockBaseUrl(serverStatus);
  const contextProjectKey = contextSeed?.projectKey ?? projectKey;
  const contextServiceKey = contextSeed?.serviceKey ?? serviceKey;
  const contextPathUrl = contextSeed ? `${serviceRoot}/m1/${encodeURIComponent(contextProjectKey)}/${encodeURIComponent(contextServiceKey)}${contextSeed.path}` : "";
  const contextOperationUrl = contextSeed?.operationId ? `${serviceRoot}/m2/${encodeURIComponent(contextProjectKey)}/${encodeURIComponent(contextServiceKey)}/${encodeURIComponent(contextSeed.operationId)}` : "";
  return <section className={`mock-workbench ${variant === "interface" ? "is-interface" : "is-project"}`}>
    {variant === "project" ? <div className="mock-title">
      <div><small>LOCAL MOCK</small><h2>Mock 服务</h2><p>独立服务默认停止；启动后按项目、服务与接口边界返回响应。</p></div>
      <div className="mock-server-controls"><Field label="监听地址"><TextInput value={serverBind} disabled={Boolean(serverStatus?.running)} onChange={(event) => setServerBind(event.target.value)} /></Field><div><StatusBadge tone={serverStatus?.running ? "success" : serverStatus?.lastError ? "danger" : "neutral"}>{serverStatus?.running ? "运行中" : "已停止"}</StatusBadge><Button size="compact" variant={serverStatus?.running ? "secondary" : "primary"} icon={serverStatus?.running ? "close" : "send"} loading={serverBusy} onClick={() => void toggleServer()}>{serverStatus?.running ? "停止服务" : "启动服务"}</Button></div></div>
    </div> : contextSeed ? <div className="mock-interface-context"><div><small>当前接口</small><div><span className={`mock-method method-${contextSeed.method.toLowerCase()}`}>{contextSeed.method}</span><code>{contextSeed.path}</code></div><p>{contextSeed.persisted === false ? "保存接口定义后即可使用 Mock" : "Mock 使用最近一次保存的接口定义。"}</p></div><div><span>路径模式地址</span><code>{contextPathUrl}</code><Button size="compact" variant="ghost" icon="copy" disabled={contextSeed.persisted === false} onClick={() => void navigator.clipboard.writeText(contextPathUrl)}>复制</Button></div></div> : null}
    <div className="mock-overview">
      {variant === "project" && serverStatus?.lastError ? <section className="mock-overview-section"><InlineAlert tone="danger" title="Mock 服务不可用">{serverStatus.lastError}</InlineAlert></section> : null}
      {variant === "project" ? <section className="mock-overview-section mock-address-section" aria-labelledby="mock-address-title">
        <div className="mock-overview-heading"><div><h3 id="mock-address-title">Mock 地址</h3><p>一个 Mock Server 承载所有项目；地址中显式包含项目与服务标识。</p></div><span className="mock-request-count">请求 {serverStatus?.requestCount ?? 0} · WebSocket {serverStatus?.activeWebsockets ?? 0}</span></div>
        <div className="mock-address-table" role="table" aria-label="Mock 服务地址">
          <div className="mock-address-head" role="row"><span>类型</span><span>基础地址</span><span>用途</span><span /></div>
          <div className="mock-address-row" role="row"><strong>路径模式</strong><code>{serviceRoot}/m1/{encodeURIComponent(projectKey)}/{encodeURIComponent(serviceKey)}/*</code><span>按 Method 与 Path 匹配</span><Button size="compact" variant="ghost" icon="copy" onClick={() => void navigator.clipboard.writeText(`${serviceRoot}/m1/${encodeURIComponent(projectKey)}/${encodeURIComponent(serviceKey)}/`)}>复制</Button></div>
          <div className="mock-address-row" role="row"><strong>ID 模式</strong><code>{serviceRoot}/m2/{encodeURIComponent(projectKey)}/{encodeURIComponent(serviceKey)}/&#123;接口 ID&#125;</code><span>同路径接口精确匹配</span><Button size="compact" variant="ghost" icon="copy" onClick={() => void navigator.clipboard.writeText(`${serviceRoot}/m2/${encodeURIComponent(projectKey)}/${encodeURIComponent(serviceKey)}/`)}>复制</Button></div>
        </div>
      </section> : null}
      {variant === "interface" && contextSeed ? <section className="mock-overview-section mock-design-responses" aria-labelledby="mock-design-responses-title">
        <div className="mock-overview-heading"><div><h3 id="mock-design-responses-title">设计响应</h3><p>来源于最近一次保存的接口定义；响应示例优先，未填写示例时按 Schema 生成。</p></div><StatusBadge tone={contextSeed.persisted === false ? "warning" : "success"}>{contextSeed.persisted === false ? "尚未保存" : "已保存"}</StatusBadge></div>
        {contextSeed.responses.length ? <div className="mock-design-response-list">{contextSeed.responses.map((response) => {
          const addressRoot = contextOperationUrl || contextPathUrl;
          const address = `${addressRoot}${addressRoot.includes("?") ? "&" : "?"}apivoyResponseId=${encodeURIComponent(response.id)}`;
          return <article key={response.id}><div><StatusBadge tone={statusTone(responseStatus(response, "success"))}>HTTP {response.statusCode}</StatusBadge><strong>{response.name}</strong><small>{response.exampleBody === undefined ? "Schema 智能生成" : "响应示例"}</small></div><code>{address}</code><Button size="compact" variant="ghost" icon="copy" disabled={contextSeed.persisted === false} onClick={() => void navigator.clipboard.writeText(address)}>复制</Button></article>;
        })}</div> : <EmptyState title="尚未设计响应" description="在接口设计中添加响应并保存后，会自动成为 Mock 的默认返回来源。" />}
      </section> : null}
      <section className="mock-overview-section mock-scenes-section mock-rule-browser" aria-labelledby="mock-scenes-title">
        <div className="mock-overview-heading"><div><h3 id="mock-scenes-title">{variant === "interface" ? "自定义 Mock 场景" : "Mock 场景"}</h3><p>{variant === "interface" ? priorityConflict ? `${visibleRules.length} 个场景中存在优先级冲突` : activeRuleId ? `当前请求将命中“${leadingRules[0].name}”` : "仅在需要条件、延迟或故障覆盖时添加场景" : `${visibleRules.length} 个响应场景，按优先级和请求方法确定命中规则。`}</p></div><Button variant="primary" size="compact" icon="plus" onClick={startCreate}>{variant === "interface" ? "添加自定义场景" : "新建场景"}</Button></div>
        {priorityConflict ? <InlineAlert tone="warning" title="无法确定当前命中场景">有 {leadingRules.length} 个场景使用相同的最高优先级。请选择其中一个“设为当前”，避免响应结果随机。</InlineAlert> : null}
        {loading ? <LoadingState label="正在加载 Mock 场景…" compact /> : loadError ? <InlineAlert tone="danger" title="加载失败"><span>{loadError}</span><Button size="compact" onClick={() => void refresh()}>重试</Button></InlineAlert> : visibleRules.length === 0 ? <EmptyState title="还没有 Mock 场景" description="创建后即可通过上方地址访问本地 Mock 服务。" action={<Button icon="plus" onClick={startCreate}>创建第一个场景</Button>} /> : <div className="mock-scene-table" role="table" aria-label="Mock 场景">
          <div className={`mock-scene-head ${variant === "interface" ? "is-interface" : ""}`} role="row">{variant === "interface" ? <><span>场景名称</span><span>响应</span><span>命中状态</span><span>行为</span><span /></> : <><span>名称</span><span>匹配条件</span><span>响应</span><span>行为</span><span /></>}</div>
          {visibleRules.map((rule) => <article key={rule.id} className={`mock-scene-row${rule.id === activeRuleId ? " is-active" : ""}${priorityConflict && rule.priority === highestVisiblePriority ? " is-conflicting" : ""}${rule.enabled ? "" : " is-disabled"}`} role="row">
            <button type="button" className="mock-scene-name" onClick={() => startEdit(rule)}><strong>{rule.name}</strong>{variant === "project" ? <code>{requestUrl(serviceRoot, rule)}</code> : <small>优先级 {rule.priority}</small>}</button>
            {variant === "project" ? <div className="mock-scene-match"><span className={`mock-method method-${rule.method.toLowerCase()}`}>{rule.method}</span><code>{rule.path}</code></div> : <div>{rule.method !== "WS" ? <StatusBadge tone={statusTone(rule.status)}>HTTP {rule.status}</StatusBadge> : <StatusBadge tone="info">WebSocket</StatusBadge>}</div>}
            {variant === "project" ? <div>{rule.enabled ? rule.method !== "WS" ? <StatusBadge tone={statusTone(rule.status)}>HTTP {rule.status}</StatusBadge> : <StatusBadge tone="info">WebSocket</StatusBadge> : <StatusBadge tone="neutral">已停用</StatusBadge>}</div> : <div className="mock-scene-hit">{!rule.enabled ? <StatusBadge tone="neutral">已停用</StatusBadge> : rule.id === activeRuleId ? <StatusBadge tone="success">当前命中</StatusBadge> : priorityConflict && rule.priority === highestVisiblePriority ? <StatusBadge tone="warning">优先级冲突</StatusBadge> : <span>候选场景</span>}</div>}
            <div className="mock-scene-behavior"><span>{variant === "project" ? `优先级 ${rule.priority}` : rule.delayMs ? `${rule.delayMs} ms 延迟` : "立即响应"}</span>{variant === "project" ? <span>{rule.delayMs ? `${rule.delayMs} ms` : "立即响应"}</span> : null}{rule.errorEvery ? <span>每 {rule.errorEvery} 次故障</span> : null}</div>
            <div className="mock-rule-actions">{variant === "interface" && rule.id !== activeRuleId ? <Button size="compact" variant={priorityConflict && rule.priority === highestVisiblePriority ? "secondary" : "ghost"} disabled={!rule.enabled} loading={activatingId === rule.id} onClick={() => void makeCurrent(rule)}>设为当前</Button> : null}<Button size="compact" variant="ghost" onClick={() => void toggleRule(rule)}>{rule.enabled ? "停用" : "启用"}</Button><Button size="compact" variant="ghost" icon="send" disabled={!rule.enabled || !serverStatus?.running} loading={testingId === rule.id} onClick={() => void testRule(rule)}>试跑</Button><Button size="compact" variant="ghost" icon="edit" onClick={() => startEdit(rule)}>编辑</Button><IconButton label={`删除 ${rule.name}`} icon="trash" tone="danger" disabled={deletingId === rule.id} onClick={() => void remove(rule)} /></div>
            {testResult?.ruleId === rule.id ? <div className={`mock-test-result ${testResult.matchedRuleId === rule.id ? "is-matched" : "is-missed"}`} role="status"><strong>{testResult.matchedRuleId === rule.id ? `试跑成功 · HTTP ${testResult.status}` : matchedTestRule ? `实际命中“${matchedTestRule.name}” · HTTP ${testResult.status}` : `没有命中 Mock 规则 · HTTP ${testResult.status}`}</strong>{testResult.matchedRuleId !== rule.id && matchedTestRule ? <span>当前规则优先级较低，可将其设为当前场景后再试。</span> : null}{testResult.body ? <code>{testResult.body}</code> : null}</div> : null}
          </article>)}
        </div>}
      </section>
    </div>
    <ModalFrame open={editorOpen} onClose={closeEditor} className="mock-editor" overlayClassName={`mock-drawer-backdrop${variant === "interface" ? " is-embedded" : ""}`} ariaLabelledBy="mock-editor-title" initialFocusRef={nameInputRef} as="form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header className="mock-editor-header"><div><IconButton label="关闭场景编辑器" icon="close" onClick={closeEditor} /><div><h2 id="mock-editor-title">{editingRule ? "编辑自定义 Mock 场景" : "新建自定义 Mock 场景"}</h2><p>{editingRule ? editingRule.name : "配置请求条件与响应覆盖"}</p></div></div><div><Button size="compact" variant="ghost" onClick={closeEditor}>取消</Button><Button type="submit" size="compact" variant="primary" icon={editingRule ? "edit" : "plus"} loading={saving}>{editingRule ? "保存" : "创建"}</Button></div></header>
      <div className="mock-editor-scroll">
        {seed ? <section className="mock-contract-source" aria-label="契约生成设置">
          <header><div><span>来源</span><strong>{seed.interfaceName}</strong><small>{seed.responses.length ? `已读取 ${seed.responses.length} 个响应定义` : "接口尚未定义响应字段，将使用基础模板"}</small></div><StatusBadge tone="info">接口契约</StatusBadge></header>
          <div className="mock-contract-controls">
            <Field label="场景模板"><SegmentedControl value={scenarioTemplate} ariaLabel="Mock 场景模板" items={[{ value: "success", label: "成功" }, { value: "empty", label: "空数据" }, { value: "error", label: "异常" }]} onValueChange={changeTemplate} /></Field>
            <Field label="返回内容来源"><SegmentedControl value={responseSource} ariaLabel="Mock 返回内容来源" items={[{ value: "smart", label: "智能生成" }, { value: "example", label: "响应示例" }, { value: "custom", label: "自定义" }]} onValueChange={changeResponseSource} /></Field>
            {seed.responses.length ? <Field label="响应定义"><Select value={selectedResponseId} onChange={(event) => changeSelectedResponse(event.target.value)}>{seed.responses.map((response) => <option key={response.id} value={response.id}>{response.statusCode} · {response.name}</option>)}</Select></Field> : null}
          </div>
        </section> : null}
        <div className="mock-editor-group-heading"><div><strong>匹配条件</strong><span>请求满足方法和路径时命中此规则</span></div></div>
        <div className="mock-fields mock-fields-primary">
          <Field label="规则名称" required><TextInput ref={nameInputRef} value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></Field>
          {variant === "interface" && contextSeed ? <div className="mock-inherited-route"><span>继承接口</span><strong><span className={`mock-method method-${draft.method.toLowerCase()}`}>{draft.method}</span><code>{draft.path}</code></strong><small>方法与路径由接口设计维护</small></div> : <><Field label="方法" required><Select value={draft.method} onChange={(event) => updateDraft("method", event.target.value)}><option>*</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>WS</option></Select></Field><Field label="匹配路径" required hint="相对于 Mock 服务入口"><TextInput className="mock-code-input" value={draft.path} onChange={(event) => updateDraft("path", event.target.value)} placeholder="/path" /></Field></>}
        </div>
        <div className="mock-editor-group-heading mock-response-heading"><div><strong>{draft.method === "WS" ? "消息行为" : "返回内容"}</strong><span>{draft.method === "WS" ? "配置连接后的消息与回显" : "预览并调整客户端最终收到的响应"}</span></div>{draft.method !== "WS" ? <Field label="HTTP 状态码"><TextInput type="number" min={100} max={999} value={draft.status} onChange={(event) => updateDraft("status", +event.target.value)} /></Field> : null}</div>
        {draft.method === "WS" ? <div className="mock-payload-grid">
          <Field label="连接后消息" hint="每行作为一帧依次发送"><Textarea className="mock-body" value={draft.wsMessages} onChange={(event) => updateDraft("wsMessages", event.target.value)} /></Field>
          <div className="mock-ws-settings"><Checkbox label="回显客户端帧" description="原样返回 Text 与 Binary 帧" checked={draft.wsEcho} onChange={(event) => updateDraft("wsEcho", event.target.checked)} /><Field label="消息间隔" hint="毫秒"><TextInput type="number" min={0} value={draft.wsIntervalMs} onChange={(event) => updateDraft("wsIntervalMs", +event.target.value)} /></Field><code>{requestUrl(serviceRoot, { method: "WS", path: draft.path.startsWith("/") ? draft.path : `/${draft.path}`, projectKey: contextProjectKey, serviceKey: contextServiceKey, operationId: contextSeed?.operationId })}</code></div>
        </div> : <div className="mock-response-editor">
          <div className="mock-response-tabs" role="tablist" aria-label="返回数据"><button type="button" role="tab" aria-selected={responseTab === "body"} className={responseTab === "body" ? "is-active" : ""} onClick={() => setResponseTab("body")}>Body</button><button type="button" role="tab" aria-selected={responseTab === "headers"} className={responseTab === "headers" ? "is-active" : ""} onClick={() => setResponseTab("headers")}>Headers</button></div>
          {responseTab === "body" ? <Field label="响应正文" hint={seed && responseSource !== "custom" ? "编辑内容后自动切换为自定义" : undefined}><Textarea className="mock-body" value={draft.body} onChange={(event) => { updateDraft("body", event.target.value); setResponseSource("custom"); }} spellCheck={false} /></Field> : <Field label="响应头" hint="JSON 对象，名称和值均为字符串" error={formError.includes("响应头") ? formError : undefined}><Textarea className="mock-headers" value={draft.headers} onChange={(event) => updateDraft("headers", event.target.value)} spellCheck={false} /></Field>}
        </div>}
        <section className="mock-advanced-section">
          <Button size="compact" variant="ghost" icon="settings" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>高级行为</Button>
          {advancedOpen ? <div className="mock-fields mock-fields-behavior">
            <Field label="优先级" hint="数值越大越优先"><TextInput type="number" value={draft.priority} onChange={(event) => updateDraft("priority", +event.target.value)} /></Field>
            <Field label="响应延迟" hint="毫秒"><TextInput type="number" min={0} value={draft.delayMs} onChange={(event) => updateDraft("delayMs", +event.target.value)} /></Field>
            <Field label="周期故障" hint="0 表示关闭"><TextInput type="number" min={0} value={draft.errorEvery} onChange={(event) => updateDraft("errorEvery", +event.target.value)} /></Field>
            <Field label="查询参数条件" hint={'JSON，例如 {"page":"1"}'}><Textarea value={draft.matchQuery} onChange={(event) => updateDraft("matchQuery", event.target.value)} spellCheck={false} /></Field>
            <Field label="请求头条件" hint="JSON；名称匹配不区分大小写"><Textarea value={draft.matchHeaders} onChange={(event) => updateDraft("matchHeaders", event.target.value)} spellCheck={false} /></Field>
            <Field label="Cookie 条件" hint="JSON"><Textarea value={draft.matchCookies} onChange={(event) => updateDraft("matchCookies", event.target.value)} spellCheck={false} /></Field>
            <Field label="Body 包含" hint="留空表示不限制"><TextInput value={draft.bodyContains} onChange={(event) => updateDraft("bodyContains", event.target.value)} /></Field>
          </div> : null}
        </section>
        {formError && !formError.includes("响应头") ? <InlineAlert tone="danger" title="无法保存场景">{formError}</InlineAlert> : null}
      </div>
    </ModalFrame>
  </section>;
}
