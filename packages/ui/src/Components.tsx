import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icons";
import { useDialogFocus } from "./useDialogFocus";

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "default" | "compact";
  icon?: IconName;
  iconPosition?: "start" | "end";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "default",
    icon,
    iconPosition = "start",
    loading = false,
    disabled,
    className,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  const iconNode = loading ? (
    <span className="ui-button-spinner" aria-hidden="true" />
  ) : icon ? (
    <Icon name={icon} width={size === "compact" ? 14 : 16} height={size === "compact" ? 14 : 16} aria-hidden="true" />
  ) : null;

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("ui-button", variant, size === "compact" && "compact", className)}
    >
      {iconPosition === "start" && iconNode}
      {children}
      {iconPosition === "end" && iconNode}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: IconName;
  size?: number;
  active?: boolean;
  tone?: "default" | "danger";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 16, active, tone = "default", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cx("ui-icon-button", active && "is-active", tone === "danger" && "danger", className)}
    >
      <Icon name={icon} width={size} height={size} aria-hidden="true" />
    </button>
  );
});

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, required, children, className, ...props }: FieldProps) {
  const generatedId = useId();
  const descriptionId = `${generatedId}-description`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>, {
        id: (children.props as { id?: string }).id ?? generatedId,
        "aria-describedby": error || hint ? descriptionId : undefined,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div {...props} className={cx("ui-field", Boolean(error) && "has-error", className)}>
      <label className="ui-field-label" htmlFor={isValidElement(control) ? (control.props as { id?: string }).id : undefined}>
        {label}
        {required && <span className="ui-field-required" aria-hidden="true">*</span>}
      </label>
      {control}
      {(error || hint) && (
        <div id={descriptionId} className={cx("ui-field-description", Boolean(error) && "error")} role={error ? "alert" : undefined}>
          {error || hint}
        </div>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, type = "text", ...props },
  ref,
) {
  return <input {...props} ref={ref} type={type} className={cx("ui-input", className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return <select {...props} ref={ref} className={cx("ui-select", className)}>{children}</select>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea {...props} ref={ref} className={cx("ui-textarea", className)} />;
});

export interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

function Choice({ label, description, className, ...props }: ChoiceProps & { type: "checkbox" | "radio" }) {
  const { type, ...inputProps } = props;
  return (
    <label className={cx("ui-choice", type === "radio" && "radio", className)}>
      <input {...inputProps} type={type} />
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    </label>
  );
}

export function Checkbox(props: ChoiceProps) { return <Choice {...props} type="checkbox" />; }
export function Radio(props: ChoiceProps) { return <Choice {...props} type="radio" />; }

export function Switch({ label, description, className, ...props }: ChoiceProps) {
  return (
    <label className={cx("ui-switch", className)}>
      <input {...props} type="checkbox" role="switch" />
      <span className="ui-switch-track" aria-hidden="true"><i /></span>
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    </label>
  );
}

export interface SegmentedItem<T extends string> { value: T; label: ReactNode; disabled?: boolean }
export function SegmentedControl<T extends string>({ value, items, onValueChange, ariaLabel, className }: {
  value: T;
  items: Array<SegmentedItem<T>>;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cx("ui-segmented", className)} role="group" aria-label={ariaLabel}>
      {items.map((item) => <button key={item.value} type="button" aria-pressed={item.value === value} disabled={item.disabled} className={item.value === value ? "is-active" : undefined} onClick={() => onValueChange(item.value)}>{item.label}</button>)}
    </div>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: Array<TabItem<T>>;
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  tabsClassName?: string;
  panelClassName?: string;
  keepMounted?: boolean;
}

export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
  tabsClassName,
  panelClassName,
  keepMounted = false,
}: TabsProps<T>) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled);
    const enabledIndex = enabled.findIndex(({ index }) => index === currentIndex);
    let target = enabledIndex;
    if (event.key === "ArrowRight") target = (enabledIndex + 1) % enabled.length;
    else if (event.key === "ArrowLeft") target = (enabledIndex - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = enabled.length - 1;
    else return;
    event.preventDefault();
    const next = enabled[target];
    if (!next) return;
    onValueChange(next.item.value);
    tabRefs.current[next.index]?.focus();
  }

  return (
    <div className={cx("ui-tabs", className)}>
      <div className={cx("ui-tab-list", tabsClassName)} role="tablist" aria-label={ariaLabel}>
        {items.map((item, index) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={`${baseId}-${item.value}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-${item.value}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cx("ui-tab", selected && "active")}
              onClick={() => onValueChange(item.value)}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => {
        const selected = item.value === value;
        if (!selected && !keepMounted) return null;
        return (
          <div
            key={item.value}
            id={`${baseId}-${item.value}-panel`}
            role="tabpanel"
            aria-labelledby={`${baseId}-${item.value}-tab`}
            className={cx("ui-tab-panel", panelClassName)}
            hidden={!selected}
          >
            {item.content}
          </div>
        );
      })}
    </div>
  );
}

export function StatusBadge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return <span {...props} className={cx("ui-status-badge", tone, className)} />;
}

export function InlineAlert({ tone = "info", title, children, className, ...props }: HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
}) {
  return (
    <div {...props} className={cx("ui-inline-alert", tone, className)} role={tone === "danger" ? "alert" : "status"}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}

export function ButtonGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ui-button-group", className)} role={props.role ?? "group"} />;
}

export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {
  onClear?: () => void;
}>(function SearchInput({ className, onClear, value, defaultValue, ...props }, ref) {
  const hasValue = value !== undefined ? String(value).length > 0 : defaultValue !== undefined && String(defaultValue).length > 0;
  return (
    <span className={cx("ui-search-input", className)}>
      <Icon name="search" width={15} height={15} aria-hidden="true" />
      <input {...props} ref={ref} type="search" value={value} defaultValue={defaultValue} />
      {onClear && hasValue ? <IconButton label="清空搜索" icon="close" size={13} onClick={onClear} /> : null}
    </span>
  );
});

export function Toolbar({ label, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return <div {...props} className={cx("ui-toolbar", className)} role="toolbar" aria-label={label} />;
}

export function Tag({ tone = "neutral", removable, onRemove, children, className, ...props }: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  removable?: boolean;
  onRemove?: () => void;
}) {
  return <span {...props} className={cx("ui-tag", tone, className)}>{children}{removable ? <IconButton label={`移除 ${String(children)}`} icon="close" size={11} onClick={onRemove} /> : null}</span>;
}

export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const normalized = Math.max(0, Math.min(100, value));
  return <div className={cx("ui-progress", className)}><div><span>{label}</span><strong>{normalized}%</strong></div><span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}><i style={{ width: `${normalized}%` }} /></span></div>;
}

export function LoadingState({ label = "正在加载…", compact = false, className }: { label?: string; compact?: boolean; className?: string }) {
  return <div className={cx("ui-loading-state", compact && "compact", className)} role="status"><span className="ui-spinner" aria-hidden="true"/><span>{label}</span></div>;
}

export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return <div className={cx("ui-skeleton", className)} aria-label="内容加载中" role="status">{Array.from({ length: lines }, (_, index) => <i key={index} />)}</div>;
}

export function EmptyState({ icon = "archive", title, description, action, className }: {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return <div className={cx("ui-empty-state", className)}><Icon name={icon} aria-hidden="true"/><strong>{title}</strong>{description ? <span>{description}</span> : null}{action}</div>;
}

export interface BreadcrumbItem { label: ReactNode; onClick?: () => void; current?: boolean }
export function Breadcrumbs({ items, label = "面包屑导航", className }: { items: BreadcrumbItem[]; label?: string; className?: string }) {
  return <nav className={cx("ui-breadcrumbs", className)} aria-label={label}><ol>{items.map((item, index) => <li key={index}>{index ? <Icon name="chevron" width={12} height={12} aria-hidden="true"/> : null}{item.onClick && !item.current ? <button type="button" onClick={item.onClick}>{item.label}</button> : <span aria-current={item.current ? "page" : undefined}>{item.label}</span>}</li>)}</ol></nav>;
}

export function Pagination({ page, pages, onPageChange, className }: { page: number; pages: number; onPageChange: (page: number) => void; className?: string }) {
  const safePages = Math.max(1, pages);
  return <nav className={cx("ui-pagination", className)} aria-label="分页"><IconButton label="上一页" icon="arrow-up" disabled={page <= 1} onClick={() => onPageChange(page - 1)} /><span>第 <strong>{page}</strong> / {safePages} 页</span><IconButton label="下一页" icon="arrow-down" disabled={page >= safePages} onClick={() => onPageChange(page + 1)} /></nav>;
}

export interface DataTableColumn { id: string; label: ReactNode; align?: "start" | "center" | "end" }
export function DataTable({ columns, rows, caption, empty, className }: {
  columns: DataTableColumn[];
  rows: Array<Record<string, ReactNode>>;
  caption: string;
  empty?: ReactNode;
  className?: string;
}) {
  return <div className={cx("ui-data-table-wrap", className)}><table className="ui-data-table"><caption className="sr-only">{caption}</caption><thead><tr>{columns.map((column) => <th key={column.id} className={column.align ? `align-${column.align}` : undefined}>{column.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column) => <td key={column.id} className={column.align ? `align-${column.align}` : undefined}>{row[column.id]}</td>)}</tr>) : <tr><td colSpan={columns.length}>{empty ?? "暂无数据"}</td></tr>}</tbody></table></div>;
}

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}
export function DropdownMenu({ label, items, icon = "more", className }: { label: string; items: MenuItem[]; icon?: IconName; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return <div ref={rootRef} className={cx("ui-dropdown", className)}><IconButton label={label} icon={icon} aria-haspopup="menu" aria-expanded={open} active={open} onClick={() => setOpen((value) => !value)} />{open ? <div className="ui-menu" role="menu" aria-label={label}>{items.map((item) => <button key={item.id} type="button" role="menuitem" disabled={item.disabled} className={item.danger ? "danger" : undefined} onClick={() => { item.onSelect?.(); setOpen(false); }}>{item.icon ? <Icon name={item.icon} width={14} height={14} aria-hidden="true"/> : null}<span>{item.label}</span></button>)}</div> : null}</div>;
}

export function Accordion({ items, className }: { items: Array<{ id: string; title: ReactNode; content: ReactNode; defaultOpen?: boolean }>; className?: string }) {
  return <div className={cx("ui-accordion", className)}>{items.map((item) => <details key={item.id} open={item.defaultOpen}><summary><span>{item.title}</span><Icon name="chevron" width={14} height={14} aria-hidden="true"/></summary><div>{item.content}</div></details>)}</div>;
}

export interface OverlayProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}

export function Dialog({ open, title, description, children, footer, onClose, className }: OverlayProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(open, dialogRef, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className="ui-overlay" role="presentation" onMouseDown={onClose}><section ref={dialogRef} tabIndex={-1} className={cx("ui-dialog", className)} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div><IconButton label="关闭" icon="close" onClick={onClose}/></header><div className="ui-overlay-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</section></div>, document.body);
}

export function Drawer({ open, title, description, children, footer, onClose, className }: OverlayProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  useDialogFocus(open, drawerRef, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className="ui-overlay" role="presentation" onMouseDown={onClose}><aside ref={drawerRef} tabIndex={-1} className={cx("ui-drawer", className)} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div><IconButton label="关闭" icon="close" onClick={onClose}/></header><div className="ui-overlay-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</aside></div>, document.body);
}
