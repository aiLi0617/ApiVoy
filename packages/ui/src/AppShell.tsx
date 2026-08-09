import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "./i18n";

export interface AppShellProps {
  title?: string;
  channelLabel: string;
  children: ReactNode;
  explorer?: ReactNode;
}

export function AppShell({ title = "ApiVoy", channelLabel, children, explorer }: AppShellProps) {
  const { locale, setLocale, t } = useI18n();
  const mainRef = useRef<HTMLElement>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sections = () => Array.from(mainRef.current?.querySelectorAll("section") ?? []).map((element, index) => ({ element: element as HTMLElement, label: element.querySelector("h1,h2")?.textContent?.trim() || t("region.fallback", { index: index + 1 }) }));
  function navigate(label: string) { const target = sections().find((item) => item.label.toLowerCase().includes(label.toLowerCase())); target?.element.scrollIntoView({ behavior: "smooth", block: "start" }); setPaletteOpen(false); }
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((value) => !value); } if (event.key === "Escape") setPaletteOpen(false); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  const commands = sections().filter((item) => item.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="apivoy-shell" style={styles.root}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.mark}>A</span>
          <div>
            <div style={styles.title}>{title}</div>
            <div style={styles.subtitle}>{t("app.tagline")}</div>
          </div>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.channel} title={t("channel.current")}>
            <span style={styles.liveDot} />
            {channelLabel}
          </div>
          <select style={styles.locale} aria-label={t("locale.label")} value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)}><option value="zh-CN">{t("locale.zh")}</option><option value="en-US">{t("locale.en")}</option></select>
          <button className="icon-button" style={styles.iconButton} title={t("command.title")} aria-label={t("command.open")} onClick={() => setPaletteOpen(true)}>⌘</button>
        </div>
      </header>
      <div style={styles.workspace}>
        <aside style={styles.sidebar} aria-label={t("nav.main")}>
          <nav style={styles.nav}>
            <button className="nav-item nav-item-active" style={styles.navItem} onClick={() => navigate("HTTP")}><span>⌁</span> {t("nav.requests")}</button>
            <button className="nav-item" style={styles.navItem} onClick={() => { explorerRef.current?.focus(); explorerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><span>◫</span> {t("nav.collections")}</button>
            <button className="nav-item" style={styles.navItem} onClick={() => navigate("HTTP")}><span>↺</span> {t("nav.history")}</button>
            <button className="nav-item" style={styles.navItem} onClick={() => navigate("HTTP")}><span>◇</span> {t("nav.environments")}</button>
          </nav>
          {explorer && <div ref={explorerRef} tabIndex={-1} style={styles.explorer}>{explorer}</div>}
          <div style={styles.sidebarFooter}>
            <span style={styles.workspaceAvatar}>L</span>
            <div><strong>Local</strong><small>{t("workspace.local")}</small></div>
          </div>
        </aside>
        <main ref={mainRef} style={styles.main}>{children}</main>
      </div>
      {paletteOpen && <div style={styles.overlay} onMouseDown={() => setPaletteOpen(false)}><div style={styles.palette} onMouseDown={(event) => event.stopPropagation()}><input autoFocus style={styles.paletteInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("command.placeholder")} />{commands.map((command) => <button key={command.label} style={styles.command} onClick={() => { command.element.scrollIntoView({ behavior: "smooth", block: "start" }); setPaletteOpen(false); }}>{command.label}<small>{t("command.jump")}</small></button>)}{commands.length === 0 && <div style={styles.empty}>{t("command.empty")}</div>}</div></div>}
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
    padding: "12px 18px",
    borderBottom: "1px solid var(--apivoy-border)",
    backdropFilter: "blur(8px)",
    background: "rgba(10, 14, 20, 0.82)",
    position: "sticky",
    top: 0,
    zIndex: 20,
  },
  brand: {
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(145deg, #75bfff, #267fd0)",
    boxShadow: "0 8px 24px rgba(37, 127, 208, .28), inset 0 1px rgba(255,255,255,.35)",
    fontWeight: 800,
    fontSize: 16,
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
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    color: "var(--apivoy-accent)",
    background: "var(--apivoy-accent-soft)",
    border: "1px solid rgba(61, 156, 240, 0.35)",
    borderRadius: 999,
    padding: "6px 12px",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "var(--apivoy-success)",
    boxShadow: "0 0 0 4px rgba(62,207,142,.1)",
  },
  headerActions: { display: "flex", alignItems: "center", gap: 8 },
  locale: { border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "var(--apivoy-bg-elevated)", color: "var(--apivoy-text)", padding: "6px 8px", fontSize: 12 },
  iconButton: {
    width: 32, height: 32, borderRadius: 8, border: "1px solid var(--apivoy-border)",
    background: "var(--apivoy-bg-elevated)", color: "var(--apivoy-muted)", cursor: "pointer",
  },
  workspace: { display: "flex", flex: 1, minHeight: 0 },
  sidebar: {
    width: 260, flexShrink: 0, borderRight: "1px solid var(--apivoy-border)",
    background: "rgba(12,17,24,.76)", padding: "18px 12px", display: "flex",
    flexDirection: "column", justifyContent: "space-between",
  },
  nav: { display: "flex", flexDirection: "column", gap: 5 },
  explorer: { flex: 1, minHeight: 0, overflow: "auto", marginTop: 12, borderTop: "1px solid var(--apivoy-border)", paddingTop: 2 },
  navItem: {
    display: "flex", alignItems: "center", gap: 11, width: "100%", border: 0,
    borderRadius: 9, padding: "10px 12px", color: "var(--apivoy-muted)",
    background: "transparent", font: "inherit", fontSize: 13, textAlign: "left", cursor: "pointer",
  },
  sidebarFooter: {
    display: "flex", gap: 10, alignItems: "center", padding: "10px 8px", color: "var(--apivoy-text)", fontSize: 12,
  },
  workspaceAvatar: {
    width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center",
    background: "var(--apivoy-accent-soft)", color: "var(--apivoy-accent)", fontWeight: 700,
  },
  main: {
    flex: 1,
    padding: "28px clamp(20px, 3vw, 42px) 48px",
    maxWidth: 1280,
    width: "100%",
    margin: "0 auto",
    minWidth: 0,
  },
  overlay: { position: "fixed", inset: 0, zIndex: 100, background: "rgba(2,6,10,.68)", backdropFilter: "blur(5px)", display: "grid", placeItems: "start center", paddingTop: "14vh" },
  palette: { width: "min(620px, calc(100vw - 32px))", maxHeight: "62vh", overflow: "auto", border: "1px solid var(--apivoy-border)", borderRadius: 14, background: "#0c131c", boxShadow: "0 24px 80px rgba(0,0,0,.5)", padding: 10 },
  paletteInput: { boxSizing: "border-box", width: "100%", padding: 13, border: "1px solid var(--apivoy-border)", borderRadius: 9, background: "#070c12", color: "var(--apivoy-text)", fontSize: 15, outline: "none", marginBottom: 7 },
  command: { display: "flex", justifyContent: "space-between", width: "100%", border: 0, borderRadius: 8, background: "transparent", color: "var(--apivoy-text)", padding: "10px 12px", textAlign: "left", cursor: "pointer" },
  empty: { padding: 18, textAlign: "center", color: "var(--apivoy-muted)" },
};
