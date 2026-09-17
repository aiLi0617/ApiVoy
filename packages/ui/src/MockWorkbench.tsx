import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, LoadingState, useFeedback } from "./Feedback";
import { Button, Checkbox, Field, IconButton, InlineAlert, Select, StatusBadge, Switch, Textarea, TextInput } from "./Components";
import { ModalFrame } from "./ModalFrame";
import { HttpStatusCodeInput } from "./HttpStatusCodeInput";
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
    conditions?: MockCondition[];
    ips?: string[];
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

export type MockConditionSource = "query" | "path" | "header" | "cookie" | "body" | "ip";
export type MockConditionOperator = "equals" | "notEquals" | "contains" | "notContains" | "greaterThan" | "greaterOrEqual" | "lessThan" | "lessOrEqual" | "exists" | "notExists" | "matches";
export interface MockCondition { source: MockConditionSource; name: string; operator: MockConditionOperator; value?: string | null }
type MockConditionDraft = MockCondition & { key: string; active: boolean };

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
  headers: MockHeaderDraft[];
  body: string;
  delayMs: number;
  errorEvery: number;
  wsMessages: string;
  wsEcho: boolean;
  wsIntervalMs: number;
  conditions: MockConditionDraft[];
  ipEnabled: boolean;
  ipAddresses: string;
}

interface MockHeaderDraft { id: string; name: string; value: string; active: boolean }

const MOCK_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MOCK_HEADER_VALUE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;

function mockHeaderNameError(value: string): string {
  const name = value.trim();
  if (!name) return "参数名不能为空";
  return MOCK_HEADER_NAME_PATTERN.test(name) ? "" : "参数名包含非法字符";
}

function mockHeaderValueError(value: string): string {
  if (!value.trim()) return "参数值不能为空";
  return MOCK_HEADER_VALUE_CONTROL_PATTERN.test(value) ? "参数值不能包含控制字符" : "";
}

function createMockHeader(name = "", value = "", active = false): MockHeaderDraft {
  return { id: crypto.randomUUID(), name, value, active };
}

function mockHeaderRowsFromRecord(headers: Record<string, string>): MockHeaderDraft[] {
  return [...Object.entries(headers).map(([name, value]) => createMockHeader(name, value, true)), createMockHeader()];
}

function normalizeMockHeaders(rows: MockHeaderDraft[]): Record<string, string> {
  const headers: Record<string, string> = {};
  const names = new Set<string>();
  for (const row of rows) {
    if (!row.active) continue;
    const name = row.name.trim();
    if (!name) throw new Error("请填写响应头参数名");
    if (!MOCK_HEADER_NAME_PATTERN.test(name)) throw new Error(`响应头参数名格式不正确：${name}`);
    const normalizedName = name.toLocaleLowerCase();
    if (names.has(normalizedName)) throw new Error(`响应头参数名不能重复：${name}`);
    if (!row.value.trim()) throw new Error(`请填写响应头参数值：${name}`);
    if (MOCK_HEADER_VALUE_CONTROL_PATTERN.test(row.value)) throw new Error(`响应头参数值包含无效控制字符：${name}`);
    names.add(normalizedName);
    headers[name] = row.value;
  }
  return headers;
}

const NEW_RULE: MockRuleDraft = {
  name: "",
  method: "GET",
  path: "/example",
  status: 200,
  priority: 0,
  headers: [],
  body: '{"ok":true}',
  delayMs: 0,
  errorEvery: 0,
  wsMessages: "connected",
  wsEcho: true,
  wsIntervalMs: 250,
  conditions: [],
  ipEnabled: false,
  ipAddresses: "",
};

