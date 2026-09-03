import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Components";
import { useI18n } from "./i18n";
import { ModalFrame } from "./ModalFrame";
import { RovingTabList } from "./RovingTabList";

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
  const tabs: CollaborationTab[] = ["team", "comments", "sso"];
  if (!open) return null;

  return (
    <ModalFrame open={open} onClose={onClose} className="collaboration-dialog" ariaLabelledBy={titleId} initialFocusRef={closeRef}>
        <header className="collaboration-dialog-header">
          <div>
            <h2 id={titleId}>{t("collaboration.title")}</h2>
            <p>{t("collaboration.subtitle")}</p>
          </div>
          <IconButton ref={closeRef} label={t("action.close")} icon="close" onClick={onClose} />
        </header>
        <RovingTabList className="collaboration-tabs" ariaLabel={t("collaboration.title")}>
          {tabs.map((item) => <button key={item} id={`collaboration-tab-${item}`} type="button" role="tab" tabIndex={tab === item ? 0 : -1} aria-selected={tab === item} aria-controls={`collaboration-panel-${item}`} className={tab === item ? "is-active" : undefined} onClick={() => setTab(item)}>{t(`collaboration.tab.${item}`)}</button>)}
        </RovingTabList>
        <div className="collaboration-dialog-body" role="tabpanel" id={`collaboration-panel-${tab}`} aria-labelledby={`collaboration-tab-${tab}`}>
          {tab === "team" ? team : null}
          {tab === "comments" ? comments : null}
          {tab === "sso" ? sso : null}
        </div>
    </ModalFrame>
  );
}

export function openCollaborationHub(tab: CollaborationTab = "team"): void {
  window.dispatchEvent(new CustomEvent("apivoy-open-collaboration", { detail: tab }));
}
