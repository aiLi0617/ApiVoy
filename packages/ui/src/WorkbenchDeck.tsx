import { Children, useEffect, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { useAppStore } from "./appStore";
import { translateWorkbench, useI18n } from "./i18n";
import { WorkbenchFrame } from "./WorkbenchFrame";

export interface WorkbenchDefinition { id: string; label: string; protocol?: string; protocols?: string[]; group?: string; icon?: IconName }
export type WorkbenchTab = WorkbenchDefinition;
export interface WorkbenchGroup { id: string; label: string; icon: IconName; workbenchIds: string[] }
export interface WorkbenchDeckProps { tabs: WorkbenchTab[]; children: ReactNode }
export const WORKBENCH_LABELS: Record<string, string> = { http:"HTTP", graphql:"GraphQL", grpc:"gRPC", rpc:"SOAP / RPC", websocket:"WebSocket", sse:"SSE", socket:"TCP / UDP", mqtt:"MQTT", amqp:"AMQP", kafka:"Kafka", redis:"Redis", sql:"SQL", mock:"Mock", gateway:"Gateway", capture:"Capture", plugins:"Plugins", ai:"AI", team:"Team", comments:"Comments", sso:"SSO" };
export const DEFAULT_WORKBENCH_GROUPS: WorkbenchGroup[] = [
  { id:"api", label:"API", icon:"globe", workbenchIds:["http","graphql","grpc","rpc"] },
  { id:"realtime", label:"实时通信", icon:"activity", workbenchIds:["websocket","sse","socket"] },
  { id:"messaging", label:"消息", icon:"network", workbenchIds:["mqtt","amqp","kafka"] },
  { id:"data", label:"数据", icon:"database", workbenchIds:["redis","sql"] },
  { id:"tools", label:"工具", icon:"settings", workbenchIds:["mock","gateway","capture","plugins","ai"] },
  { id:"collaboration", label:"协作", icon:"users", workbenchIds:["team","comments","sso"] },
];
const GROUP_BY_WORKBENCH = new Map(DEFAULT_WORKBENCH_GROUPS.flatMap((group) => group.workbenchIds.map((id) => [id, group.label])));
const LAYOUT_BY_WORKBENCH: Record<string, "request" | "stream" | "editor" | "management"> = { graphql:"request", grpc:"request", rpc:"request", websocket:"stream", sse:"stream", socket:"stream", mqtt:"stream", amqp:"stream", kafka:"stream", redis:"editor", sql:"editor", mock:"management", gateway:"management", capture:"management", plugins:"management", ai:"management", team:"management", comments:"management", sso:"management" };
export function resolveWorkbenchId(tabs: WorkbenchTab[], stored: string | null) { return tabs.some((tab) => tab.id === stored) ? stored! : tabs[0]?.id ?? ""; }
function hashWorkbench() { if (typeof window === "undefined") return null; return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("workbench"); }

export function WorkbenchDeck({ tabs, children }: WorkbenchDeckProps) {
  const items = Children.toArray(children); const { t } = useI18n();
  const active = useAppStore((state) => state.activeWorkbench); const setActive = useAppStore((state) => state.setActiveWorkbench);
  const favorites = useAppStore((state) => state.favoriteWorkbenches); const recent = useAppStore((state) => state.recentWorkbenches);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite); const collapsed = useAppStore((state) => state.collapsedNavigation); const toggleNavigation = useAppStore((state) => state.toggleNavigation);
  const selected = resolveWorkbenchId(tabs, hashWorkbench() ?? active); const selectedIndex = tabs.findIndex((tab) => tab.id === selected); const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  function activate(id: string, writeHash = true) { if (!tabMap.has(id)) return; setActive(id); if (writeHash && typeof window !== "undefined") history.pushState(null, "", `#workbench=${encodeURIComponent(id)}`); }
  useEffect(() => { const openRequest = (event: Event) => { const protocol = (event as CustomEvent).detail?.protocolId as string | undefined; const match = tabs.find((tab) => tab.protocol === protocol || tab.protocols?.includes(protocol ?? "") || tab.id === protocol); if (match) activate(match.id); }; const selectWorkbench = (event: Event) => activate((event as CustomEvent<string>).detail); const syncHash = () => { const id = hashWorkbench(); if (id && tabMap.has(id)) setActive(id); }; window.addEventListener("apivoy-open-request", openRequest); window.addEventListener("apivoy-select-workbench", selectWorkbench); window.addEventListener("hashchange", syncHash); return () => { window.removeEventListener("apivoy-open-request", openRequest); window.removeEventListener("apivoy-select-workbench", selectWorkbench); window.removeEventListener("hashchange", syncHash); }; }, [tabs, setActive]);
  useEffect(() => { if (selected !== active) setActive(selected); }, [active, selected, setActive]);
  const renderTab = (tab: WorkbenchTab) => <div className="protocol-item-wrap" key={tab.id}><button className="protocol-item" data-testid={`workbench-${tab.id}`} role="tab" aria-selected={tab.id === selected} title={collapsed ? translateWorkbench(tab.id, tab.label) : undefined} onClick={() => activate(tab.id)}><span className="protocol-glyph" aria-hidden="true">{tab.label.slice(0,2).toUpperCase()}</span><span className="protocol-label">{translateWorkbench(tab.id, tab.label)}</span></button><button className={`favorite-button ${favorites.includes(tab.id) ? "is-favorite" : ""}`} aria-label={favorites.includes(tab.id) ? `取消收藏 ${tab.label}` : `收藏 ${tab.label}`} onClick={() => toggleFavorite(tab.id)}><Icon name="star"/></button></div>;
  const selectedTab = selectedIndex >= 0 ? tabs[selectedIndex] : null;
  const activeContent = selectedIndex < 0 ? null : selected === "http" ? items[selectedIndex] : <WorkbenchFrame title={translateWorkbench(selectedTab!.id, selectedTab!.label)} description={`${GROUP_BY_WORKBENCH.get(selected) ?? "协议"}工作台`} badge={<span className="protocol-badge">{selectedTab!.protocol ?? selected.toUpperCase()}</span>} status={<span>就绪</span>}><div className={`standardized-workbench layout-${LAYOUT_BY_WORKBENCH[selected] ?? "request"}`}>{items[selectedIndex]}</div></WorkbenchFrame>;
  return <div className={`workbench-deck ${collapsed ? "protocol-nav-collapsed" : ""}`}><aside className="protocol-nav" aria-label={t("workbench.navigation")}><div className="protocol-nav-header"><span>工作台</span><button className="ui-icon-button compact" onClick={toggleNavigation} aria-label="切换协议导航"><Icon name={collapsed ? "chevron" : "menu"}/></button></div><div className="protocol-list" role="tablist" aria-orientation="vertical">{!collapsed && recent.length ? <div className="protocol-group"><div className="protocol-group-title"><Icon name="activity"/>最近使用</div>{recent.slice(0,3).map((id) => tabMap.get(id)).filter(Boolean).map((tab) => renderTab(tab!))}</div> : null}{DEFAULT_WORKBENCH_GROUPS.map((group) => { const groupTabs = group.workbenchIds.map((id) => tabMap.get(id)).filter(Boolean) as WorkbenchTab[]; return groupTabs.length ? <div className="protocol-group" key={group.id}><div className="protocol-group-title"><Icon name={group.icon}/><span>{group.label}</span></div>{groupTabs.map(renderTab)}</div> : null; })}</div></aside><div className="workbench-content" data-workbench-label={selectedTab ? translateWorkbench(selectedTab.id, selectedTab.label) : ""}>{selectedTab ? <div role="tabpanel" aria-label={translateWorkbench(selectedTab.id, selectedTab.label)} className="workbench-panel">{activeContent}</div> : null}{items.slice(tabs.length)}</div></div>;
}