import { Children, useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { useAppStore } from "./appStore";
import { translateWorkbench, useI18n } from "./i18n";
import { stashHydrate } from "./openRequestPipeline";
import { WorkbenchFrame } from "./WorkbenchFrame";

export interface WorkbenchDefinition { id: string; label: string; protocol?: string; protocols?: string[]; group?: string; icon?: IconName }
export type WorkbenchTab = WorkbenchDefinition;
export interface WorkbenchGroup { id: string; label: string; icon: IconName; workbenchIds: string[] }
export interface WorkbenchDeckProps {
  tabs: WorkbenchTab[];
  children: ReactNode;
  /** UX-012: show save target in frame status */
  saveTargetLabel?: string;
}
export const WORKBENCH_LABELS: Record<string, string> = { http:"HTTP", graphql:"GraphQL", grpc:"gRPC", rpc:"SOAP / RPC", websocket:"WebSocket", sse:"SSE", socket:"TCP / UDP", mqtt:"MQTT", amqp:"AMQP", kafka:"Kafka", redis:"Redis", sql:"SQL", mock:"Mock", runner:"Runner", gateway:"Gateway", capture:"Capture", plugins:"Plugins", ai:"AI" };
export const WORKBENCH_ICONS: Record<string, IconName> = {
  http: "globe", graphql: "code", grpc: "network", rpc: "code", websocket: "activity", sse: "activity", socket: "network",
  mqtt: "network", amqp: "network", kafka: "network", redis: "database", sql: "database",
  mock: "archive", runner: "send", gateway: "globe", capture: "search", plugins: "command", ai: "bolt",
};
export const DEFAULT_WORKBENCH_GROUPS: WorkbenchGroup[] = [
  { id:"api", label:"API", icon:"globe", workbenchIds:["http","graphql","grpc","rpc"] },
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

export function WorkbenchDeck({ tabs, children, saveTargetLabel }: WorkbenchDeckProps) {
  const items = Children.toArray(children); const { t } = useI18n();
  const active = useAppStore((state) => state.activeWorkbench); const setActive = useAppStore((state) => state.setActiveWorkbench);
  const favorites = useAppStore((state) => state.favoriteWorkbenches); const recent = useAppStore((state) => state.recentWorkbenches);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite); const collapsed = useAppStore((state) => state.collapsedNavigation); const toggleNavigation = useAppStore((state) => state.toggleNavigation);
  const selected = resolveWorkbenchId(tabs, hashWorkbench() ?? active); const selectedIndex = tabs.findIndex((tab) => tab.id === selected); const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const [codeOpen, setCodeOpen] = useState(false);

  function activate(id: string, writeHash = true) { if (!tabMap.has(id)) return; setActive(id); if (writeHash && typeof window !== "undefined") history.pushState(null, "", `#workbench=${encodeURIComponent(id)}`); }
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
    const syncHash = () => { const id = hashWorkbench(); if (id && tabMap.has(id)) setActive(id); };
    window.addEventListener("apivoy-open-request", openRequest);
    window.addEventListener("apivoy-select-workbench", selectWorkbench);
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.removeEventListener("apivoy-open-request", openRequest);
      window.removeEventListener("apivoy-select-workbench", selectWorkbench);
      window.removeEventListener("hashchange", syncHash);
    };
  }, [tabs, setActive]);
  useEffect(() => { if (selected !== active) setActive(selected); }, [active, selected, setActive]);
  useEffect(() => { setCodeOpen(false); }, [selected]);

  const renderTab = (tab: WorkbenchTab) => (
    <div className="protocol-item-wrap" key={tab.id}>
      <button className="protocol-item" data-testid={`workbench-${tab.id}`} role="tab" aria-selected={tab.id === selected} title={collapsed ? translateWorkbench(tab.id, tab.label) : undefined} onClick={() => activate(tab.id)}>
        <span className="protocol-glyph" aria-hidden="true"><Icon name={tab.icon ?? WORKBENCH_ICONS[tab.id] ?? "bolt"} /></span>
        <span className="protocol-label">{translateWorkbench(tab.id, tab.label)}</span>
      </button>
      <button className={`favorite-button ${favorites.includes(tab.id) ? "is-favorite" : ""}`} aria-label={favorites.includes(tab.id) ? t("workbench.unfavorite", { name: tab.label }) : t("workbench.favorite", { name: tab.label })} onClick={() => toggleFavorite(tab.id)}><Icon name="star"/></button>
    </div>
  );
  const selectedTab = selectedIndex >= 0 ? tabs[selectedIndex] : null;
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

  const activeContent = selectedIndex < 0 ? null : selected === "http" ? items[selectedIndex] : (
    <WorkbenchFrame
      title={translateWorkbench(selectedTab!.id, selectedTab!.label)}
      description={GROUP_BY_WORKBENCH.get(selected)}
      badge={<span className="protocol-badge">{selectedTab!.protocol ?? selected.toUpperCase()}</span>}
      toolbar={toolbar}
      status={frameStatus}
    >
      <div className={`standardized-workbench layout-${LAYOUT_BY_WORKBENCH[selected] ?? "request"}${codeOpen ? " codegen-open" : ""}`}>{items[selectedIndex]}</div>
    </WorkbenchFrame>
  );

  return (
    <div className={`workbench-deck ${collapsed ? "protocol-nav-collapsed" : ""}`}>
      <aside className="protocol-nav" aria-label={t("workbench.navigation")}>
        <div className="protocol-nav-header">
          <span>{t("workbench.navigation")}</span>
          <button className="ui-icon-button compact" onClick={toggleNavigation} aria-label={t("workbench.navigation.toggle")}><Icon name={collapsed ? "chevron" : "menu"}/></button>
        </div>
        <div className="protocol-list" role="tablist" aria-orientation="vertical">
          {!collapsed && favoriteTabs.length ? <div className="protocol-group"><div className="protocol-group-title"><Icon name="star"/><span>{t("workbench.favorites")}</span></div>{favoriteTabs.map(renderTab)}</div> : null}
          {!collapsed && recent.length ? <div className="protocol-group"><div className="protocol-group-title"><Icon name="activity"/><span>{t("workbench.recent")}</span></div>{recent.slice(0,3).map((id) => tabMap.get(id)).filter(Boolean).map((tab) => renderTab(tab!))}</div> : null}
          {DEFAULT_WORKBENCH_GROUPS.map((group) => {
            const groupTabs = group.workbenchIds.map((id) => tabMap.get(id)).filter(Boolean) as WorkbenchTab[];
            return groupTabs.length ? <div className="protocol-group" key={group.id}><div className="protocol-group-title"><Icon name={group.icon}/><span>{group.label}</span></div>{groupTabs.map(renderTab)}</div> : null;
          })}
        </div>
      </aside>
      <div className="workbench-content" data-workbench-label={selectedTab ? translateWorkbench(selectedTab.id, selectedTab.label) : ""}>
        {selectedTab ? <div role="tabpanel" aria-label={translateWorkbench(selectedTab.id, selectedTab.label)} className="workbench-panel">{activeContent}</div> : null}
        {items.slice(tabs.length)}
      </div>
    </div>
  );
}
