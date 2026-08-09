import { Children, useEffect, useState, type CSSProperties, type ReactNode } from "react";

export interface WorkbenchTab { id: string; label: string; protocol?: string; protocols?: string[] }
export interface WorkbenchDeckProps { tabs: WorkbenchTab[]; children: ReactNode }

export function WorkbenchDeck({ tabs, children }: WorkbenchDeckProps) {
  const items = Children.toArray(children);
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem("apivoy:active-workbench") ?? tabs[0]?.id ?? ""; }
    catch { return tabs[0]?.id ?? ""; }
  });
  const selected = tabs.some((tab) => tab.id === active) ? active : tabs[0]?.id ?? "";
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
  return <div style={styles.root}><div role="tablist" aria-label="Protocol workbenches" style={styles.tabs}>{tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={tab.id === selected} style={{ ...styles.tab, ...(tab.id === selected ? styles.active : {}) }} onClick={() => setActive(tab.id)}>{tab.label}</button>)}</div><div style={styles.content}>{items.map((item, index) => index < tabs.length ? <div key={tabs[index].id} role="tabpanel" hidden={tabs[index].id !== selected} style={tabs[index].id === selected ? styles.panel : undefined}>{item}</div> : item)}</div></div>;
}

const styles: Record<string, CSSProperties> = {
  root: { minWidth: 0 },
  tabs: { position: "sticky", top: 59, zIndex: 12, display: "flex", gap: 4, overflowX: "auto", padding: "8px 6px", margin: "-10px -6px 14px", border: "1px solid var(--apivoy-border)", borderRadius: 12, background: "rgba(8,13,19,.92)", backdropFilter: "blur(10px)" },
  tab: { flex: "0 0 auto", border: 0, borderRadius: 8, padding: "8px 12px", background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", fontWeight: 600 },
  active: { color: "#dff4ff", background: "linear-gradient(135deg,rgba(61,156,240,.28),rgba(76,210,175,.15))", boxShadow: "inset 0 0 0 1px rgba(96,190,255,.28)" },
  content: { minWidth: 0 },
  panel: { minWidth: 0, animation: "apivoy-panel-in .16s ease-out" },
};
