import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  Assertion,
  AssertionResultEvent,
  AuthRef,
  ExecutionSummary,
  ExecutionEvent,
  MultipartPart,
  ResponseMeta,
  RequestEnvelope,
} from "@apivoy/request-model";
import { CodeGenerator } from "./CodeGenerator";
import { Icon } from "./Icons";
import { CodeEditor } from "./CodeEditor";
import { SplitPane, WorkbenchFrame } from "./WorkbenchFrame";
import { VirtualList } from "./VirtualList";
import { readWorkbenchDraft, useAutosaveDraft } from "./draftRecovery";

export type AuthKind = "none" | "bearer" | "basic" | "api_key" | "oauth2_client_credentials" | "oauth2_authorization_code";

export interface HttpWorkbenchRequest {
  name?: string;
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: string;
  multipart?: MultipartPart[];
  timeoutMs: number;
  variables: Record<string, string>;
  assertions: Assertion[];
  auth?: AuthRef | null;
  followRedirects: boolean;
  retryMax: number;
  retryBackoffMs: number;
  proxy?: string | null;
  tlsVerify: boolean;
  tlsClientCertRef?: string | null;
  preScripts?: string[];
  postScripts?: string[];
}

export interface HttpRunResult {
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
  error?: string;
  executionId?: string;
  assertions?: AssertionResultEvent[];
  responseMeta?: ResponseMeta | null;
}

export interface HttpSendHooks {
  /** Called as soon as the execution id is known (before streaming completes). */
  onStarted?: (executionId: string) => void;
  onChunk?: (preview: string) => void;
  onEvent?: (event: ExecutionEvent) => void;
}

export interface HistoryItem {
  id: string;
  protocolId: string;
  state: string;
  status?: number | null;
  durationMs: number;
  startedAt: string;
  target?: string;
  preview?: string | null;
}

export interface HistoryFilter {
  state?: string;
  status?: number;
  protocolId?: string;
  requestId?: string;
}

export interface HttpWorkbenchProps {
  onSend: (request: HttpWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onCancel?: (executionId: string) => Promise<void>;
  onSave?: (request: HttpWorkbenchRequest) => Promise<void>;
  onLoad?: () => Promise<HttpWorkbenchRequest | null>;
  onLoadEnvironment?: () => Promise<{ variables: Record<string, string>; secretRefs: string[] }>;
  onSaveEnvironment?: (
    variables: Record<string, string>,
    secretRefs: string[],
  ) => Promise<void>;
  onPutSecret?: (name: string, value: string) => Promise<void>;
  onListCookies?: (url: string) => Promise<Array<{ name: string; value: string }>>;
  onSetCookie?: (url: string, name: string, value: string) => Promise<void>;
  onDeleteCookie?: (url: string, name: string) => Promise<void>;
  onListHistory?: (filter?: HistoryFilter) => Promise<HistoryItem[]>;
  onReplayHistory?: (id: string) => Promise<HttpWorkbenchRequest | RequestEnvelope | null>;
  externalRequest?: HttpWorkbenchRequest | null;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function shellTokens(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source.replace(/\\\r?\n/g, " ")))) {
    tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["\\])/g, "$1"));
  }
  return tokens;
}

function parseCurl(source: string): Partial<HttpWorkbenchRequest> {
  const tokens = shellTokens(source.trim());
  if (tokens[0]?.toLowerCase() !== "curl") {
    throw new Error("请输入以 curl 开头的命令");
  }
  let method = "GET";
  let url = "";
  let body: string | undefined;
  const headers: Array<[string, string]> = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "-X" || token === "--request") {
      method = (tokens[++i] ?? "GET").toUpperCase();
    } else if (token === "-H" || token === "--header") {
      const value = tokens[++i] ?? "";
      const split = value.indexOf(":");
      if (split > 0) headers.push([value.slice(0, split).trim(), value.slice(split + 1).trim()]);
    } else if (["-d", "--data", "--data-raw", "--data-binary"].includes(token)) {
      body = tokens[++i] ?? "";
      if (method === "GET") method = "POST";
    } else if (!token.startsWith("-") && !url) {
      url = token;
    }
  }
  if (!url) throw new Error("cURL 命令中没有找到 URL");
  return { method, url, headers, body };
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function requestToCurl(request: HttpWorkbenchRequest): string {
  const parts = ["curl", "-X", request.method, quoteShell(request.url)];
  request.headers.forEach(([name, value]) => parts.push("-H", quoteShell(`${name}: ${value}`)));
  if (request.body != null && request.body !== "") parts.push("--data-raw", quoteShell(request.body));
  return parts.join(" ");
}

function prettyPreview(preview: string): string {
  try {
    return JSON.stringify(JSON.parse(preview), null, 2);
  } catch {
    return preview;
  }
}

function hexPreview(preview: string): string {
  const bytes = new TextEncoder().encode(preview);
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    const hex = [...row].map((value) => value.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const ascii = [...row].map((value) => value >= 32 && value < 127 ? String.fromCharCode(value) : ".").join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
  }
  return lines.join("\n");
}

function jsonRows(preview: string): { columns: string[]; rows: Record<string, unknown>[] } | null {
  try {
    const parsed = JSON.parse(preview) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (!rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) return null;
    const records = rows as Record<string, unknown>[];
    const columns = [...new Set(records.flatMap((row) => Object.keys(row)))];
    return { columns, rows: records };
  } catch { return null; }
}

function failedSummary(): ExecutionSummary {
  const now = new Date().toISOString();
  return {
    executionId: "",
    requestId: "",
    protocolId: "http",
    state: "failed",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    bytesReceived: 0,
  };
}

function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function formatKv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function parseAssertions(text: string): Assertion[] {
  const out: Assertion[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const status = trimmed.match(/^status\s*==\s*(\d+)$/i);
    if (status) {
      out.push({ type: "status_equals", expected: Number(status[1]) });
      continue;
    }
    const duration = trimmed.match(/^duration\s*<\s*(\d+)$/i);
    if (duration) {
      out.push({ type: "duration_lt", max_ms: Number(duration[1]) });
      continue;
    }
    const contains = trimmed.match(/^body\s+contains\s+(.+)$/i);
    if (contains) {
      out.push({ type: "body_contains", expected: contains[1].trim() });
      continue;
    }
    const header = trimmed.match(/^header\s+(\S+)\s+==\s+(.+)$/i);
    if (header) {
      out.push({ type: "header_equals", name: header[1], expected: header[2].trim() });
      continue;
    }
    const jsonpath = trimmed.match(/^jsonpath\s+(\S+)\s+==\s+(.+)$/i);
    if (jsonpath) {
      out.push({ type: "json_path_equals", path: jsonpath[1], expected: jsonpath[2].trim() });
    }
  }
  return out;
}

