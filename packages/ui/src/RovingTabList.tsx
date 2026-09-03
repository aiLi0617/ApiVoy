import type { HTMLAttributes, KeyboardEvent } from "react";

export interface RovingTabListProps extends Omit<HTMLAttributes<HTMLDivElement>, "aria-label"> {
  ariaLabel: string;
}

export function moveTabFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
  if (!tabs.length) return;
  const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
  const next = event.key === "Home" ? 0
    : event.key === "End" ? tabs.length - 1
      : event.key === "ArrowRight" ? (current + 1) % tabs.length
        : (current - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].click();
  tabs[next].focus();
}

export function RovingTabList({ ariaLabel, onKeyDown, ...props }: RovingTabListProps) {
  return <div {...props} role="tablist" aria-label={ariaLabel} onKeyDown={(event) => { moveTabFocus(event); onKeyDown?.(event); }}/>;
}
