import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
void createPortal;
import type {
  Assertion,
  AssertionResultEvent,
  AuthRef,
  ExecutionSummary,
  ExecutionEvent,
  MultipartPart,
  ResponseMeta,
  RequestEnvelope,
} from "@apivoy/request-model";
import { CodeGenerator } from "./CodeGenerator";
import { Icon } from "./Icons";
import { CodeEditor } from "./CodeEditor";
import { SplitPane, WorkbenchFrame } from "./WorkbenchFrame";
import { VirtualList } from "./VirtualList";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";
import { useWorkbenchHydration } from "./useWorkbenchHydration";
import { ScriptStepEditor } from "./ScriptStepEditor";
import type { ScriptAsset } from "./scriptLibrary";
import ts from "typescript";
import { listEnvironmentResources } from "./agentResources";

export type AuthKind = "none" | "bearer" | "basic" | "api_key" | "oauth2_client_credentials" | "oauth2_authorization_code";

export interface HttpWorkbenchRequest {
  id?: string;
  name?: string;
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: string;
  bodyEncoding?: "text" | "base64";
  bodySource?: string;
  multipart?: MultipartPart[];
  timeoutMs: number;
  variables: Record<string, string>;
  assertions: Assertion[];
  auth?: AuthRef | null;
  followRedirects: boolean;
  retryMax: number;
  retryBackoffMs: number;
  proxy?: string | null;
  tlsVerify: boolean;
  tlsClientCertRef?: string | null;
  environmentRef?: string | null;
  preScripts?: string[];
  postScripts?: string[];
}

export function requestNameFromUrl(value: string): string {
  const target = value.trim();
  if (!target) return "未命名接口";
  try {
    return new URL(target, "http://apivoy.local").pathname || "/";
  } catch {
    return target.split(/[?#]/, 1)[0] || "未命名接口";
  }
}

export interface HttpRunResult {
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
  error?: string;
  executionId?: string;
  assertions?: AssertionResultEvent[];
  responseMeta?: ResponseMeta | null;
}

export interface HttpSendHooks {
  /** Called as soon as the execution id is known (before streaming completes). */
  onStarted?: (executionId: string) => void;
  onChunk?: (preview: string) => void;
  onEvent?: (event: ExecutionEvent) => void;
}

export interface HistoryItem {
  id: string;
  protocolId: string;
  state: string;
  status?: number | null;
  durationMs: number;
  startedAt: string;
  target?: string;
  preview?: string | null;
}

export interface HistoryFilter {
  state?: string;
  status?: number;
  protocolId?: string;
  requestId?: string;
}

export type RowValueType = "string" | "integer" | "number" | "boolean" | "array" | "object" | "null";

const ROW_VALUE_TYPES: Array<{ value: RowValueType; label: string }> = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "array", label: "Array" },
  { value: "object", label: "Object" },
  { value: "null", label: "Null" },
];

export interface HeaderRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  valueType: RowValueType;
  typeSelected: boolean;
  description: string;
  required: boolean;
}

function httpRequestFromEnvelope(value: unknown): HttpWorkbenchRequest | null {
  const envelope = value as RequestEnvelope | null;
  if (!envelope || envelope.payload?.type !== "http") return null;
  const payload = envelope.payload;
  return {
    id: envelope.id,
    name: envelope.name,
    url: envelope.target,
    method: payload.method,
    headers: payload.headers,
    body: payload.body ?? undefined,
    bodyEncoding: payload.bodyEncoding ?? "text",
    bodySource: payload.bodySource ?? undefined,
    multipart: payload.multipart ?? [],
    timeoutMs: envelope.timeoutMs,
    variables: envelope.variables ?? {},
    assertions: envelope.assertions ?? [],
    auth: envelope.authRef ?? null,
    followRedirects: payload.followRedirects,
    retryMax: envelope.retryPolicy.max_retries,
    retryBackoffMs: envelope.retryPolicy.backoff_ms,
    proxy: envelope.proxy ?? null,
    tlsVerify: envelope.tls.verify,
    tlsClientCertRef: envelope.tls.client_cert_ref ?? null,
    environmentRef: envelope.environmentRef,
    preScripts: envelope.preScripts ?? [],
    postScripts: envelope.postScripts ?? [],
  };
}

interface MultipartEditorPart extends MultipartPart {
  id: string;
  enabled: boolean;
  description: string;
  kind: "text" | "file";
  valueType: RowValueType;
  typeSelected: boolean;
  required: boolean;
}

type BodyMode = "none" | "multipart" | "urlencoded" | "json" | "xml" | "text" | "graphql" | "jsonrpc" | "soap" | "binary" | "msgpack";

const BODY_MODES: Array<{ id: BodyMode; label: string; contentType?: string }> = [
  { id: "none", label: "none" },
  { id: "multipart", label: "form-data" },
  { id: "urlencoded", label: "x-www-form-urlencoded", contentType: "application/x-www-form-urlencoded" },
  { id: "json", label: "JSON", contentType: "application/json" },
  { id: "xml", label: "XML", contentType: "application/xml" },
  { id: "text", label: "Text", contentType: "text/plain" },
  { id: "graphql", label: "GraphQL", contentType: "application/json" },
  { id: "jsonrpc", label: "JSON-RPC", contentType: "application/json" },
  { id: "soap", label: "SOAP", contentType: "application/soap+xml" },
  { id: "binary", label: "Binary", contentType: "application/octet-stream" },
  { id: "msgpack", label: "MessagePack", contentType: "application/msgpack" },
];

