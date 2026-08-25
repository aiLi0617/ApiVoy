export interface PortableRequest {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  collectionPath?: string[];
  variables?: Record<string, string>;
}

export interface ImportResult {
  source: "openapi" | "postman" | "har" | "apivoy";
  name: string;
  requests: PortableRequest[];
  warnings: string[];
}

export interface SensitiveFinding {
  path: string;
  kind: "header" | "query" | "body";
  key: string;
}

export interface ImportDocumentOptions {
  baseUri?: string;
  documents?: Record<string, string>;
  load?: (uri: string) => Promise<string>;
}

export const IMPORT_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const IMPORT_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
export const IMPORT_MAX_DOCUMENTS = 64;
export const IMPORT_MAX_DEPTH = 128;
export const IMPORT_MAX_NODES = 100_000;
export const IMPORT_MAX_REFS = 10_000;
export const IMPORT_MAX_REQUESTS = 10_000;

interface ImportBudget {
  documents: number;
  bytes: number;
  nodes: number;
  refs: number;
  requests: number;
}

function createBudget(): ImportBudget {
  return { documents: 0, bytes: 0, nodes: 0, refs: 0, requests: 0 };
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function consumeDocument(budget: ImportBudget, text: string, label: string): void {
  const size = textBytes(text);
  if (size > IMPORT_MAX_FILE_BYTES) throw new Error(`${label} 超过 ${IMPORT_MAX_FILE_BYTES} 字节的导入上限`);
  budget.documents += 1;
  budget.bytes += size;
  if (budget.documents > IMPORT_MAX_DOCUMENTS) throw new Error(`导入文档数量超过 ${IMPORT_MAX_DOCUMENTS} 个的上限`);
  if (budget.bytes > IMPORT_MAX_TOTAL_BYTES) throw new Error(`导入文档总大小超过 ${IMPORT_MAX_TOTAL_BYTES} 字节的上限`);
}

function consumeNode(budget: ImportBudget, depth: number): void {
  if (depth > IMPORT_MAX_DEPTH) throw new Error(`导入文档嵌套深度超过 ${IMPORT_MAX_DEPTH} 层的上限`);
  budget.nodes += 1;
  if (budget.nodes > IMPORT_MAX_NODES) throw new Error(`导入文档节点数量超过 ${IMPORT_MAX_NODES} 个的上限`);
}

function consumeRef(budget: ImportBudget): void {
  budget.refs += 1;
  if (budget.refs > IMPORT_MAX_REFS) throw new Error(`OpenAPI $ref 数量超过 ${IMPORT_MAX_REFS} 个的上限`);
}

function consumeRequest(budget: ImportBudget): void {
  budget.requests += 1;
  if (budget.requests > IMPORT_MAX_REQUESTS) throw new Error(`导入请求数量超过 ${IMPORT_MAX_REQUESTS} 个的上限`);
}

function validateStructure(root: unknown): void {
  const budget = createBudget();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    consumeNode(budget, current.depth);
    if (Array.isArray(current.value)) {
      for (const value of current.value) stack.push({ value, depth: current.depth + 1 });
    } else if (current.value && typeof current.value === "object") {
      for (const value of Object.values(current.value as Record<string, unknown>)) stack.push({ value, depth: current.depth + 1 });
    }
  }
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;
const SECRET_KEY = /(^|[-_])(authorization|api[-_]?key|token|secret|password|passwd|cookie|set-cookie)($|[-_])/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("导入文件必须是 JSON 对象");
  return value as Record<string, unknown>;
}

function headerMap(value: unknown): Record<string, string> {
  if (Array.isArray(value)) return Object.fromEntries(value.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").filter((x) => !x.disabled && typeof x.name === "string" || typeof x.key === "string").map((x) => [String(x.name ?? x.key), String(x.value ?? "")]));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)]));
  return {};
}

function resolvePointer(root: Record<string, unknown>, value: unknown, seen = new Set<string>(), budget = createBudget()): unknown {
  let current = value;
  let depth = 0;
  while (current && typeof current === "object" && !Array.isArray(current) && typeof (current as Record<string, unknown>).$ref === "string") {
    consumeNode(budget, depth++);
    consumeRef(budget);
    const ref = String((current as Record<string, unknown>).$ref);
    if (!ref.startsWith("#/")) throw new Error(`暂不支持外部 OpenAPI $ref：${ref}`);
    if (seen.has(ref)) throw new Error(`OpenAPI $ref 循环引用：${ref}`);
    seen.add(ref);
    current = root;
    for (const segment of ref.slice(2).split("/").map((item) => item.replace(/~1/g, "/").replace(/~0/g, "~"))) current = object(current)[segment];
  }
  return current;
}

function canonicalUri(input: string, base = ""): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return new URL(input).href;
  if (base && /^[a-z][a-z\d+.-]*:/i.test(base)) return new URL(input, base).href;
  const normalized = input.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "/" : "";
  const baseParts = base.replace(/\\/g, "/").split("/");
  if (baseParts.length) baseParts.pop();
  const parts = (prefix ? [] : baseParts).concat(normalized.split("/"));
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return `${prefix}${result.join("/")}` || ".";
}

