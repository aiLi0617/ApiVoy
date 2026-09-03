import { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "./Feedback";
import { Button, Checkbox, InlineAlert, Select, StatusBadge, Textarea, TextInput } from "./Components";

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
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  async function refresh() { setLoading(true); setLoadError(""); try { setRules(await onList()); } catch (error) { setLoadError(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); } }
  useEffect(() => { void refresh(); }, []);
  async function create() {
    try {
      await onCreate({ name, method, path, status, priority, headers: { "Content-Type": "application/json" }, body, delayMs, errorEvery: errorEvery || null, wsMessages: method === "WS" ? wsMessages.split("\n") : [], wsEcho: method === "WS" && wsEcho, wsIntervalMs });
      await refresh();
      setMessage("Mock 规则已创建");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  return <section className="mock-workbench">
    <div className="mock-title"><div><small>LOCAL SERVICE</small><h2>HTTP Mock</h2></div><StatusBadge tone="info">{baseUrl}/mock/*</StatusBadge></div>
    <div className="mock-form">
      <TextInput aria-label="Mock 规则名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="规则名称" />
      <Select aria-label="Mock 方法" value={method} onChange={(event) => setMethod(event.target.value)}><option>*</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>WS</option></Select>
      <TextInput aria-label="Mock 路径" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/path" />
      <label>状态<TextInput type="number" value={status} onChange={(event) => setStatus(+event.target.value)} /></label>
      <label>优先级<TextInput type="number" value={priority} onChange={(event) => setPriority(+event.target.value)} /></label>
      <label>延迟 ms<TextInput type="number" min={0} value={delayMs} onChange={(event) => setDelayMs(+event.target.value)} /></label>
      <label>每 N 次报错<TextInput type="number" min={0} value={errorEvery} onChange={(event) => setErrorEvery(+event.target.value)} /></label>
    </div>
    {method === "WS" ? <div className="mock-ws-options"><label>连接后消息（每行一帧）<Textarea value={wsMessages} onChange={(event) => setWsMessages(event.target.value)} /></label><Checkbox label="回显客户端 Text/Binary 帧" checked={wsEcho} onChange={(event) => setWsEcho(event.target.checked)} /><label>消息间隔 ms<TextInput type="number" min={0} value={wsIntervalMs} onChange={(event) => setWsIntervalMs(+event.target.value)} /></label><code>ws://127.0.0.1:39217/mock-ws{path}</code></div> : <Textarea aria-label="Mock 响应正文" className="mock-body" value={body} onChange={(event) => setBody(event.target.value)} />}
    <div className="mock-actions"><Button variant="primary" onClick={() => void create()}>创建规则</Button>{message && <span role="status">{message}</span>}</div>
    {loading ? <LoadingState label="正在加载 Mock 规则…"/> : loadError ? <InlineAlert tone="danger" title="Mock 规则加载失败"><span>{loadError}</span><Button onClick={() => void refresh()}>重试</Button></InlineAlert> : rules.length === 0 ? <EmptyState title="还没有 Mock 规则" description="创建后会显示在这里。"/> : <div className="mock-rules">{rules.map((rule) => <div key={rule.id} className="mock-rule"><b>{rule.method}</b><code>{rule.path}</code><span>{rule.status}</span><span>P{rule.priority}</span><span>{rule.delayMs}ms</span>{rule.method === "WS" ? <code>mock-ws</code> : <a href={`${baseUrl}/mock${rule.path}`} target="_blank" rel="noreferrer">访问</a>}<Button size="compact" variant="danger" onClick={async () => { await onDelete(rule.id); await refresh(); }}>删除</Button></div>)}</div>}
  </section>;
}
