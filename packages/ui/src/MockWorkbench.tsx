import { useEffect, useState, type CSSProperties } from "react";

export interface MockRule {
  id: string;
  name: string;
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  delayMs: number;
  errorEvery?: number | null;
  priority: number;
  wsMessages: string[];
  wsEcho: boolean;
  wsIntervalMs: number;
}

export interface MockWorkbenchProps {
  baseUrl: string;
  onList: () => Promise<MockRule[]>;
  onCreate: (rule: Omit<MockRule, "id">) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function MockWorkbench({ baseUrl, onList, onCreate, onDelete }: MockWorkbenchProps) {
  const [rules, setRules] = useState<MockRule[]>([]);
  const [name, setName] = useState("Example mock");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/example");
  const [status, setStatus] = useState(200);
  const [priority, setPriority] = useState(0);
  const [body, setBody] = useState('{"ok":true}');
  const [delayMs, setDelayMs] = useState(0);
  const [errorEvery, setErrorEvery] = useState(0);
  const [wsMessages, setWsMessages] = useState("connected");
  const [wsEcho, setWsEcho] = useState(true);
  const [wsIntervalMs, setWsIntervalMs] = useState(250);
  const [message, setMessage] = useState("");
  async function refresh() { setRules(await onList()); }
  useEffect(() => { void refresh().catch(() => setRules([])); }, []);
  async function create() {
    try {
      await onCreate({ name, method, path, status, priority, headers: { "Content-Type": "application/json" }, body, delayMs, errorEvery: errorEvery || null, wsMessages: method === "WS" ? wsMessages.split("\n") : [], wsEcho: method === "WS" && wsEcho, wsIntervalMs });
      await refresh();
      setMessage("Mock 规则已创建");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  return <section style={styles.root}>
    <div style={styles.title}><div><small style={styles.eyebrow}>LOCAL SERVICE</small><h2 style={styles.h2}>HTTP Mock</h2></div><code>{baseUrl}/mock/*</code></div>
    <div style={styles.form}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="规则名称" />
      <select value={method} onChange={(event) => setMethod(event.target.value)}><option>*</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>WS</option></select>
      <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/path" />
      <label>状态<input type="number" value={status} onChange={(event) => setStatus(+event.target.value)} /></label>
      <label>优先级<input type="number" value={priority} onChange={(event) => setPriority(+event.target.value)} /></label>
      <label>延迟 ms<input type="number" min={0} value={delayMs} onChange={(event) => setDelayMs(+event.target.value)} /></label>
      <label>每 N 次报错<input type="number" min={0} value={errorEvery} onChange={(event) => setErrorEvery(+event.target.value)} /></label>
    </div>
    {method === "WS" ? <div style={styles.wsOptions}><label>连接后消息（每行一帧）<textarea style={styles.body} value={wsMessages} onChange={(event) => setWsMessages(event.target.value)} /></label><label><input type="checkbox" checked={wsEcho} onChange={(event) => setWsEcho(event.target.checked)} />回显客户端 Text/Binary 帧</label><label>消息间隔 ms<input type="number" min={0} value={wsIntervalMs} onChange={(event) => setWsIntervalMs(+event.target.value)} /></label><code>ws://127.0.0.1:39217/mock-ws{path}</code></div> : <textarea style={styles.body} value={body} onChange={(event) => setBody(event.target.value)} />}
    <button style={styles.create} onClick={() => void create()}>创建规则</button>{message && <span style={styles.message}>{message}</span>}
    <div style={styles.rules}>{rules.map((rule) => <div key={rule.id} style={styles.rule}><b>{rule.method}</b><code>{rule.path}</code><span>{rule.status}</span><span>P{rule.priority}</span><span>{rule.delayMs}ms</span>{rule.method === "WS" ? <code>mock-ws</code> : <a href={`${baseUrl}/mock${rule.path}`} target="_blank" rel="noreferrer">访问</a>}<button onClick={async () => { await onDelete(rule.id); await refresh(); }}>删除</button></div>)}</div>
  </section>;
}

const styles: Record<string, CSSProperties> = {
  root: { marginTop: 22, padding: 18, border: "1px solid var(--apivoy-border)", borderRadius: 14, background: "#11120e" },
  title: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { color: "#d9c55f", letterSpacing: 1.4 }, h2: { margin: "3px 0 14px", fontSize: 18 },
  form: { display: "grid", gridTemplateColumns: "1fr 80px 1fr repeat(4, minmax(85px, .5fr))", gap: 7 },
  body: { boxSizing: "border-box", width: "100%", minHeight: 70, marginTop: 8, background: "#0a0c09", color: "#e0ddc7", border: "1px solid var(--apivoy-border)", borderRadius: 8, padding: 9 },
  create: { marginTop: 8, border: 0, borderRadius: 7, background: "#d7c45c", color: "#1c1908", fontWeight: 700, padding: "8px 13px" },
  message: { marginLeft: 10, color: "var(--apivoy-muted)", fontSize: 11 }, rules: { display: "grid", gap: 5, marginTop: 13 },
  wsOptions: { display: "flex", gap: 12, alignItems: "center", marginTop: 8, color: "var(--apivoy-muted)", fontSize: 11 },
  rule: { display: "grid", gridTemplateColumns: "70px 1fr 55px 50px 70px 45px 55px", gap: 8, alignItems: "center", borderTop: "1px solid var(--apivoy-border)", paddingTop: 7, fontSize: 11 },
};