const CONDITION_SOURCES: Array<{ value: MockConditionSource; label: string }> = [
  { value: "query", label: "Query" },
  { value: "path", label: "Path" },
  { value: "header", label: "Header" },
  { value: "cookie", label: "Cookie" },
  { value: "body", label: "Body" },
];
const CONDITION_OPERATORS: Array<{ value: MockConditionOperator; label: string }> = [
  { value: "equals", label: "等于" },
  { value: "notEquals", label: "不等于" },
  { value: "contains", label: "包含" },
  { value: "notContains", label: "不包含" },
  { value: "greaterThan", label: "大于" },
  { value: "greaterOrEqual", label: "大于等于" },
  { value: "lessThan", label: "小于" },
  { value: "lessOrEqual", label: "小于等于" },
  { value: "exists", label: "存在" },
  { value: "notExists", label: "不存在" },
  { value: "matches", label: "正则匹配" },
];
function conditionKey() { return crypto.randomUUID(); }
function emptyCondition(): MockConditionDraft { return { key: conditionKey(), active: false, source: "query", name: "", operator: "equals", value: "" }; }
function newRuleDraft(): MockRuleDraft { return { ...NEW_RULE, headers: mockHeaderRowsFromRecord({}), conditions: [emptyCondition()] }; }
function legacyConditions(matchConditions: MockRule["matchConditions"]): MockCondition[] {
  if (matchConditions.conditions?.length) return matchConditions.conditions;
  return [
    ...Object.entries(matchConditions.query ?? {}).map(([name, value]) => ({ source: "query" as const, name, operator: "equals" as const, value })),
    ...Object.entries(matchConditions.headers ?? {}).map(([name, value]) => ({ source: "header" as const, name, operator: "equals" as const, value })),
    ...Object.entries(matchConditions.cookies ?? {}).map(([name, value]) => ({ source: "cookie" as const, name, operator: "equals" as const, value })),
    ...(matchConditions.bodyContains ? [{ source: "body" as const, name: "$", operator: "contains" as const, value: matchConditions.bodyContains }] : []),
  ];
}

export function normalizeMockConditions(conditions: Array<MockCondition & { key?: string; active?: boolean }>): MockCondition[] {
  return conditions.filter((condition) => condition.active !== false).map(({ key: _key, active: _active, ...condition }) => {
    const normalized = {
      ...condition,
      name: condition.source === "ip" ? "clientIp" : condition.name.trim(),
      value: condition.operator === "exists" || condition.operator === "notExists" ? null : condition.value?.trim() ?? "",
    };
    if ((normalized.source !== "ip" && !normalized.name) || ((normalized.operator !== "exists" && normalized.operator !== "notExists") && !normalized.value)) {
      throw new Error("请完整填写每条匹配条件的参数名和参数值");
    }
    return normalized;
  });
}

