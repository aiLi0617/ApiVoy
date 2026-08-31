import type { AssertionResultEvent, ExecutionSummary, ResponseMeta } from "@apivoy/request-model";
import type { ResponseBodyType } from "./responseComponents";
import type { ProjectResponseValidationSettings } from "./responseValidationSettings";

export interface DesignedResponseField { id: string; name: string; type: string; required: boolean; parentId?: string; scope: string; example?: string }
export interface DesignedResponse { status: string; bodyType?: ResponseBodyType; contentType?: string; fields: DesignedResponseField[] }
export interface DesignedResponseResult { summary: ExecutionSummary | { status?: number | null }; eventCount?: number; preview?: string | null; responseMeta?: ResponseMeta | null }

function valueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesJsonType(value: unknown, expected: string): boolean {
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "object") return Boolean(value && typeof value === "object" && !Array.isArray(value));
  if (["bytes", "file", "enum"].includes(expected)) return typeof value === "string";
  return valueType(value) === expected;
}

function matchesHeaderType(value: string, expected: string): boolean {
  const normalized = value.trim();
  if (expected === "integer") return /^[-+]?\d+$/.test(normalized);
  if (expected === "number") return normalized !== "" && Number.isFinite(Number(normalized));
  if (expected === "boolean") return /^(true|false)$/i.test(normalized);
  if (expected === "null") return /^null$/i.test(normalized);
  if (expected === "array") return normalized.split(",").some((part) => part.trim() !== "");
  if (expected === "object") { try { const parsed = JSON.parse(normalized) as unknown; return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed)); } catch { return false; } }
  return true;
}

function mediaType(value?: string | null): string { return (value ?? "").split(";", 1)[0]!.trim().toLowerCase(); }
function mediaTypeMatches(actual: string, expected: string, bodyType: ResponseBodyType): boolean {
  if (!expected || actual === expected) return true;
  if (bodyType === "json") return actual.endsWith("+json") && expected === "application/json";
  if (bodyType === "xml") return actual.endsWith("+xml") && ["application/xml", "text/xml"].includes(expected);
  return false;
}

const MAX_RESPONSE_VALIDATION_CHARS = 1_000_000;
const MAX_SCHEMA_VALIDATION_NODES = 10_000;
const MAX_SCHEMA_VALIDATION_DEPTH = 64;

function validXml(source: string): boolean {
  if (!source.trim()) return false;
  let cleaned = source;
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned
      .replace(/<\?xml[\s\S]*?\?>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "text");
  } while (cleaned !== previous);
  cleaned = cleaned.trim();
  const tags = cleaned.match(/<[^>]+>/g);
  if (!tags?.length || !cleaned.startsWith("<") || !cleaned.endsWith(">")) return false;
  const stack: string[] = [];
  for (const tag of tags) {
    if (/^<!|^<\?/.test(tag)) continue;
    const close = tag.match(/^<\/\s*([^\s>]+)\s*>$/);
    if (close) { if (stack.pop() !== close[1]) return false; continue; }
    const open = tag.match(/^<\s*([^\s/>]+)/);
    if (!open) return false;
    if (!/\/>$/.test(tag)) stack.push(open[1]!);
  }
  return stack.length === 0;
}

function formatError(bodyType: ResponseBodyType, preview: string): string | undefined {
  if (bodyType === "json") { try { JSON.parse(preview); return undefined; } catch { return "响应 Body 不是有效 JSON"; } }
  if (bodyType === "xml" && !validXml(preview)) return "响应 Body 不是有效 XML";
  if (bodyType === "html" && preview.trim() && !/<(?:!doctype\s+html|html|head|body|[a-z][\w-]*)(?:\s|>|\/)/i.test(preview)) return "响应 Body 不是有效 HTML 标记";
  if (bodyType === "event-stream" && preview.trim() && preview.split(/\r?\n/).some((line) => line !== "" && !line.startsWith(":") && !/^(?:data|event|id|retry)(?::|$)/.test(line))) return "响应 Body 不是有效 Event-Stream 文本";
  if (bodyType === "none" && preview.length > 0) return "响应定义为无 Body，但实际响应包含数据";
  return undefined;
}

const DEFAULT_CONTENT_TYPES: Record<ResponseBodyType, string> = { json: "application/json", xml: "application/xml", html: "text/html", text: "text/plain", binary: "application/octet-stream", msgpack: "application/msgpack", "event-stream": "text/event-stream", none: "" };

