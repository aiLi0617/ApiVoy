import { useState, type CSSProperties } from "react";
import { EmptyState } from "./Feedback";

export interface CollectionRunCase { requestId: string; name: string; protocolId: string; passed: boolean; status?: number | null; durationMs: number; error?: string | null; failedAssertions: string[] }
export interface CollectionRunnerProps { collectionId: string; onRun: (collectionId: string, failFast: boolean) => Promise<CollectionRunCase[]> }

export function CollectionRunner({ collectionId, onRun }: CollectionRunnerProps) {
  const [failFast, setFailFast] = useState(false);
  const [running, setRunning] = useState(false);
  const [cases, setCases] = useState<CollectionRunCase[]>([]);
  const [error, setError] = useState("");
  async function run() { setRunning(true); setError(""); try { setCases(await onRun(collectionId, failFast)); } catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setRunning(false); } }
  const passed = cases.filter((item) => item.passed).length;
  return <section style={styles.root}><div style={styles.header}><div><small style={styles.eyebrow}>COLLECTION RUNNER</small><h2 style={styles.h2}>集合运行报告</h2></div><label><input type="checkbox" checked={failFast} onChange={(event) => setFailFast(event.target.checked)} />失败即停</label><button style={styles.run} disabled={running || !collectionId} onClick={() => void run()}>{running ? "运行中…" : "运行当前集合"}</button></div>{error && <div style={styles.error}>{error}</div>}{cases.length === 0 && !running && !error ? <EmptyState title="尚未运行" description="选择集合后点击运行，报告会出现在这里。" /> : null}{cases.length > 0 && <><div style={styles.summary}>{passed}/{cases.length} 通过 · {cases.reduce((sum, item) => sum + item.durationMs, 0)} ms</div><div>{cases.map((item) => <div key={item.requestId} style={styles.case}><b style={{ color: item.passed ? "#65d6a6" : "#ff8d9a" }}>{item.passed ? "PASS" : "FAIL"}</b><span>{item.protocolId}</span><strong>{item.name}</strong><span>{item.status ?? "—"}</span><span>{item.durationMs} ms</span><small>{item.error ?? item.failedAssertions.join(", ")}</small></div>)}</div></> }</section>;
}

const styles: Record<string, CSSProperties> = { root: { marginTop: 22, padding: 18, border: "1px solid var(--apivoy-border)", borderRadius: 14, background: "#0b1513" }, header: { display: "flex", gap: 14, alignItems: "center" }, eyebrow: { color: "#65d6a6", letterSpacing: 1.4 }, h2: { margin: "3px 0 10px", fontSize: 18 }, run: { marginLeft: "auto", border: 0, borderRadius: 8, padding: "9px 14px", background: "#65d6a6", color: "#061711", fontWeight: 700 }, summary: { margin: "10px 0", color: "var(--apivoy-muted)" }, case: { display: "grid", gridTemplateColumns: "50px 80px 1fr 55px 70px 1fr", gap: 8, borderTop: "1px solid var(--apivoy-border)", padding: "7px 0", alignItems: "center", fontSize: 11 }, error: { color: "#ff8d9a" } };
