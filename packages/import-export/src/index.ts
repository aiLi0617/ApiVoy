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

function resolvePointer(root: Record<string, unknown>, value: unknown, seen = new Set<string>()): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref !== "string") return value;
  const ref = record.$ref;
  if (!ref.startsWith("#/")) throw new Error(`暂不支持外部 OpenAPI $ref：${ref}`);
  if (seen.has(ref)) throw new Error(`OpenAPI $ref 循环引用：${ref}`);
  seen.add(ref);
  let current: unknown = root;
  for (const segment of ref.slice(2).split("/").map((item) => item.replace(/~1/g, "/").replace(/~0/g, "~"))) current = object(current)[segment];
  return resolvePointer(root, current, seen);
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

async function parseDocumentObject(text: string): Promise<Record<string, unknown>> {
  try { return object(JSON.parse(text)); }
  catch (jsonError) {
    try {
      const { parse } = await import("yaml");
      return object(parse(text));
    } catch (yamlError) {
      const detail = yamlError instanceof Error ? yamlError.message : String(yamlError);
      throw new Error(`无法解析导入文件：${detail}`, { cause: jsonError });
    }
  }
}

async function dereferenceOpenApi(root: Record<string, unknown>, options: ImportDocumentOptions): Promise<Record<string, unknown>> {
  const mainUri = canonicalUri(options.baseUri ?? "openapi.yaml");
  const cache = new Map<string, Record<string, unknown>>([[mainUri, root]]);
  for (const [uri, text] of Object.entries(options.documents ?? {})) {
    const parsed = await parseDocumentObject(text);
    cache.set(canonicalUri(uri), parsed);
    cache.set(canonicalUri(uri, mainUri), parsed);
  }

  async function load(uri: string): Promise<Record<string, unknown>> {
    const cached = cache.get(uri);
    if (cached) return cached;
    if (!options.load) throw new Error(`缺少外部 OpenAPI 引用文档：${uri}`);
    const loaded = await parseDocumentObject(await options.load(uri));
    cache.set(uri, loaded);
    return loaded;
  }

  async function visit(value: unknown, currentUri: string, stack: Set<string>): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map((item) => visit(item, currentUri, new Set(stack))));
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      const separator = record.$ref.indexOf("#");
      const documentPart = separator < 0 ? record.$ref : record.$ref.slice(0, separator);
      const fragment = separator < 0 ? "" : record.$ref.slice(separator);
      const targetUri = documentPart ? canonicalUri(documentPart, currentUri) : currentUri;
      const identity = `${targetUri}${fragment}`;
      if (stack.has(identity)) throw new Error(`OpenAPI $ref 循环引用：${identity}`);
      const target = pointerValue(await load(targetUri), fragment);
      const resolved = await visit(target, targetUri, new Set([...stack, identity]));
      const siblings = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "$ref"));
      if (!Object.keys(siblings).length) return resolved;
      if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return visit(siblings, currentUri, stack);
      return visit({ ...(resolved as Record<string, unknown>), ...siblings }, currentUri, stack);
    }
    return Object.fromEntries(await Promise.all(Object.entries(record).map(async ([key, item]) => [key, await visit(item, currentUri, new Set(stack))])));
  }

  return object(await visit(root, mainUri, new Set()));
}

function schemaExample(root: Record<string, unknown>, input: unknown, seen = new Set<string>()): unknown {
  const resolved = resolvePointer(root, input, seen);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return resolved ?? null;
  const schema = resolved as Record<string, unknown>;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === "array") return [schemaExample(root, schema.items, new Set(seen))];
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, unknown> : null;
  if (schema.type === "object" || properties) return Object.fromEntries(Object.entries(properties ?? {}).map(([key, value]) => [key, schemaExample(root, value, new Set(seen))]));
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  return "string";
}

