import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { useAppStore } from "./appStore";
import { translateWorkbench, useI18n } from "./i18n";
import { stashHydrate } from "./openRequestPipeline";
import { WorkbenchFrame } from "./WorkbenchFrame";
import { clearWorkbenchDraft } from "./draftRecovery";
import { ScriptLibraryWorkbench } from "./ScriptLibraryWorkbench";

export interface WorkbenchDefinition { id: string; label: string; protocol?: string; protocols?: string[]; group?: string; icon?: IconName }
export type WorkbenchTab = WorkbenchDefinition;
export interface WorkbenchGroup { id: string; label: string; icon: IconName; workbenchIds: string[] }
interface WorkbenchSession { id: string; workbenchId: string; title: string }
export interface WorkbenchDeckProps {
  tabs: WorkbenchTab[];
  children: ReactNode;
  /** UX-012: show save target in frame status */
  saveTargetLabel?: string;
  /** Show a project home canvas until the user opens or creates a workbench. */
  startOnHome?: boolean;
}
export const WORKBENCH_LABELS: Record<string, string> = { http:"HTTP", graphql:"GraphQL", grpc:"gRPC", rpc:"SOAP / RPC", websocket:"WebSocket", sse:"SSE", socket:"TCP / UDP", mqtt:"MQTT", amqp:"AMQP", kafka:"Kafka", redis:"Redis", sql:"SQL", mock:"Mock", runner:"Runner", gateway:"Gateway", capture:"Capture", plugins:"Plugins", ai:"AI" };
export const WORKBENCH_ICONS: Record<string, IconName> = {
  http: "globe", graphql: "code", grpc: "network", rpc: "code", websocket: "activity", sse: "activity", socket: "network",
  mqtt: "network", amqp: "network", kafka: "network", redis: "database", sql: "database",
  mock: "archive", runner: "send", gateway: "globe", capture: "search", plugins: "command", ai: "bolt", __scripts: "code",
};
export const DEFAULT_WORKBENCH_GROUPS: WorkbenchGroup[] = [
  { id:"api", label:"API", icon:"globe", workbenchIds:["http","grpc"] },
  { id:"realtime", label:"实时通信", icon:"activity", workbenchIds:["websocket","sse","socket"] },
  { id:"messaging", label:"消息", icon:"network", workbenchIds:["mqtt","amqp","kafka"] },
  { id:"data", label:"数据", icon:"database", workbenchIds:["redis","sql"] },
  { id:"tools", label:"工具", icon:"bolt", workbenchIds:["mock","runner","gateway","capture","plugins","ai"] },
];
const GROUP_BY_WORKBENCH = new Map(DEFAULT_WORKBENCH_GROUPS.flatMap((group) => group.workbenchIds.map((id) => [id, group.label])));
const LAYOUT_BY_WORKBENCH: Record<string, "request" | "stream" | "editor" | "management"> = { graphql:"request", grpc:"request", rpc:"request", websocket:"stream", sse:"stream", socket:"stream", mqtt:"stream", amqp:"stream", kafka:"stream", redis:"editor", sql:"editor", mock:"management", runner:"management", gateway:"management", capture:"management", plugins:"management", ai:"management" };
export function resolveWorkbenchId(tabs: WorkbenchTab[], stored: string | null) { return tabs.some((tab) => tab.id === stored) ? stored! : tabs[0]?.id ?? ""; }
function hashWorkbench() { if (typeof window === "undefined") return null; return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("workbench"); }

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

