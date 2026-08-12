import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";
import { useI18n } from "./i18n";

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
    queueMicrotask(() => closeRef.current?.focus());
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onSelectTab = (event: Event) => {
      const next = (event as CustomEvent<CollaborationTab>).detail;
      if (next === "team" || next === "comments" || next === "sso") setTab(next);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("apivoy-collaboration-tab", onSelectTab);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("apivoy-collaboration-tab", onSelectTab);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
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
        <div className="collaboration-tabs" role="tablist" aria-label={t("collaboration.title")}>
          <button type="button" role="tab" aria-selected={tab === "team"} className={tab === "team" ? "is-active" : undefined} onClick={() => setTab("team")}>{t("collaboration.tab.team")}</button>
          <button type="button" role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "is-active" : undefined} onClick={() => setTab("comments")}>{t("collaboration.tab.comments")}</button>
          <button type="button" role="tab" aria-selected={tab === "sso"} className={tab === "sso" ? "is-active" : undefined} onClick={() => setTab("sso")}>{t("collaboration.tab.sso")}</button>
        </div>
        <div className="collaboration-dialog-body" role="tabpanel">
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
