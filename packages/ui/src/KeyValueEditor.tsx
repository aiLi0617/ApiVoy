import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { Icon } from "./Icons";

export type RowValueType = "string" | "integer" | "number" | "boolean" | "array" | "object" | "null";

const ROW_VALUE_TYPES: Array<{ value: RowValueType; label: string }> = [
  { value: "string", label: "String" }, { value: "integer", label: "Integer" },
  { value: "number", label: "Number" }, { value: "boolean", label: "Boolean" },
  { value: "array", label: "Array" }, { value: "object", label: "Object" },
  { value: "null", label: "Null" },
];

const INPUT_STYLE: CSSProperties = {
  flex: 1, minWidth: 220, fontFamily: "var(--apivoy-mono)", fontSize: 12,
  color: "var(--apivoy-text)", background: "var(--apivoy-control-bg)",
  border: "1px solid var(--apivoy-control-border)", borderRadius: "var(--apivoy-control-radius)",
  minHeight: "var(--apivoy-control-height)", padding: "0 var(--apivoy-control-padding-x)", outline: "none",
};

export interface HeaderRow {
  id: string; key: string; value: string; enabled: boolean; valueType: RowValueType;
  typeSelected: boolean; description: string; required: boolean;
}

export function createHeaderRow(key = "", value = "", valueType: RowValueType = "string", description = ""): HeaderRow {
  return { id: crypto.randomUUID(), key, value, enabled: Boolean(key.trim() || value.trim()), valueType, typeSelected: valueType !== "string", description, required: false };
}

export function headerRowsFromPairs(entries: Array<[string, string]>): HeaderRow[] {
  return [...entries.map(([key, value]) => createHeaderRow(key, value)), createHeaderRow()];
}

export function cookieRowsFromHeaders(headers: Array<[string, string]>): HeaderRow[] {
  const cookies = headers.filter(([name]) => name.toLowerCase() === "cookie").flatMap(([, value]) => value.split(";")).flatMap((item) => {
    const separator = item.indexOf("=");
    return separator > 0 ? [createQueryRow(item.slice(0, separator).trim(), item.slice(separator + 1).trim())] : [];
  });
  return [...cookies, createQueryRow()];
}

export function createQueryRow(key = "", value = "", valueType: RowValueType = "string", description = ""): HeaderRow {
  return { ...createHeaderRow(key, value, valueType, description), enabled: Boolean(key.trim() || value.trim()) };
}

export function keyValueRowHasContent(row: HeaderRow): boolean {
  return Boolean(row.key.trim() || row.value.trim() || row.description.trim() || row.typeSelected || row.required);
}

function editRow(row: HeaderRow, patch: Partial<Pick<HeaderRow, "key" | "value" | "valueType" | "typeSelected" | "description" | "required">>): HeaderRow {
  const wasEmpty = !keyValueRowHasContent(row); const next = { ...row, ...patch };
  return { ...next, enabled: keyValueRowHasContent(next) ? row.enabled || wasEmpty : false };
}

function appendEmptyRow(rows: HeaderRow[], index: number): HeaderRow[] {
  return index === rows.length - 1 && keyValueRowHasContent(rows[index]) ? [...rows, createQueryRow()] : rows;
}

export function queryRowsFromUrl(url: string): HeaderRow[] {
  const query = url.split("#", 1)[0].split("?", 2)[1] ?? "";
  return [...Array.from(new URLSearchParams(query).entries()).map(([key, value]) => createQueryRow(key, value)), createQueryRow()];
}

export function urlWithQueryRows(url: string, rows: HeaderRow[]): string {
  const hashIndex = url.indexOf("#"); const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const base = (hashIndex >= 0 ? url.slice(0, hashIndex) : url).split("?", 1)[0];
  const query = new URLSearchParams(rows.filter((row) => row.enabled && row.key.trim()).map((row) => [row.key, row.value])).toString();
  return `${base}${query ? `?${query}` : ""}${hash}`;
}

export interface KeyValueRowsProps {
  rows: HeaderRow[]; setRows: Dispatch<SetStateAction<HeaderRow[]>>; kind: string;
  nameLabel: string; valueLabel: string; addPlaceholder: string; loading?: boolean;
  onRowsChange?: (rows: HeaderRow[]) => void; inconsistentNames?: string[];
}

