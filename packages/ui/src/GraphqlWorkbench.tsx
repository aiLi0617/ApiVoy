import { useEffect, useState } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { CodeEditor } from "./CodeEditor";
import { ProtocolCodeGenerator } from "./ProtocolCodeGenerator";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";
import { useWorkbenchHydration } from "./useWorkbenchHydration";
import { Button, StatusBadge, TextInput } from "./Components";

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
  useEffect(() => {
    const apply = (value: GraphqlWorkbenchRequest) => {
      setUrl(value.url);
      setQuery(value.query);
      setVariables(JSON.stringify(value.variables ?? {}, null, 2));
      setOperationName(value.operationName ?? "");
      setHeaderText(value.headers.map(([name, item]) => `${name}: ${item}`).join("\n"));
    };
    if (externalRequest) apply(externalRequest);
    else {
      const draft = readWorkbenchDraft<GraphqlWorkbenchRequest>("graphql");
      if (draft) apply(draft);
    }
  }, [externalRequest]);
  useWorkbenchHydration("graphql", (envelope) => {
    const detail = envelope as { name?: string; target?: string; payload?: { type?: string; query?: string; variables?: unknown; operationName?: string | null; headers?: Array<[string, string]> } };
    if (detail?.payload?.type !== "graphql") return;
    setUrl(detail.target ?? "https://");
    setQuery(detail.payload.query ?? "");
    setVariables(JSON.stringify(detail.payload.variables ?? {}, null, 2));
    setOperationName(detail.payload.operationName ?? "");
    setHeaderText((detail.payload.headers ?? []).map(([name, item]) => `${name}: ${item}`).join("\n"));
  });

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

  return <section className="graphql-workbench">
    <div className="legacy-workbench-hero graphql-title">
      <div><small>SCHEMA API</small><h2>GraphQL</h2></div>
      <StatusBadge tone="info">QUERY · MUTATION · SUBSCRIPTION</StatusBadge>
    </div>
    <div className="graphql-commandbar">
      <TextInput aria-label="GraphQL Endpoint" className="graphql-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="GraphQL endpoint" />
      <TextInput aria-label="GraphQL Operation Name" className="graphql-operation" value={operationName} onChange={(event) => setOperationName(event.target.value)} placeholder="operationName（可选）" />
      <Button variant="primary" loading={busy} onClick={() => void run()}>执行</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void introspect()}>读取 Schema</Button>
      {onSave && <Button variant="secondary" disabled={busy} onClick={() => { try { void onSave(currentRequest()); } catch { setOutput("Variables 必须是合法 JSON"); } }}>保存</Button>}
      <Button variant="secondary" disabled={busy} onClick={() => setQuery("subscription Example {\n  event\n}")}>订阅示例</Button>
      {runningId && <Button variant="danger" onClick={() => void onCancel(runningId)}>取消</Button>}
    </div>
    <label className="graphql-headers">Headers（每行 Name: Value）<TextInput value={headerText} onChange={(event) => setHeaderText(event.target.value)} placeholder="Authorization: Bearer {{token}}" /></label>
    {schemaTypes.length > 0 && <div className="graphql-schema">
      <strong>Schema Types <span>{schemaTypes.length}</span></strong>
      <div>{schemaTypes.slice(0, 80).map((name) => <button type="button" key={name} onClick={() => setQuery((value) => `${value}\n# ${name}`)}>{name}</button>)}</div>
    </div>}
    <div className="graphql-editors">
      <label>Query<CodeEditor value={query} onChange={setQuery} language="graphql" height={210} /></label>
      <label>Variables<CodeEditor value={variables} onChange={setVariables} language="json" height={210} /></label>
    </div>
    <div className="graphql-response-head"><span>RESPONSE</span><span>{busy ? "LIVE" : "READY"}</span></div>
    <ProtocolCodeGenerator input={{ protocol: "graphql", request: currentRequest() }} />
    <pre className="graphql-output">{output}</pre>
  </section>;
}
