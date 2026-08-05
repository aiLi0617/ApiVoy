import type { CSSProperties, ReactNode } from "react";

export interface AppShellProps {
  title?: string;
  channelLabel: string;
  children: ReactNode;
}

export function AppShell({ title = "ApiVoy", channelLabel, children }: AppShellProps) {
  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.mark}>Av</span>
          <div>
            <div style={styles.title}>{title}</div>
            <div style={styles.subtitle}>Explore Every Protocol. · 探索每一种协议。</div>
          </div>
        </div>
        <div style={styles.channel} title="当前执行通道">
          {channelLabel}
        </div>
      </header>
      <main style={styles.main}>{children}</main>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 24px",
    borderBottom: "1px solid var(--apivoy-border)",
    backdropFilter: "blur(8px)",
    background: "rgba(15, 20, 25, 0.72)",
  },
  brand: {
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(145deg, #3d9cf0, #1f6fb8)",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 18,
    fontWeight: 650,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 12,
    color: "var(--apivoy-muted)",
    marginTop: 2,
  },
  channel: {
    fontSize: 12,
    color: "var(--apivoy-accent)",
    background: "var(--apivoy-accent-soft)",
    border: "1px solid rgba(61, 156, 240, 0.35)",
    borderRadius: 999,
    padding: "6px 12px",
  },
  main: {
    flex: 1,
    padding: 24,
    maxWidth: 1100,
    width: "100%",
    margin: "0 auto",
  },
};
