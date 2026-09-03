import { useState } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { Checkbox, Textarea, TextInput } from "./Components";
import { ProtocolField, ProtocolFormCard, ProtocolFormGrid, ProtocolFormOptions } from "./ProtocolForm";
import { ProtocolWorkbenchLayout } from "./ProtocolWorkbenchLayout";
import { useWorkbenchHydration } from "./useWorkbenchHydration";

export interface SqlWorkbenchRequest { name: string; target: string; username: string; passwordRef: string; sql: string; parameters: unknown[]; transactional: boolean; rowLimit: number; timeoutMs: number }
export interface SqlWorkbenchProps { onSend: (request: SqlWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>; onSave?: (request: SqlWorkbenchRequest) => Promise<void>; onCancel?: (executionId: string) => Promise<void> }

export function SqlWorkbench({ onSend, onSave, onCancel }: SqlWorkbenchProps) {
  const [name, setName] = useState("SQL query"); const [target, setTarget] = useState("sqlite::memory:");
  const [username, setUsername] = useState(""); const [passwordRef, setPasswordRef] = useState("");
  const [sql, setSql] = useState("SELECT 42 AS answer"); const [parameters, setParameters] = useState("[]");
  const [transactional, setTransactional] = useState(false); const [rowLimit, setRowLimit] = useState(500);
  const [result, setResult] = useState<HttpRunResult | null>(null); const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false); const [executionId, setExecutionId] = useState<string | null>(null);

  useWorkbenchHydration("sql", (detail) => {
    const envelope = detail as { protocolId?: string; name?: string; target?: string; payload?: { type?: string; value?: Partial<SqlWorkbenchRequest> } & Partial<SqlWorkbenchRequest> };
    if (envelope.protocolId !== "sql" || envelope.payload?.type !== "raw") return;
    const value = envelope.payload.value ?? envelope.payload;
    setName(envelope.name ?? ""); setTarget(envelope.target ?? ""); setUsername(value.username ?? "");
    setPasswordRef(value.passwordRef ?? ""); setSql(value.sql ?? ""); setParameters(JSON.stringify(value.parameters ?? [], null, 2));
    setTransactional(value.transactional ?? false); setRowLimit(value.rowLimit ?? 500);
  });

  const build = (): SqlWorkbenchRequest => { const parsed = JSON.parse(parameters || "[]"); if (!Array.isArray(parsed)) throw new Error("参数必须是 JSON 数组"); return { name, target, username, passwordRef, sql, parameters: parsed, transactional, rowLimit, timeoutMs: 30_000 }; };
  async function run() { setLoading(true); setResult(null); setMessage(""); try { setResult(await onSend(build(), { onStarted: setExecutionId, onChunk: () => {} })); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); setExecutionId(null); } }
  async function save() { if (!onSave) return; try { await onSave(build()); setMessage("已保存到集合"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  const engine = target.startsWith("postgres") ? "PostgreSQL" : target.startsWith("mysql") ? "MySQL" : "SQLite";

  return <ProtocolWorkbenchLayout id="sql" protocol={engine.toUpperCase()} name={name} target={target} targetLabel="数据库连接地址" actionLabel="Run query" loadingLabel="执行中…" loading={loading} result={result} responseTitle="Result set" emptyResponse="列、结果行、影响行数与插入 ID 会显示在这里" message={message} onNameChange={setName} onTargetChange={setTarget} onRun={() => void run()} onSave={onSave ? () => void save() : undefined} onCancel={onCancel && executionId ? () => void onCancel(executionId) : undefined}>
    <ProtocolFormCard>
      <ProtocolFormGrid className="sql-credentials"><ProtocolField label="USERNAME"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} disabled={engine === "SQLite"}/></ProtocolField><ProtocolField label="PASSWORD SECRET REF"><TextInput value={passwordRef} onChange={(event) => setPasswordRef(event.target.value)} disabled={engine === "SQLite"}/></ProtocolField><ProtocolField label="ROW LIMIT"><TextInput type="number" min={1} max={10_000} value={rowLimit} onChange={(event) => setRowLimit(Math.max(1, Math.min(10_000, Number(event.target.value))))}/></ProtocolField></ProtocolFormGrid>
      <ProtocolField label="SQL"><Textarea className="protocol-code-textarea" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false}/></ProtocolField>
      <ProtocolField label="PARAMETERS · JSON ARRAY"><Textarea className="sql-parameters" value={parameters} onChange={(event) => setParameters(event.target.value)} spellCheck={false}/></ProtocolField>
      <ProtocolFormOptions><Checkbox label="Execute in transaction" checked={transactional} onChange={(event) => setTransactional(event.target.checked)}/></ProtocolFormOptions>
    </ProtocolFormCard>
  </ProtocolWorkbenchLayout>;
}
