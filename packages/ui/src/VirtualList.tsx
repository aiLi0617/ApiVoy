import { useMemo, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";

export interface VirtualListProps<T> {
  items: readonly T[];
  itemHeight: number;
  height?: number;
  overscan?: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  empty?: ReactNode;
  ariaLabel: string;
}

export interface VirtualRange { start: number; end: number }

export function getVirtualRange(itemCount: number, itemHeight: number, height: number, scrollTop: number, overscan = 5): VirtualRange {
  const visibleCount = Math.ceil(height / itemHeight);
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  return { start, end: Math.min(itemCount, start + visibleCount + overscan * 2) };
}

export function VirtualList<T>({ items, itemHeight, height = 360, overscan = 5, getKey, renderItem, className, empty, ariaLabel }: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const { start, end } = getVirtualRange(items.length, itemHeight, height, scrollTop, overscan);
  const visible = useMemo(() => items.slice(start, end), [items, start, end]);
  const spacerStyle = { height: items.length * itemHeight, position: "relative" } satisfies CSSProperties;
  const windowStyle = { position: "absolute", insetInline: 0, top: start * itemHeight } satisfies CSSProperties;
  function onScroll(event: UIEvent<HTMLDivElement>) { setScrollTop(event.currentTarget.scrollTop); }
  if (items.length === 0) return <>{empty}</>;
  return <div className={`virtual-list ${className ?? ""}`} style={{ height }} onScroll={onScroll} role="list" aria-label={ariaLabel} tabIndex={0}><div style={spacerStyle}><div style={windowStyle}>{visible.map((item, offset) => { const index = start + offset; return <div role="listitem" aria-setsize={items.length} aria-posinset={index + 1} className="virtual-list-item" style={{ height: itemHeight }} key={getKey(item, index)}>{renderItem(item, index)}</div>; })}</div></div></div>;
}