export function normalizeIpAddresses(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

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

function draftFromRule(rule: MockRule): MockRuleDraft {
  const conditions = legacyConditions(rule.matchConditions);
  const ipAddresses = [...new Set([
    ...(rule.matchConditions.ips ?? []),
    ...conditions.filter((condition) => condition.source === "ip").map((condition) => condition.value?.trim() ?? "").filter(Boolean),
  ])];
  return {
    ...rule,
    headers: mockHeaderRowsFromRecord(rule.headers),
    errorEvery: rule.errorEvery ?? 0,
    wsMessages: rule.wsMessages.join("\n"),
    conditions: [
      ...conditions.filter((condition) => condition.source !== "ip").map((condition) => ({ ...condition, key: conditionKey(), active: true })),
      emptyCondition(),
    ],
    ipEnabled: ipAddresses.length > 0,
    ipAddresses: ipAddresses.join(", "),
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [responseTab, setResponseTab] = useState<"body" | "headers" | "settings">("body");
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
        matchConditions: rule.matchConditions ?? { conditions: [], query: {}, headers: {}, cookies: {}, bodyContains: null },
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

  function updateCondition(key: string, patch: Partial<MockCondition>) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.reduce<MockConditionDraft[]>((next, condition) => {
        if (condition.key !== key) return [...next, condition];
        const activating = !condition.active;
        next.push({ ...condition, ...patch, active: true });
        if (activating) next.push(emptyCondition());
        return next;
      }, []),
    }));
    setFormError("");
  }

  function removeCondition(key: string) {
    setDraft((current) => {
      const conditions = current.conditions.filter((condition) => condition.key !== key);
      return { ...current, conditions: conditions.some((condition) => !condition.active) ? conditions : [...conditions, emptyCondition()] };
    });
    setFormError("");
  }

  function updateHeader(id: string, patch: Partial<Pick<MockHeaderDraft, "name" | "value">>) {
    setDraft((current) => ({
      ...current,
      headers: current.headers.reduce<MockHeaderDraft[]>((next, header) => {
        if (header.id !== id) return [...next, header];
        const activating = !header.active;
        next.push({ ...header, ...patch, active: true });
        if (activating) next.push(createMockHeader());
        return next;
      }, []),
    }));
    setFormError("");
  }

  function removeHeader(id: string) {
    setDraft((current) => {
      const headers = current.headers.filter((header) => header.id !== id);
      return { ...current, headers: headers.some((header) => !header.active) ? headers : [...headers, createMockHeader()] };
    });
    setFormError("");
  }

  function startCreate() {
    if (contextSeed) {
      const inferred = inferMockScenario(contextSeed);
      applySeed(contextSeed, inferred.template, "smart", inferred.responseId);
      return;
    }
    setEditingId(null);
    setDraft(newRuleDraft());
    setSeed(null);
    setResponseSource("smart");
    setScenarioTemplate("success");
    setSelectedResponseId("");
    setResponseTab("body");
    setEditorOpen(true);
    setFormError("");
    window.requestAnimationFrame(() => { nameInputRef.current?.focus(); nameInputRef.current?.select(); });
  }
  function startEdit(rule: MockRule) { setEditingId(rule.id); setDraft(draftFromRule(rule)); setSeed(null); setResponseSource("custom"); setSelectedResponseId(rule.responseId ?? ""); setResponseTab("body"); setEditorOpen(true); setFormError(""); }

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
    setResponseTab("body");
    setEditorOpen(true);
    setDraft({
      ...newRuleDraft(),
      method: nextSeed.method || "GET",
      path: nextSeed.path || "/",
      status: responseStatus(response, template),
      priority: contextSeed ? highestVisiblePriority + 1 : NEW_RULE.priority,
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

  function changeResponseStatus(statusCode: string) {
    const response = seed?.responses.find((item) => item.statusCode === statusCode);
    setSelectedResponseId(response?.id ?? "");
    setDraft((current) => ({
      ...current,
      status: Number(statusCode) || 0,
      ...(response ? {
        body: responseSource === "custom" ? current.body : buildMockResponseBody(response, responseSource, scenarioTemplate),
      } : {}),
    }));
    setFormError("");
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
    try {
      headers = normalizeMockHeaders(draft.headers);
    }
    catch (error) { return setFormError(error instanceof Error ? error.message : String(error)); }
    let conditions: MockCondition[];
    try { conditions = normalizeMockConditions(draft.conditions); }
    catch (error) { return setFormError(error instanceof Error ? error.message : String(error)); }
    const ips = draft.ipEnabled ? normalizeIpAddresses(draft.ipAddresses) : [];
    if (draft.ipEnabled && !ips.length) return setFormError("请输入至少一个客户端 IP");
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
      matchConditions: { conditions, ips, query: {}, headers: {}, cookies: {}, bodyContains: null },
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
        <section className="mock-scene-info">
          <div className={`mock-fields mock-fields-primary${variant === "interface" ? " is-interface" : ""}`}>
            <Field label="规则名称" required><TextInput ref={nameInputRef} aria-label="规则名称" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></Field>
            {variant === "interface" && contextSeed ? <Field label="继承接口"><div className="mock-inherited-route" role="group" aria-label="继承接口"><strong><span className={`mock-method method-${draft.method.toLowerCase()}`}>{draft.method}</span><code>{draft.path}</code></strong><small>方法与路径由接口设计维护</small></div></Field> : <><Field label="方法" required><Select value={draft.method} onChange={(event) => updateDraft("method", event.target.value)}><option>*</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>WS</option></Select></Field><Field label="匹配路径" required hint="相对于 Mock 服务入口"><TextInput className="mock-code-input" value={draft.path} onChange={(event) => updateDraft("path", event.target.value)} placeholder="/path" /></Field></>}
          </div>
        </section>
        <div className="mock-editor-group-heading mock-condition-heading"><div><strong>请求匹配条件</strong><span>请求需要满足以下全部条件（AND）；空白时作为默认场景</span></div></div>
        <section className="mock-condition-builder" aria-label="请求匹配条件">
          <div className="mock-condition-columns" aria-hidden="true"><span>参数位置</span><span>参数名</span><span>比较</span><span>参数值</span><span /></div>
          {draft.conditions.map((condition, index) => {
              const valueOptional = condition.operator === "exists" || condition.operator === "notExists";
              const missingName = condition.active && condition.source !== "ip" && !condition.name.trim();
              const missingValue = condition.active && !valueOptional && !condition.value?.trim();
              const placeholder = condition.source === "body" ? "$.user.id" : condition.source === "path" ? "id" : condition.source === "header" ? "X-Mode" : condition.source === "cookie" ? "session" : "page";
              const activate = () => { if (!condition.active) updateCondition(condition.key, {}); };
              return <div className={`mock-condition-row ${condition.active ? "is-active" : "is-placeholder"}`} key={condition.key}>
                <Select className="mock-condition-source" aria-label={`条件 ${index + 1} 参数位置`} value={condition.source} onFocus={activate} onChange={(event) => updateCondition(condition.key, { source: event.target.value as MockConditionSource })}>{CONDITION_SOURCES.map((source) => <option value={source.value} key={source.value}>{source.label}</option>)}</Select>
                <div className="mock-condition-cell"><TextInput className="mock-condition-name" aria-label={`条件 ${index + 1} 参数名`} aria-required={condition.active} aria-invalid={missingName} aria-describedby={missingName ? `${condition.key}-name-error` : undefined} value={condition.name} placeholder={condition.active ? (missingName ? "参数名不能为空" : placeholder) : "添加匹配条件"} onFocus={activate} onChange={(event) => updateCondition(condition.key, { name: event.target.value })} />{missingName ? <span className="mock-condition-error-sr" id={`${condition.key}-name-error`}>参数名不能为空</span> : null}</div>
                <Select className="mock-condition-operator" aria-label={`条件 ${index + 1} 比较方式`} value={condition.operator} onFocus={activate} onChange={(event) => updateCondition(condition.key, { operator: event.target.value as MockConditionOperator })}>{CONDITION_OPERATORS.map((operator) => <option value={operator.value} key={operator.value}>{operator.label}</option>)}</Select>
                {condition.active && valueOptional ? <span className="mock-condition-no-value">无需参数值</span> : <div className="mock-condition-cell"><TextInput className="mock-condition-value" aria-label={`条件 ${index + 1} 参数值`} aria-required={condition.active} aria-invalid={missingValue} aria-describedby={missingValue ? `${condition.key}-value-error` : undefined} value={condition.value ?? ""} placeholder={condition.active ? (missingValue ? "参数值不能为空" : "参数值") : ""} onFocus={activate} onChange={(event) => updateCondition(condition.key, { value: event.target.value })} />{missingValue ? <span className="mock-condition-error-sr" id={`${condition.key}-value-error`}>参数值不能为空</span> : null}</div>}
                {condition.active ? <IconButton label={`删除条件 ${index + 1}`} icon="trash" tone="danger" onClick={() => removeCondition(condition.key)} /> : <span aria-hidden="true" />}
              </div>;
            })}
        </section>
        <section className="mock-ip-settings" aria-label="IP 条件设置">
          <Switch label="IP 条件" checked={draft.ipEnabled} onChange={(event) => updateDraft("ipEnabled", event.target.checked)} />
          {draft.ipEnabled ? <TextInput aria-label="客户端 IP" aria-invalid={!normalizeIpAddresses(draft.ipAddresses).length} value={draft.ipAddresses} placeholder={draft.ipAddresses.trim() ? "多个 IP 使用逗号分隔" : "输入 IP，多个 IP 使用逗号分隔"} onChange={(event) => updateDraft("ipAddresses", event.target.value)} /> : null}
        </section>
        <div className="mock-editor-group-heading mock-response-heading"><div><strong>{draft.method === "WS" ? "消息行为" : "返回内容"}</strong><span>{draft.method === "WS" ? "配置连接后的消息与回显" : "预览并调整客户端最终收到的响应"}</span></div></div>
        {draft.method === "WS" ? <div className="mock-payload-grid">
          <Field label="连接后消息" hint="每行作为一帧依次发送"><Textarea className="mock-body" value={draft.wsMessages} onChange={(event) => updateDraft("wsMessages", event.target.value)} /></Field>
          <div className="mock-ws-settings"><Checkbox label="回显客户端帧" description="原样返回 Text 与 Binary 帧" checked={draft.wsEcho} onChange={(event) => updateDraft("wsEcho", event.target.checked)} /><Field label="消息间隔" hint="毫秒"><TextInput type="number" min={0} value={draft.wsIntervalMs} onChange={(event) => updateDraft("wsIntervalMs", +event.target.value)} /></Field><div className="mock-fields mock-fields-behavior"><Field label="优先级" hint="数值越大越优先"><TextInput type="number" value={draft.priority} onChange={(event) => updateDraft("priority", +event.target.value)} /></Field><Field label="响应延迟" hint="毫秒"><TextInput type="number" min={0} value={draft.delayMs} onChange={(event) => updateDraft("delayMs", +event.target.value)} /></Field><Field label="周期故障" hint="0 表示关闭"><TextInput type="number" min={0} value={draft.errorEvery} onChange={(event) => updateDraft("errorEvery", +event.target.value)} /></Field></div><code>{requestUrl(serviceRoot, { method: "WS", path: draft.path.startsWith("/") ? draft.path : `/${draft.path}`, projectKey: contextProjectKey, serviceKey: contextServiceKey, operationId: contextSeed?.operationId })}</code></div>
        </div> : <div className="mock-response-editor">
          <div className="mock-response-tabs" role="tablist" aria-label="返回数据"><button type="button" role="tab" aria-selected={responseTab === "body"} className={responseTab === "body" ? "is-active" : ""} onClick={() => setResponseTab("body")}>Body</button><button type="button" role="tab" aria-selected={responseTab === "headers"} className={responseTab === "headers" ? "is-active" : ""} onClick={() => setResponseTab("headers")}>Headers</button><button type="button" role="tab" aria-selected={responseTab === "settings"} className={responseTab === "settings" ? "is-active" : ""} onClick={() => setResponseTab("settings")}>设置</button></div>
          {responseTab === "body" ? <Field label="响应正文"><Textarea className="mock-body" value={draft.body} onChange={(event) => { updateDraft("body", event.target.value); setResponseSource("custom"); }} spellCheck={false} /></Field> : responseTab === "headers" ? <Field label="响应头" hint="参数名和值将作为字符串发送" error={formError.includes("响应头") ? formError : undefined}><div className="mock-header-editor" role="table" aria-label="响应头参数"><div className="mock-header-columns" role="row"><span role="columnheader">参数名</span><span role="columnheader">参数值</span><span aria-hidden="true" /></div>{draft.headers.map((header, index) => { const activate = () => { if (!header.active) updateHeader(header.id, {}); }; const nameError = header.active ? mockHeaderNameError(header.name) : ""; const valueError = header.active ? mockHeaderValueError(header.value) : ""; const nameErrorId = `${header.id}-name-error`; const valueErrorId = `${header.id}-value-error`; return <div className={`mock-header-row ${header.active ? "is-active" : "is-placeholder"}`} role="row" key={header.id}><span className={`mock-header-cell${nameError && header.name ? " has-inline-error" : ""}`} role="cell"><TextInput aria-label={`响应头 ${index + 1} 参数名`} aria-required={header.active} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? nameErrorId : undefined} value={header.name} placeholder={header.active && nameError && !header.name ? nameError : ""} onFocus={activate} onChange={(event) => updateHeader(header.id, { name: event.target.value })} spellCheck={false} />{nameError ? <small className={`mock-header-error${header.name ? " is-inline" : " is-sr-only"}`} id={nameErrorId}>{nameError}</small> : null}</span><span className={`mock-header-cell${valueError && header.value ? " has-inline-error" : ""}`} role="cell"><TextInput aria-label={`响应头 ${index + 1} 参数值`} aria-required={header.active} aria-invalid={Boolean(valueError)} aria-describedby={valueError ? valueErrorId : undefined} value={header.value} placeholder={valueError && !header.value ? valueError : ""} onFocus={activate} onChange={(event) => updateHeader(header.id, { value: event.target.value })} spellCheck={false} />{valueError ? <small className={`mock-header-error${header.value ? " is-inline" : " is-sr-only"}`} id={valueErrorId}>{valueError}</small> : null}</span>{header.active ? <IconButton label={`删除响应头 ${index + 1}`} icon="trash" tone="danger" onClick={() => removeHeader(header.id)} /> : <span aria-hidden="true" />}</div>; })}</div></Field> : <div className="mock-fields mock-settings-fields">
            <Field label="HTTP 状态码" required><HttpStatusCodeInput value={draft.status ? String(draft.status) : ""} onChange={changeResponseStatus} invalid={draft.status < 100 || draft.status > 999} maxLength={3} /></Field>
            <Field label="优先级" hint="数值越大越优先"><TextInput aria-label="优先级" type="number" value={draft.priority} onChange={(event) => updateDraft("priority", +event.target.value)} /></Field>
            <Field label="响应延迟" hint="毫秒"><TextInput aria-label="响应延迟" type="number" min={0} value={draft.delayMs} onChange={(event) => updateDraft("delayMs", +event.target.value)} /></Field>
            <Field label="周期故障" hint="0 表示关闭"><TextInput aria-label="周期故障" type="number" min={0} value={draft.errorEvery} onChange={(event) => updateDraft("errorEvery", +event.target.value)} /></Field>
          </div>}
        </div>}
        {formError && !formError.includes("响应头") ? <InlineAlert tone="danger" title="无法保存场景">{formError}</InlineAlert> : null}
      </div>
    </ModalFrame>
  </section>;
}
