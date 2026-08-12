import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useAppStore, type WorkbenchLayoutPreference } from "./appStore";

export interface SplitPaneProps { id: string; primary: ReactNode; secondary: ReactNode; direction?: WorkbenchLayoutPreference; minPrimary?: number; minSecondary?: number; primaryLabel?: string; secondaryLabel?: string }
export function SplitPane({ id, primary, secondary, direction = "auto", minPrimary = 320, minSecondary = 300, primaryLabel = "请求", secondaryLabel = "响应" }: SplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const saved = useAppStore((state) => state.splitPreferences[id]);
  const setPreference = useAppStore((state) => state.setSplitPreference);
  const [ratio, setRatio] = useState(() => saved?.ratio ?? .5);
  const actualDirection = saved?.direction ?? direction;
  useEffect(() => setRatio(saved?.ratio ?? .5), [saved?.ratio]);
  function update(next: number) { const value = Math.min(.75, Math.max(.25, next)); setRatio(value); setPreference(id, { direction: actualDirection, ratio: value }); }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const root = rootRef.current; if (!root) return; event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = root.getBoundingClientRect(); const vertical = getComputedStyle(root).gridTemplateColumns.split(" ").length === 1;
    const move = (moveEvent: globalThis.PointerEvent) => update(vertical ? (moveEvent.clientY - bounds.top) / bounds.height : (moveEvent.clientX - bounds.left) / bounds.width);
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) { if (["ArrowLeft","ArrowUp"].includes(event.key)) { event.preventDefault(); update(ratio - .05); } if (["ArrowRight","ArrowDown"].includes(event.key)) { event.preventDefault(); update(ratio + .05); } if (event.key === "Home") update(.25); if (event.key === "End") update(.75); }
  return <div ref={rootRef} className={`split-pane split-${actualDirection}`} style={{ "--split-ratio": `${ratio * 100}%`, "--split-min-primary": `${minPrimary}px`, "--split-min-secondary": `${minSecondary}px` } as React.CSSProperties}>
    <section className="split-panel" aria-label={primaryLabel}>{primary}</section><div className="split-handle" role="separator" tabIndex={0} aria-label={`调整${primaryLabel}和${secondaryLabel}区域大小`} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(ratio * 100)} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={() => update(.5)}><span/></div><section className="split-panel" aria-label={secondaryLabel}>{secondary}</section>
  </div>;
}

export interface WorkbenchFrameProps { title: string; description?: string; badge?: ReactNode; toolbar?: ReactNode; children: ReactNode; status?: ReactNode }
export function WorkbenchFrame({ title, description, badge, toolbar, children, status }: WorkbenchFrameProps) { return <section className="workbench-frame"><header className="workbench-frame-header"><div><div className="workbench-title-line"><h1>{title}</h1>{badge}</div>{description ? <p>{description}</p> : null}</div>{toolbar ? <div className="workbench-toolbar">{toolbar}</div> : null}</header><div className="workbench-frame-body">{children}</div>{status ? <footer className="workbench-status" aria-live="polite">{status}</footer> : null}</section>; }
