import { useState } from "react";
import { EmptyState } from "./Feedback";
import { Button, Checkbox, InlineAlert, StatusBadge } from "./Components";

export interface CollectionRunCase { requestId: string; name: string; protocolId: string; passed: boolean; status?: number | null; durationMs: number; error?: string | null; failedAssertions: string[] }
export interface CollectionRunnerProps { collectionId: string; onRun: (collectionId: string, failFast: boolean) => Promise<CollectionRunCase[]> }

export function CollectionRunner({ collectionId, onRun }: CollectionRunnerProps) {
  const [failFast, setFailFast] = useState(false);
  const [running, setRunning] = useState(false);
  const [cases, setCases] = useState<CollectionRunCase[]>([]);
  const [error, setError] = useState("");
  async function run() { setRunning(true); setError(""); try { setCases(await onRun(collectionId, failFast)); } catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setRunning(false); } }
  const passed = cases.filter((item) => item.passed).length;
  return <section className="collection-runner"><div className="collection-runner-header"><div><small>COLLECTION RUNNER</small><h2>集合运行报告</h2></div><Checkbox label="失败即停" checked={failFast} onChange={(event) => setFailFast(event.target.checked)} /><Button variant="primary" loading={running} disabled={!collectionId} onClick={() => void run()}>运行当前集合</Button></div>{error && <InlineAlert tone="danger" title="运行失败">{error}</InlineAlert>}{cases.length === 0 && !running && !error ? <EmptyState title="尚未运行" description="选择集合后点击运行，报告会出现在这里。" /> : null}{cases.length > 0 && <><div className="collection-runner-summary">{passed}/{cases.length} 通过 · {cases.reduce((sum, item) => sum + item.durationMs, 0)} ms</div><div>{cases.map((item) => <div key={item.requestId} className="collection-runner-case"><StatusBadge tone={item.passed ? "success" : "danger"}>{item.passed ? "PASS" : "FAIL"}</StatusBadge><span>{item.protocolId}</span><strong>{item.name}</strong><span>{item.status ?? "—"}</span><span>{item.durationMs} ms</span><small>{item.error ?? item.failedAssertions.join(", ")}</small></div>)}</div></> }</section>;
}