export function WorkbenchDeck({ tabs, children, saveTargetLabel, startOnHome = false }: WorkbenchDeckProps) {
  const items = Children.toArray(children); const { t } = useI18n();
  const active = useAppStore((state) => state.activeWorkbench); const setActive = useAppStore((state) => state.setActiveWorkbench);
  const favorites = useAppStore((state) => state.favoriteWorkbenches); const recent = useAppStore((state) => state.recentWorkbenches);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite); const collapsed = useAppStore((state) => state.collapsedNavigation); const toggleNavigation = useAppStore((state) => state.toggleNavigation);
  const initialWorkbench = resolveWorkbenchId(tabs, hashWorkbench() ?? active); const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const initialSessionId = useRef(crypto.randomUUID());
  const [sessions, setSessions] = useState<WorkbenchSession[]>(() => startOnHome ? [] : [{ id: initialSessionId.current, workbenchId: initialWorkbench, title: translateWorkbench(initialWorkbench, tabMap.get(initialWorkbench)?.label ?? initialWorkbench) }]);
  const [activeSessionId, setActiveSessionId] = useState<string>(startOnHome ? "" : initialSessionId.current);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const selected = activeSession?.workbenchId ?? ""; const selectedIndex = tabs.findIndex((tab) => tab.id === selected);
  const [codeOpen, setCodeOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedTab = selectedIndex >= 0 ? tabs[selectedIndex] : null;

  function activateSession(session: WorkbenchSession, writeHash = true) { setActiveSessionId(session.id); setPickerOpen(false); setActive(session.workbenchId); if (writeHash && typeof window !== "undefined") { const params = new URLSearchParams(window.location.hash.replace(/^#/, "")); params.set("workbench", session.workbenchId); history.pushState(null, "", `#${params}`); } }
  function activate(id: string, writeHash = true) { if (!tabMap.has(id)) return; const existing = [...sessions].reverse().find((session) => session.workbenchId === id); if (existing) activateSession(existing, writeHash); else createWorkbench(id, writeHash); }
  function createWorkbench(id: string, writeHash = true) {
    if (!tabMap.has(id)) return;
    clearWorkbenchDraft(id);
    window.dispatchEvent(new CustomEvent("apivoy-new-workbench", { detail: { workbenchId: id } }));
    const sameTypeCount = sessions.filter((session) => session.workbenchId === id).length;
    const label = translateWorkbench(id, tabMap.get(id)?.label ?? id);
    const session = { id: crypto.randomUUID(), workbenchId: id, title: sameTypeCount ? `${label} ${sameTypeCount + 1}` : label };
    setSessions((current) => [...current, session]);
    activateSession(session, writeHash);
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
      setSessions([]); setActiveSessionId(""); setPickerOpen(false);
      if (typeof window !== "undefined") { const params = new URLSearchParams(window.location.hash.replace(/^#/, "")); params.delete("workbench"); history.pushState(null, "", `#${params}`); }
      return;
    }
    setSessions(remaining);
    if (id === activeSessionId) activateSession(remaining[Math.min(index, remaining.length - 1)]);
  }
  useEffect(() => {
    const openRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const protocol = resolveOpenProtocol(detail);
      const match = tabs.find((tab) => tab.protocol === protocol || tab.protocols?.includes(protocol ?? "") || tab.id === protocol);
      if (!match) return;
      const hydrate = { workbenchId: match.id, protocolId: protocol, envelope: detail };
      stashHydrate(hydrate);
      activate(match.id);
      queueMicrotask(() => window.dispatchEvent(new CustomEvent("apivoy-hydrate-request", { detail: hydrate })));
    };
    const selectWorkbench = (event: Event) => activate((event as CustomEvent<string>).detail);
    const createWorkbenchEvent = (event: Event) => createWorkbench((event as CustomEvent<string>).detail);
    const syncHash = () => { const id = hashWorkbench(); if (id && tabMap.has(id)) setActive(id); };
    window.addEventListener("apivoy-open-request", openRequest);
    window.addEventListener("apivoy-select-workbench", selectWorkbench);
    window.addEventListener("apivoy-create-workbench", createWorkbenchEvent);
    window.addEventListener("apivoy-open-script-library", openScriptLibrary);
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.removeEventListener("apivoy-open-request", openRequest);
      window.removeEventListener("apivoy-select-workbench", selectWorkbench);
      window.removeEventListener("apivoy-create-workbench", createWorkbenchEvent);
      window.removeEventListener("apivoy-open-script-library", openScriptLibrary);
      window.removeEventListener("hashchange", syncHash);
    };
  }, [tabs, setActive, sessions]);
  useEffect(() => { if (selected && selected !== active) setActive(selected); }, [active, selected, setActive]);
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
  const showCode = selectedTab && ["graphql", "grpc", "websocket", "sse", "socket", "http"].includes(selectedTab.id);
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
    if (id !== "curl") { createWorkbench(id); return; }
    createWorkbench("http");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("apivoy-open-curl-import")), 0);
  }
  function updateSessionTitle(id: string, title: string) {
    setSessions((current) => {
      const target = current.find((session) => session.id === id);
      if (!target || target.title === title) return current;
      return current.map((session) => session.id === id ? { ...session, title } : session);
    });
  }

  function renderSession(session: WorkbenchSession) {
    if(session.workbenchId==="__scripts") return <ScriptLibraryWorkbench projectId={saveTargetLabel?.split(" / ")[0] || "default-project"}/>;
    const index = tabs.findIndex((tab) => tab.id === session.workbenchId); if (index < 0) return null;
    const tab = tabs[index]; const source = items[index];
    if (session.workbenchId === "http" && isValidElement(source)) {
      const item = cloneElement(source as ReactElement<{ onTitleChange?: (title: string) => void; toolbarTargetId?: string }>, { key: session.id, toolbarTargetId: `workbench-context-${session.id}`, onTitleChange: (title: string) => updateSessionTitle(session.id, title) });
      return item;
    }
    const item = isValidElement(source) ? cloneElement(source, { key: session.id }) : source;
    return <WorkbenchFrame title={translateWorkbench(tab.id, tab.label)} description={GROUP_BY_WORKBENCH.get(session.workbenchId)} badge={<span className="protocol-badge">{tab.protocol ?? tab.id.toUpperCase()}</span>} toolbar={session.id === activeSessionId ? toolbar : null} status={frameStatus}><div className={`standardized-workbench layout-${LAYOUT_BY_WORKBENCH[session.workbenchId] ?? "request"}${codeOpen && session.id === activeSessionId ? " codegen-open" : ""}`}>{item}</div></WorkbenchFrame>;
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
      <div className="workbench-content" data-workbench-label={selectedTab ? translateWorkbench(selectedTab.id, selectedTab.label) : selected === "__scripts" ? "脚本库" : ""}>
        {sessions.length ? <div className="workbench-tabs" role="tablist" aria-label="已打开的工作台">{sessions.map((session) => <div className={`workbench-tab${session.id === activeSessionId ? " is-active" : ""}`} key={session.id}><button type="button" role="tab" aria-selected={session.id === activeSessionId} onClick={() => activateSession(session)}><Icon name={WORKBENCH_ICONS[session.workbenchId] ?? "bolt"}/><span>{session.title}</span></button><button type="button" className="workbench-tab-close" aria-label={`关闭 ${session.title}`} onClick={() => closeSession(session.id)}><Icon name="close"/></button></div>)}<div className="workbench-tab-add" ref={pickerRef}><button type="button" className="ui-icon-button compact" aria-label="新增工作台" aria-haspopup="menu" aria-expanded={pickerOpen} onClick={() => setPickerOpen((value) => !value)}><Icon name="plus"/></button>{pickerOpen ? <div className="workbench-type-picker workbench-tab-picker" role="menu" aria-label="选择工作台类型">{DEFAULT_WORKBENCH_GROUPS.map((group) => { const groupTabs = group.workbenchIds.map((id) => tabMap.get(id)).filter(Boolean) as WorkbenchTab[]; return groupTabs.length ? <section key={group.id}><div className="workbench-picker-group"><Icon name={group.icon}/><span>{group.label}</span></div>{groupTabs.map((tab) => <button key={tab.id} type="button" role="menuitem" onClick={() => createWorkbench(tab.id)}><Icon name={tab.icon ?? WORKBENCH_ICONS[tab.id] ?? "bolt"}/><span>{translateWorkbench(tab.id, tab.label)}</span></button>)}</section> : null; })}</div> : null}</div></div> : <div className="workbench-home-bar"><strong>项目主页</strong><button type="button" aria-label="新建 HTTP 请求" title="新建 HTTP 请求" onClick={() => createWorkbench("http")}><Icon name="plus"/></button></div>}
        {sessions.length ? <div className="workbench-context-actions" aria-label="当前工作台选项">{sessions.map((session) => <div id={`workbench-context-${session.id}`} key={session.id} hidden={session.id !== activeSessionId}/>)}</div> : null}
        <div className="workbench-session-stack">{sessions.length ? sessions.map((session) => <div key={session.id} role="tabpanel" aria-label={session.title} hidden={session.id !== activeSessionId} className="workbench-panel">{renderSession(session)}</div>) : <main className="workbench-home" aria-labelledby="workbench-home-title"><div className="workbench-home-copy"><span>APIVOY WORKSPACE</span><h1 id="workbench-home-title">从这里开始探索接口</h1><p>{saveTargetLabel ? `当前保存位置：${saveTargetLabel}` : "选择一种工作台，或从左侧资源树打开已有请求。"}</p></div><div className="workbench-home-actions">{homeActions.map((action) => <button key={action.id} type="button" onClick={() => runHomeAction(action.id)}><span className={`workbench-home-action-icon tone-${action.id}`}><Icon name={action.icon}/></span><strong>{action.title}</strong><small>{action.description}</small></button>)}</div><div className="workbench-home-hint"><Icon name="folder"/><span>也可以从左侧资源树打开已保存的请求</span></div></main>}</div>
        {items.slice(tabs.length)}
      </div>
    </div>
  );
}
