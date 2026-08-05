import { useState, type CSSProperties } from "react";
import type { Assertion, AssertionResultEvent, ExecutionSummary } from "@apivoy/request-model";

export interface HttpWorkbenchRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: string;
  timeoutMs: number;
  variables: Record<string, string>;
  assertions: Assertion[];
}

export interface HttpRunResult {
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
  error?: string;
  executionId?: string;
  assertions?: AssertionResultEvent[];
}

export interface HttpSendHooks {
  /** Called as soon as the execution id is known (before streaming completes). */
  onStarted?: (executionId: string) => void;
}

export interface HistoryItem {
  id: string;
  protocolId: string;
  state: string;
  status?: number | null;
  durationMs: number;
  startedAt: string;
  target?: string;
}

export interface HttpWorkbenchProps {
  onSend: (request: HttpWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onCancel?: (executionId: string) => Promise<void>;
  onSave?: (request: HttpWorkbenchRequest) => Promise<void>;
  onLoad?: () => Promise<HttpWorkbenchRequest | null>;
  onLoadEnvironment?: () => Promise<Record<string, string>>;
  onSaveEnvironment?: (variables: Record<string, string>) => Promise<void>;
  onListHistory?: () => Promise<HistoryItem[]>;
  onReplayHistory?: (id: string) => Promise<HttpWorkbenchRequest | null>;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

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

export function HttpWorkbench({
  onSend,
  onCancel,
  onSave,
  onLoad,
  onLoadEnvironment,
  onSaveEnvironment,
  onListHistory,
  onReplayHistory,
}: HttpWorkbenchProps) {
  const [method, setMethod] = useState<string>("GET");
  const [url, setUrl] = useState("https://{{host}}");
  const [headersText, setHeadersText] = useState("Accept: application/json");
  const [body, setBody] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [variablesText, setVariablesText] = useState("host=example.com");
  const [envText, setEnvText] = useState("host=example.com");
  const [assertionsText, setAssertionsText] = useState("status == 200\nbody contains Example");
  const [loading, setLoading] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [result, setResult] = useState<HttpRunResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  function buildRequest(): HttpWorkbenchRequest {
    const headers = headersText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx <= 0) {
          return [line, ""] as [string, string];
        }
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string];
      });

    return {
      url: url.trim(),
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      timeoutMs,
      variables: parseKv(variablesText),
      assertions: parseAssertions(assertionsText),
    };
  }

  function applyRequest(loaded: HttpWorkbenchRequest) {
    setMethod(loaded.method);
    setUrl(loaded.url);
    setHeadersText(loaded.headers.map(([k, v]) => `${k}: ${v}`).join("\n"));
    setBody(loaded.body ?? "");
    setTimeoutMs(loaded.timeoutMs);
    setVariablesText(formatKv(loaded.variables));
    setAssertionsText(formatAssertions(loaded.assertions));
  }

  async function handleSend() {
    setLoading(true);
    setResult(null);
    setExecutionId(null);
    setStatusMsg(null);
    try {
      const next = await onSend(buildRequest(), {
        onStarted: (id) => setExecutionId(id),
      });
      setResult(next);
      if (onListHistory) {
        setHistory(await onListHistory());
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
      const vars = await onLoadEnvironment();
      setEnvText(formatKv(vars));
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
      await onSaveEnvironment(parseKv(envText));
      setStatusMsg("环境变量已保存");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRefreshHistory() {
    if (!onListHistory) {
      return;
    }
    try {
      setHistory(await onListHistory());
      setStatusMsg("历史已刷新");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
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
      applyRequest(loaded);
      setStatusMsg("已从历史生成请求，可再次发送");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const showBody = method !== "GET" && method !== "HEAD";

  return (
    <section style={styles.section}>
      <h1 style={styles.h1}>HTTP 请求编辑器</h1>
      <p style={styles.p}>
        支持 {"{{var}}"} 变量、内置断言与历史重放。桌面端走 Tauri；Web 端经 Local Agent。
      </p>

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
        <input
          style={styles.input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://{{host}}/api"
          spellCheck={false}
          disabled={loading}
        />
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
      </div>

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

      {showBody && (
        <label style={styles.label}>
          Body
          <textarea
            style={{ ...styles.textarea, minHeight: 120 }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            disabled={loading}
          />
        </label>
      )}

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
          {history.length === 0 ? (
            <div style={styles.muted}>暂无历史；发送请求后会出现在这里。</div>
          ) : (
            <ul style={styles.historyList}>
              {history.map((item) => (
                <li key={item.id} style={styles.historyItem}>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {statusMsg && <div style={styles.status}>{statusMsg}</div>}

      {result && (
        <div style={styles.panel}>
          {result.error ? (
            <div style={styles.error}>{result.error}</div>
          ) : (
            <>
              <div style={styles.meta}>
                <span>状态 {result.summary.status ?? "—"}</span>
                <span>{result.summary.durationMs} ms</span>
                <span>{result.summary.bytesReceived} bytes</span>
                <span>{result.eventCount} events</span>
                {result.executionId && <span>id {result.executionId.slice(0, 8)}</span>}
              </div>
              {result.assertions && result.assertions.length > 0 && (
                <ul style={styles.assertList}>
                  {result.assertions.map((a, i) => (
                    <li key={`${a.name}-${i}`} style={a.passed ? styles.assertPass : styles.assertFail}>
                      {a.passed ? "✓" : "✗"} {a.name}
                      {a.message ? ` — ${a.message}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {result.preview && (
                <pre style={styles.pre}>{result.preview.slice(0, 4000)}</pre>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  h1: {
    margin: 0,
    fontSize: 28,
    fontWeight: 650,
  },
  p: {
    margin: 0,
    color: "var(--apivoy-muted)",
    lineHeight: 1.5,
    maxWidth: 640,
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 160px",
    gap: 12,
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
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
    borderRadius: 8,
    padding: "10px 12px",
  },
  input: {
    flex: 1,
    minWidth: 220,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 14,
    color: "var(--apivoy-text)",
    background: "var(--apivoy-bg-elevated)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
  },
  timeout: {
    fontFamily: "var(--apivoy-mono)",
    fontSize: 14,
    color: "var(--apivoy-text)",
    background: "var(--apivoy-bg-elevated)",
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
    background: "linear-gradient(180deg, #6cb6f5, #3d9cf0)",
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    cursor: "pointer",
  },
  secondaryButton: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--apivoy-text)",
    background: "transparent",
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
    background: "var(--apivoy-bg-elevated)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 14,
    padding: 16,
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    fontFamily: "var(--apivoy-mono)",
    fontSize: 12,
    color: "var(--apivoy-muted)",
    marginBottom: 12,
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
