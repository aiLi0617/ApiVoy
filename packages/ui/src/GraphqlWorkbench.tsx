import { useEffect, useState, type CSSProperties } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { CodeEditor } from "./CodeEditor";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";

export interface GraphqlWorkbenchRequest {
  name: string;
  url: string;
  query: string;
  variables: unknown;
  operationName?: string;
  headers: Array<[string, string]>;
}

export interface GraphqlWorkbenchProps {
  onSend: (request: GraphqlWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onCancel: (executionId: string) => Promise<void>;
  onSave?: (request: GraphqlWorkbenchRequest) => Promise<void>;
  externalRequest?: GraphqlWorkbenchRequest | null;
}

const INTROSPECTION_QUERY = `query ApiVoyIntrospection { __schema { queryType { name } mutationType { name } subscriptionType { name } types { name kind fields { name } } } }`;

export function GraphqlWorkbench({ onSend, onCancel, onSave, externalRequest }: GraphqlWorkbenchProps) {
  const [url, setUrl] = useState("https://");
  const [query, setQuery] = useState("query Example {\n  __typename\n}");
  const [variables, setVariables] = useState("{}");
  const [operationName, setOperationName] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [schemaTypes, setSchemaTypes] = useState<string[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [output, setOutput] = useState("尚未执行");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const apply = (value: GraphqlWorkbenchRequest) => { setUrl(value.url); setQuery(value.query); setVariables(JSON.stringify(value.variables ?? {}, null, 2)); setOperationName(value.operationName ?? ""); setHeaderText(value.headers.map(([name, item]) => `${name}: ${item}`).join("\n")); }; if (externalRequest) apply(externalRequest); else { const draft = readWorkbenchDraft<GraphqlWorkbenchRequest>("graphql"); if (draft) apply(draft); } const listener = (event: Event) => { const envelope = (event as CustomEvent).detail; if (envelope?.payload?.type === "graphql") apply({ name: envelope.name, url: envelope.target, query: envelope.payload.query, variables: envelope.payload.variables, operationName: envelope.payload.operationName ?? undefined, headers: envelope.payload.headers }); }; window.addEventListener("apivoy-open-request", listener); return () => window.removeEventListener("apivoy-open-request", listener); }, [externalRequest]);