function importOpenApi(root: Record<string, unknown>): ImportResult {
  const info = root.info && typeof root.info === "object" ? root.info as Record<string, unknown> : {};
  const servers = Array.isArray(root.servers) ? root.servers : [];
  const server = servers[0] && typeof servers[0] === "object" ? servers[0] as Record<string, unknown> : {};
  const serverVariables = server.variables && typeof server.variables === "object" ? server.variables as Record<string, unknown> : {};
  const variables = Object.fromEntries(Object.entries(serverVariables).map(([name, definition]) => [name, String(object(definition).default ?? "") ]));
  const base = String(server.url ?? "").replace(/\{([^}]+)\}/g, "{{$1}}");
  const requests: PortableRequest[] = [];
  for (const [path, pathItemValue] of Object.entries(object(root.paths ?? {}))) {
    const pathItem = object(resolvePointer(root, pathItemValue));
    for (const method of METHODS) {
      if (!pathItem[method]) continue;
      const operation = object(resolvePointer(root, pathItem[method]));
      const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])].map((item) => resolvePointer(root, item));
      let url = `${base}${path}`;
      const query = parameters.filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && (p as Record<string, unknown>).in === "query").map((p) => `${encodeURIComponent(String(p.name))}={{${String(p.name)}}}`);
      if (query.length) url += `${url.includes("?") ? "&" : "?"}${query.join("&")}`;
      const requestBody = operation.requestBody && typeof operation.requestBody === "object" ? object(resolvePointer(root, operation.requestBody)) : {};
      const content = object(requestBody.content ?? {});
      const mediaType = Object.keys(content)[0];
      const media = mediaType ? object(resolvePointer(root, content[mediaType])) : {};
      const bodyValue = media.example ?? (media.schema ? schemaExample(root, media.schema) : undefined);
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

function importPostman(root: Record<string, unknown>): ImportResult {
  const requests: PortableRequest[] = [];
  const variables = Object.fromEntries((Array.isArray(root.variable) ? root.variable : []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => [String(item.key ?? item.id ?? ""), String(item.value ?? "")]).filter(([key]) => key));
  function visit(items: unknown, path: string[] = []) {
    if (!Array.isArray(items)) return;
    for (const itemValue of items) {
      const item = object(itemValue);
      if (item.request) {
        const request = typeof item.request === "string" ? { url: item.request } : object(item.request);
        const bodyObject = request.body && typeof request.body === "object" ? object(request.body) : {};
        const body = typeof bodyObject.raw === "string" ? bodyObject.raw : undefined;
        requests.push({ name: String(item.name ?? "Imported request"), method: String(request.method ?? "GET").toUpperCase(), url: postmanUrl(request.url), headers: headerMap(request.header), body, collectionPath: path, variables });
      }
      visit(item.item, [...path, String(item.name ?? "Folder")]);
    }
  }
  visit(root.item);
  const info = root.info && typeof root.info === "object" ? object(root.info) : {};
  return { source: "postman", name: String(info.name ?? "Postman Import"), requests, warnings: [] };
}

function importHar(root: Record<string, unknown>): ImportResult {
  const log = object(root.log);
  const entries = Array.isArray(log.entries) ? log.entries : [];
  const requests = entries.map((entryValue): PortableRequest => {
    const entry = object(entryValue);
    const request = object(entry.request);
    const postData = request.postData && typeof request.postData === "object" ? object(request.postData) : {};
    return { name: String(entry.comment ?? `${request.method ?? "GET"} ${request.url ?? ""}`), method: String(request.method ?? "GET").toUpperCase(), url: String(request.url ?? ""), headers: headerMap(request.headers), body: typeof postData.text === "string" ? postData.text : undefined, collectionPath: typeof entry.pageref === "string" ? [entry.pageref] : [] };
  });
  return { source: "har", name: "HAR Import", requests, warnings: [] };
}

function importObject(root: Record<string, unknown>): ImportResult {
  if (typeof root.openapi === "string" || typeof root.swagger === "string") return importOpenApi(root);
  if (root.log && typeof root.log === "object") return importHar(root);
  if (root.info && typeof root.info === "object" && String(object(root.info).schema ?? "").includes("postman")) return importPostman(root);
  if (root.format === "apivoy-project" && Array.isArray(root.requests)) return { source: "apivoy", name: String(root.name ?? "ApiVoy Import"), requests: root.requests as PortableRequest[], warnings: [] };
  throw new Error("无法识别文件格式；支持 OpenAPI JSON、Postman Collection v2、HAR 和 ApiVoy 项目包");
}

export function importJson(text: string): ImportResult { return importObject(object(JSON.parse(text))); }

export async function importDocument(text: string, options: ImportDocumentOptions = {}): Promise<ImportResult> {
  const root = await parseDocumentObject(text);
  const isOpenApi = typeof root.openapi === "string" || typeof root.swagger === "string";
  return importObject(isOpenApi ? await dereferenceOpenApi(root, options) : root);
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
