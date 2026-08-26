import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { useAppStore } from "./appStore";
import { translateWorkbench, useI18n } from "./i18n";
import { stashHydrate } from "./openRequestPipeline";
import { WorkbenchFrame } from "./WorkbenchFrame";
import { clearWorkbenchDraft } from "./draftRecovery";
import { ScriptLibraryWorkbench } from "./ScriptLibraryWorkbench";
import { CurlImportDialog } from "./CurlImportDialog";
import type { HttpWorkbenchProps, HttpWorkbenchRequest } from "./HttpWorkbench";
import { InterfaceLifecycleShell, type InterfaceCaseRunOutcome, type InterfaceCaseSummary, type InterfaceDefinitionClient } from "./InterfaceLifecycle";
import { captureHttpInterfaceStructure, INTERFACE_STRUCTURE_METADATA_KEY } from "./interfaceStructureV2";
import { consumeCaseInterfaceStructure } from "./caseStructureBridge";

export interface WorkbenchDefinition { id: string; label: string; protocol?: string; protocols?: string[]; group?: string; icon?: IconName }
export type WorkbenchTab = WorkbenchDefinition;
export interface WorkbenchGroup { id: string; label: string; icon: IconName; workbenchIds: string[] }
interface WorkbenchSession { id: string; workbenchId: string; title: string; requestId?: string; icon?: IconName; caseInterfaceName?: string; caseParentId?: string }
export interface WorkbenchDeckProps {
  tabs: WorkbenchTab[];
  children: ReactNode;
  /** UX-012: show save target in frame status */
  saveTargetLabel?: string;
  projects?: Array<{ id: string; name: string; resourceCount: number; protocols: string[] }>;
  selectedProjectId?: string;
  onSelectProject?: (projectId: string) => void;
  onCreateProject?: (name: string) => Promise<void>;
  onRenameProject?: (projectId: string, name: string) => Promise<void>;
  onCloneProject?: (projectId: string, name: string) => Promise<void>;
  onDeleteProject?: (projectId: string) => Promise<void>;
  onOpenProjectInNewWindow?: (projectId: string) => void;
  definitionClient?: InterfaceDefinitionClient;
  onCreateHttpInterface?: (request: HttpWorkbenchRequest, projectId: string, collectionId: string) => Promise<void>;
  onLoadHttpInterface?: (requestId: string) => Promise<HttpWorkbenchRequest | null>;
  interfaceCases?: Array<InterfaceCaseSummary & { parentId: string }>;
  onDeleteHttpInterface?: (requestId: string) => Promise<void>;
}
export const WORKBENCH_LABELS: Record<string, string> = { http:"HTTP", graphql:"GraphQL", grpc:"gRPC", rpc:"SOAP / RPC", websocket:"WebSocket", sse:"SSE", tcp:"TCP", udp:"UDP", mqtt:"MQTT", amqp:"AMQP", kafka:"Kafka", redis:"Redis", sql:"SQL", mock:"Mock", runner:"Runner", gateway:"Gateway", capture:"Capture", plugins:"Plugins", ai:"AI" };
export const WORKBENCH_ICONS: Record<string, IconName> = {
  http: "globe", graphql: "code", grpc: "network", rpc: "code", websocket: "activity", sse: "activity", tcp: "network", udp: "network",
  mqtt: "network", amqp: "network", kafka: "network", redis: "database", sql: "database",
  mock: "archive", runner: "send", gateway: "globe", capture: "search", plugins: "command", ai: "bolt", __scripts: "code",
};
export const DEFAULT_WORKBENCH_GROUPS: WorkbenchGroup[] = [
  { id:"api", label:"API", icon:"globe", workbenchIds:["http","grpc"] },
  { id:"realtime", label:"实时通信", icon:"activity", workbenchIds:["websocket","sse","tcp","udp"] },
  { id:"messaging", label:"消息", icon:"network", workbenchIds:["mqtt","amqp","kafka"] },
  { id:"data", label:"数据", icon:"database", workbenchIds:["redis","sql"] },
  { id:"tools", label:"工具", icon:"bolt", workbenchIds:["mock","runner","gateway","capture","plugins","ai"] },
];
const GROUP_BY_WORKBENCH = new Map(DEFAULT_WORKBENCH_GROUPS.flatMap((group) => group.workbenchIds.map((id) => [id, group.label])));
const LAYOUT_BY_WORKBENCH: Record<string, "request" | "stream" | "editor" | "management"> = { graphql:"request", grpc:"request", rpc:"request", websocket:"stream", sse:"stream", tcp:"stream", udp:"stream", mqtt:"stream", amqp:"stream", kafka:"stream", redis:"editor", sql:"editor", mock:"management", runner:"management", gateway:"management", capture:"management", plugins:"management", ai:"management" };
export function resolveWorkbenchId(tabs: WorkbenchTab[], stored: string | null) { return tabs.some((tab) => tab.id === stored) ? stored! : tabs[0]?.id ?? ""; }
export function resolveHashWorkbenchId(tabs: WorkbenchTab[], hash: string): string | null {
  const id = new URLSearchParams(hash.replace(/^#/, "")).get("workbench");
  if (!id) return null;
  return tabs.some((tab) => tab.id === id) ? id : null;
}
export function resolveInitialWorkbenchId(tabs: WorkbenchTab[], hash: string): string {
  const workbench = resolveHashWorkbenchId(tabs, hash);
  if (workbench) return workbench;
  return new URLSearchParams(hash.replace(/^#/, "")).has("view") ? "__project" : "__new";
}
export function createProjectOverviewSession(id: string) { return { id, workbenchId: "__new", title: "项目概览" }; }
export function createNewPageSession(id: string) { return { id, workbenchId: "__project", title: "新建" }; }
function hashWorkbench() { if (typeof window === "undefined") return null; return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("workbench"); }
function clearInvalidWorkbenchHash() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (!params.has("workbench")) return;
  params.delete("workbench");
  const next = params.toString();
  history.replaceState(null, "", next ? `#${next}` : `${window.location.pathname}${window.location.search}`);
}
function initialWorkbenchSessions(tabs: WorkbenchTab[], sessionId: string): WorkbenchSession[] {
  const routeId = resolveInitialWorkbenchId(tabs, typeof window === "undefined" ? "" : window.location.hash);
  if (routeId === "__new") return [createProjectOverviewSession(sessionId)];
  if (routeId === "__project") return [createNewPageSession(sessionId)];
  const tab = tabs.find((item) => item.id === routeId);
  return [{ id: sessionId, workbenchId: routeId, title: translateWorkbench(routeId, tab?.label ?? routeId) }];
}

function resolveCasePresentation(detail: unknown): { title: string; interfaceName: string; parentId: string; icon: IconName } | null {
  if (!detail || typeof detail !== "object") return null;
  const value = detail as { name?: unknown; variables?: Record<string, string>; metadata?: Record<string, unknown> };
  if (!value.variables?.__apivoyCaseOf) return null;
  const interfaceName = typeof value.metadata?.__apivoyCaseInterfaceName === "string" ? value.metadata.__apivoyCaseInterfaceName.trim() : "";
  const status = typeof value.name === "string" ? value.name.trim() : "";
  return { title: interfaceName && status ? `${interfaceName}（${status}）` : interfaceName || status || "接口用例", interfaceName, parentId: value.variables.__apivoyCaseOf, icon: "bolt" };
}

function resolveOpenProtocol(detail: unknown): string | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const value = detail as Record<string, unknown>;
  if (typeof value.protocolId === "string") return value.protocolId;
  if (typeof value.protocol === "string") return value.protocol;
  const payload = value.payload;
  if (payload && typeof payload === "object" && typeof (payload as { type?: string }).type === "string") {
    return (payload as { type: string }).type;
  }
  return undefined;
}

function openDebugTab(sessionId: string) {
  queueMicrotask(() => window.dispatchEvent(new CustomEvent("apivoy-open-lifecycle-tab", {
    detail: { sessionId, tab: "debug" },
  })));
}

export function WorkbenchDeck({ tabs, children, saveTargetLabel, projects = [], selectedProjectId, onSelectProject, onCreateProject, onRenameProject, onCloneProject, onDeleteProject, onOpenProjectInNewWindow, definitionClient, onCreateHttpInterface, onLoadHttpInterface, interfaceCases = [], onDeleteHttpInterface }: WorkbenchDeckProps) {
  const items = Children.toArray(children); const { t } = useI18n();
  const active = useAppStore((state) => state.activeWorkbench); const setActive = useAppStore((state) => state.setActiveWorkbench);
  const favorites = useAppStore((state) => state.favoriteWorkbenches); const recent = useAppStore((state) => state.recentWorkbenches);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite); const collapsed = useAppStore((state) => state.collapsedNavigation); const toggleNavigation = useAppStore((state) => state.toggleNavigation);
  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const initialSessionId = useRef(crypto.randomUUID());
  const [sessions, setSessions] = useState<WorkbenchSession[]>(() => initialWorkbenchSessions(tabs, initialSessionId.current));
  const [activeSessionId, setActiveSessionId] = useState<string>(initialSessionId.current);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const selected = activeSession?.workbenchId ?? ""; const selectedIndex = tabs.findIndex((tab) => tab.id === selected);
  const [codeOpen, setCodeOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tabsMoreOpen, setTabsMoreOpen] = useState(false);
  const [tabsMenuAlign, setTabsMenuAlign] = useState<"left" | "right">("left");
  const [homeMoreOpen, setHomeMoreOpen] = useState(false);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [curlImportTarget, setCurlImportTarget] = useState<{ projectId?: string; collectionId?: string }>({});
  const [projectQuery, setProjectQuery] = useState("");
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectCreateBusy, setProjectCreateBusy] = useState(false);
  const [projectCreateError, setProjectCreateError] = useState("");
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [projectAction, setProjectAction] = useState<{ kind: "rename" | "clone" | "delete"; id: string; originalName: string } | null>(null);
  const [projectActionName, setProjectActionName] = useState("");
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [projectActionError, setProjectActionError] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabsMoreRef = useRef<HTMLDivElement>(null);
  const selectedTab = selectedIndex >= 0 ? tabs[selectedIndex] : null;

  useEffect(() => {
    const activeTab = tabScrollRef.current?.querySelector<HTMLElement>(".workbench-tab.is-active");
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeSessionId, sessions.length]);

  function activateSession(session: WorkbenchSession, writeHash = true) {
    setActiveSessionId(session.id);
    setPickerOpen(false);
    if (!session.workbenchId.startsWith("__")) setActive(session.workbenchId);
    if (writeHash && typeof window !== "undefined" && !session.workbenchId.startsWith("__")) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      params.set("workbench", session.workbenchId);
      history.pushState(null, "", `#${params}`);
    }
  }
  function activate(id: string, writeHash = true, resetDraft = true) { if (!tabMap.has(id)) return; const existing = [...sessions].reverse().find((session) => session.workbenchId === id); if (existing) activateSession(existing, writeHash); else createWorkbench(id, writeHash, resetDraft); }
  const activateRef = useRef(activate);
  activateRef.current = activate;
  function createWorkbench(id: string, writeHash = true, resetDraft = true, openedRequest?: { id?: string; name?: string; title?: string; icon?: IconName; caseInterfaceName?: string; caseParentId?: string }): WorkbenchSession | null {
    if (!tabMap.has(id)) return null;
    if (resetDraft) {
      clearWorkbenchDraft(id);
      window.dispatchEvent(new CustomEvent("apivoy-new-workbench", { detail: { workbenchId: id } }));
    }
    const sameTypeCount = sessions.filter((session) => session.workbenchId === id).length;
    const label = translateWorkbench(id, tabMap.get(id)?.label ?? id);
    const session = { id: crypto.randomUUID(), workbenchId: id, title: openedRequest?.title?.trim() || openedRequest?.name?.trim() || (sameTypeCount ? `${label} ${sameTypeCount + 1}` : label), requestId: openedRequest?.id, icon: openedRequest?.icon, caseInterfaceName: openedRequest?.caseInterfaceName, caseParentId: openedRequest?.caseParentId };
    setSessions((current) => activeSession?.workbenchId === "__new" || activeSession?.workbenchId === "__project" ? current.map((item) => item.id === activeSession.id ? session : item) : [...current, session]);
    activateSession(session, writeHash);
    return session;
  }
  function createNewPage() {
    const session = createNewPageSession(crypto.randomUUID());
    setSessions((current) => [...current, session]);
    setActiveSessionId(session.id);
    setPickerOpen(false);
  }
  function openScriptLibrary() {
    const existing = sessions.find((session) => session.workbenchId === "__scripts");
    if (existing) { activateSession(existing, false); return; }
    const session = { id: crypto.randomUUID(), workbenchId: "__scripts", title: "脚本库" };
    setSessions((current) => [...current, session]);
    activateSession(session, false);
  }
  function closeSession(id: string) {
    const index = sessions.findIndex((session) => session.id === id); if (index < 0) return;
    const remaining = sessions.filter((session) => session.id !== id);
    if (!remaining.length) {
      setSessions([]); setActiveSessionId(""); setPickerOpen(false); setTabsMoreOpen(false);
      if (typeof window !== "undefined") { const params = new URLSearchParams(window.location.hash.replace(/^#/, "")); params.delete("workbench"); history.pushState(null, "", `#${params}`); }
      return;
    }
    setSessions(remaining);
    if (id === activeSessionId) activateSession(remaining[Math.min(index, remaining.length - 1)]);
  }
  function closeAllSessions() {
    setSessions([]); setActiveSessionId(""); setTabsMoreOpen(false);
    if (typeof window !== "undefined") { const params = new URLSearchParams(window.location.hash.replace(/^#/, "")); params.delete("workbench"); history.pushState(null, "", `#${params}`); }
  }
  function closeOtherSessions() {
    if (!activeSession) return;
    setSessions([activeSession]); setTabsMoreOpen(false);
  }
  function openTabsMoreMenu() {
    const triggerBounds = tabsMoreRef.current?.getBoundingClientRect();
    const contentBounds = tabsMoreRef.current?.closest(".workbench-content")?.getBoundingClientRect();
    if (triggerBounds && contentBounds) {
      const menuWidth = 240;
      const leftCandidate = triggerBounds.left;
      const rightCandidate = triggerBounds.right - menuWidth;
      const overflow = (left: number) => Math.max(0, contentBounds.left - left) + Math.max(0, left + menuWidth - contentBounds.right);
      setTabsMenuAlign(overflow(rightCandidate) < overflow(leftCandidate) ? "right" : "left");
    }
    setTabsMoreOpen(true);
  }
  useEffect(() => {
    const openRequest = async (event: Event) => {
      let detail = (event as CustomEvent).detail;
      const protocol = resolveOpenProtocol(detail);
      const match = tabs.find((tab) => tab.protocol === protocol || tab.protocols?.includes(protocol ?? "") || tab.id === protocol);
      if (!match) return;
      const opened = detail as { id?: string; name?: string } | null;
      const casePresentation = resolveCasePresentation(detail);
      const stashedStructure = opened?.id ? consumeCaseInterfaceStructure(opened.id) : null;
      if (casePresentation && onLoadHttpInterface) {
        const parent = await onLoadHttpInterface(casePresentation.parentId).catch(() => null);
        const structure = parent ? captureHttpInterfaceStructure(parent) : null;
        if (structure) detail = { ...detail, metadata: { ...((detail as { metadata?: Record<string, unknown> }).metadata ?? {}), [INTERFACE_STRUCTURE_METADATA_KEY]: structure } };
      }
      if (casePresentation && stashedStructure && !onLoadHttpInterface) detail = { ...detail, metadata: { ...((detail as { metadata?: Record<string, unknown> }).metadata ?? {}), [INTERFACE_STRUCTURE_METADATA_KEY]: stashedStructure } };
      const existing = opened?.id ? sessions.find((item) => item.requestId === opened.id || item.id === opened.id) : undefined;
      if (existing) {
        activateSession(existing);
        return;
      }
      if (activeSession?.workbenchId === match.id && !activeSession.requestId) {
        const restored = { ...activeSession, requestId: opened?.id, title: casePresentation?.title || opened?.name?.trim() || activeSession.title, icon: casePresentation?.icon, caseInterfaceName: casePresentation?.interfaceName, caseParentId: casePresentation?.parentId };
        setSessions((current) => current.map((item) => item.id === activeSession.id ? restored : item));
        const hydrate = { workbenchId: match.id, sessionId: match.id === "http" ? restored.id : undefined, protocolId: protocol, envelope: detail };
        stashHydrate(hydrate);
        openDebugTab(restored.id);
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("apivoy-hydrate-request", { detail: hydrate })));
        return;
      }
      const session = createWorkbench(match.id, true, false, { id: opened?.id, name: opened?.name, title: casePresentation?.title, icon: casePresentation?.icon, caseInterfaceName: casePresentation?.interfaceName, caseParentId: casePresentation?.parentId });
      if (!session) return;
      const hydrate = { workbenchId: match.id, sessionId: match.id === "http" ? session.id : undefined, protocolId: protocol, envelope: detail };
      stashHydrate(hydrate);
      openDebugTab(session.id);
      queueMicrotask(() => window.dispatchEvent(new CustomEvent("apivoy-hydrate-request", { detail: hydrate })));
    };
    const selectWorkbench = (event: Event) => activate((event as CustomEvent<string>).detail);
    const createWorkbenchEvent = (event: Event) => createWorkbench((event as CustomEvent<string>).detail);
    const openProjectHome = () => {
      const existing = sessions.find((session) => session.workbenchId === "__new");
      if (existing) activateSession(existing, false);
      else {
        const overview = createProjectOverviewSession(crypto.randomUUID());
        setSessions((current) => [...current, overview]);
        setActiveSessionId(overview.id);
        setPickerOpen(false);
      }
      if (hashWorkbench()) clearInvalidWorkbenchHash();
    };
    window.addEventListener("apivoy-open-request", openRequest);
    window.addEventListener("apivoy-select-workbench", selectWorkbench);
    window.addEventListener("apivoy-create-workbench", createWorkbenchEvent);
    window.addEventListener("apivoy-open-script-library", openScriptLibrary);
    window.addEventListener("apivoy-project-home", openProjectHome);
    const openCurlImport = (event: Event) => { setCurlImportTarget(((event as CustomEvent<{ projectId?: string; collectionId?: string }>).detail) ?? {}); setCurlImportOpen(true); };
    window.addEventListener("apivoy-open-curl-import", openCurlImport);
    return () => {
      window.removeEventListener("apivoy-open-request", openRequest);
      window.removeEventListener("apivoy-select-workbench", selectWorkbench);
      window.removeEventListener("apivoy-create-workbench", createWorkbenchEvent);
      window.removeEventListener("apivoy-open-script-library", openScriptLibrary);
      window.removeEventListener("apivoy-project-home", openProjectHome);
      window.removeEventListener("apivoy-open-curl-import", openCurlImport);
    };
  }, [tabs, setActive, sessions]);
  useEffect(() => {
    const applyHash = () => {
      const id = resolveHashWorkbenchId(tabsRef.current, window.location.hash);
      if (id) { activateRef.current(id, false, false); return; }
      if (hashWorkbench()) clearInvalidWorkbenchHash();
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
  useEffect(() => { if (!selected || selected.startsWith("__") || selected === active) return; setActive(selected); }, [active, selected, setActive]);
  useEffect(() => { setCodeOpen(false); }, [selected]);
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [pickerOpen]);
  useEffect(() => {
    const explicit: Record<string, string[]> = {
      amqp: ["请求名称", "AMQP Broker 地址"], kafka: ["请求名称", "Kafka Broker 地址"], sql: ["请求名称", "数据库连接地址"],
      capture: ["代理监听地址"], mqtt: ["请求名称", "MQTT Broker 地址"], redis: ["请求名称", "Redis 地址"],
    };
    const ensureNames = () => {
      const panel = document.querySelector<HTMLElement>(`.workbench-content[data-workbench-label] .workbench-panel`);
      if (!panel) return;
      let unlabeledIndex = 0;
      panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea").forEach((control) => {
        if (control.type === "hidden" || control.closest("label") || control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) return;
        const placeholder = "placeholder" in control ? control.placeholder.trim() : "";
        const fallback = (explicit[selected]?.[unlabeledIndex] ?? placeholder) || `${translateWorkbench(selectedTab?.id ?? selected, selectedTab?.label ?? selected)} 字段 ${unlabeledIndex + 1}`;
        control.setAttribute("aria-label", fallback); control.dataset.autoLabel = "true"; unlabeledIndex += 1;
      });
    };
    queueMicrotask(ensureNames);
    const target = document.querySelector(".workbench-content");
    const observer = new MutationObserver(ensureNames); if (target) observer.observe(target, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selected]);

  const renderShortcut = (tab: WorkbenchTab) => (
    <button className="protocol-shortcut" key={tab.id} type="button" aria-label={translateWorkbench(tab.id, tab.label)} onClick={() => activate(tab.id)}>
      <Icon name={tab.icon ?? WORKBENCH_ICONS[tab.id] ?? "bolt"}/><span>{translateWorkbench(tab.id, tab.label)}</span>
    </button>
  );
  const renderTab = (tab: WorkbenchTab) => (
    <div className="protocol-item-wrap" key={tab.id}>
      <button className="protocol-item" data-testid={`workbench-${tab.id}`} aria-current={tab.id === selected ? "page" : undefined} aria-label={translateWorkbench(tab.id, tab.label)} title={collapsed ? translateWorkbench(tab.id, tab.label) : undefined} onClick={() => activate(tab.id)}>
        <span className="protocol-glyph" aria-hidden="true"><Icon name={tab.icon ?? WORKBENCH_ICONS[tab.id] ?? "bolt"} /></span>
        <span className="protocol-label">{translateWorkbench(tab.id, tab.label)}</span>
      </button>
      <button className={`favorite-button ${favorites.includes(tab.id) ? "is-favorite" : ""}`} aria-label={favorites.includes(tab.id) ? t("workbench.unfavorite", { name: tab.label }) : t("workbench.favorite", { name: tab.label })} onClick={() => toggleFavorite(tab.id)}><Icon name="star"/></button>
    </div>
  );
  const favoriteTabs = favorites.map((id) => tabMap.get(id)).filter(Boolean) as WorkbenchTab[];
  const showCode = selectedTab && ["graphql", "grpc", "sse", "tcp", "udp", "http"].includes(selectedTab.id);
  const frameStatus = (
    <span>
      {saveTargetLabel ? `${t("workbench.saveTarget")}: ${saveTargetLabel}` : t("status.ready")}
      {showCode ? ` · ${t("codegen.title")}` : ""}
    </span>
  );
  const toolbar = showCode && selected !== "http" ? (
    <button type="button" className="ui-button secondary" onClick={() => {
      setCodeOpen((value) => !value);
      window.dispatchEvent(new CustomEvent("apivoy-toggle-codegen", { detail: { workbenchId: selected } }));
    }}>{t("codegen.title")}</button>
  ) : null;
  const homeActions = [
    { id: "http", title: "新建 HTTP 请求", description: "创建并发送 REST / HTTP 请求", icon: "globe" as IconName },
    { id: "curl", title: "导入 cURL", description: "粘贴 cURL 命令并生成 HTTP 请求", icon: "download" as IconName },
    { id: "grpc", title: "新建 gRPC 请求", description: "通过 Reflection 或 Descriptor 调试服务", icon: "network" as IconName },
    { id: "mock", title: "新建 Mock", description: "快速配置本地模拟响应", icon: "archive" as IconName },
    { id: "runner", title: "运行当前集合", description: "批量执行集合中的请求", icon: "send" as IconName },
  ].filter((action) => action.id === "curl" || tabMap.has(action.id));
  function runHomeAction(id: string) {
    setHomeMoreOpen(false);
    if (id !== "curl") { createWorkbench(id); return; }
    setCurlImportOpen(true);
  }
  async function createCurlRequest(request: HttpWorkbenchRequest) {
    const id = request.id ?? crypto.randomUUID();
    const saved = { ...request, id, metadata: { ...(request.metadata ?? {}), [INTERFACE_STRUCTURE_METADATA_KEY]: captureHttpInterfaceStructure(request) } };
    const [fallbackProject = "", fallbackCollection = ""] = (saveTargetLabel ?? "").split(" / ");
    const projectId = curlImportTarget.projectId || selectedProjectId || fallbackProject;
    const collectionId = curlImportTarget.collectionId || fallbackCollection;
    if (onCreateHttpInterface) await onCreateHttpInterface(saved, projectId, collectionId);
    else {
      const httpIndex = tabs.findIndex((tab) => tab.id === "http");
      const httpWorkbench = items[httpIndex];
      if (isValidElement(httpWorkbench)) await (httpWorkbench as ReactElement<{ onSave?: (value: HttpWorkbenchRequest) => Promise<void> }>).props.onSave?.(saved);
    }
    const session = createWorkbench("http", true, true, { id, name: saved.name });
    if (!session) return;
    const hydrate = { workbenchId: "http", sessionId: session.id, protocolId: "http", envelope: { request: saved } };
    stashHydrate(hydrate);
    setCurlImportOpen(false);
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("apivoy-hydrate-request", { detail: hydrate })));
  }
  function enterProjectEmptySession() {
    window.dispatchEvent(new CustomEvent("apivoy-project-resources"));
    setSessions([]);
    setActiveSessionId("");
    setPickerOpen(false);
    setTabsMoreOpen(false);
  }
  function renderHomePage(sessionId: string) {
    const visibleProjects = projects.filter((project) => project.name.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()));
    const openProject = (projectId: string) => {
      onSelectProject?.(projectId);
      enterProjectEmptySession();
    };
    const openCreateProject = () => { setProjectName(""); setProjectCreateError(""); setProjectDialogOpen(true); };
    const openProjectAction = (kind: "rename" | "clone" | "delete", project: { id: string; name: string }) => {
      setProjectMenuId(null); setProjectActionError(""); setProjectAction({ kind, id: project.id, originalName: project.name });
      setProjectActionName(kind === "clone" ? `${project.name} 副本` : project.name);
    };
    const runProjectAction = async () => {
      if (!projectAction) return;
      setProjectActionBusy(true); setProjectActionError("");
      try {
        if (projectAction.kind === "rename") await onRenameProject?.(projectAction.id, projectActionName.trim());
        if (projectAction.kind === "clone") await onCloneProject?.(projectAction.id, projectActionName.trim());
        if (projectAction.kind === "delete") await onDeleteProject?.(projectAction.id);
        setProjectAction(null);
      } catch (error) { setProjectActionError(error instanceof Error ? error.message : String(error)); }
      finally { setProjectActionBusy(false); }
    };
    return <main className="project-launcher" aria-labelledby={`project-launcher-title-${sessionId}`}>
      <header className="project-launcher-header"><div><h1 id={`project-launcher-title-${sessionId}`}>项目</h1><p>管理主窗口中的项目、环境与扩展能力</p></div><div className="project-launcher-actions"><label><Icon name="search"/><input aria-label="搜索项目" value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="搜索项目"/></label><button type="button" className="ui-button secondary" onClick={() => window.dispatchEvent(new CustomEvent("apivoy-import-requests"))}>导入</button><button type="button" className="ui-button primary" onClick={openCreateProject}>新建项目</button></div></header>
      <div className="project-launcher-section-title">我的项目 <span>{projects.length}</span></div>
      <div className="project-card-grid">
        {visibleProjects.map((project) => <article className={`project-card-wrap${project.id === selectedProjectId ? " is-current" : ""}`} key={project.id}>
          <button type="button" className="project-card" onClick={() => { setProjectMenuId(null); openProject(project.id); }}><span className="project-card-icon"><Icon name="archive"/></span><strong>{project.name}</strong><p>{project.resourceCount ? `管理 ${project.resourceCount} 个多协议资源` : "尚未添加资源"}</p><footer><span>{project.resourceCount} 个资源</span><span className="project-protocols">{project.protocols.slice(0, 4).map((protocol) => <i key={protocol} title={protocol}>{protocol.slice(0, 1).toUpperCase()}</i>)}</span></footer></button>
          <div className="project-card-menu-area">{onOpenProjectInNewWindow ? <button type="button" className="project-card-open-window" aria-label={`在新窗口打开 ${project.name}`} title="在新窗口打开" onClick={() => onOpenProjectInNewWindow(project.id)}><Icon name="external"/></button> : null}<button type="button" className="project-card-more" aria-label={`${project.name} 更多操作`} aria-haspopup="menu" aria-expanded={projectMenuId === project.id} onClick={() => setProjectMenuId((current) => current === project.id ? null : project.id)}><Icon name="more"/></button>{projectMenuId === project.id ? <div className="project-card-menu" role="menu" aria-label={`${project.name} 项目操作`}><button type="button" role="menuitem" onClick={() => openProjectAction("rename", project)}><Icon name="edit"/>修改名称</button><button type="button" role="menuitem" onClick={() => openProjectAction("clone", project)}><Icon name="copy"/>克隆项目</button><button type="button" role="menuitem" className="is-danger" onClick={() => openProjectAction("delete", project)}><Icon name="trash"/>删除项目</button></div> : null}</div>
        </article>)}
        <button type="button" className="project-card project-card-create" onClick={openCreateProject}><span className="project-create-icon"><Icon name="plus"/></span><strong>创建新项目</strong><p>从空项目开始，或导入已有 API 定义</p></button>
      </div>
      {projectDialogOpen ? <div className="dialog-backdrop" role="presentation" onMouseDown={() => !projectCreateBusy && setProjectDialogOpen(false)}><div className="project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title" onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id="project-create-title">新建项目</h2><p>项目用于隔离资源、环境和运行配置。</p></div><button type="button" className="ui-icon-button" aria-label="关闭" disabled={projectCreateBusy} onClick={() => setProjectDialogOpen(false)}><Icon name="close"/></button></header><label><span>项目名称</span><input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="请输入项目名称"/></label>{projectCreateError ? <p className="project-create-error" role="alert">{projectCreateError}</p> : null}<footer><button type="button" className="ui-button secondary" disabled={projectCreateBusy} onClick={() => setProjectDialogOpen(false)}>取消</button><button type="button" className="ui-button primary" disabled={projectCreateBusy || !projectName.trim()} onClick={async () => { if (!onCreateProject) return; setProjectCreateBusy(true); setProjectCreateError(""); try { await onCreateProject(projectName.trim()); setProjectDialogOpen(false); setProjectName(""); enterProjectEmptySession(); } catch (error) { setProjectCreateError(error instanceof Error ? error.message : String(error)); } finally { setProjectCreateBusy(false); } }}>{projectCreateBusy ? "创建中…" : "创建项目"}</button></footer></div></div> : null}
      {projectAction ? <div className="dialog-backdrop" role="presentation" onMouseDown={() => !projectActionBusy && setProjectAction(null)}><div className="project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-action-title" onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id="project-action-title">{projectAction.kind === "rename" ? "修改项目名称" : projectAction.kind === "clone" ? "克隆项目" : "删除项目"}</h2><p>{projectAction.kind === "delete" ? `删除“${projectAction.originalName}”后，其中的集合和请求也会被删除。` : projectAction.kind === "clone" ? "将复制项目中的集合层级和全部请求。" : "修改后会同步更新项目入口和项目导航。"}</p></div><button type="button" className="ui-icon-button" aria-label="关闭" disabled={projectActionBusy} onClick={() => setProjectAction(null)}><Icon name="close"/></button></header>{projectAction.kind !== "delete" ? <label><span>项目名称</span><input autoFocus value={projectActionName} onChange={(event) => setProjectActionName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && projectActionName.trim()) void runProjectAction(); }}/></label> : null}{projectActionError ? <p className="project-create-error" role="alert">{projectActionError}</p> : null}<footer><button type="button" className="ui-button secondary" disabled={projectActionBusy} onClick={() => setProjectAction(null)}>取消</button><button type="button" className={`ui-button ${projectAction.kind === "delete" ? "danger" : "primary"}`} disabled={projectActionBusy || (projectAction.kind !== "delete" && !projectActionName.trim())} onClick={() => void runProjectAction()}>{projectActionBusy ? "处理中…" : projectAction.kind === "delete" ? "确认删除" : projectAction.kind === "clone" ? "创建副本" : "保存"}</button></footer></div></div> : null}
    </main>;
  }
  function renderProjectHomePage(sessionId: string) {
    const primaryActions = homeActions.slice(0, 2);
    const moreActions = homeActions.slice(2);
    return <main className="workbench-home" aria-labelledby={`workbench-home-title-${sessionId}`}>
      <div className="workbench-home-copy"><span>APIVOY WORKSPACE</span><h1 id={`workbench-home-title-${sessionId}`}>从这里开始探索接口</h1><p>{saveTargetLabel ? `当前保存位置：${saveTargetLabel}` : "选择一种工作台，或从左侧资源树打开已有请求。"}</p></div>
      <div className="workbench-home-actions">{primaryActions.map((action) => <button key={action.id} type="button" onClick={() => runHomeAction(action.id)}><span className={`workbench-home-action-icon tone-${action.id}`}><Icon name={action.icon}/></span><strong>{action.title}</strong><small>{action.description}</small></button>)}</div>
      {moreActions.length ? <div className="workbench-home-more"><button type="button" className="workbench-home-more-trigger" aria-haspopup="menu" aria-expanded={homeMoreOpen} onClick={() => setHomeMoreOpen((open) => !open)}>更多功能 <Icon name="chevron"/></button>{homeMoreOpen ? <div className="workbench-home-more-menu" role="menu" aria-label="更多功能">{moreActions.map((action) => <button key={action.id} type="button" role="menuitem" onClick={() => runHomeAction(action.id)}><span className={`workbench-home-action-icon tone-${action.id}`}><Icon name={action.icon}/></span><span><strong>{action.title}</strong><small>{action.description}</small></span></button>)}</div> : null}</div> : null}
    </main>;
  }
  function updateSessionTitle(id: string, title: string) {
    setSessions((current) => {
      const target = current.find((session) => session.id === id);
      if (!target || target.title === title) return current;
      return current.map((session) => session.id === id ? { ...session, title } : session);
    });
  }

  function renderSession(session: WorkbenchSession) {
    if (session.workbenchId === "__new") return renderHomePage(session.id);
    if (session.workbenchId === "__project") return renderProjectHomePage(session.id);
    if(session.workbenchId==="__scripts") return <ScriptLibraryWorkbench projectId={saveTargetLabel?.split(" / ")[0] || "default-project"}/>;
    const index = tabs.findIndex((tab) => tab.id === session.workbenchId); if (index < 0) return null;
    const tab = tabs[index]; const source = items[index];
    const lifecycle = (content: ReactNode) => {
      const caseName = session.caseInterfaceName && session.title.startsWith(`${session.caseInterfaceName}（`)
        ? session.title.slice(session.caseInterfaceName.length + 1).replace(/）$/, "")
        : session.title;
      const cases = session.requestId ? interfaceCases.filter((item) => item.parentId === session.requestId && item.metadata?.__apivoyCaseType === "test") : [];
      const openCase = onLoadHttpInterface ? async (caseId: string) => {
        const detail = await onLoadHttpInterface(caseId);
        if (detail) window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: { ...detail, protocolId: "http", metadata: { ...(detail.metadata ?? {}), __apivoyCaseInterfaceName: session.title } } }));
      } : undefined;
      const saveCase = onLoadHttpInterface && onCreateHttpInterface ? async (caseId: string | null, input: { name: string; group: string; tags: string[]; request?: HttpWorkbenchRequest }) => {
        const source = input.request ?? await onLoadHttpInterface(caseId ?? session.requestId ?? ""); if (!source) return;
        const summary = caseId ? interfaceCases.find((item) => item.id === caseId) : undefined;
        const [fallbackProject = selectedProjectId ?? "", fallbackCollection = ""] = (saveTargetLabel ?? "").split(" / ");
        await onCreateHttpInterface({ ...source, id: caseId ?? crypto.randomUUID(), name: input.name, variables: { ...(source.variables ?? {}), __apivoyCaseOf: session.requestId ?? source.id ?? "", __apivoyCaseInterfaceName: session.title }, metadata: { ...(source.metadata ?? {}), __apivoyCaseType: "test", __apivoyCaseGroup: input.group, __apivoyCaseTags: input.tags } }, summary?.projectId ?? fallbackProject, summary?.collectionId ?? fallbackCollection);
      } : undefined;
      const duplicateCase = onLoadHttpInterface && onCreateHttpInterface ? async (caseId: string) => { const source = await onLoadHttpInterface(caseId); const summary = interfaceCases.find((item) => item.id === caseId); if (!source || !summary) return; const [fallbackProject = selectedProjectId ?? "", fallbackCollection = ""] = (saveTargetLabel ?? "").split(" / "); await onCreateHttpInterface({ ...source, id: crypto.randomUUID(), name: `${source.name ?? "测试用例"} 副本` }, summary.projectId ?? fallbackProject, summary.collectionId ?? fallbackCollection); } : undefined;
      const copyCurl = onLoadHttpInterface ? async (caseId: string) => { const source = await onLoadHttpInterface(caseId); if (!source) return ""; const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`; return [`curl --location --request ${source.method} ${quote(source.url)}`, ...source.headers.map(([key,value]) => `  --header ${quote(`${key}: ${value}`)}`), ...(source.body ? [`  --data-raw ${quote(source.body)}`] : [])].join(" \\\n"); } : undefined;
      const sendCase = isValidElement(source) ? (source as ReactElement<{ onSend?: HttpWorkbenchProps["onSend"] }>).props.onSend : undefined;
      const runCases = onLoadHttpInterface && sendCase ? async (caseIds: string[]): Promise<Record<string, InterfaceCaseRunOutcome>> => Object.fromEntries(await Promise.all(caseIds.map(async (id) => { const request = await onLoadHttpInterface(id); if (!request) return [id, { passed: false, error: "用例不存在" }] as const; const result = await sendCase(request); return [id, { passed: !result.error, error: result.error, status: result.summary.status ?? null, durationMs: result.summary.durationMs, body: result.preview, headers: result.responseMeta?.headers ?? [] }] as const; }))) : undefined;
      const deleteCase = onDeleteHttpInterface ?? (async (caseId: string) => { window.dispatchEvent(new CustomEvent("apivoy-delete-test-case", { detail: { caseId } })); });
      return <InterfaceLifecycleShell workbenchId={session.workbenchId} sessionId={session.id} title={session.title} projectId={selectedProjectId} requestId={session.requestId ?? session.id} definitionClient={definitionClient} caseMode={Boolean(session.caseParentId)} caseInterfaceName={session.caseInterfaceName} caseName={caseName} cases={cases} onOpenCase={openCase} onSaveCase={saveCase} onDeleteCase={deleteCase} onDuplicateCase={duplicateCase} onRunCases={runCases} onRunRequest={sendCase} onCopyCurl={copyCurl} onLoadCase={onLoadHttpInterface}>{content}</InterfaceLifecycleShell>;
    };
    const sourceWithSaveIdentity = isValidElement(source) ? (() => {
      const element = source as ReactElement<{ onSave?: (request: Record<string, unknown>) => Promise<void>; onSaveAsCase?: (request: Record<string, unknown>) => Promise<void>; onUpdateInterface?: (request: Record<string, unknown>) => Promise<void> }>;
      const onSave = element.props.onSave;
      if (!onSave) return element;
      const requestId = session.requestId ?? session.id;
      return cloneElement(element, { onSave: (request) => onSave({ ...request, id: requestId }), onSaveAsCase: (request) => onSave({ ...request, id: crypto.randomUUID(), name: String(request.name || session.title + " - 成功用例"), variables: { ...((request.variables as Record<string, string> | undefined) ?? {}), __apivoyCaseOf: requestId, __apivoyCaseInterfaceName: session.title.replace(/^[A-Z]+\s+/, "") } }), onUpdateInterface: session.caseParentId ? (request) => onSave({ ...request, id: session.caseParentId }) : undefined });
    })() : source;
    if (session.workbenchId === "http" && isValidElement(source)) {
      const item = cloneElement(sourceWithSaveIdentity as ReactElement<{ onTitleChange?: (title: string) => void; toolbarTargetId?: string; commandbarTargetId?: string; workbenchSessionId?: string }>, { key: session.id, workbenchSessionId: session.id, toolbarTargetId: `workbench-context-${session.id}`, commandbarTargetId: `interface-commandbar-${session.id}`, onTitleChange: (title: string) => updateSessionTitle(session.id, session.caseInterfaceName ? `${session.caseInterfaceName}（${title.replace(/^[A-Z]+\s+/, "")}）` : title) });
      return lifecycle(item);
    }
    if ((session.workbenchId === "websocket" || session.workbenchId === "sse" || session.workbenchId === "tcp" || session.workbenchId === "udp" || session.workbenchId === "grpc") && isValidElement(source)) {
      const item = cloneElement(sourceWithSaveIdentity as ReactElement<{ onTitleChange?: (title: string) => void }>, { key: session.id, onTitleChange: (title: string) => updateSessionTitle(session.id, title) });
      return lifecycle(<WorkbenchFrame title={translateWorkbench(tab.id, tab.label)} hideHeader toolbar={session.id === activeSessionId ? toolbar : null} status={frameStatus}><div className={`standardized-workbench layout-${LAYOUT_BY_WORKBENCH[session.workbenchId] ?? "request"}${codeOpen && session.id === activeSessionId ? " codegen-open" : ""}`}>{item}</div></WorkbenchFrame>);
    }
    const item = isValidElement(sourceWithSaveIdentity) ? cloneElement(sourceWithSaveIdentity, { key: session.id }) : sourceWithSaveIdentity;
    return lifecycle(<WorkbenchFrame title={translateWorkbench(tab.id, tab.label)} description={GROUP_BY_WORKBENCH.get(session.workbenchId)} badge={<span className="protocol-badge">{tab.protocol ?? tab.id.toUpperCase()}</span>} toolbar={session.id === activeSessionId ? toolbar : null} status={frameStatus}><div className={`standardized-workbench layout-${LAYOUT_BY_WORKBENCH[session.workbenchId] ?? "request"}${codeOpen && session.id === activeSessionId ? " codegen-open" : ""}`}>{item}</div></WorkbenchFrame>);
  }

  return (
    <div className={`workbench-deck ${collapsed ? "protocol-nav-collapsed" : ""}`}>
      <aside className="protocol-nav" aria-label={t("workbench.navigation")}>
        <div className="protocol-nav-header">
          <span>{t("workbench.navigation")}</span>
          <button className="ui-icon-button compact" onClick={toggleNavigation} aria-label={t("workbench.navigation.toggle")}><Icon name={collapsed ? "chevron" : "menu"}/></button>
        </div>
        <div className="workbench-create" ref={pickerRef}>
          <button type="button" className="workbench-create-button" aria-haspopup="menu" aria-expanded={pickerOpen} onClick={() => setPickerOpen((value) => !value)} title="新建工作台"><Icon name="plus"/><span>新建</span></button>
          {pickerOpen ? <div className="workbench-type-picker" role="menu" aria-label="选择工作台类型">
            {DEFAULT_WORKBENCH_GROUPS.map((group) => { const groupTabs = group.workbenchIds.map((id) => tabMap.get(id)).filter(Boolean) as WorkbenchTab[]; return groupTabs.length ? <section key={group.id}><div className="workbench-picker-group"><Icon name={group.icon}/><span>{group.label}</span></div>{groupTabs.map((tab) => <button key={tab.id} type="button" role="menuitem" onClick={() => createWorkbench(tab.id)}><Icon name={tab.icon ?? WORKBENCH_ICONS[tab.id] ?? "bolt"}/><span>{translateWorkbench(tab.id, tab.label)}</span></button>)}</section> : null; })}
          </div> : null}
        </div>
        {selectedTab ? <div className="protocol-list protocol-current"><div className="protocol-group-title"><span>当前工作台</span></div>{renderTab(selectedTab)}</div> : selected === "__scripts" ? <div className="protocol-list protocol-current"><div className="protocol-group-title"><span>当前工作台</span></div><div className="protocol-item-wrap"><button type="button" className="protocol-item" aria-current="page" aria-label="脚本库" onClick={openScriptLibrary}><span className="protocol-glyph" aria-hidden="true"><Icon name="code" /></span><span className="protocol-label">脚本库</span></button></div></div> : null}
        {!collapsed && favoriteTabs.length ? <div className="protocol-shortcuts" aria-label={t("workbench.favorites")}><div className="protocol-group-title"><Icon name="star"/><span>{t("workbench.favorites")}</span></div>{favoriteTabs.map(renderShortcut)}</div> : null}
        {!collapsed && recent.length ? <div className="protocol-shortcuts" aria-label={t("workbench.recent")}><div className="protocol-group-title"><Icon name="activity"/><span>{t("workbench.recent")}</span></div>{recent.slice(0,3).map((id) => tabMap.get(id)).filter(Boolean).map((tab) => renderShortcut(tab!))}</div> : null}
      </aside>
      <CurlImportDialog open={curlImportOpen} onClose={() => setCurlImportOpen(false)} onCreate={createCurlRequest}/>
      <div className="workbench-content" data-workbench-label={selectedTab ? translateWorkbench(selectedTab.id, selectedTab.label) : selected === "__scripts" ? "脚本库" : ""}>
        {selected !== "__new" ? <div className="workbench-tabs"><div className="workbench-tab-scroll" ref={tabScrollRef} role="tablist" aria-label="已打开的工作台">{sessions.map((session) => <div className={`workbench-tab${session.id === activeSessionId ? " is-active" : ""}`} key={session.id}><button type="button" role="tab" aria-selected={session.id === activeSessionId} onClick={() => activateSession(session)}><Icon name={session.icon ?? WORKBENCH_ICONS[session.workbenchId] ?? "plus"}/><span>{session.title}</span></button><button type="button" className="workbench-tab-close" aria-label={`关闭 ${session.title}`} onClick={() => closeSession(session.id)}><Icon name="close"/></button></div>)}</div><div className="workbench-tab-tools"><button type="button" className="ui-icon-button compact" aria-label="新建" title="新建" onClick={createNewPage}><Icon name="plus"/></button><div ref={tabsMoreRef} className={`workbench-tabs-more is-align-${tabsMenuAlign}`} onMouseEnter={openTabsMoreMenu} onMouseLeave={() => setTabsMoreOpen(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setTabsMoreOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setTabsMoreOpen(false); }}><button type="button" className="ui-icon-button compact" aria-label="更多页签操作" title="更多" aria-haspopup="menu" aria-expanded={tabsMoreOpen} onFocus={openTabsMoreMenu}><Icon name="more"/></button>{tabsMoreOpen ? <div className="workbench-tabs-menu" role="menu" aria-label="页签列表与操作"><div className="workbench-tabs-menu-list">{sessions.length ? sessions.map((session) => <button type="button" role="menuitem" className={session.id === activeSessionId ? "is-active" : undefined} key={session.id} onClick={() => { activateSession(session); setTabsMoreOpen(false); }}><Icon name={session.icon ?? WORKBENCH_ICONS[session.workbenchId] ?? "plus"}/><span>{session.title}</span></button>) : <span className="workbench-tabs-empty">暂无打开的页签</span>}</div><div className="workbench-tabs-menu-actions"><button type="button" role="menuitem" disabled={!sessions.length} onClick={closeAllSessions}>关闭全部标签页</button><button type="button" role="menuitem" disabled={!activeSession} onClick={() => activeSession && closeSession(activeSession.id)}>关闭当前标签页</button><button type="button" role="menuitem" disabled={!activeSession || sessions.length < 2} onClick={closeOtherSessions}>关闭其他标签页</button></div></div> : null}</div></div>{sessions.length ? <div className="workbench-context-actions" aria-label="当前工作台选项">{sessions.map((session) => <div id={`workbench-context-${session.id}`} key={session.id} hidden={session.id !== activeSessionId}/>)}</div> : null}</div> : null}
        <div className="workbench-session-stack">{sessions.length ? sessions.map((session) => <div key={session.id} role="tabpanel" aria-label={session.title} hidden={session.id !== activeSessionId} className="workbench-panel">{renderSession(session)}</div>) : <div className="workbench-panel workbench-empty-session">{renderProjectHomePage("empty")}</div>}</div>
        {items.slice(tabs.length)}
      </div>
    </div>
  );
}