function pointerValue(root: Record<string, unknown>, fragment: string): unknown {
  if (!fragment || fragment === "#") return root;
  if (!fragment.startsWith("#/")) throw new Error(`Unsupported OpenAPI reference fragment: ${fragment}`);
  let current: unknown = root;
  for (const raw of fragment.slice(2).split("/")) {
    const segment = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    current = object(current)[segment];
    if (current === undefined) throw new Error(`OpenAPI reference does not exist: ${fragment}`);
  }
  return current;
}

async function parseDocumentObject(text: string, budget: ImportBudget, label = "导入文件"): Promise<Record<string, unknown>> {
  consumeDocument(budget, text, label);
  try { return object(JSON.parse(text)); }
  catch (jsonError) {
    try {
      const { parse } = await import("yaml");
      return object(parse(text, { maxAliasCount: 100 }));
    } catch (yamlError) {
      const detail = yamlError instanceof Error ? yamlError.message : String(yamlError);
      throw new Error(`无法解析导入文件：${detail}`, { cause: jsonError });
    }
  }
}

async function dereferenceOpenApi(root: Record<string, unknown>, options: ImportDocumentOptions, documentBudget: ImportBudget): Promise<Record<string, unknown>> {
  const mainUri = canonicalUri(options.baseUri ?? "openapi.yaml");
  const cache = new Map<string, Record<string, unknown>>([[mainUri, root]]);
  for (const [uri, text] of Object.entries(options.documents ?? {})) {
    const parsed = await parseDocumentObject(text, documentBudget, uri);
    validateStructure(parsed);
    cache.set(canonicalUri(uri), parsed);
    cache.set(canonicalUri(uri, mainUri), parsed);
  }

  async function load(uri: string): Promise<Record<string, unknown>> {
    const cached = cache.get(uri);
    if (cached) return cached;
    if (!options.load) throw new Error(`缺少外部 OpenAPI 引用文档：${uri}`);
    const loaded = await parseDocumentObject(await options.load(uri), documentBudget, uri);
    validateStructure(loaded);
    cache.set(uri, loaded);
    return loaded;
  }

  const traversalBudget = createBudget();
  async function visit(value: unknown, currentUri: string, stack: Set<string>, depth = 0): Promise<unknown> {
    consumeNode(traversalBudget, depth);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) result.push(await visit(item, currentUri, new Set(stack), depth + 1));
      return result;
    }
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      consumeRef(traversalBudget);
      const separator = record.$ref.indexOf("#");
      const documentPart = separator < 0 ? record.$ref : record.$ref.slice(0, separator);
      const fragment = separator < 0 ? "" : record.$ref.slice(separator);
      const targetUri = documentPart ? canonicalUri(documentPart, currentUri) : currentUri;
      const identity = `${targetUri}${fragment}`;
      if (stack.has(identity)) throw new Error(`OpenAPI $ref 循环引用：${identity}`);
      const target = pointerValue(await load(targetUri), fragment);
      const resolved = await visit(target, targetUri, new Set([...stack, identity]), depth + 1);
      const siblings = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "$ref"));
      if (!Object.keys(siblings).length) return resolved;
      if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return visit(siblings, currentUri, stack, depth + 1);
      return visit({ ...(resolved as Record<string, unknown>), ...siblings }, currentUri, stack, depth + 1);
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) result[key] = await visit(item, currentUri, new Set(stack), depth + 1);
    return result;
  }

  return object(await visit(root, mainUri, new Set()));
}

