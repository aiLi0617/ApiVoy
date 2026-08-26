import type { HttpWorkbenchRequest } from "./HttpWorkbench";

export type InterfaceFieldLocation = "query" | "header" | "body";
export interface InterfaceStructureField { key: string; name: string; location: InterfaceFieldLocation; type: "string" | "integer" | "number" | "boolean" | "array" | "object" | "null"; }
export interface HttpInterfaceStructure { version: 1; method: string; path: string; fields: InterfaceStructureField[]; }
export interface InterfaceStructureDifference { kind: "added" | "removed" | "changed"; key: string; field: InterfaceStructureField; baseline?: InterfaceStructureField; }
export const INTERFACE_STRUCTURE_METADATA_KEY = "__apivoyInterfaceStructure";

function valueType(value: unknown): InterfaceStructureField["type"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "string";
}

function bodyFields(value: unknown, prefix = ""): InterfaceStructureField[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([name, item]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    const field: InterfaceStructureField = { key: `body:${path}`, name: path, location: "body", type: valueType(item) };
    return [field, ...bodyFields(item, path)];
  });
}

export function captureHttpInterfaceStructure(request: Pick<HttpWorkbenchRequest, "method" | "url" | "headers" | "body">): HttpInterfaceStructure {
  const url = new URL(request.url || "/", "http://apivoy.local");
  const query = [...new Set([...url.searchParams.keys()])].map((name) => ({ key: `query:${name.toLowerCase()}`, name, location: "query" as const, type: "string" as const }));
  const ignoredHeaders = new Set(["authorization", "cookie", "content-length", "host", "connection", "user-agent", "accept-encoding", "content-type", "accept"]);
  const headers = request.headers.filter(([name]) => name.trim() && !ignoredHeaders.has(name.trim().toLowerCase())).map(([name]) => ({ key: `header:${name.trim().toLowerCase()}`, name: name.trim(), location: "header" as const, type: "string" as const }));
  let body: InterfaceStructureField[] = [];
  if (request.body?.trim()) { try { body = bodyFields(JSON.parse(request.body)); } catch { /* Raw bodies have no safely inferred field structure. */ } }
  return { version: 1, method: request.method.toUpperCase(), path: url.pathname || "/", fields: [...query, ...headers, ...body] };
}

export function readInterfaceStructureMetadata(metadata?: Record<string, unknown>): HttpInterfaceStructure | null {
  const value = metadata?.[INTERFACE_STRUCTURE_METADATA_KEY];
  if (!value || typeof value !== "object") return null;
  const structure = value as Partial<HttpInterfaceStructure>;
  return structure.version === 1 && typeof structure.method === "string" && typeof structure.path === "string" && Array.isArray(structure.fields) ? structure as HttpInterfaceStructure : null;
}

export function diffHttpInterfaceStructure(current: HttpInterfaceStructure, baseline: HttpInterfaceStructure): InterfaceStructureDifference[] {
  const currentByKey = new Map(current.fields.map((field) => [field.key, field]));
  const baselineByKey = new Map(baseline.fields.map((field) => [field.key, field]));
  const result: InterfaceStructureDifference[] = [];
  for (const field of current.fields) {
    const before = baselineByKey.get(field.key);
    if (!before) result.push({ kind: "added", key: field.key, field });
    else if (before.name !== field.name || before.location !== field.location || before.type !== field.type) result.push({ kind: "changed", key: field.key, field, baseline: before });
  }
  for (const field of baseline.fields) if (!currentByKey.has(field.key)) result.push({ kind: "removed", key: field.key, field, baseline: field });
  if (current.method !== baseline.method) result.unshift({ kind: "changed", key: "operation:method", field: { key: "operation:method", name: current.method, location: "query", type: "string" }, baseline: { key: "operation:method", name: baseline.method, location: "query", type: "string" } });
  if (current.path !== baseline.path) result.unshift({ kind: "changed", key: "operation:path", field: { key: "operation:path", name: current.path, location: "query", type: "string" }, baseline: { key: "operation:path", name: baseline.path, location: "query", type: "string" } });
  return result;
}

function isSafePathSegment(part: string): boolean {
  return part !== "__proto__" && part !== "prototype" && part !== "constructor";
}

function setAtPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    if (!isSafePathSegment(part)) return;
    const next = cursor[part];
    cursor =
      next && typeof next === "object" && !Array.isArray(next)
        ? (next as Record<string, unknown>)
        : ((cursor[part] = Object.create(null)) as Record<string, unknown>);
  }
  const leaf = parts.at(-1)!;
  if (!isSafePathSegment(leaf)) return;
  cursor[leaf] = value;
}

export function alignRequestToInterface(request: HttpWorkbenchRequest, baseline: HttpInterfaceStructure): HttpWorkbenchRequest {
  const url = new URL(request.url || "/", "http://apivoy.local"); const existingQuery = new Map(url.searchParams); url.pathname = baseline.path; url.search = "";
  for (const field of baseline.fields.filter((item) => item.location === "query")) url.searchParams.set(field.name, existingQuery.get(field.name) ?? "");
  const base = request.url.match(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i)?.[0] ?? "";
  const nextHeaders = baseline.fields.filter((item) => item.location === "header").map((field) => { const existing = request.headers.find(([name]) => name.toLowerCase() === field.name.toLowerCase()); return [field.name, existing?.[1] ?? ""] as [string, string]; });
  const specialHeaders = request.headers.filter(([name]) => ["authorization", "cookie", "content-type", "accept"].includes(name.toLowerCase()));
  let body = request.body; const expectedBody = baseline.fields.filter((item) => item.location === "body");
  if (expectedBody.length) {
    let existing: Record<string, unknown> = {}; try { existing = JSON.parse(request.body || "{}"); } catch { /* Align invalid raw body to JSON structure. */ }
    const next: Record<string, unknown> = {};
    for (const field of expectedBody) {
      const parts = field.name.split("."); let value: unknown = existing;
      for (const part of parts) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
      if (value !== undefined) setAtPath(next, field.name, value);
      else if (!expectedBody.some((candidate) => candidate.name.startsWith(`${field.name}.`))) setAtPath(next, field.name, field.type === "boolean" ? false : ["integer", "number"].includes(field.type) ? 0 : field.type === "array" ? [] : field.type === "object" ? {} : "");
    }
    body = JSON.stringify(next, null, 2);
  }
  return { ...request, method: baseline.method, url: `${base}${url.pathname}${url.search}`, headers: [...nextHeaders, ...specialHeaders], body };
}
