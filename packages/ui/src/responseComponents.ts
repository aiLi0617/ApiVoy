export type ResponseBodyType = "json" | "xml" | "html" | "text" | "binary" | "msgpack" | "event-stream" | "none";

export const RESPONSE_BODY_TYPES: Array<{ id: ResponseBodyType; label: string; contentType: string }> = [
  { id: "json", label: "JSON", contentType: "application/json" },
  { id: "xml", label: "XML", contentType: "application/xml" },
  { id: "html", label: "HTML", contentType: "text/html" },
  { id: "text", label: "Text", contentType: "text/plain" },
  { id: "binary", label: "Binary", contentType: "application/octet-stream" },
  { id: "msgpack", label: "MessagePack", contentType: "application/msgpack" },
  { id: "event-stream", label: "Event-Stream", contentType: "text/event-stream" },
  { id: "none", label: "No Content", contentType: "" },
];

export interface ResponseComponent {
  id: string;
  name: string;
  statusCode?: string;
  bodyType: ResponseBodyType;
  contentType: string;
  description?: string;
  addToNewInterfaces: boolean;
  fields?: unknown[];
}

const storageKey = (projectId?: string) => `apivoy:project:${projectId || "default"}:response-components:v1`;

export function normalizeResponseBodyType(value: unknown): ResponseBodyType {
  if (value === "sse") return "event-stream";
  return RESPONSE_BODY_TYPES.some((item) => item.id === value) ? value as ResponseBodyType : "json";
}

export function readResponseComponents(projectId?: string): ResponseComponent[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectId)) || "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is ResponseComponent => Boolean(item && typeof item === "object" && typeof (item as ResponseComponent).id === "string")).map((item) => { const bodyType = normalizeResponseBodyType((item as ResponseComponent & { bodyType?: unknown }).bodyType); return { ...item, bodyType, contentType: item.contentType || RESPONSE_BODY_TYPES.find((type) => type.id === bodyType)?.contentType || "" }; }) : [];
  } catch { return []; }
}

export function writeResponseComponents(projectId: string | undefined, components: ResponseComponent[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey(projectId), JSON.stringify(components));
  window.dispatchEvent(new CustomEvent("apivoy-response-components-changed", { detail: { projectId } }));
}

export function createResponseComponent(index = 0): ResponseComponent {
  return { id: crypto.randomUUID(), name: `未命名响应组件${index ? ` ${index + 1}` : ""}`, bodyType: "json", contentType: "application/json", addToNewInterfaces: false };
}
