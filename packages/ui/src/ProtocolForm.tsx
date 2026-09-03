import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ProtocolFormCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("protocol-form-card", className)} />;
}

export function ProtocolFormGrid({ columns = 3, className, ...props }: HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 }) {
  return <div {...props} className={cx("protocol-form-grid", `columns-${columns}`, className)} />;
}

export function ProtocolField({ label, children, className, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { label: ReactNode }) {
  return <label {...props} className={cx("protocol-form-field", className)}>{label}{children}</label>;
}

export function ProtocolFormOptions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("protocol-form-options", className)} />;
}