function schemaExample(root: Record<string, unknown>, input: unknown, budget: ImportBudget, seen = new Set<string>(), depth = 0): unknown {
  consumeNode(budget, depth);
  const resolved = resolvePointer(root, input, seen, budget);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return resolved ?? null;
  const schema = resolved as Record<string, unknown>;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === "array") return [schemaExample(root, schema.items, budget, new Set(seen), depth + 1)];
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, unknown> : null;
  if (schema.type === "object" || properties) return Object.fromEntries(Object.entries(properties ?? {}).map(([key, value]) => [key, schemaExample(root, value, budget, new Set(seen), depth + 1)]));
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  return "string";
}

function importOpenApi(root: Record<string, unknown>, budget: ImportBudget): ImportResult {
  const info = root.info && typeof root.info === "object" ? root.info as Record<string, unknown> : {};
  const servers = Array.isArray(root.servers) ? root.servers : [];
  const server = servers[0] && typeof servers[0] === "object" ? servers[0] as Record<string, unknown> : {};
  const serverVariables = server.variables && typeof server.variables === "object" ? server.variables as Record<string, unknown> : {};
  const variables = Object.fromEntries(Object.entries(serverVariables).map(([name, definition]) => [name, String(object(definition).default ?? "") ]));
  const base = String(server.url ?? "").replace(/\{([^}]+)\}/g, "{{$1}}");
  const requests: PortableRequest[] = [];
  for (const [path, pathItemValue] of Object.entries(object(root.paths ?? {}))) {
    const pathItem = object(resolvePointer(root, pathItemValue, new Set(), budget));
    for (const method of METHODS) {
      if (!pathItem[method]) continue;
      consumeRequest(budget);
      const operation = object(resolvePointer(root, pathItem[method], new Set(), budget));
      const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])].map((item) => resolvePointer(root, item, new Set(), budget));
      let url = `${base}${path}`;
      const query = parameters.filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && (p as Record<string, unknown>).in === "query").map((p) => `${encodeURIComponent(String(p.name))}={{${String(p.name)}}}`);
      if (query.length) url += `${url.includes("?") ? "&" : "?"}${query.join("&")}`;
      const requestBody = operation.requestBody && typeof operation.requestBody === "object" ? object(resolvePointer(root, operation.requestBody, new Set(), budget)) : {};
      const content = object(requestBody.content ?? {});
      const mediaType = Object.keys(content)[0];
      const media = mediaType ? object(resolvePointer(root, content[mediaType], new Set(), budget)) : {};
      const bodyValue = media.example ?? (media.schema ? schemaExample(root, media.schema, budget) : undefined);
      const body = bodyValue === undefined ? undefined : typeof bodyValue === "string" ? bodyValue : JSON.stringify(bodyValue, null, 2);
      const tags = Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === "string") : [];
      requests.push({ name: String(operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`), method: method.toUpperCase(), url, headers: mediaType ? { "Content-Type": mediaType } : {}, body, collectionPath: tags.slice(0, 1), variables });
    }
  }
  return { source: "openapi", name: String(info.title ?? "OpenAPI Import"), requests, warnings: base ? [] : ["OpenAPI 未声明 servers，已保留相对 URL"] };
}

function postmanUrl(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const raw = (value as Record<string, unknown>).raw;
    if (typeof raw === "string") return raw;
  }
  return "";
}

function importPostman(root: Record<string, unknown>, budget: ImportBudget): ImportResult {
  const requests: PortableRequest[] = [];
  const variables = Object.fromEntries((Array.isArray(root.variable) ? root.variable : []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => [String(item.key ?? item.id ?? ""), String(item.value ?? "")]).filter(([key]) => key));
  const stack: Array<{ item: unknown; path: string[]; depth: number }> = [];
  const rootItems = Array.isArray(root.item) ? root.item : [];
  for (let index = rootItems.length - 1; index >= 0; index -= 1) stack.push({ item: rootItems[index], path: [], depth: 0 });
  while (stack.length) {
    const current = stack.pop()!;
    consumeNode(budget, current.depth);
    const item = object(current.item);
    if (item.request) {
      consumeRequest(budget);
      const request = typeof item.request === "string" ? { url: item.request } : object(item.request);
      const bodyObject = request.body && typeof request.body === "object" ? object(request.body) : {};
      const body = typeof bodyObject.raw === "string" ? bodyObject.raw : undefined;
      requests.push({ name: String(item.name ?? "Imported request"), method: String(request.method ?? "GET").toUpperCase(), url: postmanUrl(request.url), headers: headerMap(request.header), body, collectionPath: current.path, variables });
    }
    const children = Array.isArray(item.item) ? item.item : [];
    const childPath = [...current.path, String(item.name ?? "Folder")];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ item: children[index], path: childPath, depth: current.depth + 1 });
  }
  const info = root.info && typeof root.info === "object" ? object(root.info) : {};
  return { source: "postman", name: String(info.name ?? "Postman Import"), requests, warnings: [] };
}

function importHar(root: Record<string, unknown>, budget: ImportBudget): ImportResult {
  const log = object(root.log);
  const entries = Array.isArray(log.entries) ? log.entries : [];
  const requests = entries.map((entryValue): PortableRequest => {
    consumeRequest(budget);
    const entry = object(entryValue);
    const request = object(entry.request);
    const postData = request.postData && typeof request.postData === "object" ? object(request.postData) : {};
    return { name: String(entry.comment ?? `${request.method ?? "GET"} ${request.url ?? ""}`), method: String(request.method ?? "GET").toUpperCase(), url: String(request.url ?? ""), headers: headerMap(request.headers), body: typeof postData.text === "string" ? postData.text : undefined, collectionPath: typeof entry.pageref === "string" ? [entry.pageref] : [] };
  });
  return { source: "har", name: "HAR Import", requests, warnings: [] };
}

function importObject(root: Record<string, unknown>, budget: ImportBudget): ImportResult {
  if (typeof root.openapi === "string" || typeof root.swagger === "string") return importOpenApi(root, budget);
  if (root.log && typeof root.log === "object") return importHar(root, budget);
  if (root.info && typeof root.info === "object" && String(object(root.info).schema ?? "").includes("postman")) return importPostman(root, budget);
  if (root.format === "apivoy-project" && Array.isArray(root.requests)) {
    for (const _request of root.requests) consumeRequest(budget);
    return { source: "apivoy", name: String(root.name ?? "ApiVoy Import"), requests: root.requests as PortableRequest[], warnings: [] };
  }
  throw new Error("无法识别文件格式；支持 OpenAPI JSON、Postman Collection v2、HAR 和 ApiVoy 项目包");
}

export function importJson(text: string): ImportResult {
  const budget = createBudget();
  consumeDocument(budget, text, "导入文件");
  const root = object(JSON.parse(text));
  validateStructure(root);
  return importObject(root, budget);
}

export async function importDocument(text: string, options: ImportDocumentOptions = {}): Promise<ImportResult> {
  if (Object.keys(options.documents ?? {}).length > IMPORT_MAX_DOCUMENTS - 1) throw new Error(`导入文档数量超过 ${IMPORT_MAX_DOCUMENTS} 个的上限`);
  const documentBudget = createBudget();
  const root = await parseDocumentObject(text, documentBudget);
  validateStructure(root);
  const isOpenApi = typeof root.openapi === "string" || typeof root.swagger === "string";
  const resolved = isOpenApi ? await dereferenceOpenApi(root, options, documentBudget) : root;
  validateStructure(resolved);
  return importObject(resolved, createBudget());
}

export function scanSensitiveData(requests: PortableRequest[]): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  requests.forEach((request, index) => {
    for (const key of Object.keys(request.headers)) if (SECRET_KEY.test(key)) findings.push({ path: `requests[${index}].headers.${key}`, kind: "header", key });
    try { for (const key of new URL(request.url, "http://relative.local").searchParams.keys()) if (SECRET_KEY.test(key)) findings.push({ path: `requests[${index}].url.${key}`, kind: "query", key }); } catch { /* malformed URL remains exportable */ }
    if (request.body) for (const match of request.body.matchAll(/["']?([\w-]*(?:token|secret|password|api[-_]?key)[\w-]*)["']?\s*[:=]/gi)) findings.push({ path: `requests[${index}].body`, kind: "body", key: match[1] });
  });
  return findings;
}

export function exportApiVoyProject(name: string, requests: PortableRequest[], allowSensitive = false): string {
  const findings = scanSensitiveData(requests);
  if (findings.length && !allowSensitive) throw new Error(`检测到 ${findings.length} 处可能的敏感信息，请清理或明确允许导出`);
  return JSON.stringify({ format: "apivoy-project", version: 1, name, exportedAt: new Date().toISOString(), requests }, null, 2);
}
