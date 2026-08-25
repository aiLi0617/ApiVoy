import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useAppStore, type WorkbenchLayoutPreference } from "./appStore";

function SplitLayoutIcon({ direction = "vertical" }: { direction?: "vertical" | "horizontal" }) {
  return <svg className="split-layout-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2"/>
    {direction === "vertical" ? <path d="M3.75 10h12.5"/> : <path d="M10 3.75v12.5"/>}
  </svg>;
}

export interface SplitPaneProps { id: string; primary: ReactNode; secondary: ReactNode; secondaryActions?: ReactNode; direction?: WorkbenchLayoutPreference; fixedDirection?: "vertical" | "horizontal"; minPrimary?: number; minSecondary?: number; primaryLabel?: string; secondaryLabel?: string }
export function calculateSplitCollapseThreshold(totalSize: number, minSecondary: number, handleSize: number) {
  return totalSize > 0 ? Math.max(.25, Math.min(.99, (totalSize - handleSize - minSecondary) / totalSize)) : .94;
}
export function SplitPane({ id, primary, secondary, secondaryActions, direction = "vertical", fixedDirection, minPrimary = 280, minSecondary = 240, primaryLabel = "请求", secondaryLabel = "响应" }: SplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const saved = useAppStore((state) => state.splitPreferences[id]);
  const globalDirection = useAppStore((state) => state.splitDirection);
  const setGlobalDirection = useAppStore((state) => state.setSplitDirection);
  const setPreference = useAppStore((state) => state.setSplitPreference);
  const [ratio, setRatio] = useState(() => saved?.ratio ?? .42);
  const [collapsedPanel, setCollapsedPanel] = useState<"primary" | "secondary" | null>(null);
  const expandedRatioRef = useRef(saved?.ratio && saved.ratio < .9 ? saved.ratio : .42);
  const preferredDirection = globalDirection ?? direction;
  const actualDirection: "vertical" | "horizontal" = fixedDirection ?? (preferredDirection === "horizontal" ? "horizontal" : "vertical");
  useEffect(() => setRatio(saved?.ratio ?? .42), [saved?.ratio]);
  function persist(nextDirection: WorkbenchLayoutPreference, nextRatio: number) {
    const value = Math.min(.99, Math.max(.25, nextRatio));
    setRatio(value);
    setPreference(id, { direction: nextDirection, ratio: value });
  }
  function update(next: number) { if (next < .94) expandedRatioRef.current = next; persist(actualDirection, next); }
  function collapseThreshold(root: HTMLDivElement) {
    const bounds = root.getBoundingClientRect();
    const total = actualDirection === "horizontal" ? bounds.width : bounds.height;
    const handleSize = actualDirection === "horizontal" ? 24 : 44;
    return calculateSplitCollapseThreshold(total, minSecondary, handleSize);
  }
  function resize(next: number, root: HTMLDivElement) {
    if (next >= collapseThreshold(root)) {
      if (collapsedPanel !== "secondary" && ratio < .94) expandedRatioRef.current = ratio;
      setCollapsedPanel("secondary");
      return;
    }
    if (collapsedPanel === "secondary") setCollapsedPanel(null);
    update(next);
  }
  function toggleSecondary() {
    if (collapsedPanel === "secondary") { setCollapsedPanel(null); persist(actualDirection, expandedRatioRef.current); }
    else { if (ratio < .94) expandedRatioRef.current = ratio; setCollapsedPanel("secondary"); }
  }
  function setDirection(next: Exclude<WorkbenchLayoutPreference, "auto">) { setGlobalDirection(next); }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const root = rootRef.current; if (!root || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const bounds = root.getBoundingClientRect(); const vertical = actualDirection === "vertical";
    let dragCollapsed = collapsedPanel === "secondary";
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const next = vertical ? (moveEvent.clientY - bounds.top) / bounds.height : (moveEvent.clientX - bounds.left) / bounds.width;
      if (next >= collapseThreshold(root)) { if (!dragCollapsed) { if (ratio < .94) expandedRatioRef.current = ratio; dragCollapsed = true; setCollapsedPanel("secondary"); } return; }
      if (dragCollapsed) { dragCollapsed = false; setCollapsedPanel(null); }
      update(next);
    };
    const stop = (stopEvent: globalThis.PointerEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) { const root = rootRef.current; if (["ArrowLeft","ArrowUp"].includes(event.key)) { event.preventDefault(); if (collapsedPanel === "secondary") toggleSecondary(); else update(ratio - .05); } if (["ArrowRight","ArrowDown"].includes(event.key)) { event.preventDefault(); if (root && collapsedPanel !== "secondary") resize(ratio + .05, root); } if (event.key === "Home") update(.25); if (event.key === "End") { expandedRatioRef.current = ratio < .94 ? ratio : expandedRatioRef.current; setCollapsedPanel("secondary"); } }
  const layouts: Array<{ id: "vertical" | "horizontal"; label: string; title: string }> = [
    { id: "vertical", label: "上下", title: "请求在上、响应在下（适合阅读正文）" },
    { id: "horizontal", label: "左右", title: "请求在左、响应在右" },
  ];
  return <div className="split-pane-shell">
    <div ref={rootRef} className={`split-pane split-${actualDirection}${collapsedPanel ? ` split-${collapsedPanel}-collapsed` : ""}`} style={{ "--split-ratio": `${ratio * 100}%`, "--split-min-primary": `${minPrimary}px`, "--split-min-secondary": `${minSecondary}px` } as React.CSSProperties}>
      <section className="split-panel" aria-label={primaryLabel}>{primary}</section>
      <div className="split-handle" role="separator" tabIndex={0} aria-label={`调整${primaryLabel}和${secondaryLabel}区域大小`} aria-orientation={actualDirection === "horizontal" ? "vertical" : "horizontal"} aria-valuemin={25} aria-valuemax={99} aria-valuenow={collapsedPanel === "secondary" ? 99 : Math.round(ratio * 100)} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={() => { setCollapsedPanel(null); update(.42); }}><span/><div className="split-response-heading"><button type="button" className="split-response-toggle" aria-label={collapsedPanel === "secondary" ? `展开${secondaryLabel}` : `收起${secondaryLabel}`} aria-expanded={collapsedPanel !== "secondary"} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); toggleSecondary(); }}><span className="split-response-toggle-icon" aria-hidden="true"/></button><span className="split-response-toggle-label">返回响应</span></div>{secondaryActions ? <div className="split-secondary-actions" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>{secondaryActions}</div> : null}</div>
      <section className="split-panel split-secondary-panel" aria-label={secondaryLabel}><div className="split-secondary-horizontal-header"><div className="split-secondary-header-heading"><button type="button" className="split-secondary-header-toggle" aria-label={collapsedPanel === "secondary" ? `展开${secondaryLabel}` : `收起${secondaryLabel}`} aria-expanded={collapsedPanel !== "secondary"} onClick={toggleSecondary}><span className="split-response-toggle-icon" aria-hidden="true"/></button><span>{secondaryLabel === "响应检查器" ? "返回响应" : secondaryLabel}</span></div>{secondaryActions ? <div className="split-secondary-header-actions">{secondaryActions}</div> : null}</div><div className="split-secondary-content">{secondary}</div><div className="split-layout-flyout"><div className="split-layout-popover" role="group" aria-label="选择分栏布局">{layouts.map((layout) => <button key={layout.id} type="button" className={actualDirection === layout.id ? "is-active" : ""} aria-pressed={actualDirection === layout.id} title={layout.title} onClick={() => setDirection(layout.id)}><SplitLayoutIcon direction={layout.id}/><span>{layout.label}分屏</span></button>)}</div><button type="button" className="split-layout-trigger" aria-label="切换分栏布局" title="切换分栏布局"><SplitLayoutIcon direction={actualDirection}/></button></div></section>
    </div>
  </div>;
}

export interface WorkbenchFrameProps { title: string; description?: string; badge?: ReactNode; toolbar?: ReactNode; children: ReactNode; status?: ReactNode; busy?: boolean; hideHeader?: boolean }
export function WorkbenchFrame({ title, description, badge, toolbar, children, status, busy = false, hideHeader = false }: WorkbenchFrameProps) {
  const titleId = `workbench-title-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return <section className="workbench-frame" aria-labelledby={titleId} aria-busy={busy || undefined}>
    {hideHeader
      ? <h1 id={titleId} className="workbench-frame-title-hidden">{title}</h1>
      : <header className="workbench-frame-header"><div><div className="workbench-title-line"><h1 id={titleId}>{title}</h1>{badge}</div>{description ? <p>{description}</p> : null}</div>{toolbar ? <div className="workbench-toolbar">{toolbar}</div> : null}</header>}
    <div className="workbench-frame-body">{children}</div>
    {status || busy ? <footer className="workbench-status" role="status" aria-live="polite">{status ?? "处理中…"}</footer> : null}
  </section>;
}