function resolveAssets(ids:string[]):string[]{ let assets:ScriptAsset[]=[];try{assets=JSON.parse(localStorage.getItem("apivoy-project-scripts-v1")??"[]") as ScriptAsset[]}catch{return []}return ids.map((id)=>assets.find((item)=>item.id===id)).filter((item):item is ScriptAsset=>!!item).map((item)=>{const source=item.language==="typescript"?ts.transpileModule(item.source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText:item.source;return `// @apivoy-script:${item.id}\n${source}`})}
function assetIdsFromScripts(scripts:string[]|undefined):string[]{return Array.from(new Set((scripts??[]).map((script)=>script.match(/^\/\/ @apivoy-script:([^\s]+)/m)?.[1]).filter((id):id is string=>Boolean(id))))}

function createHeaderRow(key = "", value = "", valueType: HeaderRow["valueType"] = "string", description = ""): HeaderRow {
  return { id: crypto.randomUUID(), key, value, enabled: Boolean(key.trim() || value.trim()), valueType, typeSelected: valueType !== "string", description, required: false };
}

function headerRowsFromPairs(headers: Array<[string, string]>): HeaderRow[] {
  return [...headers.map(([key, value]) => createHeaderRow(key, value)), createHeaderRow()];
}

function cookieRowsFromHeaders(headers: Array<[string, string]>): HeaderRow[] {
  const parsed = headers
    .filter(([key]) => key.toLowerCase() === "cookie")
    .flatMap(([, value]) => value.split(";"))
    .flatMap((item) => {
      const trimmed = item.trim();
      const separator = trimmed.indexOf("=");
      return separator > 0 ? [createQueryRow(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim())] : [];
    });
  return [...parsed, createQueryRow()];
}

export function createQueryRow(key = "", value = "", valueType: HeaderRow["valueType"] = "string", description = ""): HeaderRow {
  return { ...createHeaderRow(key, value, valueType, description), enabled: Boolean(key.trim() || value.trim()) };
}

function keyValueRowHasContent(row: HeaderRow): boolean {
  return Boolean(row.key.trim() || row.value.trim() || row.description.trim() || row.typeSelected || row.required);
}

function editKeyValueRow(row: HeaderRow, patch: Partial<Pick<HeaderRow, "key" | "value" | "valueType" | "typeSelected" | "description" | "required">>): HeaderRow {
  const wasEmpty = !keyValueRowHasContent(row);
  const next = { ...row, ...patch };
  const hasContent = keyValueRowHasContent(next);
  return { ...next, enabled: hasContent ? row.enabled || wasEmpty : false };
}

function appendEmptyKeyValueRow(rows: HeaderRow[], editedIndex: number): HeaderRow[] {
  return editedIndex === rows.length - 1 && keyValueRowHasContent(rows[editedIndex]) ? [...rows, createQueryRow()] : rows;
}

function createMultipartEditorPart(part: Partial<MultipartPart> = {}): MultipartEditorPart {
  return { id: crypto.randomUUID(), enabled: Boolean(part.name?.trim()), description: "", kind: part.fileName ? "file" : "text", valueType: "string", typeSelected: Boolean(part.fileName), required: false, name: part.name ?? "", value: part.value ?? "", fileName: part.fileName, contentType: part.contentType, base64: part.base64 ?? false };
}

function multipartPartHasContent(part: MultipartEditorPart): boolean {
  return Boolean(part.name.trim() || part.value || part.fileName || part.description.trim() || part.typeSelected || part.required);
}

export function queryRowsFromUrl(url: string): HeaderRow[] {
  const query = url.split("#", 1)[0].split("?", 2)[1] ?? "";
  return [...Array.from(new URLSearchParams(query).entries()).map(([key, value]) => createQueryRow(key, value)), createQueryRow()];
}

export function urlWithQueryRows(url: string, rows: HeaderRow[]): string {
  const hashIndex = url.indexOf("#"); const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const base = withoutHash.split("?", 1)[0];
  const query = new URLSearchParams(rows.filter((row) => row.enabled && row.key.trim()).map((row) => [row.key, row.value])).toString();
  return `${base}${query ? `?${query}` : ""}${hash}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function charsetFromContentType(contentType?: string | null): string {
  return contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase() ?? "utf-8";
}

function requestSize(request: HttpWorkbenchRequest | null): number {
  if (!request) return 0;
  return requestHeaderSize(request) + requestBodySize(request);
}

function requestHeaderSize(request: HttpWorkbenchRequest | null): number {
  return request?.headers.reduce((size, [name, value]) => size + new TextEncoder().encode(`${name}: ${value}\r\n`).length, 0) ?? 0;
}

function requestBodySize(request: HttpWorkbenchRequest | null): number {
  return new TextEncoder().encode(request?.body ?? "").length;
}

function responseHeaderSize(meta: ResponseMeta | null | undefined): number {
  return meta?.headers.reduce((size, [name, value]) => size + new TextEncoder().encode(`${name}: ${value}\r\n`).length, 0) ?? 0;
}

interface KeyValueRowsProps {
  rows: HeaderRow[];
  setRows: Dispatch<SetStateAction<HeaderRow[]>>;
  kind: string;
  nameLabel: string;
  valueLabel: string;
  addPlaceholder: string;
  loading?: boolean;
  onRowsChange?: (rows: HeaderRow[]) => void;
}

export function KeyValueRows({ rows, setRows, kind, nameLabel, valueLabel, addPlaceholder, loading = false, onRowsChange }: KeyValueRowsProps) {
  const update = (producer: (current: HeaderRow[]) => HeaderRow[]) => { if (loading) return; setRows((current) => { const next = producer(current); onRowsChange?.(next); return next; }); };
  const activateTypeSelection = (row: HeaderRow, index: number) => {
    if (row.typeSelected) return;
    update((current) => appendEmptyKeyValueRow(current.map((item) => item.id === row.id ? editKeyValueRow(item, { typeSelected: true }) : item), index));
  };
  const activateEmptyRow = (row: HeaderRow, index: number) => {
    if (row.enabled || keyValueRowHasContent(row)) return;
    update((current) => { const next = current.map((item) => item.id === row.id ? { ...item, enabled: true } : item); return index === current.length - 1 ? [...next, createQueryRow()] : next; });
  };
  const remove = (row: HeaderRow) => {
    update((current) => { const next = current.filter((item) => item.id !== row.id); return next.length && !keyValueRowHasContent(next[next.length - 1]) ? next : [...next, createQueryRow()]; });
  };
  return <div className="http-kv-editor" aria-label={kind}>
    <div className="http-param-header"><span/><span>{nameLabel}</span><span>{valueLabel}</span><span className="http-type-header"><span>类型</span><button type="button" title="是否全部必需" aria-label="切换全部参数是否必填" disabled={loading} onClick={() => update((current) => { const required = !current.filter(keyValueRowHasContent).every((item) => item.required); return current.map((item) => keyValueRowHasContent(item) ? { ...item, required } : item); })}>*</button></span><span/><span>说明</span><span/></div>
    {rows.map((row, index) => {
      const removable = index < rows.length - 1 || keyValueRowHasContent(row);
      const hasContent = keyValueRowHasContent(row);
      const isEntry = index < rows.length - 1 || hasContent;
      const missingName = !row.key.trim() && (row.enabled || hasContent || index < rows.length - 1);
      const invalidName = row.enabled && missingName;
      const mutedInvalidName = !row.enabled && missingName;
      const missingValue = row.required && !row.value.trim();
      const invalidValue = row.enabled && missingValue;
      const mutedInvalidValue = !row.enabled && missingValue;
      return <div className={`http-param-row http-apifox-row${hasContent ? " has-content" : ""}${isEntry ? " is-entry" : ""}${row.enabled ? " is-enabled" : ""}${index === rows.length - 1 ? " is-new" : ""}`} key={row.id}>
        <input className="http-row-enabled" type="checkbox" aria-label={`${row.enabled ? "停用" : "启用"} ${kind} ${index + 1}`} checked={row.enabled} onChange={(event) => { const enabled = event.target.checked; update((current) => { const next = current.map((item) => item.id === row.id ? { ...item, enabled } : item); return enabled && index === current.length - 1 ? [...next, createQueryRow()] : next; }); }} disabled={loading}/>
        <div className={`http-param-name-cell${mutedInvalidName ? " has-muted-error" : ""}`}><input aria-label={`${kind} ${index + 1} 名称`} aria-invalid={invalidName} aria-describedby={missingName ? `${row.id}-name-error` : undefined} title={missingName ? (row.enabled ? "参数名不能为空" : "参数名为空（已停用，不影响发送）") : undefined} style={styles.input} value={row.key} onFocus={() => activateEmptyRow(row, index)} onChange={(event) => update((current) => appendEmptyKeyValueRow(current.map((item) => item.id === row.id ? editKeyValueRow(item, { key: event.target.value }) : item), index))} placeholder={missingName ? "" : row.enabled ? nameLabel : index === rows.length - 1 ? addPlaceholder : ""} spellCheck={false} disabled={loading}/>{missingName && <span id={`${row.id}-name-error`}>参数名不能为空</span>}</div>
        <div className={`http-param-value-cell${mutedInvalidValue ? " has-muted-error" : ""}`}><input aria-label={`${kind} ${index + 1} 值`} aria-invalid={invalidValue} aria-describedby={missingValue ? `${row.id}-value-error` : undefined} title={missingValue ? (row.enabled ? "参数值不能为空" : "参数值为空（已停用，不影响发送）") : undefined} style={styles.input} value={row.value} onFocus={() => activateEmptyRow(row, index)} onChange={(event) => update((current) => appendEmptyKeyValueRow(current.map((item) => item.id === row.id ? editKeyValueRow(item, { value: event.target.value }) : item), index))} placeholder="" spellCheck={false} disabled={loading}/>{missingValue && <span id={`${row.id}-value-error`}>参数值不能为空</span>}</div>
        <div className="http-param-type-cell"><select className="http-param-type" aria-label={`${kind} ${index + 1} 类型`} style={styles.input} value={row.valueType} onPointerDown={() => activateTypeSelection(row, index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") activateTypeSelection(row, index); }} onChange={(event) => update((current) => appendEmptyKeyValueRow(current.map((item) => item.id === row.id ? editKeyValueRow(item, { valueType: event.target.value as HeaderRow["valueType"], typeSelected: true }) : item), index))} disabled={loading}>{ROW_VALUE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
        <span className="http-required-row"><button type="button" className={row.required ? "is-required" : ""} aria-pressed={row.required} aria-label={`${kind} ${index + 1} ${row.required ? "取消必填" : "设为必填"}`} title={row.required ? "取消必填" : "设为必填"} disabled={loading} onClick={() => update((current) => appendEmptyKeyValueRow(current.map((item) => item.id === row.id ? editKeyValueRow(item, { required: !item.required }) : item), index))}>*</button></span>
        <input aria-label={`${kind} ${index + 1} 说明`} style={styles.input} value={row.description} onChange={(event) => update((current) => appendEmptyKeyValueRow(current.map((item) => item.id === row.id ? editKeyValueRow(item, { description: event.target.value }) : item), index))} placeholder="" disabled={loading}/>
        {removable ? <button type="button" className="http-kv-delete" aria-label={`删除 ${kind} ${index + 1}`} title={`删除此 ${kind}`} onClick={() => remove(row)} disabled={loading}><Icon name="trash"/></button> : <span className="http-kv-delete-placeholder" aria-hidden="true"/>}
      </div>;
    })}
  </div>;
}

export interface HttpWorkbenchProps {
  onSend: (request: HttpWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onTitleChange?: (title: string) => void;
  onCancel?: (executionId: string) => Promise<void>;
  onSave?: (request: HttpWorkbenchRequest) => Promise<void>;
  onPutSecret?: (name: string, value: string) => Promise<void>;
  onListCookies?: (url: string) => Promise<Array<{ name: string; value: string }>>;
  onSetCookie?: (url: string, name: string, value: string) => Promise<void>;
  onDeleteCookie?: (url: string, name: string) => Promise<void>;
  onListHistory?: (filter?: HistoryFilter) => Promise<HistoryItem[]>;
  onReplayHistory?: (id: string) => Promise<HttpWorkbenchRequest | RequestEnvelope | null>;
  externalRequest?: HttpWorkbenchRequest | null;
  environments?: Array<{ id: string; name: string }>;
  defaultEnvironmentId?: string;
  toolbarTargetId?: string;
  workbenchSessionId?: string;
}

const DEFAULT_ENVIRONMENTS = [{ id: "default-env", name: "默认环境" }];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function shellTokens(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source.replace(/\\\r?\n/g, " ")))) {
    tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["\\])/g, "$1"));
  }
  return tokens;
}

function parseCurl(source: string): Partial<HttpWorkbenchRequest> {
  const tokens = shellTokens(source.trim());
  if (tokens[0]?.toLowerCase() !== "curl") {
    throw new Error("请输入以 curl 开头的命令");
  }
  let method = "GET";
  let url = "";
  let body: string | undefined;
  const headers: Array<[string, string]> = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "-X" || token === "--request") {
      method = (tokens[++i] ?? "GET").toUpperCase();
    } else if (token === "-H" || token === "--header") {
      const value = tokens[++i] ?? "";
      const split = value.indexOf(":");
      if (split > 0) headers.push([value.slice(0, split).trim(), value.slice(split + 1).trim()]);
    } else if (["-d", "--data", "--data-raw", "--data-binary"].includes(token)) {
      body = tokens[++i] ?? "";
      if (method === "GET") method = "POST";
    } else if (!token.startsWith("-") && !url) {
      url = token;
    }
  }
  if (!url) throw new Error("cURL 命令中没有找到 URL");
  return { method, url, headers, body };
}

function prettyPreview(preview: string): string {
  try {
    return JSON.stringify(JSON.parse(preview), null, 2);
  } catch {
    return preview;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function encodeMessagePack(value: unknown): Uint8Array {
  const output: number[] = []; const text = new TextEncoder();
  const push16 = (n: number) => output.push((n >>> 8) & 255, n & 255);
  const encode = (item: unknown): void => {
    if (item === null) { output.push(0xc0); return; }
    if (item === false || item === true) { output.push(item ? 0xc3 : 0xc2); return; }
    if (typeof item === "number") {
      if (Number.isInteger(item) && item >= 0 && item <= 0x7f) output.push(item);
      else if (Number.isInteger(item) && item >= -32 && item < 0) output.push(0x100 + item);
      else if (Number.isInteger(item) && item >= 0 && item <= 0xff) output.push(0xcc, item);
      else if (Number.isInteger(item) && item >= 0 && item <= 0xffff) { output.push(0xcd); push16(item); }
      else if (Number.isInteger(item) && item >= -128 && item < 0) output.push(0xd0, item & 255);
      else { const buffer = new ArrayBuffer(9); const view = new DataView(buffer); view.setUint8(0, 0xcb); view.setFloat64(1, item, false); output.push(...new Uint8Array(buffer)); }
      return;
    }
    if (typeof item === "string") { const bytes = text.encode(item); if (bytes.length < 32) output.push(0xa0 | bytes.length); else if (bytes.length <= 0xff) output.push(0xd9, bytes.length); else { output.push(0xda); push16(bytes.length); } output.push(...bytes); return; }
    if (Array.isArray(item)) { if (item.length < 16) output.push(0x90 | item.length); else { output.push(0xdc); push16(item.length); } item.forEach(encode); return; }
    if (typeof item === "object") { const entries = Object.entries(item as Record<string, unknown>); if (entries.length < 16) output.push(0x80 | entries.length); else { output.push(0xde); push16(entries.length); } entries.forEach(([key, child]) => { encode(key); encode(child); }); return; }
    throw new Error(`MessagePack 不支持 ${typeof item}`);
  };
  encode(value); return new Uint8Array(output);
}

function hexPreview(preview: string): string {
  const bytes = new TextEncoder().encode(preview);
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    const hex = [...row].map((value) => value.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const ascii = [...row].map((value) => value >= 32 && value < 127 ? String.fromCharCode(value) : ".").join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
  }
  return lines.join("\n");
}

function jsonRows(preview: string): { columns: string[]; rows: Record<string, unknown>[] } | null {
  try {
    const parsed = JSON.parse(preview) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (!rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) return null;
    const records = rows as Record<string, unknown>[];
    const columns = [...new Set(records.flatMap((row) => Object.keys(row)))];
    return { columns, rows: records };
  } catch { return null; }
}

function failedSummary(): ExecutionSummary {
  const now = new Date().toISOString();
  return {
    executionId: "",
    requestId: "",
    protocolId: "http",
    state: "failed",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    bytesReceived: 0,
  };
}

function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function formatKv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function parseAssertions(text: string): Assertion[] {
  const out: Assertion[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const status = trimmed.match(/^status\s*==\s*(\d+)$/i);
    if (status) {
      out.push({ type: "status_equals", expected: Number(status[1]) });
      continue;
    }
    const duration = trimmed.match(/^duration\s*<\s*(\d+)$/i);
    if (duration) {
      out.push({ type: "duration_lt", max_ms: Number(duration[1]) });
      continue;
    }
    const contains = trimmed.match(/^body\s+contains\s+(.+)$/i);
    if (contains) {
      out.push({ type: "body_contains", expected: contains[1].trim() });
      continue;
    }
    const header = trimmed.match(/^header\s+(\S+)\s+==\s+(.+)$/i);
    if (header) {
      out.push({ type: "header_equals", name: header[1], expected: header[2].trim() });
      continue;
    }
    const jsonpath = trimmed.match(/^jsonpath\s+(\S+)\s+==\s+(.+)$/i);
    if (jsonpath) {
      out.push({ type: "json_path_equals", path: jsonpath[1], expected: jsonpath[2].trim() });
    }
  }
  return out;
}

function formatAssertions(list: Assertion[]): string {
  return list
    .map((a) => {
      switch (a.type) {
        case "status_equals":
          return `status == ${a.expected}`;
        case "duration_lt":
          return `duration < ${a.max_ms}`;
        case "body_contains":
          return `body contains ${a.expected}`;
        case "header_equals":
          return `header ${a.name} == ${a.expected}`;
        case "json_path_equals":
          return `jsonpath ${a.path} == ${a.expected}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

function buildAuth(
  kind: AuthKind,
  secretRef: string,
  username: string,
  headerName: string,
  tokenUrl: string,
  scope: string,
  audience: string,
  authorizationUrl: string,
  redirectUri: string,
  codeRef: string,
  verifierRef: string,
): AuthRef | null {
  if (kind === "none") {
    return null;
  }
  return {
    kind,
    secret_ref: secretRef.trim() || null,
    username: kind === "basic" || kind.startsWith("oauth2_") ? username.trim() || null : null,
    header_name: kind === "api_key" ? headerName.trim() || "X-Api-Key" : null,
    token_url: kind.startsWith("oauth2_") ? tokenUrl.trim() || null : null,
    scope: kind.startsWith("oauth2_") ? scope.trim() || null : null,
    audience: kind.startsWith("oauth2_") ? audience.trim() || null : null,
    authorization_url: kind === "oauth2_authorization_code" ? authorizationUrl.trim() || null : null,
    redirect_uri: kind === "oauth2_authorization_code" ? redirectUri.trim() || null : null,
    authorization_code_ref: kind === "oauth2_authorization_code" ? codeRef : null,
    code_verifier_ref: kind === "oauth2_authorization_code" ? verifierRef : null,
  };
}

export function HttpWorkbench({
  onSend,
  onTitleChange,
  onCancel,
  onSave,
  onPutSecret,
  onListHistory,
  onReplayHistory,
  externalRequest,
  environments = DEFAULT_ENVIRONMENTS,
  defaultEnvironmentId = "default-env",
  toolbarTargetId,
  workbenchSessionId,
}: HttpWorkbenchProps) {
  const [name, setName] = useState("");
  const [requestId, setRequestId] = useState<string | undefined>();
  const [method, setMethod] = useState<string>("GET");
  const [url, setUrl] = useState("");
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => [createHeaderRow()]);
  const [queryRows, setQueryRows] = useState<HeaderRow[]>(() => [createQueryRow()]);
  const [body, setBody] = useState("");
  const [bodyMode, setBodyMode] = useState<BodyMode>("none");
  const [multipart, setMultipart] = useState<MultipartEditorPart[]>(() => [createMultipartEditorPart()]);
  const [formRows, setFormRows] = useState<HeaderRow[]>(() => [createQueryRow()]);
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [followRedirects, setFollowRedirects] = useState(true);
  const [retryMax, setRetryMax] = useState(0);
  const [retryBackoffMs, setRetryBackoffMs] = useState(250);
  const [proxy, setProxy] = useState("");
  const [tlsVerify, setTlsVerify] = useState(true);
  const [tlsClientCertRef, setTlsClientCertRef] = useState("");
  const [environmentRef,setEnvironmentRef]=useState<string>(defaultEnvironmentId);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  void toolbarTarget;
  useEffect(() => { setToolbarTarget(toolbarTargetId ? document.getElementById(toolbarTargetId) : null); }, [toolbarTargetId]);
  const [environmentOptions,setEnvironmentOptions]=useState(environments);
  useEffect(()=>{listEnvironmentResources().then((items)=>setEnvironmentOptions(items.map(({id,name})=>({id,name})))).catch(()=>setEnvironmentOptions(environments))},[environments]);
  const [preScriptAssetIds,setPreScriptAssetIds]=useState<string[]>([]);
  const [postScriptAssetIds,setPostScriptAssetIds]=useState<string[]>([]);
  const [variablesText, setVariablesText] = useState("");
  const [assertionsText, setAssertionsText] = useState("");
  const [assertionsEnabled, setAssertionsEnabled] = useState(true);
  const [assertionConfigOpen, setAssertionConfigOpen] = useState(false);
  const [assertionsDraft, setAssertionsDraft] = useState("");
  const [authKind, setAuthKind] = useState<AuthKind>("none");
  const [authSecretRef, setAuthSecretRef] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("X-Api-Key");
  const [oauthTokenUrl, setOauthTokenUrl] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthAudience, setOauthAudience] = useState("");
  const [oauthAuthorizationUrl, setOauthAuthorizationUrl] = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("http://127.0.0.1:39218/oauth/callback");
  const [oauthAuthorizationCode, setOauthAuthorizationCode] = useState("");
  const [oauthCodeRef] = useState(() => `oauth-code-${crypto.randomUUID()}`);
  const [oauthVerifierRef] = useState(() => `oauth-verifier-${crypto.randomUUID()}`);
  const [cookieRows, setCookieRows] = useState<HeaderRow[]>(() => [createQueryRow()]);
  const [loading, setLoading] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [result, setResult] = useState<HttpRunResult | null>(null);
  const [livePreview, setLivePreview] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyStateFilter, setHistoryStateFilter] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [responseView, setResponseView] = useState<"pretty" | "raw" | "hex" | "table" | "preview">("pretty");
  const [responseCharset, setResponseCharset] = useState("auto");
  const [responseFormat, setResponseFormat] = useState<"auto" | "json" | "xml" | "html" | "text">("auto");
  const [responseWrap, setResponseWrap] = useState(false);
  const [responseSearch, setResponseSearch] = useState("");
  const [responseSearchOpen, setResponseSearchOpen] = useState(false);
  const [responseSearchCase, setResponseSearchCase] = useState(false);
  const [responseSearchWord, setResponseSearchWord] = useState(false);
  const [responseSearchRegex, setResponseSearchRegex] = useState(false);
  const [responseSearchIndex, setResponseSearchIndex] = useState(0);
  const [responseBytes, setResponseBytes] = useState<Uint8Array | null>(null);
  const [responseMediaUrl, setResponseMediaUrl] = useState("");
  const [responseTab, setResponseTab] = useState<"body" | "cookies" | "headers" | "console" | "request">("body");
  const [lastRequest, setLastRequest] = useState<HttpWorkbenchRequest | null>(null);
  const [requestWallMs, setRequestWallMs] = useState(0);
  const [requestTab, setRequestTab] = useState<"params" | "headers" | "body" | "auth" | "cookies" | "pre" | "post" | "proxy">("params");
  const [timeline, setTimeline] = useState<Array<{ at: number; event: ExecutionEvent }>>([]);
  const [graphqlQuery, setGraphqlQuery] = useState("query Example {\n  __typename\n}");
  const [graphqlVariables, setGraphqlVariables] = useState("{}");
  const [graphqlOperationName, setGraphqlOperationName] = useState("");
  const [graphqlSplitRatio, setGraphqlSplitRatio] = useState(() => Number(localStorage.getItem("apivoy-graphql-editor-ratio-v2")) || .5);
  const [graphqlSchemaState, setGraphqlSchemaState] = useState<{ status: "idle" | "loading" | "ready" | "error"; typeCount?: number; message?: string }>({ status: "idle" });
  const graphqlSplitRef = useRef<HTMLDivElement>(null);
  const [rpcMethod, setRpcMethod] = useState("users.list");
  const [rpcParams, setRpcParams] = useState("{}");
  const [rpcId, setRpcId] = useState("1");
  const [soapVersion, setSoapVersion] = useState<"1.1" | "1.2">("1.2");
  const [soapAction, setSoapAction] = useState("");
  const [soapEnvelope, setSoapEnvelope] = useState('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">\n  <soap:Body>\n  </soap:Body>\n</soap:Envelope>');
  const [binaryBase64, setBinaryBase64] = useState("");
  const [binaryFileName, setBinaryFileName] = useState("");
  const [binarySize, setBinarySize] = useState(0);
  const [messagePackJson, setMessagePackJson] = useState("{}" );

  function resizeGraphqlEditors(event: ReactPointerEvent<HTMLDivElement>) {
    const root = graphqlSplitRef.current;
    if (!root) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = root.getBoundingClientRect();
    const move = (moveEvent: globalThis.PointerEvent) => {
      const stacked = window.matchMedia("(max-width: 760px)").matches;
      const next = stacked ? (moveEvent.clientY - bounds.top) / bounds.height : (moveEvent.clientX - bounds.left) / bounds.width;
      setGraphqlSplitRatio(Math.min(.78, Math.max(.22, next)));
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  useEffect(() => { localStorage.setItem("apivoy-graphql-editor-ratio-v2", String(graphqlSplitRatio)); }, [graphqlSplitRatio]);

  useEffect(() => {
    onTitleChange?.(`${method} ${name.trim() || "新建 HTTP 接口"}`);
  }, [method, name, onTitleChange]);

  useEffect(() => {
    const confirmLegacyDelete = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".http-kv-delete:not([data-native-delete-confirm])");
      document.querySelectorAll(".http-kv-delete.is-confirming:not([data-native-delete-confirm])").forEach((item) => { if (item !== button) item.classList.remove("is-confirming"); });
      if (!button || button.classList.contains("is-confirming")) return;
      event.preventDefault(); event.stopPropagation();
      button.classList.add("is-confirming");
      button.title = "再次点击确认删除";
      button.setAttribute("aria-label", `确认${button.getAttribute("aria-label") ?? "删除"}`);
    };
    document.addEventListener("click", confirmLegacyDelete, true);
    return () => document.removeEventListener("click", confirmLegacyDelete, true);
  }, []);

  const decodedResponse = useMemo(() => {
    if (!responseBytes?.length) return result?.preview ?? livePreview;
    const charset = responseCharset === "auto" ? charsetFromContentType(result?.responseMeta?.contentType) : responseCharset;
    try { return new TextDecoder(charset).decode(responseBytes); } catch { return new TextDecoder("utf-8").decode(responseBytes); }
  }, [responseBytes, responseCharset, result?.preview, result?.responseMeta?.contentType, livePreview]);
  const responseHasBody = Boolean(responseBytes?.length || decodedResponse.length);
  const responseContentType = (result?.responseMeta?.contentType ?? "").toLowerCase();
  const responsePreviewKind = responseContentType.includes("text/html") || responseFormat === "html" ? "html" : responseContentType.startsWith("image/") ? "image" : responseContentType.startsWith("audio/") ? "audio" : null;
  useEffect(() => {
    if (!responseBytes?.length || (responsePreviewKind !== "image" && responsePreviewKind !== "audio")) { setResponseMediaUrl(""); return; }
    const url = URL.createObjectURL(new Blob([new Uint8Array(responseBytes).buffer], { type: result?.responseMeta?.contentType ?? "application/octet-stream" }));
    setResponseMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [responseBytes, responsePreviewKind, result?.responseMeta?.contentType]);
  const responsePreview = useMemo(() => {
    const preview = decodedResponse;
    if (responseView === "pretty") return responseFormat === "text" || responseFormat === "html" ? preview : prettyPreview(preview);
    if (responseView === "hex") return hexPreview(preview);
    return preview;
  }, [decodedResponse, responseView, responseFormat]);
  const responseLanguage = useMemo(() => {
    if (responseView === "hex") return "plaintext";
    if (responseFormat !== "auto") return responseFormat === "text" ? "plaintext" : responseFormat;
    if (responseContentType.includes("json") || responseContentType.includes("+json")) return "json";
    if (responseContentType.includes("html")) return "html";
    if (responseContentType.includes("xml") || responseContentType.includes("+xml")) return "xml";
    if (responseContentType.includes("javascript")) return "javascript";
    if (responseContentType.includes("css")) return "css";
    const source = decodedResponse.trimStart();
    if (source.startsWith("{") || source.startsWith("[")) { try { JSON.parse(source); return "json"; } catch { /* use plain text */ } }
    if (/^<!doctype\s+html|^<html[\s>]/i.test(source)) return "html";
    if (/^<\?xml|^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(source)) return "xml";
    return "plaintext";
  }, [decodedResponse, responseContentType, responseFormat, responseView]);
  const responseTable = useMemo(() => jsonRows(decodedResponse), [decodedResponse]);
  const responseSearchMatches = useMemo(() => {
    if (!responseSearch) return [];
    try {
      const escaped = responseSearchRegex ? responseSearch : responseSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expression = new RegExp(responseSearchWord ? `\\b(?:${escaped})\\b` : escaped, responseSearchCase ? "g" : "gi");
      return Array.from(responsePreview.matchAll(expression), (match) => match.index ?? 0);
    } catch { return []; }
  }, [responsePreview, responseSearch, responseSearchCase, responseSearchWord, responseSearchRegex]);
  const responseSearchCount = responseSearchMatches.length;
  const responseSearchLine = useMemo(() => {
    const offset = responseSearchMatches[responseSearchIndex];
    return offset === undefined ? undefined : responsePreview.slice(0, offset).split("\n").length;
  }, [responsePreview, responseSearchMatches, responseSearchIndex]);
  useEffect(() => { setResponseSearchIndex(0); }, [responseSearch, responseSearchCase, responseSearchWord, responseSearchRegex]);
  const responseCookies = useMemo(() => (result?.responseMeta?.headers ?? [])
    .filter(([name]) => name.toLowerCase() === "set-cookie")
    .map(([, value]) => value), [result?.responseMeta?.headers]);
  const scriptConsoleEvents = useMemo(() => timeline.filter(({ event }) =>
    event.type === "log"
    || event.type === "variables_extracted"
    || (event.type === "failed" && event.code === "script_error")
  ), [timeline]);

  function validateParameterNames(): boolean {
    const groups = [
      { tab: "params" as const, label: "Query 参数", rows: queryRows.map((row) => ({ enabled: row.enabled, hasContent: keyValueRowHasContent(row), name: row.key, value: row.value, required: row.required })) },
      { tab: "headers" as const, label: "Header", rows: headerRows.map((row) => ({ enabled: row.enabled, hasContent: keyValueRowHasContent(row), name: row.key, value: row.value, required: row.required })) },
      { tab: "cookies" as const, label: "Cookie", rows: cookieRows.map((row) => ({ enabled: row.enabled, hasContent: keyValueRowHasContent(row), name: row.key, value: row.value, required: row.required })) },
      ...(bodyMode === "urlencoded" ? [{ tab: "body" as const, label: "表单字段", rows: formRows.map((row) => ({ enabled: row.enabled, hasContent: keyValueRowHasContent(row), name: row.key, value: row.value, required: row.required })) }] : []),
      ...(bodyMode === "multipart" ? [{ tab: "body" as const, label: "form-data 字段", rows: multipart.map((part) => ({ enabled: part.enabled, hasContent: multipartPartHasContent(part), name: part.name, value: part.kind === "file" ? part.fileName ?? "" : part.value, required: part.required })) }] : []),
    ];
    for (const group of groups) {
      const invalidIndex = group.rows.findIndex((row) => row.enabled && row.hasContent && !row.name.trim());
      if (invalidIndex < 0) continue;
      setRequestTab(group.tab);
      setStatusMsg(`${group.label}第 ${invalidIndex + 1} 行的参数名不能为空`);
      return false;
    }
    for (const group of groups) {
      const invalidIndex = group.rows.findIndex((row) => row.enabled && row.required && !row.value.trim());
      if (invalidIndex < 0) continue;
      setRequestTab(group.tab);
      setStatusMsg(`${group.label}第 ${invalidIndex + 1} 行是必填参数，参数值不能为空`);
      return false;
    }
    return true;
  }

  function buildRequest(): HttpWorkbenchRequest {
    const headers = headerRows
      .filter((row) => row.enabled && row.key.trim())
      .map((row) => [row.key.trim(), row.value.trim()] as [string, string]);
    const requestCookies = cookieRows.filter((row) => row.enabled && row.key.trim());
    if (requestCookies.length) {
      headers.push(["Cookie", requestCookies.map((row) => `${row.key.trim()}=${row.value}`).join("; ")]);
    }
    if (bodyMode === "soap" && soapAction.trim()) {
      if (soapVersion === "1.1") headers.push(["SOAPAction", `"${soapAction.trim()}"`]);
      else {
        const contentType = headers.find((header) => header[0].toLowerCase() === "content-type");
        if (contentType) contentType[1] = `application/soap+xml; action="${soapAction.trim()}"`;
      }
    }

    const encodedBody = bodyMode === "binary" ? binaryBase64 : bodyMode === "msgpack" ? bytesToBase64(encodeMessagePack(JSON.parse(messagePackJson || "null"))) : undefined;
    return {
      id: requestId,
      name: name.trim() || requestNameFromUrl(url),
      url: url.trim(),
      method,
      headers,
      body: method === "GET" || method === "HEAD" || bodyMode === "none" || bodyMode === "multipart"
        ? undefined
        : bodyMode === "urlencoded"
          ? new URLSearchParams(formRows.filter((row) => row.enabled && row.key.trim()).map((row) => [row.key, row.value])).toString()
          : bodyMode === "graphql"
            ? JSON.stringify({ query: graphqlQuery, variables: JSON.parse(graphqlVariables || "{}"), ...(graphqlOperationName.trim() ? { operationName: graphqlOperationName.trim() } : {}) })
            : bodyMode === "jsonrpc"
              ? JSON.stringify({ jsonrpc: "2.0", method: rpcMethod, params: JSON.parse(rpcParams || "{}"), id: rpcId === "null" ? null : Number.isNaN(Number(rpcId)) ? rpcId : Number(rpcId) })
              : bodyMode === "soap" ? soapEnvelope
              : bodyMode === "binary" || bodyMode === "msgpack" ? encodedBody
            : body,
      bodyEncoding: bodyMode === "binary" || bodyMode === "msgpack" ? "base64" : "text",
      bodySource: bodyMode === "msgpack" ? messagePackJson : bodyMode === "graphql" ? JSON.stringify({ type: "graphql", query: graphqlQuery, variables: JSON.parse(graphqlVariables || "{}"), operationName: graphqlOperationName.trim() || null }) : bodyMode === "jsonrpc" ? JSON.stringify({ type: "jsonrpc", method: rpcMethod, params: JSON.parse(rpcParams || "{}"), id: rpcId }) : undefined,
      multipart: bodyMode === "multipart" ? multipart.filter((part) => part.enabled && part.name.trim()).map(({ id: _id, enabled: _enabled, description: _description, kind: _kind, valueType: _valueType, typeSelected: _typeSelected, required: _required, ...part }) => part) : [],
      timeoutMs,
      variables: parseKv(variablesText),
      assertions: assertionsEnabled ? parseAssertions(assertionsText) : [],
      auth: buildAuth(authKind, authSecretRef, authUsername, authHeaderName, oauthTokenUrl, oauthScope, oauthAudience, oauthAuthorizationUrl, oauthRedirectUri, oauthCodeRef, oauthVerifierRef),
      followRedirects,
      retryMax,
      retryBackoffMs,
      proxy: proxy.trim() || null,
      tlsVerify,
      tlsClientCertRef: tlsClientCertRef.trim() || null,
      environmentRef,
      preScripts: resolveAssets(preScriptAssetIds),
      postScripts: resolveAssets(postScriptAssetIds),
    };
  }

  function handleImportCurl() {
    try {
      const parsed = parseCurl(curlText);
      if (parsed.method) setMethod(parsed.method);
      if (parsed.url) setUrl(parsed.url);
      if (parsed.headers) {
        setHeaderRows(headerRowsFromPairs(parsed.headers.filter(([key]) => key.toLowerCase() !== "cookie")));
        setCookieRows(cookieRowsFromHeaders(parsed.headers));
      }
      if (parsed.body !== undefined) setBody(parsed.body);
      setShowCurlImport(false);
      setStatusMsg("已从 cURL 导入请求");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyText(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatusMsg(success);
    } catch {
      setStatusMsg("复制失败，请检查剪贴板权限");
    }
  }

  function downloadResponse() {
    if (!responsePreview && !responseBytes?.length) return;
    const type = result?.responseMeta?.contentType ?? "text/plain;charset=utf-8";
    const extension = type.includes("json") ? "json" : type.includes("xml") ? "xml" : type.includes("html") ? "html" : type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : type.includes("gif") ? "gif" : type.includes("svg") ? "svg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : type.includes("ogg") ? "ogg" : "txt";
    const body = responseBytes?.length ? new Uint8Array(responseBytes).buffer : responsePreview;
    const href = URL.createObjectURL(new Blob([body], { type }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `apivoy-response-${result?.executionId?.slice(0, 8) ?? "latest"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(href);
    setStatusMsg("响应正文已下载");
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !loading && url.trim()) {
        event.preventDefault();
        void handleSend();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function applyRequest(loaded: HttpWorkbenchRequest) {
    setRequestId(loaded.id);
    setName(loaded.name ?? "");
    setMethod(loaded.method);
    setUrl(loaded.url);
    setQueryRows(queryRowsFromUrl(loaded.url));
    setHeaderRows(headerRowsFromPairs(loaded.headers.filter(([key]) => key.toLowerCase() !== "cookie")));
    setCookieRows(cookieRowsFromHeaders(loaded.headers));
    const contentType = loaded.headers.find(([key]) => key.toLowerCase() === "content-type")?.[1].toLowerCase() ?? "";
    const structuredSource = (() => { try { return JSON.parse(loaded.bodySource || loaded.body || "null") as { type?: string; query?: unknown; variables?: unknown; operationName?: unknown; jsonrpc?: unknown; method?: unknown; params?: unknown; id?: unknown }; } catch { return null; } })();
    const graphqlSource = structuredSource && (structuredSource.type === "graphql" || (typeof structuredSource.query === "string" && structuredSource.variables !== undefined)) ? structuredSource : null;
    const jsonRpcSource = structuredSource && (structuredSource.type === "jsonrpc" || (structuredSource.jsonrpc === "2.0" && typeof structuredSource.method === "string")) ? structuredSource : null;
    const nextBodyMode: BodyMode = loaded.multipart?.length ? "multipart"
      : contentType.includes("x-www-form-urlencoded") ? "urlencoded"
      : contentType.includes("graphql") || graphqlSource ? "graphql"
      : jsonRpcSource ? "jsonrpc"
      : loaded.bodyEncoding === "base64" && contentType.includes("msgpack") ? "msgpack"
      : loaded.bodyEncoding === "base64" ? "binary"
      : contentType.includes("json") ? "json"
      : contentType.includes("xml") ? "xml"
      : loaded.body ? "text" : "none";
    setBody(loaded.body ?? "");
    if (nextBodyMode === "binary") { setBinaryBase64(loaded.body ?? ""); setBinaryFileName("saved-binary"); setBinarySize(Math.floor((loaded.body?.length ?? 0) * .75)); }
    if (nextBodyMode === "msgpack") setMessagePackJson(loaded.bodySource ?? "{}");
    if (nextBodyMode === "graphql") { setGraphqlQuery(typeof graphqlSource?.query === "string" ? graphqlSource.query : loaded.body ?? ""); setGraphqlVariables(JSON.stringify(graphqlSource?.variables ?? {}, null, 2)); setGraphqlOperationName(typeof graphqlSource?.operationName === "string" ? graphqlSource.operationName : ""); }
    if (nextBodyMode === "jsonrpc") { setRpcMethod(typeof jsonRpcSource?.method === "string" ? jsonRpcSource.method : ""); setRpcParams(JSON.stringify(jsonRpcSource?.params ?? {}, null, 2)); setRpcId(jsonRpcSource?.id === null ? "null" : String(jsonRpcSource?.id ?? "1")); }
    setMultipart([...(loaded.multipart ?? []).map((part) => createMultipartEditorPart(part)), createMultipartEditorPart()]);
    setBodyMode(nextBodyMode);
    setFormRows(nextBodyMode === "urlencoded"
      ? [...Array.from(new URLSearchParams(loaded.body ?? "").entries()).map(([key, value]) => createQueryRow(key, value)), createQueryRow()]
      : [createQueryRow()]);
    setTimeoutMs(loaded.timeoutMs);
    setFollowRedirects(loaded.followRedirects ?? true);
    setRetryMax(loaded.retryMax ?? 0);
    setRetryBackoffMs(loaded.retryBackoffMs ?? 250);
    setProxy(loaded.proxy ?? "");
    setTlsVerify(loaded.tlsVerify ?? true);
    setTlsClientCertRef(loaded.tlsClientCertRef ?? "");
    setEnvironmentRef(loaded.environmentRef ?? defaultEnvironmentId);
    setPreScriptAssetIds(assetIdsFromScripts(loaded.preScripts));
    setPostScriptAssetIds(assetIdsFromScripts(loaded.postScripts));
    setVariablesText(formatKv(loaded.variables));
    setAssertionsText(formatAssertions(loaded.assertions));
    setAssertionsEnabled(loaded.assertions.length > 0);
    const auth = loaded.auth;
    if (!auth || auth.kind === "none") {
      setAuthKind("none");
    } else if (auth.kind === "bearer" || auth.kind === "basic" || auth.kind === "api_key" || auth.kind === "oauth2_client_credentials" || auth.kind === "oauth2_authorization_code") {
      setAuthKind(auth.kind);
      setAuthSecretRef(auth.secret_ref ?? "");
      setAuthUsername(auth.username ?? "");
      setAuthHeaderName(auth.header_name ?? "X-Api-Key");
      setOauthTokenUrl(auth.token_url ?? "");
      setOauthScope(auth.scope ?? "");
      setOauthAudience(auth.audience ?? "");
      setOauthAuthorizationUrl(auth.authorization_url ?? "");
      setOauthRedirectUri(auth.redirect_uri ?? "http://127.0.0.1:39218/oauth/callback");
    } else {
      setAuthKind("none");
    }
  }

  function selectBodyMode(nextMode: BodyMode) {
    const contentType = nextMode === "soap" && soapVersion === "1.1" ? "text/xml" : BODY_MODES.find((mode) => mode.id === nextMode)?.contentType;
    if (["graphql", "jsonrpc", "soap", "binary", "msgpack"].includes(nextMode)) setMethod("POST");
    setBodyMode(nextMode);
    setHeaderRows((rows) => {
      const withoutContentType = rows.filter((row) => row.key.toLowerCase() !== "content-type");
      const contentRows = contentType ? [createHeaderRow("Content-Type", contentType), ...withoutContentType] : withoutContentType;
      return contentRows.length && !contentRows[contentRows.length - 1].key && !contentRows[contentRows.length - 1].value
        ? contentRows
        : [...contentRows, createHeaderRow()];
    });
  }

  useEffect(() => {
    if (externalRequest) {
      applyRequest(externalRequest);
      setResult(null);
      setStatusMsg("已打开集合中的请求");
    } else {
      const draft = readWorkbenchDraft<HttpWorkbenchRequest>("http");
      if (draft) {
        applyRequest(draft);
        setStatusMsg("已恢复上次未完成的 HTTP 草稿");
      }
    }
  }, [externalRequest]);

  useWorkbenchHydration("http", (raw) => {
    const savedRequest = httpRequestFromEnvelope(raw);
    if (savedRequest) {
      applyRequest(savedRequest);
      setResult(null);
      setStatusMsg("已打开资源树中的请求");
      return;
    }
    const envelope = raw as { target?: string; payload?: { type?: string; query?: string; variables?: unknown; operationName?: string | null; headers?: Array<[string, string]> } };
    if (envelope?.payload?.type === "graphql") {
      setMethod("POST"); setUrl(envelope.target ?? "https://"); setBodyMode("graphql");
      setGraphqlQuery(envelope.payload.query ?? ""); setGraphqlVariables(JSON.stringify(envelope.payload.variables ?? {}, null, 2)); setGraphqlOperationName(envelope.payload.operationName ?? "");
      setHeaderRows(headerRowsFromPairs([["Content-Type", "application/json"], ...(envelope.payload.headers ?? []).filter(([name]) => name.toLowerCase() !== "content-type")]));
      setResult(null); setStatusMsg("已在 HTTP 工作台中载入 GraphQL 请求"); return;
    }
    const rpcEnvelope = raw as { protocolId?: string; target?: string; payload?: { type?: string; value?: { version?: "1.1" | "1.2"; action?: string; envelope?: string; method?: string; params?: unknown; id?: string | number | null; headers?: Array<[string, string]> } } };
    if (rpcEnvelope?.payload?.type === "raw" && (rpcEnvelope.protocolId === "soap" || rpcEnvelope.protocolId === "jsonrpc")) {
      const value = rpcEnvelope.payload.value ?? {}; setMethod("POST"); setUrl(rpcEnvelope.target ?? "https://"); setBodyMode(rpcEnvelope.protocolId);
      setHeaderRows(headerRowsFromPairs(value.headers ?? []));
      if (rpcEnvelope.protocolId === "soap") { setSoapVersion(value.version ?? "1.2"); setSoapAction(value.action ?? ""); setSoapEnvelope(value.envelope ?? ""); }
      else { setRpcMethod(value.method ?? ""); setRpcParams(JSON.stringify(value.params ?? {}, null, 2)); setRpcId(value.id == null ? "null" : String(value.id)); }
      setResult(null); setStatusMsg(`已在 HTTP 工作台中载入 ${rpcEnvelope.protocolId === "soap" ? "SOAP" : "JSON-RPC"} 请求`); return;
    }
    const detail = raw as { request?: HttpWorkbenchRequest; aiAssertions?: string };
    if (!detail?.request) return;
    applyRequest(detail.request);
    if (detail.aiAssertions) setAssertionsText(detail.aiAssertions);
    setResult(null);
    setStatusMsg("已载入请求，请检查后再发送");
  }, workbenchSessionId);

  useAutosaveDraft("http", buildRequest);
  useEffect(() => {
    const openCurlImport = () => setShowCurlImport(true);
    window.addEventListener("apivoy-open-curl-import", openCurlImport);
    return () => window.removeEventListener("apivoy-open-curl-import", openCurlImport);
  }, []);

  async function startPkceAuthorization() {
    if (!oauthAuthorizationUrl.trim() || !authUsername.trim() || !oauthRedirectUri.trim()) {
      setStatusMsg("请先填写 Authorization Endpoint、Client ID 和 Redirect URI");
      return;
    }
    if (!onPutSecret) { setStatusMsg("当前执行端未提供安全密钥存储"); return; }
    const random = crypto.getRandomValues(new Uint8Array(48));
    const verifier = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await onPutSecret(oauthVerifierRef, verifier);
    const authorization = new URL(oauthAuthorizationUrl);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("client_id", authUsername);
    authorization.searchParams.set("redirect_uri", oauthRedirectUri);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    if (oauthScope.trim()) authorization.searchParams.set("scope", oauthScope.trim());
    if (oauthAudience.trim()) authorization.searchParams.set("audience", oauthAudience.trim());
    window.open(authorization.toString(), "_blank", "noopener,noreferrer");
    setStatusMsg("授权页面已打开；完成授权后粘贴回调中的 code");
  }

  async function fetchGraphqlSchema() {
    if (!url.trim()) { setGraphqlSchemaState({ status: "error", message: "请先填写 GraphQL 地址" }); return; }
    setGraphqlSchemaState({ status: "loading" });
    try {
      const request = buildRequest();
      const introspectionQuery = "query ApiVoySchemaIntrospection { __schema { queryType { name } mutationType { name } subscriptionType { name } types { name kind } } }";
      const schemaHeaders = request.headers.some(([key]) => key.toLowerCase() === "content-type") ? request.headers : [["Content-Type", "application/json"], ...request.headers] as Array<[string, string]>;
      const schemaRequest: HttpWorkbenchRequest = { ...request, name: "GraphQL Schema Introspection", method: "POST", headers: schemaHeaders, body: JSON.stringify({ query: introspectionQuery, operationName: "ApiVoySchemaIntrospection", variables: {} }) };
      const response = await onSend(schemaRequest);
      if (response.error) throw new Error(response.error);
      const parsed = JSON.parse(response.preview ?? "{}") as { data?: { __schema?: { types?: unknown[] } }; errors?: Array<{ message?: string }> };
      if (parsed.errors?.length) throw new Error(parsed.errors.map((item) => item.message).filter(Boolean).join("；") || "Schema introspection 失败");
      const typeCount = parsed.data?.__schema?.types?.length;
      if (typeof typeCount !== "number") throw new Error("响应中没有 GraphQL Schema");
      setGraphqlSchemaState({ status: "ready", typeCount });
    } catch (error) {
      setGraphqlSchemaState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function formatGraphqlQuery() {
    let depth = 0; let quoted = false; let escaped = false;
    setGraphqlQuery(graphqlQuery.split("\n").map((raw) => {
      const line = raw.trim();
      if (!line) return "";
      if (line.startsWith("}")) depth = Math.max(0, depth - 1);
      const output = `${"  ".repeat(depth)}${line}`;
      for (const character of line) { if (escaped) { escaped = false; continue; } if (character === "\\" && quoted) { escaped = true; continue; } if (character === '"') quoted = !quoted; else if (!quoted && character === "{") depth += 1; else if (!quoted && character === "}" && !line.startsWith("}")) depth = Math.max(0, depth - 1); }
      return output;
    }).join("\n").trim());
  }
  function formatGraphqlVariables() {
    try { setGraphqlVariables(JSON.stringify(JSON.parse(graphqlVariables || "{}"), null, 2)); setStatusMsg(null); }
    catch { setStatusMsg("Variables 必须是合法 JSON，无法格式化"); }
  }

  async function handleSend() {
    if (!validateParameterNames()) return;
    const wallStartedAt = performance.now();
    setLoading(true);
    setResult(null);
    setLivePreview("");
    setResponseBytes(null);
    setResponseSearch("");
    setTimeline([]);
    setResponseTab("body");
    setExecutionId(null);
    setStatusMsg(null);
    try {
      if (authKind === "oauth2_authorization_code" && oauthAuthorizationCode.trim()) {
        if (!onPutSecret) throw new Error("当前执行端未提供安全密钥存储，无法保存短期授权码");
        await onPutSecret(oauthCodeRef, oauthAuthorizationCode.trim());
      }
      const request = buildRequest();
      setLastRequest(request);
      const next = await onSend(request, {
        onStarted: (id) => setExecutionId(id),
        onChunk: (preview) => setLivePreview((current) => current + preview),
        onEvent: (event) => {
          setTimeline((current) => [...current, { at: performance.now(), event }]);
          if (event.type === "response_chunk" && event.dataBase64) {
            const chunk = base64Bytes(event.dataBase64);
            setResponseBytes((current) => {
              if (!current?.length) return chunk;
              const combined = new Uint8Array(current.length + chunk.length);
              combined.set(current); combined.set(chunk, current.length); return combined;
            });
          }
        },
      });
      setResult(next);
      setRequestWallMs(Math.round(performance.now() - wallStartedAt));
      if (onListHistory) {
        setHistory(await onListHistory(currentHistoryFilter()));
      }
    } catch (err) {
      setRequestWallMs(Math.round(performance.now() - wallStartedAt));
      setResult({
        summary: failedSummary(),
        eventCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
      setExecutionId(null);
    }
  }

  async function handleCancel() {
    if (!onCancel || !executionId) {
      return;
    }
    try {
      await onCancel(executionId);
      setStatusMsg("已请求取消");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave() {
    if (!onSave) {
      return;
    }
    if (!validateParameterNames()) return;
    try {
      const request = buildRequest();
      await onSave(request);
      if (!name.trim()) setName(request.name ?? "");
      setStatusMsg("请求已保存到本地库");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function currentHistoryFilter(): HistoryFilter | undefined {
    const status = historyStatusFilter.trim()
      ? Number(historyStatusFilter.trim())
      : undefined;
    const filter: HistoryFilter = {};
    if (historyStateFilter.trim()) {
      filter.state = historyStateFilter.trim();
    }
    if (status != null && !Number.isNaN(status)) {
      filter.status = status;
    }
    return filter.state || filter.status != null ? filter : undefined;
  }

  async function handleRefreshHistory() {
    if (!onListHistory) {
      return;
    }
    try {
      setHistory(await onListHistory(currentHistoryFilter()));
      setStatusMsg("历史已刷新");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    const focusHistory = () => {
      setHistoryOpen(true);
      void handleRefreshHistory();
    };
    window.addEventListener("apivoy-focus-history", focusHistory);
    return () => window.removeEventListener("apivoy-focus-history", focusHistory);
  }, [onListHistory, historyStateFilter, historyStatusFilter]);

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 2) {
        return [prev[1], id];
      }
      return [...prev, id];
    });
  }

  async function handleReplay(id: string) {
    if (!onReplayHistory) {
      return;
    }
    try {
      const loaded = await onReplayHistory(id);
      if (!loaded) {
        setStatusMsg("该历史记录无可重放的请求快照");
        return;
      }
      if ("payload" in loaded) {
        window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: loaded }));
        if (loaded.payload.type === "http") applyRequest({ name: loaded.name, url: loaded.target, method: loaded.payload.method, headers: loaded.payload.headers, body: loaded.payload.body ?? undefined, multipart: loaded.payload.multipart ?? [], timeoutMs: loaded.timeoutMs, variables: loaded.variables ?? {}, assertions: loaded.assertions ?? [], auth: loaded.authRef ?? null, followRedirects: loaded.payload.followRedirects, retryMax: loaded.retryPolicy.max_retries, retryBackoffMs: loaded.retryPolicy.backoff_ms, proxy: loaded.proxy ?? null, tlsVerify: loaded.tls.verify, tlsClientCertRef: loaded.tls.client_cert_ref ?? null, preScripts: loaded.preScripts ?? [], postScripts: loaded.postScripts ?? [] });
      } else applyRequest(loaded);
      setHistoryOpen(false);
      setStatusMsg("已从历史恢复请求，可再次发送");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function updateMultipart(index: number, patch: Partial<MultipartEditorPart>) {
    setMultipart((parts) => {
      const next = parts.map((part, partIndex) => {
        if (partIndex !== index) return part;
        const wasEmpty = !multipartPartHasContent(part);
        const edited = { ...part, ...patch };
        const hasContent = multipartPartHasContent(edited);
        return { ...edited, enabled: patch.enabled ?? (hasContent ? part.enabled || wasEmpty : false) };
      });
      return index === parts.length - 1 && (multipartPartHasContent(next[index]) || next[index].enabled) ? [...next, createMultipartEditorPart()] : next;
    });
  }

  async function attachMultipartFile(index: number, file: File | null) {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    updateMultipart(index, {
      value: btoa(binary),
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      base64: true,
    });
  }

  const responseHeaderBytes = responseHeaderSize(result?.responseMeta);
  const responseBodyBytes = result?.summary.bytesReceived ?? 0;
  const responseTotalBytes = responseHeaderBytes + responseBodyBytes;
  const requestHeaderBytes = requestHeaderSize(lastRequest);
  const requestBodyBytes = requestBodySize(lastRequest);
  const responseMetrics = result && !result.error ? <>
    <strong className="http-status-code">{result.summary.status ?? "—"}</strong>
    <span className="http-metric-popover" tabIndex={0}>{result.summary.durationMs} ms<span className="http-metric-card http-timing-card" role="tooltip"><b>事件 <i>时间</i></b><span className="http-timing-progress-row"><em>前置操作执行</em><span className="http-timing-progress" aria-label="前置操作占总耗时 0%"><i style={{ width: "0%" }}/></span><i>0 ms</i></span><span className="http-timing-progress-row"><em>接口请求</em><span className="http-timing-progress" aria-label={`接口请求占总耗时 ${Math.round(result.summary.durationMs / Math.max(1, requestWallMs || result.summary.durationMs) * 100)}%`}><i style={{ width: `${Math.min(100, result.summary.durationMs / Math.max(1, requestWallMs || result.summary.durationMs) * 100)}%` }}/></span><i>{result.summary.durationMs} ms</i></span><span className="http-timing-progress-row"><em>后置操作执行</em><span className="http-timing-progress" aria-label="后置操作占总耗时 0%"><i style={{ width: "0%" }}/></span><i>0 ms</i></span><span className="http-timing-progress-row http-timing-total"><em>总耗时</em><span className="http-timing-progress" aria-label="总耗时 100%"><i style={{ width: "100%" }}/></span><i>{requestWallMs || result.summary.durationMs} ms</i></span></span></span>
    <span className="http-metric-popover" tabIndex={0}>{formatBytes(responseTotalBytes)}<span className="http-metric-card http-size-card" role="tooltip"><b>↓ 响应大小 <i>{formatBytes(responseTotalBytes)}</i></b><span>Header <i>{formatBytes(responseHeaderBytes)}</i></span><span>Body <i>{formatBytes(responseBodyBytes)}</i></span><hr/><b>↑ 请求大小 <i>{formatBytes(requestSize(lastRequest))}</i></b><span>Header <i>{formatBytes(requestHeaderBytes)}</i></span><span>Body <i>{formatBytes(requestBodyBytes)}</i></span></span></span>
  </> : null;
  const responseHeaderActions = <div className="http-response-header-actions">
    {!loading && !result ? <label className="http-response-validation-control" title="启用或停用响应校验"><span>校验响应</span><span className="http-switch"><input type="checkbox" checked={assertionsEnabled} onChange={(event) => setAssertionsEnabled(event.target.checked)}/><span/></span></label> : null}
    {!loading && !result ? <div className="http-assertion-config">
      <button type="button" className="http-assertion-summary" aria-expanded={assertionConfigOpen} onClick={() => { setAssertionsDraft(assertionsText); setAssertionConfigOpen((open) => !open); }}>
        <span>配置</span><span className="http-assertion-chevron"><Icon name="chevron"/></span>
      </button>
      {assertionConfigOpen ? <div className="http-assertion-editor" role="dialog" aria-label="响应校验配置">
        <strong>响应校验配置</strong>
        <span>每行一条：status == 200 / body contains … / jsonpath $.a == 1</span>
        <textarea style={styles.textarea} value={assertionsDraft} onChange={(event) => setAssertionsDraft(event.target.value)} rows={5} spellCheck={false}/>
        <div className="http-assertion-editor-actions"><button type="button" style={styles.secondaryButton} onClick={() => setAssertionConfigOpen(false)}>取消</button><button type="button" style={styles.primaryButton} onClick={() => { setAssertionsText(assertionsDraft); setAssertionConfigOpen(false); setStatusMsg("响应校验配置已保存"); }}>保存</button></div>
      </div> : null}
    </div> : null}
    {result && !result.error ? <div className="http-response-metrics">{responseMetrics}</div> : loading ? <span className="http-response-pending">请求中…</span> : null}
  </div>;
  const environmentControl = <div className="http-environment-select"><select aria-label="请求环境" value={environmentRef} onChange={(event)=>setEnvironmentRef(event.target.value)} disabled={loading}>{environmentOptions.map((environment)=><option key={environment.id} value={environment.id}>{environment.name}{environment.id===defaultEnvironmentId?" · 默认":""}</option>)}</select><button type="button" className="http-environment-manage" aria-label="编辑环境变量" title="编辑环境变量" onClick={() => window.dispatchEvent(new CustomEvent("apivoy-open-environment"))}><Icon name="menu"/></button></div>;

  const requestCommandbar = <div className="http-request-commandbar">
    <label className="http-request-name-field"><input aria-label="接口名称" style={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="接口名称" disabled={loading} /></label>
    <div className="http-request-primary-actions">
      <select aria-label="HTTP 方法" style={styles.select} value={method} onChange={(e) => setMethod(e.target.value)} disabled={loading}>
        {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <label className="http-target-field"><input id="http-target-url" aria-label="目标 URL" style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} onBlur={(e) => setQueryRows(queryRowsFromUrl(e.target.value))} placeholder="接口路径" spellCheck={false} disabled={loading} /></label>
      <button className={`http-send-button${loading ? " is-cancel" : ""}`} style={styles.button} disabled={loading ? !onCancel || !executionId : !url.trim()} aria-label={loading ? "取消请求" : "发送请求"} onClick={() => loading ? void handleCancel() : void handleSend()}>
        <Icon name={loading ? "close" : "send"}/>{loading ? "取消" : "发送"}
      </button>
      {onSave && <button className="http-save-button" style={styles.secondaryButton} disabled={loading || !url.trim()} onClick={handleSave}><Icon name="archive"/>保存</button>}
    </div>
  </div>;

  return (
    <>{toolbarTarget ? createPortal(environmentControl, toolbarTarget) : null}<WorkbenchFrame title="HTTP" hideHeader busy={loading} status={statusMsg ? <span role="status">{statusMsg}</span> : <span>就绪</span>}>
      <div className="http-workbench-layout">
      {requestCommandbar}
      <div className="http-workbench-split">
      <SplitPane id="http-workbench" direction="vertical" minPrimary={160} minSecondary={160} primaryLabel="请求配置" secondaryLabel="响应检查器" secondaryActions={responseHeaderActions} primary={<div className="apivoy-workbench http-request-pane" style={styles.section}>
      {showCurlImport && (
        <div style={styles.importPanel}>
          <div style={styles.panelTitle}><strong>从 cURL 导入</strong><span>支持 method、header 和 request body</span></div>
          <textarea aria-label="导入 cURL 命令" style={{ ...styles.textarea, minHeight: 110 }} value={curlText} onChange={(e) => setCurlText(e.target.value)} placeholder="curl -X POST 'https://api.example.com' -H 'Content-Type: application/json' --data-raw '{...}'" spellCheck={false} />
          <div style={styles.row}><button style={styles.button} onClick={handleImportCurl}>导入请求</button><button style={styles.secondaryButton} onClick={() => setShowCurlImport(false)}>取消</button></div>
        </div>
      )}
      {(() => {
        const requestTabs = [
          { id: "params" as const, label: "Params", hint: queryRows.filter((row) => row.key.trim()).length || undefined },
          { id: "body" as const, label: "Body" },
          { id: "headers" as const, label: "Headers", hint: headerRows.filter((row) => row.key.trim()).length || undefined },
          { id: "cookies" as const, label: "Cookies", hint: cookieRows.filter((row) => row.key.trim()).length || undefined },
          { id: "auth" as const, label: "Auth", hint: authKind !== "none" ? "·" : undefined },
          { id: "pre" as const, label: "前置操作", hint: preScriptAssetIds.length || undefined },
          { id: "post" as const, label: "后置操作", hint: postScriptAssetIds.length || undefined },
          { id: "proxy" as const, label: "设置", hint: proxy.trim() ? "·" : undefined },
        ];
        const activeTab = requestTabs.some((tab) => tab.id === requestTab) ? requestTab : "params";
        return <div className="http-request-tabs">
          <div style={styles.requestTabs} role="tablist" aria-label="请求配置" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const current = requestTabs.findIndex((tab) => tab.id === activeTab);
            const next = event.key === "Home" ? 0 : event.key === "End" ? requestTabs.length - 1 : event.key === "ArrowRight" ? (current + 1) % requestTabs.length : (current - 1 + requestTabs.length) % requestTabs.length;
            const tabsRoot = event.currentTarget;
            setRequestTab(requestTabs[next].id);
            queueMicrotask(() => tabsRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus());
          }}>
            {requestTabs.map((tab) => <button key={tab.id} type="button" role="tab" tabIndex={activeTab === tab.id ? 0 : -1} aria-selected={activeTab === tab.id} id={`http-request-tab-${tab.id}`} aria-controls={`http-request-panel-${tab.id}`} style={activeTab === tab.id ? styles.tabActive : styles.tab} onClick={() => setRequestTab(tab.id)}>{tab.label}{tab.hint != null && tab.hint !== "" ? <span aria-label={`${tab.hint} 项`} style={styles.count}>{tab.hint}</span> : null}</button>)}
          </div>
          <div className="http-request-tab-panel" role="tabpanel" id={`http-request-panel-${activeTab}`} aria-labelledby={`http-request-tab-${activeTab}`}>
            {activeTab === "params" && <div className="http-kv-editor" aria-label="URL Query Params">
              <div className="http-section-heading">Query 参数</div>
              <KeyValueRows rows={queryRows} setRows={setQueryRows} kind="Param" nameLabel="参数名" valueLabel="参数值" addPlaceholder="添加参数" loading={loading} onRowsChange={(rows) => setUrl((current) => urlWithQueryRows(current, rows))}/>
            </div>}
            {activeTab === "headers" && <div className="http-kv-editor" aria-label="请求 Headers">
              <div className="http-section-heading">请求 Headers</div>
              <KeyValueRows rows={headerRows} setRows={setHeaderRows} kind="Header" nameLabel="Header 名称" valueLabel="Header 值" addPlaceholder="例如 Content-Type" loading={loading}/>
            </div>}
            {activeTab === "body" && <div style={styles.label}>
              <div className="http-body-mode-tabs" role="tablist" aria-label="请求体类型">
                {BODY_MODES.map((mode) => <button key={mode.id} type="button" role="tab" aria-selected={bodyMode === mode.id} className={bodyMode === mode.id ? "is-active" : ""} onClick={() => selectBodyMode(mode.id)} disabled={loading}>{mode.label}</button>)}
              </div>
              {bodyMode === "none" && <div className="http-body-empty">当前请求不发送 Body。选择上方类型开始编辑。</div>}
              {bodyMode !== "none" && bodyMode !== "multipart" && bodyMode !== "urlencoded" && !["graphql", "jsonrpc", "soap", "binary", "msgpack"].includes(bodyMode) && <>
                <div className="http-body-editor-label">请求内容</div>
                <CodeEditor value={body} onChange={setBody} language={bodyMode === "json" ? "json" : bodyMode === "xml" ? "xml" : "plaintext"} height={260} readOnly={loading} />
              </>}
              {bodyMode === "graphql" && <div className="http-graphql-editor">
                <div ref={graphqlSplitRef} className="http-graphql-split" style={{ "--graphql-split-ratio": `${graphqlSplitRatio * 100}%` } as CSSProperties}>
                  <section className="http-graphql-pane"><header><strong>Query</strong><input className="http-graphql-operation" aria-label="Operation Name" value={graphqlOperationName} onChange={(event) => setGraphqlOperationName(event.target.value)} disabled={loading} placeholder="Operation Name（可选）"/><button type="button" className={`http-graphql-schema is-${graphqlSchemaState.status}`} disabled={graphqlSchemaState.status === "loading"} title={graphqlSchemaState.message ?? "读取服务端 GraphQL Schema"} onClick={() => void fetchGraphqlSchema()}>{graphqlSchemaState.status === "loading" ? "获取中…" : graphqlSchemaState.status === "ready" ? `已获取 Schema · ${graphqlSchemaState.typeCount}` : graphqlSchemaState.status === "error" ? "Schema 获取失败" : "获取 Schema"}</button><span className="http-graphql-pane-actions"><button type="button" className="http-graphql-format" title="格式化 Query" aria-label="格式化 Query" onClick={formatGraphqlQuery}><Icon name="code"/></button><button type="button" className="http-graphql-clear" title="清空 Query" aria-label="清空 Query" disabled={!graphqlQuery} onClick={() => setGraphqlQuery("")}><Icon name="broom"/></button></span></header><CodeEditor value={graphqlQuery} onChange={setGraphqlQuery} language="graphql" height="100%" readOnly={loading} bare/></section>
                  <div className="http-graphql-resizer" role="separator" aria-label="调整 Query 和 Variables 区域大小" onPointerDown={resizeGraphqlEditors}/>
                  <section className="http-graphql-pane"><header><strong>Variables</strong><span className="http-graphql-pane-actions"><button type="button" className="http-graphql-format" title="格式化 Variables" aria-label="格式化 Variables" onClick={formatGraphqlVariables}><Icon name="code"/></button><button type="button" className="http-graphql-clear" title="清空 Variables" aria-label="清空 Variables" disabled={!graphqlVariables} onClick={() => setGraphqlVariables("")}><Icon name="broom"/></button></span></header><CodeEditor value={graphqlVariables} onChange={setGraphqlVariables} language="json" height="100%" readOnly={loading} bare/></section>
                </div>
              </div>}
              {bodyMode === "jsonrpc" && <div className="http-specialized-editor"><div className="http-specialized-row"><label>Method<input style={styles.input} value={rpcMethod} onChange={(event) => setRpcMethod(event.target.value)} disabled={loading}/></label><label>Request ID<input style={styles.input} value={rpcId} onChange={(event) => setRpcId(event.target.value)} disabled={loading}/></label></div><div className="http-body-editor-label">Params (JSON)</div><CodeEditor value={rpcParams} onChange={setRpcParams} language="json" height={220} readOnly={loading}/></div>}
              {bodyMode === "soap" && <div className="http-specialized-editor"><div className="http-specialized-row"><label>SOAP Version<select style={styles.input} value={soapVersion} onChange={(event) => { const version = event.target.value as "1.1" | "1.2"; setSoapVersion(version); setHeaderRows((rows) => headerRowsFromPairs([["Content-Type", version === "1.1" ? "text/xml" : "application/soap+xml"], ...rows.filter((row) => row.key && row.key.toLowerCase() !== "content-type").map((row) => [row.key, row.value] as [string, string])])); }} disabled={loading}><option>1.1</option><option>1.2</option></select></label><label>SOAP Action<input style={styles.input} value={soapAction} onChange={(event) => setSoapAction(event.target.value)} disabled={loading}/></label></div><div className="http-body-editor-label">XML Envelope</div><CodeEditor value={soapEnvelope} onChange={setSoapEnvelope} language="xml" height={260} readOnly={loading}/></div>}
              {bodyMode === "binary" && <div className="http-binary-editor"><label className="http-binary-picker"><Icon name="archive"/><strong>{binaryFileName || "选择二进制文件"}</strong><span>{binaryFileName ? `${binarySize.toLocaleString()} bytes` : "文件将以 Base64 保存，发送时还原为原始字节"}</span><input type="file" disabled={loading} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const value = String(reader.result ?? ""); setBinaryBase64(value.slice(value.indexOf(",") + 1)); setBinaryFileName(file.name); setBinarySize(file.size); setHeaderRows((rows) => headerRowsFromPairs([["Content-Type", file.type || "application/octet-stream"], ...rows.filter((row) => row.key && row.key.toLowerCase() !== "content-type").map((row) => [row.key, row.value] as [string, string])])); }; reader.readAsDataURL(file); }}/></label>{binaryFileName ? <button type="button" style={styles.secondaryButton} disabled={loading} onClick={() => { setBinaryBase64(""); setBinaryFileName(""); setBinarySize(0); }}>移除文件</button> : null}</div>}
              {bodyMode === "msgpack" && <div className="http-specialized-editor"><div className="http-body-editor-label">JSON 数据（发送时编码为 MessagePack）</div><CodeEditor value={messagePackJson} onChange={setMessagePackJson} language="json" height={280} readOnly={loading}/></div>}
              {bodyMode === "urlencoded" && <div className="http-kv-editor http-form-editor" aria-label="URL 编码表单">
                <KeyValueRows rows={formRows} setRows={setFormRows} kind="表单字段" nameLabel="字段名" valueLabel="字段值" addPlaceholder="添加字段" loading={loading}/>
              </div>}
              {bodyMode === "multipart" && (
                <div className="http-kv-editor http-multipart-editor" aria-label="form-data">
                  <div className="http-param-header" aria-hidden="true"><span/><span>字段名</span><span>字段值</span><span>类型</span><span/><span>说明</span><span/></div>
                  {multipart.map((part, index) => { const hasContent = multipartPartHasContent(part); const isEntry = index < multipart.length - 1 || hasContent; const missingName = !part.name.trim() && (part.enabled || hasContent || index < multipart.length - 1); const invalidName = part.enabled && missingName; const mutedInvalidName = !part.enabled && missingName; const missingValue = part.required && !(part.kind === "file" ? part.fileName : part.value.trim()); const invalidValue = part.enabled && missingValue; const mutedInvalidValue = !part.enabled && missingValue; return <div className={`http-param-row http-apifox-row${hasContent ? " has-content" : ""}${isEntry ? " is-entry" : ""}${part.enabled ? " is-enabled" : ""}${index === multipart.length - 1 ? " is-new" : ""}`} key={part.id}>
                    <input className="http-row-enabled" type="checkbox" aria-label={`${part.enabled ? "停用" : "启用"} form-data 字段 ${index + 1}`} checked={part.enabled} onChange={(event) => updateMultipart(index, { enabled: event.target.checked })} disabled={loading}/>
                    <div className={`http-param-name-cell${mutedInvalidName ? " has-muted-error" : ""}`}><input aria-label={`Multipart 字段 ${index + 1} 名称`} aria-invalid={invalidName} aria-describedby={missingName ? `${part.id}-name-error` : undefined} title={missingName ? (part.enabled ? "字段名不能为空" : "字段名为空（已停用，不影响发送）") : undefined} style={styles.input} value={part.name} onFocus={() => { if (!part.enabled && !hasContent) updateMultipart(index, { enabled: true }); }} onChange={(event) => updateMultipart(index, { name: event.target.value })} placeholder={missingName ? "" : index === multipart.length - 1 ? "添加字段" : ""} disabled={loading}/>{missingName && <span id={`${part.id}-name-error`}>字段名不能为空</span>}</div>
                    {part.kind === "file"
                      ? <label className={`http-multipart-file${invalidValue ? " is-invalid" : mutedInvalidValue ? " has-muted-error" : ""}`}><span>{part.fileName || (missingValue ? "请选择文件" : "选择文件")}</span><input type="file" onChange={(event) => void attachMultipartFile(index, event.target.files?.[0] ?? null)} disabled={loading}/></label>
                      : <div className={`http-param-value-cell${mutedInvalidValue ? " has-muted-error" : ""}`}><input aria-label={`Multipart 字段 ${index + 1} 文本值`} aria-invalid={invalidValue} aria-describedby={missingValue ? `${part.id}-value-error` : undefined} title={missingValue ? (part.enabled ? "字段值不能为空" : "字段值为空（已停用，不影响发送）") : undefined} style={styles.input} value={part.value} onFocus={() => { if (!part.enabled && !hasContent) updateMultipart(index, { enabled: true }); }} onChange={(event) => updateMultipart(index, { value: event.target.value, base64: false })} placeholder="" disabled={loading}/>{missingValue && <span id={`${part.id}-value-error`}>字段值不能为空</span>}</div>
                    }
                    <div className="http-param-type-cell"><select className="http-param-type" aria-label={`Multipart 字段 ${index + 1} 类型`} style={styles.input} value={part.kind === "file" ? "file" : part.valueType} onPointerDown={() => { if (!part.typeSelected) updateMultipart(index, { typeSelected: true }); }} onKeyDown={(event) => { if (!part.typeSelected && (event.key === "Enter" || event.key === " ")) updateMultipart(index, { typeSelected: true }); }} onChange={(event) => { const type = event.target.value as RowValueType | "file"; updateMultipart(index, type === "file" ? { kind: "file", typeSelected: true, value: "", fileName: null, contentType: null, base64: false } : { kind: "text", valueType: type, typeSelected: true, fileName: null, contentType: null, base64: false, value: part.kind === "file" ? "" : part.value }); }} disabled={loading}>{ROW_VALUE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}<option value="file">File</option></select></div>
                    <span className="http-required-row"><button type="button" className={part.required ? "is-required" : ""} aria-pressed={part.required} aria-label={`form-data 字段 ${index + 1} ${part.required ? "取消必填" : "设为必填"}`} title={part.required ? "取消必填" : "设为必填"} disabled={loading} onClick={() => updateMultipart(index, { required: !part.required })}>*</button></span>
                    <input aria-label={`Multipart 字段 ${index + 1} 说明`} style={styles.input} value={part.description} onChange={(event) => updateMultipart(index, { description: event.target.value })} placeholder="" disabled={loading}/>
                    {isEntry ? <button type="button" className="http-kv-delete" aria-label={`删除 form-data 字段 ${index + 1}`} onClick={() => setMultipart((parts) => { const next = parts.filter((_, partIndex) => partIndex !== index); const last = next[next.length - 1]; return last && !multipartPartHasContent(last) && !last.enabled ? next : [...next, createMultipartEditorPart()]; })} disabled={loading}><Icon name="trash"/></button> : <span className="http-kv-delete-placeholder" aria-hidden="true"/>}
                  </div>; })}
                </div>
              )}
            </div>}
            {activeTab === "auth" && <label style={styles.label}>
              认证
              <select style={styles.selectWide} value={authKind} onChange={(e) => setAuthKind(e.target.value as AuthKind)} disabled={loading}>
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic</option>
                <option value="api_key">API Key</option>
                <option value="oauth2_client_credentials">OAuth 2.0 Client Credentials</option>
                <option value="oauth2_authorization_code">OAuth 2.0 Authorization Code + PKCE</option>
              </select>
              {authKind !== "none" && (
                <div style={styles.authFields}>
                  {(authKind === "basic" || authKind.startsWith("oauth2_")) && (
                    <input aria-label={authKind.startsWith("oauth2_") ? "OAuth Client ID" : "认证用户名"} style={styles.input} value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} placeholder={authKind.startsWith("oauth2_") ? "Client ID（支持 {{var}}）" : "Username（支持 {{var}}）"} spellCheck={false} disabled={loading} />
                  )}
                  <input aria-label="认证 Secret Ref" style={styles.input} value={authSecretRef} onChange={(e) => setAuthSecretRef(e.target.value)} placeholder={authKind === "basic" ? "Password secret_ref 名称" : authKind === "oauth2_client_credentials" ? "Client Secret secret_ref 名称" : authKind === "api_key" ? "API Key secret_ref 名称" : "Token secret_ref 名称"} spellCheck={false} disabled={loading} />
                  {authKind === "api_key" && <input aria-label="API Key Header 名称" style={styles.input} value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="Header 名（默认 X-Api-Key）" spellCheck={false} disabled={loading} />}
                  {authKind.startsWith("oauth2_") && <>
                    <input style={styles.input} value={oauthTokenUrl} onChange={(event) => setOauthTokenUrl(event.target.value)} placeholder="Token Endpoint URL" spellCheck={false} disabled={loading} />
                    <input style={styles.input} value={oauthScope} onChange={(event) => setOauthScope(event.target.value)} placeholder="Scopes（空格分隔，可选）" spellCheck={false} disabled={loading} />
                    <input style={styles.input} value={oauthAudience} onChange={(event) => setOauthAudience(event.target.value)} placeholder="Audience（可选）" spellCheck={false} disabled={loading} />
                  </>}
                  {authKind === "oauth2_authorization_code" && <>
                    <input style={styles.input} value={oauthAuthorizationUrl} onChange={(event) => setOauthAuthorizationUrl(event.target.value)} placeholder="Authorization Endpoint URL" spellCheck={false} disabled={loading} />
                    <input style={styles.input} value={oauthRedirectUri} onChange={(event) => setOauthRedirectUri(event.target.value)} placeholder="Redirect URI" spellCheck={false} disabled={loading} />
                    <button type="button" style={styles.secondaryButton} disabled={loading} onClick={() => void startPkceAuthorization()}>打开浏览器授权（PKCE S256）</button>
                    <input style={styles.input} value={oauthAuthorizationCode} onChange={(event) => setOauthAuthorizationCode(event.target.value)} placeholder="粘贴回调参数 code（仅写入安全存储）" spellCheck={false} disabled={loading} />
                  </>}
                  <div style={styles.muted}>仅保存密钥引用名；明文写入「变量与密钥」页签中的密钥存储。</div>
                </div>
              )}
            </label>}
            {activeTab === "cookies" && <div className="http-request-editor-section">
              <div className="http-section-heading">请求 Cookies</div>
              <KeyValueRows rows={cookieRows} setRows={setCookieRows} kind="Cookie" nameLabel="Cookie 名称" valueLabel="Cookie 值" addPlaceholder="添加 Cookie" loading={loading}/>
            </div>}
            {activeTab === "pre" && <ScriptStepEditor phase="pre" assetIds={preScriptAssetIds} onAssetIdsChange={setPreScriptAssetIds} readOnly={loading}/>}
            {activeTab === "post" && <ScriptStepEditor phase="post" assetIds={postScriptAssetIds} onAssetIdsChange={setPostScriptAssetIds} readOnly={loading}/>}
            {activeTab === "proxy" && <div style={styles.grid3}>
              <label style={styles.label}>代理地址（可选）<input style={styles.input} value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="http://127.0.0.1:7890" spellCheck={false} disabled={loading} /></label>
              <label style={styles.label}>Timeout (ms)<input style={styles.timeout} type="number" min={1} value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value) || 30_000)} disabled={loading} /></label>
              <label style={styles.label}>最大重试次数<input style={styles.timeout} type="number" min={0} max={10} value={retryMax} onChange={(e) => setRetryMax(Math.max(0, Number(e.target.value) || 0))} disabled={loading} /></label>
              <label style={styles.label}>重试间隔 (ms)<input style={styles.timeout} type="number" min={0} value={retryBackoffMs} onChange={(e) => setRetryBackoffMs(Math.max(0, Number(e.target.value) || 0))} disabled={loading || retryMax === 0} /></label>
              <label style={styles.checkLabel}><input type="checkbox" checked={followRedirects} onChange={(e) => setFollowRedirects(e.target.checked)} disabled={loading} />跟随重定向</label>
              <label style={styles.checkLabel} title="关闭证书校验存在中间人攻击风险"><input type="checkbox" checked={tlsVerify} onChange={(e) => setTlsVerify(e.target.checked)} disabled={loading} />校验 TLS 证书</label>
              {!tlsVerify && <span style={styles.dangerHint}>仅在可信测试环境关闭证书校验</span>}
              <label style={styles.label}>客户端证书密钥引用<input style={styles.input} value={tlsClientCertRef} onChange={(event) => setTlsClientCertRef(event.target.value)} placeholder="Keychain 中的合并 PEM 名称" disabled={loading} /></label>
            </div>}
          </div>
        </div>;
      })()}

      {onListHistory && historyOpen && (
        <div className="execution-history-layer" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
        <aside className="execution-history-drawer" role="dialog" aria-modal="true" aria-label="执行历史" id="http-execution-history" onMouseDown={(event) => event.stopPropagation()}>
          <div style={styles.row}>
            <strong style={{ color: "var(--apivoy-text)" }}>执行历史</strong>
            <button type="button" className="ui-icon-button" aria-label="关闭执行历史" onClick={() => setHistoryOpen(false)}><Icon name="close"/></button>
            <button style={styles.secondaryButton} disabled={loading} onClick={handleRefreshHistory}>
              刷新
            </button>
          </div>
          <div style={styles.row}>
            <label style={styles.label}>
              状态
              <select
                style={styles.select}
                value={historyStateFilter}
                onChange={(e) => setHistoryStateFilter(e.target.value)}
              >
                <option value="">全部</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label style={styles.label}>
              HTTP 状态码
              <input
                style={styles.input}
                value={historyStatusFilter}
                onChange={(e) => setHistoryStatusFilter(e.target.value)}
                placeholder="如 200"
              />
            </label>
            <button style={styles.secondaryButton} disabled={loading} onClick={handleRefreshHistory}>
              筛选
            </button>
          </div>
          {history.length === 0 ? (
            <div style={styles.muted}>暂无历史；发送请求后会出现在这里。</div>
          ) : (
            <VirtualList
              items={history}
              itemHeight={48}
              height={Math.min(360, Math.max(96, history.length * 48))}
              ariaLabel="执行历史"
              getKey={(item) => item.id}
              renderItem={(item) => (
                <div style={styles.historyItem}>
                  <label style={styles.compareCheck}>
                    <input
                      type="checkbox"
                      checked={compareIds.includes(item.id)}
                      onChange={() => toggleCompare(item.id)}
                    />
                    对比
                  </label>
                  <span style={styles.mono}>
                    {item.status ?? "—"} · {item.durationMs}ms · {item.state}
                  </span>
                  <span style={styles.muted}>{item.target ?? item.protocolId}</span>
                  {onReplayHistory && (
                    <button
                      style={styles.linkButton}
                      disabled={loading}
                      onClick={() => handleReplay(item.id)}
                    >
                      重放
                    </button>
                  )}
                </div>
              )}
            />
          )}
          {compareIds.length === 2 && (
            <div style={styles.compareBox}>
              {compareIds.map((id) => {
                const item = history.find((h) => h.id === id);
                return (
                  <div key={id} style={styles.comparePane}>
                    <div style={styles.mono}>
                      {item?.status ?? "—"} · {item?.durationMs ?? 0}ms · {item?.state ?? "—"}
                    </div>
                    <div style={styles.muted}>{item?.target ?? id.slice(0, 8)}</div>
                    <pre style={styles.comparePre}>
                      {(item?.preview ?? "(无预览)").slice(0, 2000)}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
        </div>
      )}

      </div>} secondary={<div className="http-response-pane">
      {!result && !loading ? <div className="response-empty"><span className="response-empty-icon">↗</span><strong>等待响应</strong><p>发送请求后，状态、响应头、正文、断言与时间线会显示在这里。</p></div> : null}

      {loading && livePreview && <div className="http-response-content"><div style={styles.responseHeader}><strong>响应流正在接收…</strong><span>{new TextEncoder().encode(livePreview).length} bytes</span></div><pre className="http-response-body">{prettyPreview(livePreview).slice(0, 10000)}</pre></div>}

      {result && (
        <div className="http-response-content">
          {!result.error && <div className="http-response-inline-metrics">{responseMetrics}</div>}
          {result.error ? (
            <div style={styles.error}>{result.error}</div>
          ) : (
            <>
              <div style={styles.responseTabs} role="tablist" aria-label="响应内容视图" onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); const tabs = ["body", "cookies", "headers", "console", "request"] as const; const current = tabs.indexOf(responseTab); const next = event.key === "ArrowRight" ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length; const tabsRoot = event.currentTarget; setResponseTab(tabs[next]); queueMicrotask(() => tabsRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()); }}>
                <button role="tab" tabIndex={responseTab === "body" ? 0 : -1} aria-selected={responseTab === "body"} style={responseTab === "body" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("body")}>Body</button>
                <button role="tab" tabIndex={responseTab === "cookies" ? 0 : -1} aria-selected={responseTab === "cookies"} style={responseTab === "cookies" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("cookies")}>Cookie <span style={styles.count}>{responseCookies.length}</span></button>
                <button role="tab" tabIndex={responseTab === "headers" ? 0 : -1} aria-selected={responseTab === "headers"} style={responseTab === "headers" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("headers")}>Header <span style={styles.count}>{result.responseMeta?.headers.length ?? 0}</span></button>
                <button role="tab" tabIndex={responseTab === "console" ? 0 : -1} aria-selected={responseTab === "console"} style={responseTab === "console" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("console")}>控制台</button>
                <button role="tab" tabIndex={responseTab === "request" ? 0 : -1} aria-selected={responseTab === "request"} style={responseTab === "request" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("request")}>实时请求</button>
              </div>
              {responseTab === "body" && responseHasBody && <div className="http-response-view-toolbar" role="tablist" aria-label="响应显示模式" onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                  event.preventDefault();
                  const modes: Array<"pretty" | "raw" | "hex" | "table" | "preview"> = ["pretty", "raw", "hex", ...(responseTable ? ["table" as const] : []), ...(responsePreviewKind ? ["preview" as const] : [])];
                  const current = modes.indexOf(responseView);
                  const next = event.key === "ArrowRight" ? (current + 1) % modes.length : (current - 1 + modes.length) % modes.length;
                  const tabsRoot = event.currentTarget;
                  setResponseView(modes[next]);
                  queueMicrotask(() => tabsRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')[next]?.focus());
                }}>
                  <button role="tab" tabIndex={responseView === "pretty" ? 0 : -1} aria-selected={responseView === "pretty"} style={responseView === "pretty" ? styles.tabActive : styles.tab} onClick={() => setResponseView("pretty")}>美化</button>
                  <button role="tab" tabIndex={responseView === "raw" ? 0 : -1} aria-selected={responseView === "raw"} style={responseView === "raw" ? styles.tabActive : styles.tab} onClick={() => setResponseView("raw")}>原文</button>
                  <button role="tab" tabIndex={responseView === "hex" ? 0 : -1} aria-selected={responseView === "hex"} style={responseView === "hex" ? styles.tabActive : styles.tab} onClick={() => setResponseView("hex")}>Hex</button>
                  <button role="tab" tabIndex={responseView === "table" ? 0 : -1} aria-selected={responseView === "table"} style={responseView === "table" ? styles.tabActive : styles.tab} disabled={!responseTable} onClick={() => setResponseView("table")}>表格</button>
                  <button role="tab" tabIndex={responseView === "preview" ? 0 : -1} aria-selected={responseView === "preview"} style={responseView === "preview" ? styles.tabActive : styles.tab} disabled={!responsePreviewKind} onClick={() => setResponseView("preview")}>预览</button>
                  {responseView === "pretty" && <select className="http-response-tool-select" aria-label="响应内容类型" value={responseFormat} onChange={(event) => setResponseFormat(event.target.value as typeof responseFormat)}><option value="auto">自动类型</option><option value="json">JSON</option><option value="xml">XML</option><option value="html">HTML</option><option value="text">Text</option></select>}
                  {(responseView === "pretty" || responseView === "raw") && <select className="http-response-tool-select" aria-label="响应字符集" value={responseCharset} onChange={(event) => setResponseCharset(event.target.value)}><option value="auto">自动字符集</option><option value="utf-8">UTF-8</option><option value="gb18030">GBK / GB18030</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="windows-1252">Windows-1252</option><option value="iso-8859-1">ISO-8859-1</option></select>}
                  {(responseView === "pretty" || responseView === "raw") && <button type="button" className={responseWrap ? "http-response-icon-button is-active" : "http-response-icon-button"} aria-label="自动换行" title="自动换行" aria-pressed={responseWrap} onClick={() => setResponseWrap((wrap) => !wrap)}><Icon name="wrap"/></button>}
                  <div className="http-response-toolbar-actions">
                    {result.preview && <button type="button" className="http-response-icon-button" aria-label="下载响应内容" title="下载响应内容" onClick={downloadResponse}><Icon name="download"/></button>}
                    {result.preview && <button type="button" className="http-response-icon-button" aria-label="复制响应内容" title="复制响应内容" onClick={() => void copyText(responsePreview, "响应内容已复制")}><Icon name="copy"/></button>}
                    <button type="button" className={responseSearchOpen ? "http-response-icon-button is-active" : "http-response-icon-button"} aria-label="搜索响应内容" title="搜索响应内容" aria-pressed={responseSearchOpen} onClick={() => setResponseSearchOpen((open) => !open)}><Icon name="search"/></button>
                    {responseSearchOpen && <div className="http-response-find" role="search">
                      <div className="http-response-find-input"><input autoFocus value={responseSearch} onChange={(event) => setResponseSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && responseSearchCount) setResponseSearchIndex((index) => event.shiftKey ? (index - 1 + responseSearchCount) % responseSearchCount : (index + 1) % responseSearchCount); if (event.key === "Escape") setResponseSearchOpen(false); }} placeholder="Find" aria-label="搜索响应内容"/><button type="button" className={responseSearchCase ? "is-active" : ""} aria-label="区分大小写" title="区分大小写" onClick={() => setResponseSearchCase((value) => !value)}>Aa</button><button type="button" className={responseSearchWord ? "is-active" : ""} aria-label="全词匹配" title="全词匹配" onClick={() => setResponseSearchWord((value) => !value)}><u>ab</u></button><button type="button" className={responseSearchRegex ? "is-active" : ""} aria-label="使用正则表达式" title="使用正则表达式" onClick={() => setResponseSearchRegex((value) => !value)}>.*</button></div>
                      <span className="http-response-find-count">{responseSearch ? (responseSearchCount ? `${responseSearchIndex + 1} / ${responseSearchCount}` : "No results") : "No results"}</span>
                      <button type="button" aria-label="上一个结果" title="上一个结果" disabled={!responseSearchCount} onClick={() => setResponseSearchIndex((index) => (index - 1 + responseSearchCount) % responseSearchCount)}>↑</button>
                      <button type="button" aria-label="下一个结果" title="下一个结果" disabled={!responseSearchCount} onClick={() => setResponseSearchIndex((index) => (index + 1) % responseSearchCount)}>↓</button>
                      <button type="button" aria-label="关闭搜索" title="关闭搜索" onClick={() => setResponseSearchOpen(false)}>×</button>
                    </div>}
                  </div>
              </div>}
              <div className={`http-response-scroll is-${responseTab}`}>
              {responseTab === "console" && <div className="http-response-console">{result.assertions && result.assertions.length > 0 && (
                <ul style={styles.assertList}>
                  {result.assertions.map((a, i) => (
                    <li key={`${a.name}-${i}`} style={a.passed ? styles.assertPass : styles.assertFail}>
                      {a.passed ? "✓" : "✗"} {a.name}
                      {a.message ? ` — ${a.message}` : ""}
                    </li>
                  ))}
                </ul>
              )}<VirtualList items={scriptConsoleEvents} itemHeight={31} height={260} getKey={({ at, event }, index) => `${at}-${event.type}-${index}`} ariaLabel="脚本控制台" className="http-timeline" renderItem={({ at, event }) => <div style={styles.timelineRow} className={`http-timeline-event event-${event.type}`}><time>+{timeline.length ? (at - timeline[0].at).toFixed(1) : "0.0"}ms</time><b>{event.type === "log" ? "script_log" : event.type}</b><span>{event.type === "log" ? event.message : event.type === "variables_extracted" ? Object.entries(event.variables).map(([key, value]) => `${key}=${value}`).join(", ") : event.type === "failed" ? event.message : ""}</span></div>} empty={<div className="http-console-empty"><Icon name="code"/><strong>没有脚本输出</strong><span>前置或后置脚本中的 console.log、变量提取和脚本错误会显示在这里。</span></div>} /></div>}
              {responseTab === "headers" && !result.responseMeta?.headers.length && <div className="http-response-no-data"><Icon name="archive"/><span>No data</span></div>}
              {responseTab === "headers" && Boolean(result.responseMeta?.headers.length) && <div style={styles.headerTable}>
                <div style={styles.headerSummary}><span>{result.responseMeta?.contentType ?? "未知 Content-Type"}</span><span>预估 {result.responseMeta?.sizeHint ?? result.summary.bytesReceived} bytes</span></div>
                {(result.responseMeta?.headers ?? []).map(([name, value], index) => <div key={`${name}-${index}`} style={styles.headerRow}><strong>{name}</strong><span>{value}</span></div>)}
              </div>}
              {responseTab === "cookies" && responseCookies.length === 0 && <div className="http-response-no-data"><Icon name="archive"/><span>No data</span></div>}
              {responseTab === "cookies" && responseCookies.length > 0 && <div style={styles.headerTable}>{responseCookies.map((cookie, index) => <div key={index} style={styles.headerRow}><strong>{cookie.split("=", 1)[0]}</strong><span>{cookie}</span></div>)}</div>}
              {responseTab === "request" && (lastRequest ? <div className="http-live-request">
                <section><h4>请求信息</h4><div className="http-request-summary"><strong>{lastRequest.method}</strong><code>{lastRequest.url}</code></div></section>
                <section className="http-live-data-section"><h4>Header <span>{lastRequest.headers.length}</span></h4><div className="http-request-data">{lastRequest.headers.length ? lastRequest.headers.map(([name, value], index) => <div key={`${name}-${index}`}><strong>{name}</strong><span>{value}</span></div>) : <p>（空）</p>}</div></section>
                <section className="http-live-data-section"><h4>Body <span>{lastRequest.headers.find(([header]) => header.toLowerCase() === "content-type")?.[1] ?? formatBytes(requestBodySize(lastRequest))}</span></h4><pre className={`http-request-body${lastRequest.body ? "" : " is-empty"}`}>{lastRequest.body || "（空）"}</pre></section>
                <section><CodeGenerator request={lastRequest}/></section>
              </div> : <div className="http-response-no-data"><Icon name="archive"/><span>No data</span></div>)}
              {responseTab === "body" && !responseHasBody && <div className="http-response-no-data"><Icon name="archive"/><span>No data</span></div>}
              {responseTab === "body" && responseHasBody && responseView === "table" && responseTable && <div style={styles.jsonTableWrap}><table style={styles.jsonTable}><thead><tr>{responseTable.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{responseTable.rows.slice(0, 1000).map((row, index) => <tr key={index}>{responseTable.columns.map((column) => <td key={column}>{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>{responseTable.rows.length > 1000 && <div style={styles.muted}>仅显示前 1000 行，共 {responseTable.rows.length} 行。</div>}</div>}
              {responseTab === "body" && responseHasBody && responseView === "preview" && responsePreviewKind === "html" && <iframe className="http-response-html-preview" title="HTML 响应预览" sandbox="allow-forms allow-modals allow-popups" srcDoc={decodedResponse}/>}
              {responseTab === "body" && responseHasBody && responseView === "preview" && responsePreviewKind === "image" && responseMediaUrl && <div className="http-response-media-preview"><img src={responseMediaUrl} alt="响应图片预览"/></div>}
              {responseTab === "body" && responseHasBody && responseView === "preview" && responsePreviewKind === "audio" && responseMediaUrl && <div className="http-response-media-preview"><audio src={responseMediaUrl} controls/></div>}
              {responseTab === "body" && responseHasBody && responseView !== "table" && responseView !== "preview" && (
                <CodeEditor value={responsePreview} onChange={() => {}} language={responseLanguage} height="100%" readOnly bare wordWrap={responseWrap} revealLine={responseSearchLine}/>
              )}
              </div>
            </>
          )}
        </div>
      )}
      </div>}/>
      </div>
      </div>
    </WorkbenchFrame></>
  );
}

const styles: Record<string, CSSProperties> = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  h1: {
    margin: 0,
    fontSize: 30,
    fontWeight: 720,
    letterSpacing: "-0.7px",
  },
  p: {
    margin: 0,
    color: "var(--apivoy-muted)",
    lineHeight: 1.5,
    maxWidth: 720,
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  importPanel: {
    display: "flex", flexDirection: "column", gap: 12, padding: 16,
    border: "1px solid rgba(86,173,245,.38)", borderRadius: 14,
    background: "rgba(21,39,56,.72)", boxShadow: "0 18px 50px rgba(0,0,0,.16)",
  },
  panelTitle: {
    display: "flex", alignItems: "baseline", gap: 10, color: "var(--apivoy-text)", fontSize: 14,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 160px",
    gap: 12,
    padding: 16,
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    background: "rgba(18,25,35,.72)",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    padding: 16,
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    background: "rgba(18,25,35,.72)",
  },
  grid3: {
    display: "grid", gridTemplateColumns: "minmax(280px, 2fr) 1fr 1fr", gap: 12,
    padding: 16, border: "1px solid var(--apivoy-border)", borderRadius: 14,
    background: "rgba(18,25,35,.72)", alignItems: "end",
  },
  checkLabel: {
    display: "flex", alignItems: "center", gap: 8, color: "var(--apivoy-text)", fontSize: 12,
    minHeight: 34,
  },
  dangerHint: { color: "var(--apivoy-danger)", fontSize: 12 },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 12,
    color: "var(--apivoy-muted)",
  },
  select: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--apivoy-success)",
    background: "rgba(62, 207, 142, 0.12)",
    border: "1px solid rgba(62, 207, 142, 0.35)",
    borderRadius: 9,
    padding: "10px 12px",
  },
  selectWide: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--apivoy-text)",
    background: "#0d131b",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 8,
    padding: "10px 12px",
  },
  authFields: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 4,
  },
  input: {
    flex: 1,
    minWidth: 220,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 14,
    color: "var(--apivoy-text)",
    background: "#0d131b",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
  },
  timeout: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 14,
    color: "var(--apivoy-text)",
    background: "#0d131b",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
  },
  textarea: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
    color: "var(--apivoy-text)",
    background: "var(--apivoy-bg-elevated)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
    resize: "vertical",
  },
  button: {
    fontSize: 14,
    fontWeight: 600,
    color: "#041018",
    background: "var(--apivoy-accent)",
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    cursor: "pointer",
    boxShadow: "0 8px 22px rgba(31,111,184,.22)",
  },
  secondaryButton: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--apivoy-text)",
    background: "rgba(255,255,255,.025)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 18px",
    cursor: "pointer",
  },
  linkButton: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--apivoy-accent)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  panel: {
    marginTop: 8,
    background: "var(--apivoy-panel)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    padding: 18,
    boxShadow: "0 18px 50px rgba(0,0,0,.18)",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 12,
    color: "var(--apivoy-muted)",
    marginBottom: 0,
  },
  responseHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    flexWrap: "wrap", paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid var(--apivoy-border)",
  },
  responseTabs: { display: "flex", alignItems: "stretch", gap: 4, marginBottom: 12, borderBottom: "1px solid var(--apivoy-border)" },
  requestTabs: { display: "flex", flexWrap: "wrap", gap: 2, marginBottom: 12, borderBottom: "1px solid var(--apivoy-border)" },
  jsonTableWrap: { maxHeight: 420, overflow: "auto", border: "1px solid var(--apivoy-border)", borderRadius: 8 },
  jsonTable: { width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "left" },
  timeline: { display: "grid", gap: 1, maxHeight: 420, overflow: "auto", border: "1px solid var(--apivoy-border)", borderRadius: 8 },
  timelineRow: { display: "grid", gridTemplateColumns: "85px 145px 1fr", gap: 10, padding: "7px 9px", borderBottom: "1px solid var(--apivoy-border)", fontSize: 11, color: "var(--apivoy-muted)" },
  windowNav: { display: "flex", justifyContent: "center", alignItems: "center", gap: 10, padding: 8, color: "var(--apivoy-muted)", fontSize: 10 },
  count: { opacity: .7, marginLeft: 4 },
  headerTable: { display: "flex", flexDirection: "column", border: "1px solid var(--apivoy-border)", borderRadius: 9, overflow: "hidden" },
  headerSummary: { display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 11px", background: "rgba(86,173,245,.08)", color: "var(--apivoy-muted)", fontSize: 11 },
  headerRow: { display: "grid", gridTemplateColumns: "minmax(140px, .35fr) 1fr", gap: 12, padding: "8px 11px", borderTop: "1px solid var(--apivoy-border)", fontFamily: "var(--apivoy-mono)", fontSize: 11, wordBreak: "break-all" },
  statusBadge: {
    color: "var(--apivoy-success)", background: "rgba(62,207,142,.1)",
    borderRadius: 999, padding: "4px 9px",
  },
  tab: {
    border: 0, background: "transparent", color: "var(--apivoy-muted)",
    height: 40, display: "flex", alignItems: "center", padding: "0 10px", marginBottom: -1, cursor: "pointer", borderRadius: 0, borderBottom: "2px solid transparent",
  },
  tabActive: {
    border: 0, background: "transparent", color: "var(--apivoy-accent)",
    height: 40, display: "flex", alignItems: "center", padding: "0 10px", marginBottom: -1, cursor: "pointer", borderRadius: 0, borderBottom: "2px solid var(--apivoy-accent)",
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--apivoy-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 420,
    overflow: "auto",
  },
  error: {
    color: "var(--apivoy-danger)",
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
  },
  status: {
    fontSize: 13,
    color: "var(--apivoy-accent)",
  },
  history: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 16,
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    background: "rgba(18,25,35,.72)",
  },
  historyList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  historyItem: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    fontSize: 12,
    padding: "10px 12px",
    borderRadius: 9,
    background: "rgba(255,255,255,.025)",
  },
  compareCheck: {
    display: "inline-flex",
    gap: 4,
    alignItems: "center",
    color: "var(--apivoy-muted)",
    fontSize: 12,
  },
  compareBox: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginTop: 8,
  },
  comparePane: {
    border: "1px solid var(--apivoy-border)",
    borderRadius: 8,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  comparePre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--apivoy-mono)",
    fontSize: 11,
    lineHeight: 1.4,
    maxHeight: 240,
    overflow: "auto",
    color: "var(--apivoy-text)",
  },
  mono: {
    fontFamily: "var(--apivoy-mono)",
    color: "var(--apivoy-text)",
  },
  muted: {
    color: "var(--apivoy-muted)",
    fontSize: 12,
  },
  assertList: {
    listStyle: "none",
    margin: "0 0 12px",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 12,
  },
  assertPass: {
    color: "var(--apivoy-success)",
  },
  assertFail: {
    color: "var(--apivoy-danger)",
  },
};
