import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icons";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./useDialogFocus";

export type CollaborationTab = "team" | "comments" | "sso";

export interface CollaborationHubProps {
  open: boolean;
  onClose: () => void;
  team: ReactNode;
  comments: ReactNode;
  sso: ReactNode;
  initialTab?: CollaborationTab;
}

export function CollaborationHub({ open, onClose, team, comments, sso, initialTab = "team" }: CollaborationHubProps) {
  const { t } = useI18n();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<CollaborationTab, HTMLButtonElement>());
  const [tab, setTab] = useState<CollaborationTab>(initialTab);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onSelectTab = (event: Event) => {
      const next = (event as CustomEvent<CollaborationTab>).detail;
      if (next === "team" || next === "comments" || next === "sso") setTab(next);
    };
    window.addEventListener("apivoy-collaboration-tab", onSelectTab);
    return () => {
      window.removeEventListener("apivoy-collaboration-tab", onSelectTab);
    };
  }, [open]);
  useDialogFocus(open, dialogRef, onClose, closeRef);
  const tabs: CollaborationTab[] = ["team", "comments", "sso"];
  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const current = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
    setTab(tabs[next]); queueMicrotask(() => tabRefs.current.get(tabs[next])?.focus());
  }

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="collaboration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="collaboration-dialog-header">
          <div>
            <h2 id={titleId}>{t("collaboration.title")}</h2>
            <p>{t("collaboration.subtitle")}</p>
          </div>
          <button ref={closeRef} type="button" className="ui-icon-button" aria-label={t("action.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="collaboration-tabs" role="tablist" aria-label={t("collaboration.title")} onKeyDown={onTabKeyDown}>
          {tabs.map((item) => <button ref={(node) => { if (node) tabRefs.current.set(item, node); else tabRefs.current.delete(item); }} key={item} id={`collaboration-tab-${item}`} type="button" role="tab" tabIndex={tab === item ? 0 : -1} aria-selected={tab === item} aria-controls={`collaboration-panel-${item}`} className={tab === item ? "is-active" : undefined} onClick={() => setTab(item)}>{t(`collaboration.tab.${item}`)}</button>)}
        </div>
        <div className="collaboration-dialog-body" role="tabpanel" id={`collaboration-panel-${tab}`} aria-labelledby={`collaboration-tab-${tab}`}>
          {tab === "team" ? team : null}
          {tab === "comments" ? comments : null}
          {tab === "sso" ? sso : null}
        </div>
      </div>
    </div>
  );
}

export function openCollaborationHub(tab: CollaborationTab = "team"): void {
  window.dispatchEvent(new CustomEvent("apivoy-open-collaboration", { detail: tab }));
}
