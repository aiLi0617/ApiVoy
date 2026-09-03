import { useEffect, useState } from "react";
import type { RequestEnvelope } from "@apivoy/request-model";
import { useQuery } from "@tanstack/react-query";
import { getGatewayKey, getGatewayUrl, setGatewayKey, setGatewayUrl, subscribePreferences } from "./userPreferences";
import { Button, StatusBadge, Textarea, TextInput } from "./Components";

type Job = { id: string; name: string; intervalSeconds: number; nextRunAt: string; enabled: boolean; lastExecutionId?: string | null };
type Execution = { id: string; source: string; success: boolean; startedAt: string; error?: string | null; summary?: { durationMs: number; protocolId: string; status?: number | null } | null };

function defaultRequest(): RequestEnvelope {
  return { id: crypto.randomUUID(), protocolId: "http", name: "Gateway health check", target: "https://example.com", environmentRef: null, authRef: null, timeoutMs: 30000, retryPolicy: { max_retries: 0, backoff_ms: 0 }, proxy: null, tls: { verify: true, client_cert_ref: null }, metadata: {}, payload: { type: "http", method: "GET", headers: [], body: null, multipart: [], followRedirects: true }, preScripts: [], postScripts: [], assertions: [], variables: {}, createdAt: new Date().toISOString() };
}

export function GatewayWorkbench() {
  const [baseUrl, setBaseUrl] = useState(() => getGatewayUrl());
  const [apiKey, setApiKey] = useState(() => getGatewayKey());
  const [requestText, setRequestText] = useState(() => JSON.stringify(defaultRequest(), null, 2));
  const [jobName, setJobName] = useState("Scheduled gateway check");
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [output, setOutput] = useState("配置 Gateway API Key 后可远程执行、创建定时任务或刷新历史。\nAPI Key 仅保留在当前浏览器会话中。");
  const [busy, setBusy] = useState(false);
  const jobsQuery = useQuery({ queryKey: ["gateway", baseUrl, apiKey, "jobs"], queryFn: () => call<Job[]>("/v1/jobs"), enabled: false, initialData: [] });
  const executionsQuery = useQuery({ queryKey: ["gateway", baseUrl, apiKey, "executions"], queryFn: () => call<Execution[]>("/v1/executions"), enabled: false, initialData: [] });
  const jobs = jobsQuery.data;
  const executions = executionsQuery.data;

  useEffect(() => { setGatewayUrl(baseUrl); setGatewayKey(apiKey); }, [baseUrl, apiKey]);
  useEffect(() => subscribePreferences((keys) => {
    if (keys.length === 0 || keys.includes("gatewayUrl")) setBaseUrl(getGatewayUrl());
    if (keys.length === 0 || keys.includes("gatewayKey")) setApiKey(getGatewayKey());
  }), []);
  async function call<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...init?.headers } }); const body = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? `Gateway HTTP ${response.status}`); return body as T; }
  function request() { return JSON.parse(requestText) as RequestEnvelope; }
  async function run(source: "remote" | "ci") { setBusy(true); try { const body = source === "ci" ? { request: request(), failOnAssertion: true } : request(); const result = await call<unknown>(source === "ci" ? "/v1/runner/execute" : "/v1/executions", { method: "POST", body: JSON.stringify(body) }); setOutput(JSON.stringify(result, null, 2)); await refresh(); } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function schedule() { setBusy(true); try { const result = await call<Job>("/v1/jobs", { method: "POST", body: JSON.stringify({ name: jobName, intervalSeconds, enabled: true, request: request() }) }); setOutput(`已创建定时任务 ${result.id}`); await refresh(); } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function refresh() { if (!apiKey) return; try { const results = await Promise.all([jobsQuery.refetch(), executionsQuery.refetch()]); const error = results.find((result: { error: Error | null }) => result.error)?.error; if (error) throw error; } catch (error) { setOutput(error instanceof Error ? error.message : String(error)); } }
  async function remove(id: string) { await call(`/v1/jobs/${id}`, { method: "DELETE" }); await refresh(); }

  return <section className="gateway-workbench"><header className="gateway-header"><div><small>REMOTE · SCHEDULED · CI</small><h2>云协议网关</h2><p>复用 ApiVoy 全协议内核，在受控服务中执行远程请求、周期任务与 CI 检查。</p></div><StatusBadge tone="success">BEARER AUTH</StatusBadge></header><div className="gateway-credentials"><label className="gateway-field">GATEWAY URL<TextInput value={baseUrl} onChange={event=>setBaseUrl(event.target.value)} /></label><label className="gateway-field">SESSION API KEY<TextInput type="password" value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder="至少 24 位" /></label><Button disabled={!apiKey||busy} onClick={()=>void refresh()}>刷新状态</Button></div><div className="gateway-grid"><div className="gateway-panel"><div className="gateway-panel-title"><h3>RequestEnvelope</h3><StatusBadge>JSON</StatusBadge></div><Textarea className="gateway-editor" value={requestText} onChange={event=>setRequestText(event.target.value)} spellCheck={false}/><div className="gateway-actions"><Button variant="primary" disabled={!apiKey||busy} onClick={()=>void run("remote")}>远程执行</Button><Button disabled={!apiKey||busy} onClick={()=>void run("ci")}>CI Runner</Button></div></div><div className="gateway-panel"><div className="gateway-panel-title"><h3>定时任务</h3><StatusBadge>{jobs.length} JOBS</StatusBadge></div><div className="gateway-schedule"><TextInput value={jobName} onChange={event=>setJobName(event.target.value)} /><label className="gateway-field">INTERVAL SECONDS<TextInput type="number" min={10} value={intervalSeconds} onChange={event=>setIntervalSeconds(Math.max(10,+event.target.value))}/></label><Button variant="primary" disabled={!apiKey||busy} onClick={()=>void schedule()}>创建任务</Button></div><div className="gateway-list">{jobs.map((job: Job)=><div className="gateway-item" key={job.id}><div><b>{job.name}</b><small>每 {job.intervalSeconds}s · 下次 {new Date(job.nextRunAt).toLocaleString()}</small></div><Button size="compact" variant="danger" onClick={()=>void remove(job.id)}>删除</Button></div>)}{jobs.length===0&&<div className="gateway-empty">暂无定时任务</div>}</div></div></div><div className="gateway-results"><div className="gateway-panel-title"><h3>网关输出与脱敏历史</h3><StatusBadge>{executions.length} RUNS</StatusBadge></div><div className="gateway-history">{executions.slice(0,8).map((item: Execution)=><div className="gateway-run" key={item.id}><span className={item.success?"is-success":"is-danger"}/><b>{item.source}</b><code>{item.summary?.protocolId??"failed"}</code><span>{item.summary?.durationMs??0} ms</span></div>)}</div><pre className="gateway-output">{output}</pre></div></section>;
}