export function validateDesignedResponse(definition: DesignedResponse, result: DesignedResponseResult, settings: ProjectResponseValidationSettings): AssertionResultEvent[] {

  const output: AssertionResultEvent[] = [];
  const push = (name: string, passed: boolean, expected?: string, actual?: string, message?: string) => output.push({ ruleId: `design:${definition.status}:${name}`, name, passed, expected, actual, message });
  const actualStatus = String(result.summary.status ?? "");
  if (settings.status) push("接口设计 · HTTP 状态码", actualStatus === definition.status, definition.status, actualStatus || "—", actualStatus === definition.status ? undefined : "实际状态码与所选返回响应不一致");

  if (settings.headers) {
    const headers = new Map((result.responseMeta?.headers ?? []).map(([name, value]) => [name.toLowerCase(), value]));
    for (const field of definition.fields.filter((item) => item.scope === "response.headers" && item.name)) {
      const actual = headers.get(field.name.toLowerCase());
      if (actual == null) { push(`接口设计 · Header ${field.name}`, !field.required, field.required ? `${field.type}（必需）` : `${field.type}（可选）`, "不存在", field.required ? "缺少必需 Header" : undefined); continue; }
      const passed = matchesHeaderType(actual, field.type);
      push(`接口设计 · Header ${field.name}`, passed, field.type, actual, passed ? undefined : "Header 值类型与接口设计不一致");
    }
  }

  const bodyFields = definition.fields.filter((field) => field.scope === "response.body" && field.name);
  const bodyType = definition.bodyType ?? (bodyFields.length ? "json" : undefined);
  const preview = result.preview ?? "";
  const bodyWithinBudget = preview.length <= MAX_RESPONSE_VALIDATION_CHARS;
  if (settings.bodyFormat && bodyType) {
    const expectedContentType = mediaType(definition.contentType) || DEFAULT_CONTENT_TYPES[bodyType];
    const actualContentType = mediaType(result.responseMeta?.contentType) || mediaType(result.responseMeta?.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1]);
    const contentTypePassed = mediaTypeMatches(actualContentType, expectedContentType, bodyType);
    if (expectedContentType) push("接口设计 · Body Content-Type", contentTypePassed, expectedContentType, actualContentType || "未提供", contentTypePassed ? undefined : "响应 Content-Type 与接口设计不一致");
    const error = bodyWithinBudget ? formatError(bodyType, preview) : `响应 Body 超过校验上限（${MAX_RESPONSE_VALIDATION_CHARS} 字符）`;
    push("接口设计 · Body 格式", !error, bodyType === "none" ? "无 Body" : bodyType.toUpperCase(), error ? actualContentType || "未知" : bodyType.toUpperCase(), error);
  }

  if (settings.bodySchema && bodyFields.length) {
    if (!bodyWithinBudget) {
      if (!settings.bodyFormat) push("接口设计 · Body 结构", false, `不超过 ${MAX_RESPONSE_VALIDATION_CHARS} 字符`, `${preview.length} 字符`, "响应 Body 过大，已跳过结构校验");
      return output;
    }
    let body: unknown;
    try { body = JSON.parse(preview); }
    catch { if (!settings.bodyFormat) push("接口设计 · Body 格式", false, "JSON", mediaType(result.responseMeta?.contentType) || "未知", "响应 Body 不是有效 JSON"); return output; }
    const fieldsByParent = new Map<string | undefined, DesignedResponseField[]>();
    for (const field of bodyFields) fieldsByParent.set(field.parentId, [...(fieldsByParent.get(field.parentId) ?? []), field]);
    let visitedNodes = 0;
    let budgetExceeded = false;
    const visit = (parent: unknown, parentId: string | undefined, path: string, depth: number) => {
      if (budgetExceeded) return;
      visitedNodes += 1;
      if (depth > MAX_SCHEMA_VALIDATION_DEPTH || visitedNodes > MAX_SCHEMA_VALIDATION_NODES) {
        budgetExceeded = true;
        push("接口设计 · Body 结构复杂度", false, `深度 ≤ ${MAX_SCHEMA_VALIDATION_DEPTH} 且节点 ≤ ${MAX_SCHEMA_VALIDATION_NODES}`, `深度 ${depth}，节点 ${visitedNodes}`, "响应结构过于复杂，已停止校验");
        return;
      }
      const children = fieldsByParent.get(parentId) ?? [];
      if (!parent || typeof parent !== "object" || Array.isArray(parent)) { if (children.length) push(`接口设计 · ${path}`, false, "object", valueType(parent), "父级数据类型不匹配"); return; }
      const container = parent as Record<string, unknown>;
      for (const field of children) {
        const value = container[field.name]; const fieldPath = `${path}.${field.name}`;
        if (value === undefined) { push(`接口设计 · ${fieldPath}`, !field.required, field.required ? `${field.type}（必需）` : `${field.type}（可选）`, "不存在", field.required ? "缺少必需属性" : undefined); continue; }
        const passed = matchesJsonType(value, field.type);
        push(`接口设计 · ${fieldPath}`, passed, field.type, valueType(value), passed ? undefined : "值类型与接口设计不一致");
        if (passed && field.type === "object") visit(value, field.id, fieldPath, depth + 1);
        if (passed && field.type === "array" && Array.isArray(value)) {
          for (let index = 0; index < value.length && !budgetExceeded; index += 1) visit(value[index], field.id, `${fieldPath}[${index}]`, depth + 1);
        }
      }
      if (!settings.allowAdditionalProperties) {
        const allowed = new Set(children.map((field) => field.name));
        for (const name of Object.keys(container)) if (!allowed.has(name)) push(`接口设计 · ${path}.${name}`, false, "未定义字段", "存在", "不允许额外属性");
      }
    };
    visit(body, undefined, "$", 0);
  }
  return output;
}
