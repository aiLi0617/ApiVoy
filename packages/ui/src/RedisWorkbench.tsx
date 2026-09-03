import { useState } from "react";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { ProtocolWorkbenchLayout } from "./ProtocolWorkbenchLayout";
import { Textarea, TextInput } from "./Components";
import { ProtocolField, ProtocolFormCard, ProtocolFormGrid } from "./ProtocolForm";
import { useWorkbenchHydration } from "./useWorkbenchHydration";

export interface RedisWorkbenchRequest {
  name: string;
  target: string;
  username: string;
  passwordRef: string;
  database: number;
  commands: string[][];
  timeoutMs: number;
}

export interface RedisWorkbenchProps {
  onSend: (request: RedisWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onSave?: (request: RedisWorkbenchRequest) => Promise<void>;
  onCancel?: (executionId: string) => Promise<void>;
}

function tokenize(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quote = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) { value += character === "n" ? "\n" : character === "r" ? "\r" : character === "t" ? "\t" : character; escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ""; else value += character; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/.test(character)) { if (value) { values.push(value); value = ""; } } else value += character;
  }
  if (escaped || quote) throw new Error("命令中存在未结束的转义或引号");
  if (value) values.push(value);
  return values;
}

function quoteArgument(value: string) {
  return /\s|["'\\]/.test(value) ? JSON.stringify(value) : value;
}

export function RedisWorkbench({ onSend, onSave, onCancel }: RedisWorkbenchProps) {
  const [name, setName] = useState("Redis request");
  const [target, setTarget] = useState("redis://127.0.0.1:6379");
  const [username, setUsername] = useState("");
  const [passwordRef, setPasswordRef] = useState("");
  const [database, setDatabase] = useState(0);
  const [commands, setCommands] = useState("PING\nSET greeting \"hello world\"\nGET greeting");
  const [result, setResult] = useState<HttpRunResult | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);

  useWorkbenchHydration("redis", (detail) => {
      const envelope = detail as { protocolId?: string; name?: string; target?: string; payload?: { type?: string; value?: Partial<RedisWorkbenchRequest> } & Partial<RedisWorkbenchRequest> };
      if (envelope?.protocolId !== "redis" || envelope.payload?.type !== "raw") return;
      const raw = envelope.payload.value ?? envelope.payload;
      setName(envelope.name ?? ""); setTarget(envelope.target ?? ""); setUsername(raw.username ?? "");
      setPasswordRef(raw.passwordRef ?? ""); setDatabase(raw.database ?? 0);
      setCommands((raw.commands ?? []).map((command: string[]) => command.map(quoteArgument).join(" ")).join("\n"));
  });

  function buildRequest(): RedisWorkbenchRequest {
    const parsed = commands.split("\n").map((line) => line.trim()).filter(Boolean).map(tokenize);
    if (!parsed.length || parsed.some((command) => !command.length)) throw new Error("至少输入一条 Redis 命令");
    return { name, target, username, passwordRef, database, commands: parsed, timeoutMs: 30_000 };
  }

  async function send() {
    setLoading(true); setResult(null); setMessage("");
    try { setResult(await onSend(buildRequest(), { onStarted: setExecutionId, onChunk: () => {} })); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); setExecutionId(null); }
  }

  async function save() {
    if (!onSave) return;
    try { await onSave(buildRequest()); setMessage("已保存到集合"); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  return <ProtocolWorkbenchLayout id="redis" protocol="REDIS" name={name} target={target} targetLabel="Redis 地址" actionLabel="Run pipeline" loadingLabel="执行中…" loading={loading} result={result} responseTitle="Pipeline response" emptyResponse="每条命令的 RESP 响应会按顺序显示在这里" message={message} onNameChange={setName} onTargetChange={setTarget} onRun={() => void send()} onSave={onSave ? () => void save() : undefined} onCancel={onCancel && executionId ? () => void onCancel(executionId) : undefined}>
      <ProtocolFormCard>
        <ProtocolFormGrid className="redis-credentials"><ProtocolField label="ACL USERNAME"><TextInput value={username} onChange={(event) => setUsername(event.target.value)} placeholder="default" /></ProtocolField><ProtocolField label="PASSWORD SECRET REF"><TextInput value={passwordRef} onChange={(event) => setPasswordRef(event.target.value)} placeholder="redis-password" /></ProtocolField><ProtocolField label="DATABASE"><TextInput type="number" min={0} value={database} onChange={(event) => setDatabase(Math.max(0, Number(event.target.value)))} /></ProtocolField></ProtocolFormGrid>
        <ProtocolField label="COMMANDS · ONE PER LINE"><Textarea className="protocol-code-textarea redis-command-editor" spellCheck={false} value={commands} onChange={(event) => setCommands(event.target.value)} /></ProtocolField>
        <div className="protocol-form-hint">空格参数可使用单引号、双引号或反斜杠</div>
      </ProtocolFormCard>
  </ProtocolWorkbenchLayout>;
}
