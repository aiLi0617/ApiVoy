export type MockResponseSource = "smart" | "example" | "custom";
export type MockScenarioTemplate = "success" | "empty" | "error";

export interface MockSeedField {
  id: string;
  name: string;
  type: string;
  example?: string;
  parentId?: string;
}

export interface MockSeedResponse {
  id: string;
  name: string;
  statusCode: string;
  contentType: string;
  fields: MockSeedField[];
  exampleBody?: unknown;
}

export interface MockDraftSeed {
  interfaceName: string;
  projectKey?: string;
  serviceKey?: string;
  operationId?: string;
  persisted?: boolean;
  method: string;
  path: string;
  responses: MockSeedResponse[];
}

const UNSAFE_FIELD_NAMES = new Set(["__proto__", "prototype", "constructor"]);

function explicitExample(field: MockSeedField): unknown {
  const raw = field.example?.trim();
  if (!raw) return undefined;
  try { return JSON.parse(raw); }
  catch { return raw.replace(/^['"]|['"]$/g, ""); }
}

function semanticString(name: string): string {
  const key = name.toLowerCase().replace(/[-_\s]/g, "");
  if (key.includes("email")) return "user@example.com";
  if (key.includes("avatar")) return "https://example.com/avatar.png";
  if (key.endsWith("url") || key.includes("link")) return "https://example.com/resource";
  if (key.includes("phone") || key.includes("mobile")) return "13800138000";
  if (key.includes("datetime") || key.endsWith("at") || key.includes("time")) return "2026-01-01T08:00:00Z";
  if (key.includes("date")) return "2026-01-01";
  if (key.includes("name") || key.includes("title")) return "示例名称";
  if (key.includes("message") || key.includes("description")) return "操作成功";
  if (key === "id" || key.endsWith("id")) return "10001";
  return "string";
}

function primitiveValue(field: MockSeedField, source: MockResponseSource, empty: boolean): unknown {
  if (!empty) {
    const example = explicitExample(field);
    if (example !== undefined) return example;
  }
  if (field.type === "boolean") return empty ? false : true;
  if (field.type === "integer") return empty ? 0 : 1001;
  if (field.type === "number") return empty ? 0 : 12.5;
  if (field.type === "null") return null;
  return empty ? "" : source === "smart" ? semanticString(field.name) : "string";
}

function buildFieldValue(field: MockSeedField, fields: MockSeedField[], source: MockResponseSource, empty: boolean, visiting: Set<string>): unknown {
  if (visiting.has(field.id)) return null;
  const nextVisiting = new Set(visiting).add(field.id);
  const children = fields.filter((candidate) => candidate.parentId === field.id && candidate.name && !UNSAFE_FIELD_NAMES.has(candidate.name));
  if (field.type === "array") {
    if (empty) return [];
    if (!children.length) {
      const example = explicitExample(field);
      return Array.isArray(example) ? example : [];
    }
    const item = children.length === 1 && ["items", "item", "0"].includes(children[0].name.toLowerCase())
      ? buildFieldValue(children[0], fields, source, false, nextVisiting)
      : buildObject(children, fields, source, false, nextVisiting);
    return [item];
  }
  if (field.type === "object") {
    if (!children.length) {
      const example = explicitExample(field);
      return example && typeof example === "object" && !Array.isArray(example) ? example : Object.create(null);
    }
    return buildObject(children, fields, source, empty, nextVisiting);
  }
  return primitiveValue(field, source, empty);
}

function buildObject(fieldsAtLevel: MockSeedField[], allFields: MockSeedField[], source: MockResponseSource, empty: boolean, visiting = new Set<string>()): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const field of fieldsAtLevel) {
    if (!field.name || UNSAFE_FIELD_NAMES.has(field.name)) continue;
    result[field.name] = buildFieldValue(field, allFields, source, empty, visiting);
  }
  return result;
}

export function selectMockResponse(responses: MockSeedResponse[], template: MockScenarioTemplate): MockSeedResponse | undefined {
  const matching = responses.find((response) => {
    const status = Number(response.statusCode);
    if (template === "success") return status >= 200 && status < 300;
    if (template === "error") return status >= 400;
    return status >= 200 && status < 300;
  });
  return matching ?? responses[0];
}

/** Prefer a response status encoded in paths such as /status/404. */
export function inferMockScenario(seed: MockDraftSeed): { template: MockScenarioTemplate; responseId?: string } {
  const pathStatus = seed.path.match(/(?:^|\/)([1-5]\d{2})(?=\/|$)/)?.[1];
  const response = pathStatus ? seed.responses.find((item) => item.statusCode === pathStatus) : undefined;
  if (!response) return { template: "success" };
  const status = Number(response.statusCode);
  return { template: status >= 400 ? "error" : "success", responseId: response.id };
}

export function buildMockResponseBody(response: MockSeedResponse | undefined, source: MockResponseSource, template: MockScenarioTemplate): string {
  if (source === "custom") return "";
  if (source === "example" && response?.exampleBody !== undefined)
    return typeof response.exampleBody === "string" ? response.exampleBody : JSON.stringify(response.exampleBody, null, 2);
  if (template === "error" && !response)
    return JSON.stringify({ code: "INTERNAL_ERROR", message: "服务暂时不可用" }, null, 2);
  const fields = response?.fields ?? [];
  const roots = fields.filter((field) => !field.parentId && field.name && !UNSAFE_FIELD_NAMES.has(field.name));
  const body = buildObject(roots, fields, source, template === "empty");
  if (!roots.length && template === "error") {
    body.code = response?.statusCode ? `HTTP_${response.statusCode}` : "INTERNAL_ERROR";
    body.message = response?.name || "服务暂时不可用";
  }
  return JSON.stringify(body, null, 2);
}

export function mockPathFromUrl(value: string): string {
  try {
    const parsed = new URL(value || "/", "http://apivoy.local");
    return parsed.pathname.startsWith("/") ? parsed.pathname : `/${parsed.pathname}`;
  } catch { return "/"; }
}
