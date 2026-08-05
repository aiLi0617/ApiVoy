import { useState, type CSSProperties } from "react";
import type { ExecutionSummary } from "@apivoy/request-model";

export interface HttpWorkbenchRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: string;
  timeoutMs: number;
}

export interface HttpRunResult {
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
  error?: string;
  executionId?: string;
}

export interface HttpSendHooks {
  /** Called as soon as the execution id is known (before streaming completes). */
  onStarted?: (executionId: string) => void;
}

export interface HttpWorkbenchProps {
  onSend: (request: HttpWorkbenchRequest, hooks?: HttpSendHooks) => Promise<HttpRunResult>;
  onCancel?: (executionId: string) => Promise<void>;
  onSave?: (request: HttpWorkbenchRequest) => Promise<void>;
  onLoad?: () => Promise<HttpWorkbenchRequest | null>;
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

export function HttpWorkbench({ onSend, onCancel, onSave, onLoad }: HttpWorkbenchProps) {
  const [method, setMethod] = useState<string>("GET");
  const [url, setUrl] = useState("https://example.com");
  const [headersText, setHeadersText] = useState("Accept: application/json");
  const [body, setBody] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [loading, setLoading] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [result, setResult] = useState<HttpRunResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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
    };
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
      setMethod(loaded.method);
      setUrl(loaded.url);
      setHeadersText(loaded.headers.map(([k, v]) => `${k}: ${v}`).join("\n"));
      setBody(loaded.body ?? "");
      setTimeoutMs(loaded.timeoutMs);
      setStatusMsg("已从本地库打开请求");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const showBody = method !== "GET" && method !== "HEAD";

  return (
    <section style={styles.section}>
      <h1 style={styles.h1}>HTTP 请求编辑器</h1>
      <p style={styles.p}>
        通过统一执行内核发送请求。桌面端走 Tauri Command，Web 端经 Local Agent 正式执行 API（SSE）。
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
          placeholder="https://"
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
};
