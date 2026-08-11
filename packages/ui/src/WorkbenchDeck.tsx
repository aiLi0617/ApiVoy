import { Children, useEffect, useState, type CSSProperties, type ReactNode } from "react";

export interface WorkbenchTab { id: string; label: string; protocol?: string; protocols?: string[] }
export interface WorkbenchDeckProps { tabs: WorkbenchTab[]; children: ReactNode }

export function resolveWorkbenchId(tabs: WorkbenchTab[], stored: string | null) {
  return tabs.some((tab) => tab.id === stored) ? stored! : tabs[0]?.id ?? "";
}

export function WorkbenchDeck({ tabs, children }: WorkbenchDeckProps) {
  const items = Children.toArray(children);
  const [active, setActive] = useState(() => {
    try { return resolveWorkbenchId(tabs, localStorage.getItem("apivoy:active-workbench")); }
    catch { return tabs[0]?.id ?? ""; }
  });
  const selected = resolveWorkbenchId(tabs, active);
  useEffect(() => {
    const listener = (event: Event) => {
      const protocol = (event as CustomEvent).detail?.protocolId as string | undefined;
      const match = tabs.find((tab) => tab.protocol === protocol || tab.protocols?.includes(protocol ?? "") || tab.id === protocol);
      if (match) setActive(match.id);
    };
    window.addEventListener("apivoy-open-request", listener);
    return () => window.removeEventListener("apivoy-open-request", listener);
  }, [tabs]);
  useEffect(() => { try { localStorage.setItem("apivoy:active-workbench", selected); } catch { /* optional */ } }, [selected]);
  return <div style={styles.root}><div className="workbench-tabs" role="tablist" aria-label="Protocol workbenches" style={styles.tabs}>{tabs.map((tab) => <button className="workbench-tab" key={tab.id} role="tab" aria-selected={tab.id === selected} style={{ ...styles.tab, ...(tab.id === selected ? styles.active : {}) }} onClick={() => setActive(tab.id)}>{tab.label}</button>)}</div><div style={styles.content}>{items.map((item, index) => index < tabs.length ? <div key={tabs[index].id} role="tabpanel" hidden={tabs[index].id !== selected} style={tabs[index].id === selected ? styles.panel : undefined}>{item}</div> : item)}</div></div>;
}

const styles: Record<string, CSSProperties> = {
  root: { minWidth: 0 },
  tabs: { position: "sticky", top: 59, zIndex: 12, display: "flex", flexWrap: "wrap", gap: 5, padding: 7, margin: "-10px -6px 16px", border: "1px solid var(--apivoy-border)", borderRadius: 14, background: "rgba(8,13,19,.94)", boxShadow: "0 12px 34px rgba(0,0,0,.22)", backdropFilter: "blur(14px)" },
  tab: { flex: "0 0 auto", border: "1px solid transparent", borderRadius: 8, padding: "7px 10px", background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", fontWeight: 650, fontSize: 12 },
  active: { color: "#e9f8ff", borderColor: "rgba(96,190,255,.3)", background: "linear-gradient(135deg,rgba(61,156,240,.3),rgba(76,210,175,.14))", boxShadow: "0 5px 16px rgba(24,112,184,.16)" },
  content: { minWidth: 0 },
  panel: { minWidth: 0, animation: "apivoy-panel-in .16s ease-out" },
};