function formatAssertions(list: Assertion[]): string {
  return list
    .map((a) => {
      switch (a.type) {
        case "status_equals":
          return `status == ${a.expected}`;
        case "duration_lt":
          return `duration < ${a.max_ms}`;
        case "body_contains":
          return `body contains ${a.expected}`;
        case "header_equals":
          return `header ${a.name} == ${a.expected}`;
        case "json_path_equals":
          return `jsonpath ${a.path} == ${a.expected}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

function buildAuth(
  kind: AuthKind,
  secretRef: string,
  username: string,
  headerName: string,
  tokenUrl: string,
  scope: string,
  audience: string,
  authorizationUrl: string,
  redirectUri: string,
  codeRef: string,
  verifierRef: string,
): AuthRef | null {
  if (kind === "none") {
    return null;
  }
  return {
    kind,
    secret_ref: secretRef.trim() || null,
    username: kind === "basic" || kind.startsWith("oauth2_") ? username.trim() || null : null,
    header_name: kind === "api_key" ? headerName.trim() || "X-Api-Key" : null,
    token_url: kind.startsWith("oauth2_") ? tokenUrl.trim() || null : null,
    scope: kind.startsWith("oauth2_") ? scope.trim() || null : null,
    audience: kind.startsWith("oauth2_") ? audience.trim() || null : null,
    authorization_url: kind === "oauth2_authorization_code" ? authorizationUrl.trim() || null : null,
    redirect_uri: kind === "oauth2_authorization_code" ? redirectUri.trim() || null : null,
    authorization_code_ref: kind === "oauth2_authorization_code" ? codeRef : null,
    code_verifier_ref: kind === "oauth2_authorization_code" ? verifierRef : null,
  };
}

export function HttpWorkbench({
  onSend,
  onCancel,
  onSave,
  onLoad,
  onLoadEnvironment,
  onSaveEnvironment,
  onPutSecret,
  onListCookies,
  onSetCookie,
  onDeleteCookie,
  onListHistory,
  onReplayHistory,
  externalRequest,
}: HttpWorkbenchProps) {
  const [method, setMethod] = useState<string>("GET");
  const [url, setUrl] = useState("https://{{host}}");
  const [headersText, setHeadersText] = useState("Accept: application/json");
  const [body, setBody] = useState("");
  const [bodyMode, setBodyMode] = useState<"raw" | "multipart">("raw");
  const [multipart, setMultipart] = useState<MultipartPart[]>([]);
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [followRedirects, setFollowRedirects] = useState(true);
  const [retryMax, setRetryMax] = useState(0);
  const [retryBackoffMs, setRetryBackoffMs] = useState(250);
  const [proxy, setProxy] = useState("");
  const [tlsVerify, setTlsVerify] = useState(true);
  const [tlsClientCertRef, setTlsClientCertRef] = useState("");
  const [preScript, setPreScript] = useState("");
  const [postScript, setPostScript] = useState("");
  const [variablesText, setVariablesText] = useState("host=example.com");
  const [envText, setEnvText] = useState("host=example.com");
  const [secretRefs, setSecretRefs] = useState<string[]>([]);
  const [assertionsText, setAssertionsText] = useState("status == 200\nbody contains Example");
  const [authKind, setAuthKind] = useState<AuthKind>("none");
  const [authSecretRef, setAuthSecretRef] = useState("apiToken");
  const [authUsername, setAuthUsername] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("X-Api-Key");
  const [oauthTokenUrl, setOauthTokenUrl] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthAudience, setOauthAudience] = useState("");
  const [oauthAuthorizationUrl, setOauthAuthorizationUrl] = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("http://127.0.0.1:39218/oauth/callback");
  const [oauthAuthorizationCode, setOauthAuthorizationCode] = useState("");
  const [oauthCodeRef] = useState(() => `oauth-code-${crypto.randomUUID()}`);
  const [oauthVerifierRef] = useState(() => `oauth-verifier-${crypto.randomUUID()}`);
  const [secretName, setSecretName] = useState("apiToken");
  const [secretValue, setSecretValue] = useState("");
  const [cookies, setCookies] = useState<Array<{ name: string; value: string }>>([]);
  const [cookieName, setCookieName] = useState("");
  const [cookieValue, setCookieValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [result, setResult] = useState<HttpRunResult | null>(null);
  const [livePreview, setLivePreview] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyStateFilter, setHistoryStateFilter] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [codeRequest, setCodeRequest] = useState<HttpWorkbenchRequest | null>(null);
  const [curlText, setCurlText] = useState("");
  const [responseView, setResponseView] = useState<"pretty" | "raw" | "hex" | "table">("pretty");
  const [responseTab, setResponseTab] = useState<"body" | "headers" | "assertions" | "timeline">("body");
  const [timeline, setTimeline] = useState<Array<{ at: number; event: ExecutionEvent }>>([]);
  const [responseOffset, setResponseOffset] = useState(0);

  const responsePreview = useMemo(() => {
    const preview = result?.preview ?? livePreview;
    if (responseView === "pretty") return prettyPreview(preview);
    if (responseView === "hex") return hexPreview(preview);
    return preview;
  }, [result?.preview, livePreview, responseView]);
  const responseTable = useMemo(() => jsonRows(result?.preview ?? livePreview), [result?.preview, livePreview]);
  const responseWindow = responsePreview.slice(responseOffset, responseOffset + 10000);

  function buildRequest(): HttpWorkbenchRequest {
    const headers = headersText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx <= 0) {
          throw new Error(`Header 格式错误：${line}`);
        }
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string];
      });

    return {
      url: url.trim(),
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      multipart: bodyMode === "multipart" ? multipart.filter((part) => part.name.trim()) : [],
      timeoutMs,
      variables: parseKv(variablesText),
      assertions: parseAssertions(assertionsText),
      auth: buildAuth(authKind, authSecretRef, authUsername, authHeaderName, oauthTokenUrl, oauthScope, oauthAudience, oauthAuthorizationUrl, oauthRedirectUri, oauthCodeRef, oauthVerifierRef),
      followRedirects,
      retryMax,
      retryBackoffMs,
      proxy: proxy.trim() || null,
      tlsVerify,
      tlsClientCertRef: tlsClientCertRef.trim() || null,
      preScripts: preScript.trim() ? [preScript] : [],
      postScripts: postScript.trim() ? [postScript] : [],
    };
  }

  function handleImportCurl() {
    try {
      const parsed = parseCurl(curlText);
      if (parsed.method) setMethod(parsed.method);
      if (parsed.url) setUrl(parsed.url);
      if (parsed.headers) setHeadersText(parsed.headers.map(([k, v]) => `${k}: ${v}`).join("\n"));
      if (parsed.body !== undefined) setBody(parsed.body);
      setShowCurlImport(false);
      setStatusMsg("已从 cURL 导入请求");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyText(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatusMsg(success);
    } catch {
      setStatusMsg("复制失败，请检查剪贴板权限");
    }
  }

  function handleCopyCurl() {
    try {
      void copyText(requestToCurl(buildRequest()), "cURL 已复制");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function downloadResponse() {
    if (!responsePreview) return;
    const type = result?.responseMeta?.contentType ?? "text/plain;charset=utf-8";
    const extension = type.includes("json") ? "json" : type.includes("xml") ? "xml" : type.includes("html") ? "html" : "txt";
    const href = URL.createObjectURL(new Blob([responsePreview], { type }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `apivoy-response-${result?.executionId?.slice(0, 8) ?? "latest"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(href);
    setStatusMsg("响应正文已下载");
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !loading && url.trim()) {
        event.preventDefault();
        void handleSend();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function applyRequest(loaded: HttpWorkbenchRequest) {
    setMethod(loaded.method);
    setUrl(loaded.url);
    setHeadersText(loaded.headers.map(([k, v]) => `${k}: ${v}`).join("\n"));
    setBody(loaded.body ?? "");
    setMultipart(loaded.multipart ?? []);
    setBodyMode(loaded.multipart?.length ? "multipart" : "raw");
    setTimeoutMs(loaded.timeoutMs);
    setFollowRedirects(loaded.followRedirects ?? true);
    setRetryMax(loaded.retryMax ?? 0);
    setRetryBackoffMs(loaded.retryBackoffMs ?? 250);
    setProxy(loaded.proxy ?? "");
    setTlsVerify(loaded.tlsVerify ?? true);
    setTlsClientCertRef(loaded.tlsClientCertRef ?? "");
    setPreScript(loaded.preScripts?.join("\n") ?? "");
    setPostScript(loaded.postScripts?.join("\n") ?? "");
    setVariablesText(formatKv(loaded.variables));
    setAssertionsText(formatAssertions(loaded.assertions));
    const auth = loaded.auth;
    if (!auth || auth.kind === "none") {
      setAuthKind("none");
    } else if (auth.kind === "bearer" || auth.kind === "basic" || auth.kind === "api_key" || auth.kind === "oauth2_client_credentials" || auth.kind === "oauth2_authorization_code") {
      setAuthKind(auth.kind);
      setAuthSecretRef(auth.secret_ref ?? "");
      setAuthUsername(auth.username ?? "");
      setAuthHeaderName(auth.header_name ?? "X-Api-Key");
      setOauthTokenUrl(auth.token_url ?? "");
      setOauthScope(auth.scope ?? "");
      setOauthAudience(auth.audience ?? "");
      setOauthAuthorizationUrl(auth.authorization_url ?? "");
      setOauthRedirectUri(auth.redirect_uri ?? "http://127.0.0.1:39218/oauth/callback");
    } else {
      setAuthKind("none");
    }
  }

  useEffect(() => {
    if (externalRequest) {
      applyRequest(externalRequest);
      setResult(null);
      setStatusMsg("已打开集合中的请求");
    } else {
      const draft = readWorkbenchDraft<HttpWorkbenchRequest>("http");
      if (draft) {
        applyRequest(draft);
        setStatusMsg("已恢复上次未完成的 HTTP 草稿");
      }
    }
  }, [externalRequest]);

  useEffect(() => { const listener=(event:Event)=>{const detail=(event as CustomEvent<{request?:HttpWorkbenchRequest;aiAssertions?:string}>).detail;if(!detail?.request)return;applyRequest(detail.request);if(detail.aiAssertions)setAssertionsText(detail.aiAssertions);setResult(null);setStatusMsg("已载入 AI 生成请求，请检查后再发送");};window.addEventListener("apivoy-open-request",listener);return()=>window.removeEventListener("apivoy-open-request",listener); }, []);

  useAutosaveDraft("http", buildRequest);

  async function startPkceAuthorization() {
    if (!oauthAuthorizationUrl.trim() || !authUsername.trim() || !oauthRedirectUri.trim()) {
      setStatusMsg("请先填写 Authorization Endpoint、Client ID 和 Redirect URI");
      return;
    }
    if (!onPutSecret) { setStatusMsg("当前执行端未提供安全密钥存储"); return; }
    const random = crypto.getRandomValues(new Uint8Array(48));
    const verifier = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await onPutSecret(oauthVerifierRef, verifier);
    const authorization = new URL(oauthAuthorizationUrl);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("client_id", authUsername);
    authorization.searchParams.set("redirect_uri", oauthRedirectUri);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    if (oauthScope.trim()) authorization.searchParams.set("scope", oauthScope.trim());
    if (oauthAudience.trim()) authorization.searchParams.set("audience", oauthAudience.trim());
    window.open(authorization.toString(), "_blank", "noopener,noreferrer");
    setStatusMsg("授权页面已打开；完成授权后粘贴回调中的 code");
  }

  async function handleSend() {
    setLoading(true);
    setResult(null);
    setLivePreview("");
    setTimeline([]);
    setResponseOffset(0);
    setResponseTab("body");
    setExecutionId(null);
    setStatusMsg(null);
    try {
      if (authKind === "oauth2_authorization_code" && oauthAuthorizationCode.trim()) {
        if (!onPutSecret) throw new Error("当前执行端未提供安全密钥存储，无法保存短期授权码");
        await onPutSecret(oauthCodeRef, oauthAuthorizationCode.trim());
      }
      const next = await onSend(buildRequest(), {
        onStarted: (id) => setExecutionId(id),
        onChunk: (preview) => setLivePreview((current) => current + preview),
        onEvent: (event) => setTimeline((current) => [...current, { at: performance.now(), event }]),
      });
      setResult(next);
      if (onListHistory) {
        setHistory(await onListHistory(currentHistoryFilter()));
      }
    } catch (err) {
      setResult({
        summary: failedSummary(),
        eventCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
      setExecutionId(null);
    }
  }

  async function handleCancel() {
    if (!onCancel || !executionId) {
      return;
    }
    try {
      await onCancel(executionId);
      setStatusMsg("已请求取消");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave() {
    if (!onSave) {
      return;
    }
    try {
      await onSave(buildRequest());
      setStatusMsg("请求已保存到本地库");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLoad() {
    if (!onLoad) {
      return;
    }
    try {
      const loaded = await onLoad();
      if (!loaded) {
        setStatusMsg("本地库中暂无已保存请求");
        return;
      }
      applyRequest(loaded);
      setStatusMsg("已从本地库打开请求");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLoadEnv() {
    if (!onLoadEnvironment) {
      return;
    }
    try {
      const env = await onLoadEnvironment();
      setEnvText(formatKv(env.variables));
      setSecretRefs(env.secretRefs ?? []);
      setStatusMsg("已加载环境变量");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveEnv() {
    if (!onSaveEnvironment) {
      return;
    }
    try {
      const refs = [...secretRefs];
      if (authKind !== "none" && authSecretRef.trim() && !refs.includes(authSecretRef.trim())) {
        refs.push(authSecretRef.trim());
      }
      if (tlsClientCertRef.trim() && !refs.includes(tlsClientCertRef.trim())) {
        refs.push(tlsClientCertRef.trim());
      }
      await onSaveEnvironment(parseKv(envText), refs);
      setSecretRefs(refs);
      setStatusMsg("环境变量已保存");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePutSecret() {
    if (!onPutSecret) {
      return;
    }
    const name = secretName.trim();
    if (!name || !secretValue) {
      setStatusMsg("请填写密钥名称与值");
      return;
    }
    try {
      await onPutSecret(name, secretValue);
      setSecretValue("");
      setAuthSecretRef(name);
      const refs = secretRefs.includes(name) ? secretRefs : [...secretRefs, name];
      setSecretRefs(refs);
      if (onSaveEnvironment) {
        await onSaveEnvironment(parseKv(envText), refs);
      }
      setStatusMsg(`密钥 ${name} 已写入安全存储（不明文落盘）`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshCookies() {
    if (!onListCookies) return;
    try { setCookies(await onListCookies(url)); } catch (error) { setStatusMsg(error instanceof Error ? error.message : String(error)); }
  }

  async function handleSetCookie() {
    if (!onSetCookie || !cookieName.trim()) return;
    try { await onSetCookie(url, cookieName.trim(), cookieValue); await refreshCookies(); setCookieName(""); setCookieValue(""); } catch (error) { setStatusMsg(error instanceof Error ? error.message : String(error)); }
  }

  function currentHistoryFilter(): HistoryFilter | undefined {
    const status = historyStatusFilter.trim()
      ? Number(historyStatusFilter.trim())
      : undefined;
    const filter: HistoryFilter = {};
    if (historyStateFilter.trim()) {
      filter.state = historyStateFilter.trim();
    }
    if (status != null && !Number.isNaN(status)) {
      filter.status = status;
    }
    return filter.state || filter.status != null ? filter : undefined;
  }

  async function handleRefreshHistory() {
    if (!onListHistory) {
      return;
    }
    try {
      setHistory(await onListHistory(currentHistoryFilter()));
      setStatusMsg("历史已刷新");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 2) {
        return [prev[1], id];
      }
      return [...prev, id];
    });
  }

  async function handleReplay(id: string) {
    if (!onReplayHistory) {
      return;
    }
    try {
      const loaded = await onReplayHistory(id);
      if (!loaded) {
        setStatusMsg("该历史记录无可重放的请求快照");
        return;
      }
      if ("payload" in loaded) {
        window.dispatchEvent(new CustomEvent("apivoy-open-request", { detail: loaded }));
        if (loaded.payload.type === "http") applyRequest({ name: loaded.name, url: loaded.target, method: loaded.payload.method, headers: loaded.payload.headers, body: loaded.payload.body ?? undefined, multipart: loaded.payload.multipart ?? [], timeoutMs: loaded.timeoutMs, variables: loaded.variables ?? {}, assertions: loaded.assertions ?? [], auth: loaded.authRef ?? null, followRedirects: loaded.payload.followRedirects, retryMax: loaded.retryPolicy.max_retries, retryBackoffMs: loaded.retryPolicy.backoff_ms, proxy: loaded.proxy ?? null, tlsVerify: loaded.tls.verify, tlsClientCertRef: loaded.tls.client_cert_ref ?? null, preScripts: loaded.preScripts ?? [], postScripts: loaded.postScripts ?? [] });
      } else applyRequest(loaded);
      setStatusMsg("已从历史恢复请求，可再次发送");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function updateMultipart(index: number, patch: Partial<MultipartPart>) {
    setMultipart((parts) => parts.map((part, partIndex) => partIndex === index ? { ...part, ...patch } : part));
  }

  async function attachMultipartFile(index: number, file: File | null) {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    updateMultipart(index, {
      value: btoa(binary),
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      base64: true,
    });
  }

  const showBody = method !== "GET" && method !== "HEAD";

  return (
    <WorkbenchFrame title="HTTP" description="构建、发送并检查 HTTP 请求" badge={<span className="protocol-badge">REQUEST</span>} busy={loading} status={statusMsg ? <span role="status">{statusMsg}</span> : <span>就绪 · Ctrl + Enter 发送</span>}>
      <SplitPane id="http-workbench" primaryLabel="请求配置" secondaryLabel="响应检查器" primary={<div className="apivoy-workbench http-request-pane" style={styles.section}>
<div style={styles.row}>
        <select
          style={styles.select}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          disabled={loading}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="http-target-field">目标 URL<input id="http-target-url" style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://{{host}}/api" spellCheck={false} disabled={loading} aria-describedby="http-target-url-help" aria-invalid={!url.trim()} /><small id="http-target-url-help">支持环境变量，例如 https://&#123;&#123;host&#125;&#125;/api</small></label>
        <button style={styles.button} disabled={loading || !url.trim()} onClick={handleSend}>
          {loading ? "发送中…" : "发送"}
        </button>
        {onCancel && (
          <button
            style={styles.secondaryButton}
            disabled={!loading || !executionId}
            onClick={handleCancel}
          >
            取消
          </button>
        )}
        <button style={styles.secondaryButton} disabled={loading} onClick={() => setShowCurlImport((v) => !v)}>
          导入 cURL
        </button>
        <button style={styles.secondaryButton} disabled={loading || !url.trim()} onClick={handleCopyCurl}>
          复制 cURL
        </button>
        <button style={styles.secondaryButton} disabled={loading || !url.trim()} onClick={() => { try { setCodeRequest(buildRequest()); } catch (error) { setStatusMsg(error instanceof Error ? error.message : String(error)); } }}>
          生成代码
        </button>
        <span style={styles.shortcut}>Ctrl ↵</span>
      </div>

      {showCurlImport && (
        <div style={styles.importPanel}>
          <div style={styles.panelTitle}><strong>从 cURL 导入</strong><span>支持 method、header 和 request body</span></div>
          <textarea style={{ ...styles.textarea, minHeight: 110 }} value={curlText} onChange={(e) => setCurlText(e.target.value)} placeholder="curl -X POST 'https://api.example.com' -H 'Content-Type: application/json' --data-raw '{...}'" spellCheck={false} />
          <div style={styles.row}><button style={styles.button} onClick={handleImportCurl}>导入请求</button><button style={styles.secondaryButton} onClick={() => setShowCurlImport(false)}>取消</button></div>
        </div>
      )}
      {codeRequest && <CodeGenerator request={codeRequest} />}

      <div style={styles.grid}>
        <label style={styles.label}>
          Headers（每行 `Name: Value`）
          <textarea
            style={styles.textarea}
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            rows={4}
            spellCheck={false}
            disabled={loading}
          />
        </label>
        <label style={styles.label}>
          Timeout (ms)
          <input
            style={styles.timeout}
            type="number"
            min={1}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value) || 30_000)}
            disabled={loading}
          />
        </label>
      </div>

      <div style={styles.grid3}>
        <label style={styles.label}>
          代理地址（可选）
          <input style={styles.input} value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="http://127.0.0.1:7890" spellCheck={false} disabled={loading} />
        </label>
        <label style={styles.label}>
          最大重试次数
          <input style={styles.timeout} type="number" min={0} max={10} value={retryMax} onChange={(e) => setRetryMax(Math.max(0, Number(e.target.value) || 0))} disabled={loading} />
        </label>
        <label style={styles.label}>
          重试间隔 (ms)
          <input style={styles.timeout} type="number" min={0} value={retryBackoffMs} onChange={(e) => setRetryBackoffMs(Math.max(0, Number(e.target.value) || 0))} disabled={loading || retryMax === 0} />
        </label>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={followRedirects} onChange={(e) => setFollowRedirects(e.target.checked)} disabled={loading} />
          跟随重定向
        </label>
        <label style={styles.checkLabel} title="关闭证书校验存在中间人攻击风险">
          <input type="checkbox" checked={tlsVerify} onChange={(e) => setTlsVerify(e.target.checked)} disabled={loading} />
          校验 TLS 证书
        </label>
        {!tlsVerify && <span style={styles.dangerHint}>仅在可信测试环境关闭证书校验</span>}
        <label style={styles.label}>客户端证书密钥引用<input style={styles.input} value={tlsClientCertRef} onChange={(event) => setTlsClientCertRef(event.target.value)} placeholder="Keychain 中的合并 PEM 名称" disabled={loading} /></label>
      </div>

      {onListCookies && onSetCookie && onDeleteCookie && <div style={styles.importPanel}>
        <div style={styles.panelTitle}><strong>Cookie Jar</strong><button style={styles.secondaryButton} onClick={() => void refreshCookies()}>刷新当前 URL</button></div>
        <div style={styles.row}><input style={styles.input} value={cookieName} onChange={(event) => setCookieName(event.target.value)} placeholder="Cookie 名称" /><input style={styles.input} value={cookieValue} onChange={(event) => setCookieValue(event.target.value)} placeholder="Cookie 值" /><button style={styles.secondaryButton} onClick={() => void handleSetCookie()}>设置</button></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>{cookies.map((cookie) => <span key={cookie.name} style={{ border: "1px solid var(--apivoy-border)", borderRadius: 999, padding: "4px 8px", fontSize: 11 }}><code>{cookie.name}={cookie.value}</code> <button aria-label={`删除 Cookie ${cookie.name}`} onClick={async () => { await onDeleteCookie(url, cookie.name); await refreshCookies(); }}><Icon name="trash" /></button></span>)}</div>
      </div>}

      {showBody && (
        <div style={styles.label}>
          <div style={styles.row}>
            <strong>Body</strong>
            <select style={styles.select} value={bodyMode} onChange={(event) => setBodyMode(event.target.value as "raw" | "multipart")} disabled={loading}>
              <option value="raw">Raw</option>
              <option value="multipart">Multipart form-data</option>
            </select>
          </div>
          {bodyMode === "raw" ? (
            <CodeEditor value={body} onChange={setBody} language="json" height={170} readOnly={loading} />
          ) : (
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {multipart.map((part, index) => (
                <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(100px,.7fr) minmax(140px,1fr) auto auto", gap: 8 }}>
                  <input style={styles.input} value={part.name} onChange={(event) => updateMultipart(index, { name: event.target.value })} placeholder="字段名" disabled={loading} />
                  {part.fileName ? <input style={styles.input} value={part.fileName} readOnly title={part.contentType ?? undefined} /> : <input style={styles.input} value={part.value} onChange={(event) => updateMultipart(index, { value: event.target.value, base64: false })} placeholder="文本值" disabled={loading} />}
                  <label style={styles.secondaryButton}>选择文件<input type="file" hidden onChange={(event) => void attachMultipartFile(index, event.target.files?.[0] ?? null)} disabled={loading} /></label>
                  <button style={styles.secondaryButton} onClick={() => setMultipart((parts) => parts.filter((_, partIndex) => partIndex !== index))} disabled={loading}>删除</button>
                </div>
              ))}
              <button style={styles.secondaryButton} onClick={() => setMultipart((parts) => [...parts, { name: "", value: "", base64: false }])} disabled={loading}>添加字段</button>
              <small style={{ color: "var(--apivoy-muted)" }}>文件内容以 Base64 保存在请求中；发送时自动生成 multipart boundary。</small>
            </div>
          )}
        </div>
      )}

      <div style={styles.grid2}>
        <label style={styles.label}>前置脚本（QuickJS）<CodeEditor value={preScript} onChange={setPreScript} language="javascript" height={145} readOnly={loading} /></label>
        <label style={styles.label}>后置脚本（QuickJS）<CodeEditor value={postScript} onChange={setPostScript} language="javascript" height={145} readOnly={loading} /></label>
      </div>

      <div style={styles.grid2}>
        <label style={styles.label}>
          认证
          <select
            style={styles.selectWide}
            value={authKind}
            onChange={(e) => setAuthKind(e.target.value as AuthKind)}
            disabled={loading}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic</option>
            <option value="api_key">API Key</option>
            <option value="oauth2_client_credentials">OAuth 2.0 Client Credentials</option>
            <option value="oauth2_authorization_code">OAuth 2.0 Authorization Code + PKCE</option>
          </select>
          {authKind !== "none" && (
            <div style={styles.authFields}>
              {(authKind === "basic" || authKind.startsWith("oauth2_")) && (
                <input
                  style={styles.input}
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  placeholder={authKind.startsWith("oauth2_") ? "Client ID（支持 {{var}}）" : "Username（支持 {{var}}）"}
                  spellCheck={false}
                  disabled={loading}
                />
              )}
              <input
                style={styles.input}
                value={authSecretRef}
                onChange={(e) => setAuthSecretRef(e.target.value)}
                placeholder={
                  authKind === "basic"
                    ? "Password secret_ref 名称"
                    : authKind === "oauth2_client_credentials"
                      ? "Client Secret secret_ref 名称"
                    : authKind === "api_key"
                      ? "API Key secret_ref 名称"
                      : "Token secret_ref 名称"
                }
                spellCheck={false}
                disabled={loading}
              />
              {authKind === "api_key" && (
                <input
                  style={styles.input}
                  value={authHeaderName}
                  onChange={(e) => setAuthHeaderName(e.target.value)}
                  placeholder="Header 名（默认 X-Api-Key）"
                  spellCheck={false}
                  disabled={loading}
                />
              )}
              {authKind.startsWith("oauth2_") && <>
                <input style={styles.input} value={oauthTokenUrl} onChange={(event) => setOauthTokenUrl(event.target.value)} placeholder="Token Endpoint URL" spellCheck={false} disabled={loading} />
                <input style={styles.input} value={oauthScope} onChange={(event) => setOauthScope(event.target.value)} placeholder="Scopes（空格分隔，可选）" spellCheck={false} disabled={loading} />
                <input style={styles.input} value={oauthAudience} onChange={(event) => setOauthAudience(event.target.value)} placeholder="Audience（可选）" spellCheck={false} disabled={loading} />
              </>}
              {authKind === "oauth2_authorization_code" && <>
                <input style={styles.input} value={oauthAuthorizationUrl} onChange={(event) => setOauthAuthorizationUrl(event.target.value)} placeholder="Authorization Endpoint URL" spellCheck={false} disabled={loading} />
                <input style={styles.input} value={oauthRedirectUri} onChange={(event) => setOauthRedirectUri(event.target.value)} placeholder="Redirect URI" spellCheck={false} disabled={loading} />
                <button type="button" style={styles.secondaryButton} disabled={loading} onClick={() => void startPkceAuthorization()}>打开浏览器授权（PKCE S256）</button>
                <input style={styles.input} value={oauthAuthorizationCode} onChange={(event) => setOauthAuthorizationCode(event.target.value)} placeholder="粘贴回调参数 code（仅写入安全存储）" spellCheck={false} disabled={loading} />
              </>}
              <div style={styles.muted}>
                仅保存密钥引用名；明文写入下方「密钥存储」。
              </div>
            </div>
          )}
        </label>
        <label style={styles.label}>
          断言（每行一条：`status == 200` / `body contains …` / `jsonpath $.a == 1`）
          <textarea
            style={styles.textarea}
            value={assertionsText}
            onChange={(e) => setAssertionsText(e.target.value)}
            rows={4}
            spellCheck={false}
            disabled={loading}
          />
        </label>
      </div>

      <div style={styles.grid2}>
        <label style={styles.label}>
          请求变量（`key=value`，覆盖环境）
          <textarea
            style={styles.textarea}
            value={variablesText}
            onChange={(e) => setVariablesText(e.target.value)}
            rows={4}
            spellCheck={false}
            disabled={loading}
          />
        </label>
        {onPutSecret ? (
          <label style={styles.label}>
            密钥存储（写入 OS Keychain / Agent，不明文进 SQLite）
            <input
              style={styles.input}
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              placeholder="secret 名称，如 apiToken"
              spellCheck={false}
              disabled={loading}
            />
            <input
              style={styles.input}
              type="password"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="密钥值（仅写入安全存储）"
              disabled={loading}
            />
            <div style={styles.row}>
              <button style={styles.secondaryButton} disabled={loading} onClick={handlePutSecret}>
                存入密钥
              </button>
              {secretRefs.length > 0 && (
                <span style={styles.muted}>已关联: {secretRefs.join(", ")}</span>
              )}
            </div>
          </label>
        ) : (
          <div />
        )}
      </div>

      {(onLoadEnvironment || onSaveEnvironment) && (
        <label style={styles.label}>
          环境变量（Default env，`key=value`）
          <textarea
            style={styles.textarea}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={3}
            spellCheck={false}
            disabled={loading}
          />
          <div style={styles.row}>
            {onLoadEnvironment && (
              <button style={styles.secondaryButton} disabled={loading} onClick={handleLoadEnv}>
                加载环境
              </button>
            )}
            {onSaveEnvironment && (
              <button style={styles.secondaryButton} disabled={loading} onClick={handleSaveEnv}>
                保存环境
              </button>
            )}
          </div>
        </label>
      )}

      {(onSave || onLoad) && (
        <div style={styles.row}>
          {onSave && (
            <button style={styles.secondaryButton} disabled={loading || !url.trim()} onClick={handleSave}>
              保存请求
            </button>
          )}
          {onLoad && (
            <button style={styles.secondaryButton} disabled={loading} onClick={handleLoad}>
              打开最近请求
            </button>
          )}
        </div>
      )}

      {onListHistory && (
        <div style={styles.history}>
          <div style={styles.row}>
            <strong style={{ color: "var(--apivoy-text)" }}>执行历史</strong>
            <button style={styles.secondaryButton} disabled={loading} onClick={handleRefreshHistory}>
              刷新
            </button>
          </div>
          <div style={styles.row}>
            <label style={styles.label}>
              状态
              <select
                style={styles.select}
                value={historyStateFilter}
                onChange={(e) => setHistoryStateFilter(e.target.value)}
              >
                <option value="">全部</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label style={styles.label}>
              HTTP 状态码
              <input
                style={styles.input}
                value={historyStatusFilter}
                onChange={(e) => setHistoryStatusFilter(e.target.value)}
                placeholder="如 200"
              />
            </label>
            <button style={styles.secondaryButton} disabled={loading} onClick={handleRefreshHistory}>
              筛选
            </button>
          </div>
          {history.length === 0 ? (
            <div style={styles.muted}>暂无历史；发送请求后会出现在这里。</div>
          ) : (
            <VirtualList
              items={history}
              itemHeight={48}
              height={Math.min(360, Math.max(96, history.length * 48))}
              ariaLabel="执行历史"
              getKey={(item) => item.id}
              renderItem={(item) => (
                <div style={styles.historyItem}>
                  <label style={styles.compareCheck}>
                    <input
                      type="checkbox"
                      checked={compareIds.includes(item.id)}
                      onChange={() => toggleCompare(item.id)}
                    />
                    对比
                  </label>
                  <span style={styles.mono}>
                    {item.status ?? "—"} · {item.durationMs}ms · {item.state}
                  </span>
                  <span style={styles.muted}>{item.target ?? item.protocolId}</span>
                  {onReplayHistory && (
                    <button
                      style={styles.linkButton}
                      disabled={loading}
                      onClick={() => handleReplay(item.id)}
                    >
                      重放
                    </button>
                  )}
                </div>
              )}
            />
          )}
          {compareIds.length === 2 && (
            <div style={styles.compareBox}>
              {compareIds.map((id) => {
                const item = history.find((h) => h.id === id);
                return (
                  <div key={id} style={styles.comparePane}>
                    <div style={styles.mono}>
                      {item?.status ?? "—"} · {item?.durationMs ?? 0}ms · {item?.state ?? "—"}
                    </div>
                    <div style={styles.muted}>{item?.target ?? id.slice(0, 8)}</div>
                    <pre style={styles.comparePre}>
                      {(item?.preview ?? "(无预览)").slice(0, 2000)}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      </div>} secondary={<div className="http-response-pane">
      {!result && !loading ? <div className="response-empty"><span className="response-empty-icon">↗</span><strong>等待响应</strong><p>发送请求后，状态、响应头、正文、断言与时间线会显示在这里。</p></div> : null}
      {statusMsg && <div role="status" aria-live="polite" style={styles.status}>{statusMsg}</div>}

      {loading && livePreview && <div style={styles.panel}><div style={styles.responseHeader}><strong>响应流正在接收…</strong><span>{new TextEncoder().encode(livePreview).length} bytes</span></div><pre style={styles.pre}>{prettyPreview(livePreview).slice(0, 10000)}</pre></div>}

      {result && (
        <div style={styles.panel}>
          {result.error ? (
            <div style={styles.error}>{result.error}</div>
          ) : (
            <>
              <div style={styles.responseHeader}>
                <div style={styles.meta}>
                  <span style={styles.statusBadge}>状态 {result.summary.status ?? "—"}</span>
                  <span>{result.summary.durationMs} ms</span>
                  <span>{result.summary.bytesReceived} bytes</span>
                  <span>{result.eventCount} events</span>
                  {result.executionId && <span>id {result.executionId.slice(0, 8)}</span>}
                </div>
                <div style={styles.row}>
                  <button style={responseView === "pretty" ? styles.tabActive : styles.tab} onClick={() => setResponseView("pretty")}>美化</button>
                  <button style={responseView === "raw" ? styles.tabActive : styles.tab} onClick={() => setResponseView("raw")}>原文</button>
                  <button style={responseView === "hex" ? styles.tabActive : styles.tab} onClick={() => setResponseView("hex")}>Hex</button>
                  <button style={responseView === "table" ? styles.tabActive : styles.tab} disabled={!responseTable} onClick={() => setResponseView("table")}>表格</button>
                  {result.preview && <button style={styles.linkButton} onClick={() => void copyText(responsePreview, "响应内容已复制")}>复制</button>}
                  {result.preview && <button style={styles.linkButton} onClick={downloadResponse}>下载</button>}
                </div>
              </div>
              <div style={styles.responseTabs} role="tablist" aria-label="响应内容视图">
                <button role="tab" aria-selected={responseTab === "body"} style={responseTab === "body" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("body")}>响应体</button>
                <button role="tab" aria-selected={responseTab === "headers"} style={responseTab === "headers" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("headers")}>Headers <span style={styles.count}>{result.responseMeta?.headers.length ?? 0}</span></button>
                <button role="tab" aria-selected={responseTab === "assertions"} style={responseTab === "assertions" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("assertions")}>断言 <span style={styles.count}>{result.assertions?.length ?? 0}</span></button>
                <button role="tab" aria-selected={responseTab === "timeline"} style={responseTab === "timeline" ? styles.tabActive : styles.tab} onClick={() => setResponseTab("timeline")}>时间线 <span style={styles.count}>{timeline.length}</span></button>
              </div>
              {responseTab === "assertions" && result.assertions && result.assertions.length > 0 && (
                <ul style={styles.assertList}>
                  {result.assertions.map((a, i) => (
                    <li key={`${a.name}-${i}`} style={a.passed ? styles.assertPass : styles.assertFail}>
                      {a.passed ? "✓" : "✗"} {a.name}
                      {a.message ? ` — ${a.message}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {responseTab === "assertions" && (!result.assertions || result.assertions.length === 0) && <div style={styles.muted}>当前请求没有断言结果。</div>}
              {responseTab === "headers" && <div style={styles.headerTable}>
                <div style={styles.headerSummary}><span>{result.responseMeta?.contentType ?? "未知 Content-Type"}</span><span>预估 {result.responseMeta?.sizeHint ?? result.summary.bytesReceived} bytes</span></div>
                {(result.responseMeta?.headers ?? []).map(([name, value], index) => <div key={`${name}-${index}`} style={styles.headerRow}><strong>{name}</strong><span>{value}</span></div>)}
                {!result.responseMeta?.headers.length && <div style={styles.muted}>没有可用的响应 Header。</div>}
              </div>}
              {responseTab === "timeline" && <div style={styles.timeline}>{timeline.map(({ at, event }, index) => <div key={index} style={styles.timelineRow}><time>+{index === 0 ? "0.0" : (at - timeline[0].at).toFixed(1)}ms</time><b>{event.type}</b><span>{event.type === "state_changed" ? `${event.state}${event.phase ? ` · ${event.phase}` : ""}` : event.type === "response_chunk" ? `${event.size} bytes${event.done ? " · done" : ""}` : event.type === "response_meta" ? `${event.status ?? ""} ${event.statusText ?? ""}` : event.type === "warning" || event.type === "failed" ? event.message : event.type === "metric" ? `${event.name}: ${event.value} ${event.unit}` : ""}</span></div>)}</div>}
              {responseTab === "body" && result.preview && responseView === "table" && responseTable && <div style={styles.jsonTableWrap}><table style={styles.jsonTable}><thead><tr>{responseTable.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{responseTable.rows.slice(0, 1000).map((row, index) => <tr key={index}>{responseTable.columns.map((column) => <td key={column}>{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>{responseTable.rows.length > 1000 && <div style={styles.muted}>仅显示前 1000 行，共 {responseTable.rows.length} 行。</div>}</div>}
              {responseTab === "body" && result.preview && responseView !== "table" && (
                <><pre style={styles.pre}>{responseWindow}</pre>{responsePreview.length > 10000 && <div style={styles.windowNav}><button disabled={responseOffset === 0} onClick={() => setResponseOffset(Math.max(0, responseOffset - 10000))}>上一段</button><span>{responseOffset + 1}–{Math.min(responsePreview.length, responseOffset + 10000)} / {responsePreview.length} 字符</span><button disabled={responseOffset + 10000 >= responsePreview.length} onClick={() => setResponseOffset(responseOffset + 10000)}>下一段</button></div>}</>
              )}
            </>
          )}
        </div>
      )}
      </div>}/>
    </WorkbenchFrame>
  );
}

const styles: Record<string, CSSProperties> = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  h1: {
    margin: 0,
    fontSize: 30,
    fontWeight: 720,
    letterSpacing: "-0.7px",
  },
  p: {
    margin: 0,
    color: "var(--apivoy-muted)",
    lineHeight: 1.5,
    maxWidth: 720,
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  shortcut: {
    color: "var(--apivoy-muted)", fontFamily: "var(--apivoy-mono)", fontSize: 11,
    border: "1px solid var(--apivoy-border)", borderRadius: 6, padding: "4px 7px",
  },
  importPanel: {
    display: "flex", flexDirection: "column", gap: 12, padding: 16,
    border: "1px solid rgba(86,173,245,.38)", borderRadius: 14,
    background: "rgba(21,39,56,.72)", boxShadow: "0 18px 50px rgba(0,0,0,.16)",
  },
  panelTitle: {
    display: "flex", alignItems: "baseline", gap: 10, color: "var(--apivoy-text)", fontSize: 14,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 160px",
    gap: 12,
    padding: 16,
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    background: "rgba(18,25,35,.72)",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    padding: 16,
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    background: "rgba(18,25,35,.72)",
  },
  grid3: {
    display: "grid", gridTemplateColumns: "minmax(280px, 2fr) 1fr 1fr", gap: 12,
    padding: 16, border: "1px solid var(--apivoy-border)", borderRadius: 14,
    background: "rgba(18,25,35,.72)", alignItems: "end",
  },
  checkLabel: {
    display: "flex", alignItems: "center", gap: 8, color: "var(--apivoy-text)", fontSize: 12,
    minHeight: 34,
  },
  dangerHint: { color: "var(--apivoy-danger)", fontSize: 12 },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 12,
    color: "var(--apivoy-muted)",
  },
  select: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--apivoy-success)",
    background: "rgba(62, 207, 142, 0.12)",
    border: "1px solid rgba(62, 207, 142, 0.35)",
    borderRadius: 9,
    padding: "10px 12px",
  },
  selectWide: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--apivoy-text)",
    background: "#0d131b",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 8,
    padding: "10px 12px",
  },
  authFields: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 4,
  },
  input: {
    flex: 1,
    minWidth: 220,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 14,
    color: "var(--apivoy-text)",
    background: "#0d131b",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
  },
  timeout: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 14,
    color: "var(--apivoy-text)",
    background: "#0d131b",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
  },
  textarea: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
    color: "var(--apivoy-text)",
    background: "var(--apivoy-bg-elevated)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
    resize: "vertical",
  },
  button: {
    fontSize: 14,
    fontWeight: 600,
    color: "#041018",
    background: "linear-gradient(180deg, #71bdfb, #3d9cf0)",
    border: "none",
    borderRadius: 9,
    padding: "12px 18px",
    cursor: "pointer",
    boxShadow: "0 8px 22px rgba(31,111,184,.22)",
  },
  secondaryButton: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--apivoy-text)",
    background: "rgba(255,255,255,.025)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 18px",
    cursor: "pointer",
  },
  linkButton: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--apivoy-accent)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  panel: {
    marginTop: 8,
    background: "linear-gradient(180deg, rgba(18,25,35,.96), rgba(13,19,27,.96))",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    padding: 18,
    boxShadow: "0 18px 50px rgba(0,0,0,.18)",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 12,
    color: "var(--apivoy-muted)",
    marginBottom: 0,
  },
  responseHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    flexWrap: "wrap", paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid var(--apivoy-border)",
  },
  responseTabs: { display: "flex", gap: 4, marginBottom: 12 },
  jsonTableWrap: { maxHeight: 420, overflow: "auto", border: "1px solid var(--apivoy-border)", borderRadius: 8 },
  jsonTable: { width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "left" },
  timeline: { display: "grid", gap: 1, maxHeight: 420, overflow: "auto", border: "1px solid var(--apivoy-border)", borderRadius: 8 },
  timelineRow: { display: "grid", gridTemplateColumns: "85px 145px 1fr", gap: 10, padding: "7px 9px", borderBottom: "1px solid var(--apivoy-border)", fontSize: 11, color: "var(--apivoy-muted)" },
  windowNav: { display: "flex", justifyContent: "center", alignItems: "center", gap: 10, padding: 8, color: "var(--apivoy-muted)", fontSize: 10 },
  count: { opacity: .7, marginLeft: 4 },
  headerTable: { display: "flex", flexDirection: "column", border: "1px solid var(--apivoy-border)", borderRadius: 9, overflow: "hidden" },
  headerSummary: { display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 11px", background: "rgba(86,173,245,.08)", color: "var(--apivoy-muted)", fontSize: 11 },
  headerRow: { display: "grid", gridTemplateColumns: "minmax(140px, .35fr) 1fr", gap: 12, padding: "8px 11px", borderTop: "1px solid var(--apivoy-border)", fontFamily: "var(--apivoy-mono)", fontSize: 11, wordBreak: "break-all" },
  statusBadge: {
    color: "var(--apivoy-success)", background: "rgba(62,207,142,.1)",
    borderRadius: 999, padding: "4px 9px",
  },
  tab: {
    border: 0, background: "transparent", color: "var(--apivoy-muted)",
    padding: "5px 8px", cursor: "pointer", borderRadius: 6,
  },
  tabActive: {
    border: 0, background: "var(--apivoy-accent-soft)", color: "var(--apivoy-accent)",
    padding: "5px 8px", cursor: "pointer", borderRadius: 6,
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--apivoy-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 420,
    overflow: "auto",
  },
  error: {
    color: "var(--apivoy-danger)",
    fontFamily: "var(--apivoy-mono)",
    fontSize: 13,
  },
  status: {
    fontSize: 13,
    color: "var(--apivoy-accent)",
  },
  history: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 16,
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    background: "rgba(18,25,35,.72)",
  },
  historyList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  historyItem: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    fontSize: 12,
    padding: "10px 12px",
    borderRadius: 9,
    background: "rgba(255,255,255,.025)",
  },
  compareCheck: {
    display: "inline-flex",
    gap: 4,
    alignItems: "center",
    color: "var(--apivoy-muted)",
    fontSize: 12,
  },
  compareBox: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginTop: 8,
  },
  comparePane: {
    border: "1px solid var(--apivoy-border)",
    borderRadius: 8,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  comparePre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--apivoy-mono)",
    fontSize: 11,
    lineHeight: 1.4,
    maxHeight: 240,
    overflow: "auto",
    color: "var(--apivoy-text)",
  },
  mono: {
    fontFamily: "var(--apivoy-mono)",
    color: "var(--apivoy-text)",
  },
  muted: {
    color: "var(--apivoy-muted)",
    fontSize: 12,
  },
  assertList: {
    listStyle: "none",
    margin: "0 0 12px",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 12,
  },
  assertPass: {
    color: "var(--apivoy-success)",
  },
  assertFail: {
    color: "var(--apivoy-danger)",
  },
};