export function KeyValueRows({ rows, setRows, kind, nameLabel, valueLabel, addPlaceholder, loading = false, onRowsChange, inconsistentNames = [] }: KeyValueRowsProps) {
  const inconsistent = new Set(inconsistentNames.map((name) => name.toLowerCase()));
  const update = (producer: (current: HeaderRow[]) => HeaderRow[]) => { if (loading) return; setRows((current) => { const next = producer(current); onRowsChange?.(next); return next; }); };
  const activateType = (row: HeaderRow, index: number) => { if (!row.typeSelected) update((current) => appendEmptyRow(current.map((item) => item.id === row.id ? editRow(item, { typeSelected: true }) : item), index)); };
  const activateEmpty = (row: HeaderRow, index: number) => { if (!row.enabled && !keyValueRowHasContent(row)) update((current) => { const next = current.map((item) => item.id === row.id ? { ...item, enabled: true } : item); return index === current.length - 1 ? [...next, createQueryRow()] : next; }); };
  const remove = (row: HeaderRow) => update((current) => { const next = current.filter((item) => item.id !== row.id); return next.length && !keyValueRowHasContent(next[next.length - 1]) ? next : [...next, createQueryRow()]; });
  return <div className="http-kv-editor" aria-label={kind}>
    <div className="http-param-header"><span/><span>{nameLabel}</span><span>{valueLabel}</span><span className="http-type-header"><span>类型</span><button type="button" title="是否全部必需" aria-label="切换全部参数是否必填" disabled={loading} onClick={() => update((current) => { const required = !current.filter(keyValueRowHasContent).every((item) => item.required); return current.map((item) => keyValueRowHasContent(item) ? { ...item, required } : item); })}>*</button></span><span/><span>说明</span><span/></div>
    {rows.map((row, index) => {
      const rowHasContent = keyValueRowHasContent(row); const isEntry = index < rows.length - 1 || rowHasContent;
      const missingName = !row.key.trim() && (row.enabled || rowHasContent || index < rows.length - 1);
      const missingValue = row.required && !row.value.trim();
      const isInconsistent = Boolean(row.key.trim() && inconsistent.has(row.key.trim().toLowerCase()));
      return <div className={`http-param-row http-apifox-row${rowHasContent ? " has-content" : ""}${isEntry ? " is-entry" : ""}${row.enabled ? " is-enabled" : ""}${index === rows.length - 1 ? " is-new" : ""}${isInconsistent ? " is-interface-inconsistent" : ""}`} key={row.id} title={isInconsistent ? "此字段与接口文档不一致" : undefined}>
        <input className="http-row-enabled" type="checkbox" aria-label={`${row.enabled ? "停用" : "启用"} ${kind} ${index + 1}`} checked={row.enabled} onChange={(event) => { const enabled = event.target.checked; update((current) => { const next = current.map((item) => item.id === row.id ? { ...item, enabled } : item); return enabled && index === current.length - 1 ? [...next, createQueryRow()] : next; }); }} disabled={loading}/>
        <div className={`http-param-name-cell${!row.enabled && missingName ? " has-muted-error" : ""}`}><input aria-label={`${kind} ${index + 1} 名称`} aria-invalid={row.enabled && missingName} aria-describedby={missingName ? `${row.id}-name-error` : undefined} title={missingName ? (row.enabled ? "参数名不能为空" : "参数名为空（已停用，不影响发送）") : undefined} style={INPUT_STYLE} value={row.key} onFocus={() => activateEmpty(row, index)} onChange={(event) => update((current) => appendEmptyRow(current.map((item) => item.id === row.id ? editRow(item, { key: event.target.value }) : item), index))} placeholder={missingName ? "" : row.enabled ? nameLabel : index === rows.length - 1 ? addPlaceholder : ""} spellCheck={false} disabled={loading}/>{missingName ? <span id={`${row.id}-name-error`}>参数名不能为空</span> : null}</div>
        <div className={`http-param-value-cell${!row.enabled && missingValue ? " has-muted-error" : ""}`}><input aria-label={`${kind} ${index + 1} 值`} aria-invalid={row.enabled && missingValue} aria-describedby={missingValue ? `${row.id}-value-error` : undefined} title={missingValue ? (row.enabled ? "参数值不能为空" : "参数值为空（已停用，不影响发送）") : undefined} style={INPUT_STYLE} value={row.value} onFocus={() => activateEmpty(row, index)} onChange={(event) => update((current) => appendEmptyRow(current.map((item) => item.id === row.id ? editRow(item, { value: event.target.value }) : item), index))} spellCheck={false} disabled={loading}/>{missingValue ? <span id={`${row.id}-value-error`}>参数值不能为空</span> : null}</div>
        <div className="http-param-type-cell"><select className="http-param-type" aria-label={`${kind} ${index + 1} 类型`} style={INPUT_STYLE} value={row.valueType} onPointerDown={() => activateType(row, index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") activateType(row, index); }} onChange={(event) => update((current) => appendEmptyRow(current.map((item) => item.id === row.id ? editRow(item, { valueType: event.target.value as RowValueType, typeSelected: true }) : item), index))} disabled={loading}>{ROW_VALUE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
        <span className="http-required-row"><button type="button" className={row.required ? "is-required" : ""} aria-pressed={row.required} aria-label={`${kind} ${index + 1} ${row.required ? "取消必填" : "设为必填"}`} title={row.required ? "取消必填" : "设为必填"} disabled={loading} onClick={() => update((current) => appendEmptyRow(current.map((item) => item.id === row.id ? editRow(item, { required: !item.required }) : item), index))}>*</button></span>
        <input aria-label={`${kind} ${index + 1} 说明`} style={INPUT_STYLE} value={row.description} onChange={(event) => update((current) => appendEmptyRow(current.map((item) => item.id === row.id ? editRow(item, { description: event.target.value }) : item), index))} disabled={loading}/>
        {index < rows.length - 1 || rowHasContent ? <button type="button" className="http-kv-delete" aria-label={`删除 ${kind} ${index + 1}`} title={`删除此 ${kind}`} onClick={() => remove(row)} disabled={loading}><Icon name="trash"/></button> : <span className="http-kv-delete-placeholder" aria-hidden="true"/>}
      </div>;
    })}
  </div>;
}
