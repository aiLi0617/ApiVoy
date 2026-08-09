import { useMemo, useState, type CSSProperties } from "react";
import type { GraphqlWorkbenchRequest } from "./GraphqlWorkbench";
import type { GrpcWorkbenchRequest } from "./GrpcWorkbench";
import type { SocketWorkbenchRequest } from "./SocketWorkbench";
import type { SseWorkbenchRequest } from "./SseWorkbench";
import type { WebSocketWorkbenchRequest } from "./WebSocketWorkbench";
import { useI18n } from "./i18n";

export type CodegenProtocol = "graphql" | "grpc" | "websocket" | "sse" | "tcp" | "udp";
export type ProtocolCodegenInput =
  | { protocol: "graphql"; request: GraphqlWorkbenchRequest }
  | { protocol: "grpc"; request: GrpcWorkbenchRequest }
  | { protocol: "websocket"; request: WebSocketWorkbenchRequest }
  | { protocol: "sse"; request: SseWorkbenchRequest }
  | { protocol: "tcp" | "udp"; request: SocketWorkbenchRequest };

export interface CodeTemplate {
  id: string;
  label: string;
  protocols: CodegenProtocol[];
  generate: (input: ProtocolCodegenInput) => string;
  source?: "builtin" | "plugin";
}

const templates = new Map<string, CodeTemplate>();
const quote = (value: string) => JSON.stringify(value);
const headers = (values: Array<[string, string]>) => values.flatMap(([name, value]) => ["-H", quote(`${name}: ${value}`)]).join(" ");

export function registerCodeTemplate(template: CodeTemplate): () => void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(template.id)) throw new Error(`无效的代码模板 ID：${template.id}`);
  if (templates.has(template.id)) throw new Error(`代码模板已存在：${template.id}`);
  templates.set(template.id, { ...template, protocols: [...template.protocols] });
  return () => { if (templates.get(template.id)?.generate === template.generate) templates.delete(template.id); };
}

export function listCodeTemplates(protocol: CodegenProtocol): CodeTemplate[] {
  return [...templates.values()].filter((template) => template.protocols.includes(protocol));
}

export function generateProtocolCode(input: ProtocolCodegenInput, templateId: string): string {
  const template = templates.get(templateId);
  if (!template || !template.protocols.includes(input.protocol)) throw new Error(`协议 ${input.protocol} 不支持模板 ${templateId}`);
  return template.generate(input);
}

function builtin(template: Omit<CodeTemplate, "source">) { registerCodeTemplate({ ...template, source: "builtin" }); }

builtin({ id: "graphql.curl", label: "GraphQL · cURL", protocols: ["graphql"], generate: (input) => {
  if (input.protocol !== "graphql") return "";
  const payload = JSON.stringify({ query: input.request.query, variables: input.request.variables, operationName: input.request.operationName });
  return `curl ${quote(input.request.url)} -H "Content-Type: application/json" ${headers(input.request.headers)} --data-raw ${quote(payload)}`;
} });
builtin({ id: "graphql.fetch", label: "GraphQL · Fetch", protocols: ["graphql"], generate: (input) => input.protocol === "graphql" ? `const response = await fetch(${quote(input.request.url)}, {\n  method: "POST",\n  headers: ${JSON.stringify(Object.fromEntries(input.request.headers), null, 2)},\n  body: JSON.stringify(${JSON.stringify({ query: input.request.query, variables: input.request.variables, operationName: input.request.operationName }, null, 2)})\n});\nconsole.log(await response.json());` : "" });
builtin({ id: "grpc.grpcurl", label: "gRPC · grpcurl", protocols: ["grpc"], generate: (input) => input.protocol === "grpc" ? `grpcurl ${input.request.metadata.flatMap(([name, value]) => ["-H", quote(`${name}: ${value}`)]).join(" ")} -d ${quote(input.request.messageJson || "{}") } ${quote(input.request.target.replace(/^https?:\/\//, ""))} ${quote(`${input.request.service}/${input.request.method}`)}` : "" });
builtin({ id: "websocket.javascript", label: "WebSocket · JavaScript", protocols: ["websocket"], generate: (input) => input.protocol === "websocket" ? `const socket = new WebSocket(${quote(input.request.url)}, ${JSON.stringify(input.request.subprotocols)});\nsocket.onmessage = ({data}) => console.log(data);\nsocket.onopen = () => socket.send(${quote(input.request.messages[0]?.data ?? "")});` : "" });
builtin({ id: "sse.curl", label: "SSE · cURL", protocols: ["sse"], generate: (input) => input.protocol === "sse" ? `curl -N -H "Accept: text/event-stream" ${headers(input.request.headers)}${input.request.lastEventId ? ` -H ${quote(`Last-Event-ID: ${input.request.lastEventId}`)}` : ""} ${quote(input.request.url)}` : "" });
builtin({ id: "sse.eventsource", label: "SSE · EventSource", protocols: ["sse"], generate: (input) => input.protocol === "sse" ? `const events = new EventSource(${quote(input.request.url)});\nevents.onmessage = (event) => console.log(event.lastEventId, event.data);\nevents.onerror = console.error;` : "" });
builtin({ id: "tcp.netcat", label: "TCP · netcat", protocols: ["tcp"], generate: (input) => input.protocol === "tcp" ? `printf %s ${quote(input.request.data)} | nc ${input.request.target.replace(":", " ")}` : "" });
builtin({ id: "udp.netcat", label: "UDP · netcat", protocols: ["udp"], generate: (input) => input.protocol === "udp" ? `printf %s ${quote(input.request.data)} | nc -u ${input.request.target.replace(":", " ")}` : "" });

export function ProtocolCodeGenerator({ input }: { input: ProtocolCodegenInput }) {
  const { t } = useI18n();
  const options = listCodeTemplates(input.protocol);
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  const active = options.some((option) => option.id === selected) ? selected : options[0]?.id ?? "";
  const code = useMemo(() => active ? generateProtocolCode(input, active) : "暂无可用模板", [input, active]);
  return <details style={styles.root}><summary>{t("codegen.title")}</summary><div style={styles.toolbar}><select value={active} onChange={(event) => setSelected(event.target.value)}>{options.map((option) => <option key={option.id} value={option.id}>{option.label}{option.source === "plugin" ? ` (${t("codegen.plugin")})` : ""}</option>)}</select><button onClick={() => void navigator.clipboard.writeText(code)}>{t("action.copy")}</button></div><pre style={styles.code}>{code}</pre></details>;
}

const styles: Record<string, CSSProperties> = {
  root: { marginTop: 10, border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 10, background: "#080d13" },
  toolbar: { display: "flex", gap: 8, marginTop: 8 },
  code: { maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", color: "#bfe0ee", fontSize: 12 },
};