  const headers = () => headerText.split("\n").filter(Boolean).map((line): [string, string] => {
    const index = line.indexOf(":");
    return index < 0 ? [line.trim(), ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  });
  const currentRequest = (nextQuery = query, nextVariables: unknown = JSON.parse(variables || "{}"), nextOperation = operationName || undefined): GraphqlWorkbenchRequest => ({ name: nextOperation || "GraphQL Request", url, query: nextQuery, variables: nextVariables, operationName: nextOperation, headers: headers() });
  useAutosaveDraft("graphql", currentRequest);

  async function send(nextQuery: string, nextVariables: unknown, nextOperation?: string) {
    return onSend(
      currentRequest(nextQuery, nextVariables, nextOperation),
      { onStarted: setRunningId, onChunk: (chunk) => setOutput((current) => current === "正在执行 GraphQL…" ? chunk : `${current}\n${chunk}`) },
    );
  }

  async function run() {
    let parsed: unknown;
    try { parsed = JSON.parse(variables || "{}"); }
    catch { setOutput("Variables 必须是合法 JSON"); return; }
    setBusy(true);
    setOutput("正在执行 GraphQL…");
    try {
      const result = await send(query, parsed, operationName || undefined);
      let value = result.preview ?? "";
      try { value = JSON.stringify(JSON.parse(value), null, 2); } catch { /* 保留原始响应 */ }
      setOutput(result.error ? `执行失败：${result.error}\n${value}` : value);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setRunningId(null);
    }
  }

  async function introspect() {
    setBusy(true);
    setOutput("正在读取 GraphQL Schema…");
    try {
      const result = await send(INTROSPECTION_QUERY, {}, "ApiVoyIntrospection");
      if (result.error) throw new Error(result.error);
      const parsed = JSON.parse(result.preview ?? "{}") as { data?: { __schema?: { types?: Array<{ name?: string }> } } };
      const names = (parsed.data?.__schema?.types ?? []).map((type) => type.name ?? "").filter((name) => name && !name.startsWith("__")).sort();
      setSchemaTypes(names);
      setOutput(JSON.stringify(parsed, null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setRunningId(null);
    }
  }

  return <section style={styles.root}>
    <div style={styles.title}>
      <div><small style={styles.eyebrow}>SCHEMA API</small><h2 style={styles.h2}>GraphQL</h2></div>
      <span style={styles.pill}>QUERY · MUTATION · SUBSCRIPTION</span>
    </div>
    <div style={styles.row}>
      <input style={styles.url} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="GraphQL endpoint" />
      <input style={styles.operation} value={operationName} onChange={(event) => setOperationName(event.target.value)} placeholder="operationName（可选）" />
      <button style={styles.run} disabled={busy} onClick={() => void run()}>{busy ? "执行中…" : "执行"}</button>
      <button style={styles.secondary} disabled={busy} onClick={() => void introspect()}>读取 Schema</button>
      {onSave && <button style={styles.secondary} disabled={busy} onClick={() => { try { void onSave(currentRequest()); } catch { setOutput("Variables 必须是合法 JSON"); } }}>保存</button>}
      <button style={styles.secondary} disabled={busy} onClick={() => setQuery("subscription Example {\n  event\n}")}>订阅示例</button>
      {runningId && <button style={styles.cancel} onClick={() => void onCancel(runningId)}>取消</button>}
    </div>
    <label style={styles.headers}>Headers（每行 Name: Value）<input style={styles.headerInput} value={headerText} onChange={(event) => setHeaderText(event.target.value)} placeholder="Authorization: Bearer {{token}}" /></label>
    {schemaTypes.length > 0 && <div style={styles.schema}>
      <strong style={styles.schemaTitle}>Schema Types <span>{schemaTypes.length}</span></strong>
      <div style={styles.schemaItems}>{schemaTypes.slice(0, 80).map((name) => <button style={styles.typeChip} key={name} onClick={() => setQuery((value) => `${value}\n# ${name}`)}>{name}</button>)}</div>
    </div>}
    <div style={styles.editors}>
      <label>Query<CodeEditor value={query} onChange={setQuery} language="graphql" height={210} /></label>
      <label>Variables<CodeEditor value={variables} onChange={setVariables} language="json" height={210} /></label>
    </div>
    <div style={styles.responseHead}><span>RESPONSE</span><span>{busy ? "LIVE" : "READY"}</span></div>
    <ProtocolCodeGenerator input={{ protocol: "graphql", request: currentRequest() }} />
    <pre style={styles.output}>{output}</pre>
  </section>;
}

const styles: Record<string, CSSProperties> = {
  root: { marginTop: 22, padding: 20, border: "1px solid var(--apivoy-border)", borderRadius: 16, background: "var(--apivoy-panel)", boxShadow: "0 18px 48px rgba(0,0,0,.18)" },
  title: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" }, eyebrow: { color: "#ef76c5", letterSpacing: 1.6, fontWeight: 700 }, h2: { margin: "4px 0 16px", fontSize: 20 }, pill: { alignSelf: "center", color: "#ef9bd2", fontSize: 10, border: "1px solid #683a5a", borderRadius: 999, padding: "5px 9px", background: "rgba(104,58,90,.16)" },
  row: { display: "flex", gap: 8, flexWrap: "wrap" }, url: { flex: "1 1 320px", minWidth: 0, background: "#090d14", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 9, padding: 11 }, operation: { width: 200, background: "#090d14", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 9, padding: 11 }, run: { border: 0, borderRadius: 9, background: "var(--apivoy-panel)", color: "#210817", fontWeight: 800, padding: "0 20px" }, secondary: { border: "1px solid #683a5a", borderRadius: 9, padding: "0 13px", background: "#211426", color: "#ef9bd2" }, cancel: { border: "1px solid #71434a", borderRadius: 9, background: "#2b171b", color: "#ff9ca8" },
  headers: { display: "grid", gap: 6, marginTop: 12, color: "var(--apivoy-muted)", fontSize: 11 }, headerInput: { background: "#090d14", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9 }, schema: { marginTop: 12, padding: 11, border: "1px solid #35263f", borderRadius: 10, background: "rgba(18,12,25,.7)" }, schemaTitle: { display: "flex", justifyContent: "space-between", color: "#ead9ee", fontSize: 12 }, schemaItems: { display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 95, overflow: "auto", marginTop: 9 }, typeChip: { border: "1px solid #50345c", borderRadius: 999, background: "#1d1424", color: "#d9b8df", padding: "4px 8px", fontSize: 11 },
  editors: { display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(220px,.6fr)", gap: 10, marginTop: 12, color: "var(--apivoy-muted)", fontSize: 11 }, editor: { boxSizing: "border-box", display: "block", width: "100%", minHeight: 175, marginTop: 6, resize: "vertical", background: "#080c12", color: "#dccfe8", border: "1px solid var(--apivoy-border)", borderRadius: 9, padding: 12, fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace", lineHeight: 1.55 }, responseHead: { display: "flex", justifyContent: "space-between", marginTop: 13, color: "#846f91", fontSize: 10, letterSpacing: 1.2 }, output: { minHeight: 100, maxHeight: 350, overflow: "auto", whiteSpace: "pre-wrap", background: "#070a0f", border: "1px solid var(--apivoy-border)", borderRadius: 9, padding: 12, color: "#cfe1ef", lineHeight: 1.5 },
};
