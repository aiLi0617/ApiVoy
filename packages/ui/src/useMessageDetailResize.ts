import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useAppStore } from "./appStore";

export function useMessageDetailResize(storageKey: string, detailOpen: boolean, browserSelector?: string) {
  const browserRef = useRef<HTMLDivElement | null>(null);
  const stackedByLayout = useAppStore((state) => state.splitDirection === "horizontal");
  const [compact, setCompact] = useState(false);
  const stacked = stackedByLayout || compact;
  const [ratio, setRatio] = useState(() => {
    if (typeof window === "undefined") return 46;
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= 5 && saved <= 95 ? saved : 46;
  });

  function bounds(): [number, number] {
    const rect = browserRef.current?.getBoundingClientRect();
    const size = rect ? (stacked ? rect.height : rect.width) : 0;
    if (!size) return [22, 78];
    const listMinimum = stacked ? 120 : 320;
    const detailMinimum = stacked ? 150 : 370;
    const minimum = listMinimum / size * 100;
    const maximum = (size - detailMinimum - 7) / size * 100;
    return minimum <= maximum ? [minimum, maximum] : [50, 50];
  }

  function clamp(value: number) {
    const [minimum, maximum] = bounds();
    return Math.min(maximum, Math.max(minimum, value));
  }

  useEffect(() => { window.localStorage.setItem(storageKey, String(ratio)); }, [ratio, storageKey]);
  useEffect(() => {
    const browser = browserSelector ? document.querySelector<HTMLDivElement>(browserSelector) : browserRef.current;
    if (!browser || !detailOpen) return;
    browserRef.current = browser;
    browser.classList.toggle("is-stacked", stacked);
    browser.style.setProperty("--websocket-message-list-ratio", `${ratio}%`);
    const resizer = browser.querySelector<HTMLElement>(".websocket-detail-resizer");
    resizer?.setAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
    resizer?.setAttribute("aria-valuenow", String(Math.round(ratio)));
  }, [browserSelector, detailOpen, ratio, stacked]);
  useEffect(() => {
    const browser = browserSelector ? document.querySelector<HTMLDivElement>(browserSelector) : browserRef.current;
    if (!browser || !detailOpen) return;
    browserRef.current = browser;
    browser.classList.toggle("is-stacked", stacked);
    browser.style.setProperty("--websocket-message-list-ratio", `${ratio}%`);
    const detail = browser.querySelector<HTMLElement>(".websocket-frame-detail");
    let resizer = browser.querySelector<HTMLDivElement>(".websocket-detail-resizer");
    const injected = !resizer;
    if (!resizer && detail) {
      resizer = document.createElement("div");
      resizer.className = "websocket-detail-resizer";
      resizer.tabIndex = 0;
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-label", "调整消息列表和详情区域大小");
      detail.before(resizer);
    }
    const update = (clientX: number, clientY: number) => {
      const rect = browser.getBoundingClientRect();
      const position = stacked ? clientY - rect.top : clientX - rect.left;
      const size = stacked ? rect.height : rect.width;
      if (size > 0) setRatio(clamp(position / size * 100));
    };
    const pointerDown = (event: PointerEvent) => {
      event.preventDefault();
      resizer?.setPointerCapture(event.pointerId);
      update(event.clientX, event.clientY);
      const move = (moveEvent: PointerEvent) => update(moveEvent.clientX, moveEvent.clientY);
      const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    };
    const keyDown = (event: globalThis.KeyboardEvent) => {
      const decrease = stacked ? "ArrowUp" : "ArrowLeft";
      const increase = stacked ? "ArrowDown" : "ArrowRight";
      if (event.key === decrease || event.key === increase) { event.preventDefault(); setRatio((current) => clamp(current + (event.key === increase ? 2 : -2))); }
      else if (event.key === "Home" || event.key === "End") { event.preventDefault(); const [minimum, maximum] = bounds(); setRatio(event.key === "Home" ? minimum : maximum); }
    };
    const reset = () => setRatio(46);
    resizer?.setAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
    resizer?.addEventListener("pointerdown", pointerDown);
    resizer?.addEventListener("keydown", keyDown);
    resizer?.addEventListener("dblclick", reset);
    const observer = new ResizeObserver(([entry]) => {
      if (entry.target === browser) setCompact(!stackedByLayout && entry.contentRect.width < 720);
      setRatio((current) => clamp(current));
    });
    observer.observe(browser);
    return () => {
      observer.disconnect();
      resizer?.removeEventListener("pointerdown", pointerDown);
      resizer?.removeEventListener("keydown", keyDown);
      resizer?.removeEventListener("dblclick", reset);
      if (injected) resizer?.remove();
      if (browserRef.current === browser) browserRef.current = null;
    };
  }, [browserSelector, detailOpen, stackedByLayout, stacked]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const update = (clientX: number, clientY: number) => {
      const rect = browserRef.current?.getBoundingClientRect();
      if (!rect) return;
      const position = stacked ? clientY - rect.top : clientX - rect.left;
      const size = stacked ? rect.height : rect.width;
      if (size > 0) setRatio(clamp(position / size * 100));
    };
    update(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX, moveEvent.clientY);
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const decrease = stacked ? "ArrowUp" : "ArrowLeft";
    const increase = stacked ? "ArrowDown" : "ArrowRight";
    if (event.key === decrease || event.key === increase) {
      event.preventDefault();
      setRatio((current) => clamp(current + (event.key === increase ? 2 : -2)));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const [minimum, maximum] = bounds();
      setRatio(event.key === "Home" ? minimum : maximum);
    }
  }

  return { browserRef, ratio, setRatio, stacked, onPointerDown, onKeyDown };
}
