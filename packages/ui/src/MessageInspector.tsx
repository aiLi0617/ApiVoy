import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const MessageInspector = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { hasDetail?: boolean; stacked?: boolean }>(function MessageInspector({ hasDetail, stacked, className, style, children, ...props }, ref) {
  return <div {...props} ref={ref} className={cx("websocket-message-browser", hasDetail && "has-detail", stacked && "is-stacked", className)} style={style as CSSProperties}>{children}</div>;
});

export function MessageSummary({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cx("websocket-message-summary", className)}/>;
}

export function MessageToolbar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header {...props} className={cx("websocket-message-toolbar", className)}/>;
}

export interface MessageAction {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
  className?: string;
}

export function MessageDetailActions({ actions, onClose, closeLabel = "关闭消息详情", moreLabel = "更多消息操作", className }: { actions: MessageAction[]; onClose: () => void; closeLabel?: string; moreLabel?: string; className?: string }) {
  return <div className={cx("websocket-frame-detail-actions", className)}>
    {actions.map((action) => <button type="button" className={action.className} aria-label={action.label} title={action.label} key={action.id} onClick={action.onSelect}><Icon name={action.icon}/></button>)}
    <details className="websocket-detail-more"><summary aria-label={moreLabel} title="更多"><Icon name="more"/></summary><div role="menu" aria-label={moreLabel}>{actions.map((action) => <button type="button" role="menuitem" key={action.id} onClick={(event) => { action.onSelect(); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Icon name={action.icon}/>{action.label}</button>)}</div></details>
    <button type="button" aria-label={closeLabel} title="关闭" onClick={onClose}><Icon name="close"/></button>
  </div>;
}

export function MessageDetail({ options, actions, children, className }: { options: ReactNode; actions: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cx("websocket-frame-detail", className)}><header><div className="websocket-frame-detail-options">{options}</div>{actions}</header>{children}</section>;
}
