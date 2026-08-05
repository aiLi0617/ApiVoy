import { useState, type CSSProperties } from "react";
import type { ExecutionSummary } from "@apivoy/request-model";

export interface HttpRunResult {
  summary: ExecutionSummary;
  eventCount: number;
  preview?: string | null;
  error?: string;
}

export interface HttpWorkbenchProps {
  onSend: (url: string) => Promise<HttpRunResult>;
}

export function HttpWorkbench({ onSend }: HttpWorkbenchProps) {
  const [url, setUrl] = useState("https://example.com");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HttpRunResult | null>(null);

  async function handleSend() {
    setLoading(true);
    setResult(null);
    try {
      const next = await onSend(url.trim());
      setResult(next);
    } catch (err) {
      setResult({
        summary: {
          executionId: "",
          requestId: "",
          protocolId: "http",
          state: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          bytesReceived: 0,
        },
        eventCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={styles.section}>
      <h1 style={styles.h1}>HTTP 快速调试</h1>
      <p style={styles.p}>
        通过统一执行内核发送请求。桌面端走 Tauri Command，Web 端可连接 Local Agent。
      </p>

      <div style={styles.row}>
        <span style={styles.method}>GET</span>
        <input
          style={styles.input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          spellCheck={false}
        />
        <button style={styles.button} disabled={loading || !url.trim()} onClick={handleSend}>
          {loading ? "发送中…" : "发送"}
        </button>
      </div>

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
  },
  method: {
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
    fontFamily: "var(--apivoy-mono)",
    fontSize: 14,
    color: "var(--apivoy-text)",
    background: "var(--apivoy-bg-elevated)",
    border: "1px solid var(--apivoy-border)",
    borderRadius: 10,
    padding: "12px 14px",
    outline: "none",
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
};
