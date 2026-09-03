import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { IconButton } from "./Components";

export interface ClosableTabItem {
  id: string;
  title: string;
  icon?: IconName;
}

export interface ClosableTabStripProps {
  items: ClosableTabItem[];
  activeId?: string | null;
  ariaLabel: string;
  menuLabel: string;
  className?: string;
  menuMode?: "click" | "hover";
  menuAlign?: "auto" | "left" | "right";
  showItemsInMenu?: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onCloseOthers: () => void;
  onCreate?: () => void;
  createLabel?: string;
  children?: ReactNode;
}

export function ClosableTabStrip({
  items,
  activeId,
  ariaLabel,
  menuLabel,
  className,
  menuMode = "click",
  menuAlign = "right",
  showItemsInMenu = false,
  onActivate,
  onClose,
  onCloseAll,
  onCloseOthers,
  onCreate,
  createLabel = "新建",
  children,
}: ClosableTabStripProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [resolvedAlign, setResolvedAlign] = useState<"left" | "right">(menuAlign === "left" ? "left" : "right");
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeTab = tabScrollRef.current?.querySelector<HTMLElement>(".workbench-tab.is-active");
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeId, items.length]);

  function openMenu() {
    if (menuAlign === "auto") {
      const triggerBounds = menuRef.current?.getBoundingClientRect();
      const contentBounds = menuRef.current?.closest(".workbench-content")?.getBoundingClientRect();
      if (triggerBounds && contentBounds) {
        const menuWidth = 240;
        const leftCandidate = triggerBounds.left;
        const rightCandidate = triggerBounds.right - menuWidth;
        const overflow = (left: number) => Math.max(0, contentBounds.left - left) + Math.max(0, left + menuWidth - contentBounds.right);
        setResolvedAlign(overflow(rightCandidate) < overflow(leftCandidate) ? "right" : "left");
      }
    } else {
      setResolvedAlign(menuAlign);
    }
    setMenuOpen(true);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    onActivate(items[nextIndex].id);
    tabScrollRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[nextIndex]?.focus();
  }

  const menuEvents = menuMode === "hover" ? {
    onMouseEnter: openMenu,
    onMouseLeave: () => setMenuOpen(false),
  } : {};

  return <div className={`${className ? `${className} ` : ""}workbench-tabs`}>
    <div className="workbench-tab-scroll" ref={tabScrollRef} role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => <div className={`workbench-tab${item.id === activeId ? " is-active" : ""}`} key={item.id}>
        <button type="button" role="tab" aria-selected={item.id === activeId} tabIndex={item.id === activeId ? 0 : -1} onClick={() => onActivate(item.id)} onKeyDown={(event) => handleTabKeyDown(event, index)}>
          <Icon name={item.icon ?? "activity"}/><span>{item.title}</span>
        </button>
        <button type="button" className="workbench-tab-close" aria-label={`关闭 ${item.title}`} onClick={() => onClose(item.id)}><Icon name="close"/></button>
      </div>)}
    </div>
    <div className="workbench-tab-tools">
      {onCreate ? <IconButton label={createLabel} icon="plus" className="compact" title={createLabel} onClick={onCreate}/> : null}
      <div
        ref={menuRef}
        className={`workbench-tabs-more is-align-${resolvedAlign}`}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMenuOpen(false); }}
        onKeyDown={(event) => { if (event.key === "Escape") setMenuOpen(false); }}
        {...menuEvents}
      >
        <IconButton label="更多页签操作" icon="more" className="compact" title="更多" aria-haspopup="menu" aria-expanded={menuOpen} onFocus={menuMode === "hover" ? openMenu : undefined} onClick={() => menuMode === "click" && menuOpen ? setMenuOpen(false) : openMenu()}/>
        {menuOpen ? <div className="workbench-tabs-menu" role="menu" aria-label={menuLabel}>
          {showItemsInMenu ? <div className="workbench-tabs-menu-list">
            {items.length ? items.map((item) => <button type="button" role="menuitem" className={item.id === activeId ? "is-active" : undefined} key={item.id} onClick={() => { onActivate(item.id); setMenuOpen(false); }}><Icon name={item.icon ?? "activity"}/><span>{item.title}</span></button>) : <span className="workbench-tabs-empty">暂无打开的页签</span>}
          </div> : null}
          <div className="workbench-tabs-menu-actions">
            <button type="button" role="menuitem" disabled={!items.length} onClick={() => { onCloseAll(); setMenuOpen(false); }}>关闭全部标签页</button>
            <button type="button" role="menuitem" disabled={!activeId} onClick={() => { if (activeId) onClose(activeId); setMenuOpen(false); }}>关闭当前标签页</button>
            <button type="button" role="menuitem" disabled={!activeId || items.length < 2} onClick={() => { onCloseOthers(); setMenuOpen(false); }}>关闭其他标签页</button>
          </div>
        </div> : null}
      </div>
    </div>
    {children}
  </div>;
}
