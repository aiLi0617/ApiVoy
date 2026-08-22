import { useEffect, useState, type CSSProperties } from "react";
import { consumeHydrate } from "./openRequestPipeline";
import type { HttpRunResult, HttpSendHooks } from "./HttpWorkbench";
import { ProtocolWorkbenchLayout } from "./ProtocolWorkbenchLayout";

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

  useEffect(() => {
    const listener = (event: Event) => {
      const envelope = (event as CustomEvent).detail;
      if (envelope?.protocolId !== "redis" || envelope.payload?.type !== "raw") return;
      const raw = envelope.payload.value ?? envelope.payload;
      setName(envelope.name); setTarget(envelope.target); setUsername(raw.username ?? "");
      setPasswordRef(raw.passwordRef ?? ""); setDatabase(raw.database ?? 0);
      setCommands((raw.commands ?? []).map((command: string[]) => command.map(quoteArgument).join(" ")).join("\n"));
    };
    const pending = consumeHydrate("redis");
    if (pending) listener(new CustomEvent("apivoy-open-request", { detail: pending.envelope }) as Event);
    const onHydrate = (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (d?.workbenchId !== "redis") return;
      listener(new CustomEvent("apivoy-open-request", { detail: d.envelope }) as Event);
    };
    window.addEventListener("apivoy-open-request", listener);
    window.addEventListener("apivoy-hydrate-request", onHydrate);
    return () => {
      window.removeEventListener("apivoy-open-request", listener);
      window.removeEventListener("apivoy-hydrate-request", onHydrate);
    };
  }, []);

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
      <div style={styles.card}>
        <div style={styles.credentials}><label style={styles.label}>ACL USERNAME<input style={styles.input} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="default" /></label><label style={styles.label}>PASSWORD SECRET REF<input style={styles.input} value={passwordRef} onChange={(event) => setPasswordRef(event.target.value)} placeholder="redis-password" /></label><label style={styles.label}>DATABASE<input style={styles.input} type="number" min={0} value={database} onChange={(event) => setDatabase(Math.max(0, Number(event.target.value)))} /></label></div>
        <label style={styles.label}>COMMANDS · ONE PER LINE<textarea style={styles.editor} spellCheck={false} value={commands} onChange={(event) => setCommands(event.target.value)} /></label>
        <div style={styles.actions}><span style={styles.hint}>空格参数可使用单引号、双引号或反斜杠</span></div>
      </div>
  </ProtocolWorkbenchLayout>;
}

const styles: Record<string, CSSProperties> = {
  root: { padding: 22, border: "1px solid var(--apivoy-border)", borderRadius: 18, background: "var(--apivoy-panel)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }, eyebrow: { color: "#ff7772", letterSpacing: 2, fontWeight: 800, fontSize: 10 }, title: { fontSize: 27, margin: "5px 0 2px" }, subtitle: { margin: 0, color: "var(--apivoy-muted)", fontSize: 12 }, badge: { border: "1px solid rgba(255,119,114,.35)", color: "#ffaaa6", borderRadius: 999, padding: "6px 10px", fontSize: 10, fontWeight: 800 },
  targetRow: { display: "grid", gridTemplateColumns: "170px 1fr auto auto", gap: 8, marginBottom: 12 }, name: { border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 10, background: "#080d13", color: "var(--apivoy-text)" }, target: { border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 10, background: "#080d13", color: "#ffd0ce", fontFamily: "var(--apivoy-mono)" }, send: { border: 0, borderRadius: 8, padding: "10px 16px", background: "var(--apivoy-panel)", color: "white", fontWeight: 800, cursor: "pointer" }, cancel: { border: "1px solid #744", borderRadius: 8, background: "#281416", color: "#ffc4c1" },
  grid: { display: "grid", gridTemplateColumns: "minmax(430px,1.1fr) minmax(360px,.9fr)", gap: 12 }, card: { border: "1px solid var(--apivoy-border)", borderRadius: 12, padding: 14, background: "rgba(4,8,12,.5)" }, credentials: { display: "grid", gridTemplateColumns: "1fr 1.3fr 100px", gap: 8 }, label: { display: "grid", gap: 6, color: "var(--apivoy-muted)", fontSize: 10, fontWeight: 750, marginBottom: 10 }, input: { width: "100%", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9, background: "#070c12", color: "var(--apivoy-text)" }, editor: { width: "100%", minHeight: 270, resize: "vertical", border: "1px solid var(--apivoy-border)", borderRadius: 9, padding: 12, background: "#05090e", color: "#f4d1cf", fontFamily: "var(--apivoy-mono)", lineHeight: 1.65 }, actions: { display: "flex", alignItems: "center", justifyContent: "space-between" }, secondary: { border: "1px solid rgba(255,119,114,.35)", borderRadius: 8, background: "rgba(255,119,114,.08)", color: "#ffc6c3", padding: "9px 12px", cursor: "pointer" }, hint: { color: "var(--apivoy-muted)", fontSize: 10 }, response: { border: "1px solid var(--apivoy-border)", borderRadius: 12, background: "#05090d", overflow: "hidden" }, responseHeader: { display: "flex", justifyContent: "space-between", padding: 12, borderBottom: "1px solid var(--apivoy-border)", color: "#e9eff5" }, preview: { margin: 0, padding: 14, whiteSpace: "pre-wrap", overflow: "auto", color: "#bcd9d0", minHeight: 330 }, notice: { marginTop: 12, borderLeft: "3px solid #e24540", padding: "10px 13px", background: "rgba(226,69,64,.08)" },
};
