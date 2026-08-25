import { useState } from "react";
import { Icon } from "./Icons";
import type { HttpWorkbenchRequest } from "./HttpWorkbench";

export interface HttpResponseViewResult {
  passed?: boolean;
  error?: string;
  status?: number | null;
  durationMs?: number;
  body?: string | null;
  headers?: Array<[string, string]>;
}

type RequestTab = "params" | "body" | "headers" | "auth" | "pre" | "post" | "settings";

export function HttpRequestResponseView({ request, result, loadingLabel = "正在加载用例…" }: { request: HttpWorkbenchRequest | null; result?: HttpResponseViewResult; loadingLabel?: string }) {
  const [activeTab, setActiveTab] = useState<RequestTab>("body");
  const query = (() => { try { return [...new URL(request?.url ?? "", "http://apivoy.local").searchParams.entries()]; } catch { return []; } })();
  const content: Record<RequestTab, string> = {
    params: query.length ? query.map(([key, value]) => `${key}: ${value}`).join("\n") : "当前请求没有 Query 参数",
    body: request?.body || "当前请求没有 Body",
    headers: request?.headers.length ? request.headers.map(([key, value]) => `${key}: ${value}`).join("\n") : "当前请求没有 Headers",
    auth: request?.auth ? JSON.stringify(request.auth, null, 2) : "当前请求没有鉴权配置",
    pre: request?.preScripts?.length ? request.preScripts.join("\n\n") : "当前请求没有前置操作",
    post: request?.postScripts?.length ? request.postScripts.join("\n\n") : "当前请求没有后置操作",
    settings: request ? `超时: ${request.timeoutMs} ms\n重试: ${request.retryMax} 次\n跟随重定向: ${request.followRedirects ? "是" : "否"}\nTLS 校验: ${request.tlsVerify ? "开启" : "关闭"}` : loadingLabel,
  };
  const tabs = [["params","Params"],["body","Body"],["headers","Headers"],["auth","Auth"],["pre","前置操作"],["post","后置操作"],["settings","设置"]] as const;
  return <div className="interface-case-inline-preview http-shared-request-view"><header><code><b>{request?.method ?? "HTTP"}</b>{request?.url ?? loadingLabel}</code></header><div className="interface-case-preview-split"><section><nav>{tabs.map(([id,label]) => <button key={id} type="button" className={activeTab === id ? "is-active" : ""} onClick={() => setActiveTab(id)}>{label}</button>)}</nav><div className="interface-case-preview-editor"><span>{activeTab === "body" ? "JSON" : tabs.find(([id]) => id === activeTab)?.[1]}</span><pre>{content[activeTab]}</pre></div></section><section><header><strong>返回响应</strong><span>{result ? `${result.status ?? "—"} · ${result.durationMs ?? 0} ms` : "尚未运行"}</span></header>{result ? <div className="interface-case-preview-result"><div>{result.headers?.map(([key,value], index) => <span key={`${key}-${index}`}><b>{key}</b><code>{value}</code></span>)}</div><pre>{result.error || result.body || "响应正文为空"}</pre></div> : <div className="interface-case-preview-response"><Icon name="send"/><span>运行请求后将在这里显示真实响应</span></div>}</section></div></div>;
}
