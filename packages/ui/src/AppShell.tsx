import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icons";
import { useAppStore } from "./appStore";
import { DEFAULT_WORKBENCH_GROUPS, WORKBENCH_LABELS } from "./WorkbenchDeck";
import { useI18n } from "./i18n";
import { FeedbackProvider } from "./Feedback";
import { SettingsDialog } from "./SettingsDialog";
import { CollaborationHub, type CollaborationTab } from "./CollaborationHub";
import type { EnvironmentEditorProps } from "./EnvironmentEditor";
import { useDialogFocus } from "./useDialogFocus";

export interface AppShellProps {
  title?: string;
  channelLabel: string;
  children: ReactNode;
  explorer?: ReactNode;
  status?: ReactNode;
  /** UX-013: real health text; omit to hide fake "connected" */
  connectionStatus?: { label: string; tone?: "ok" | "warn" | "off" } | null;
  collaboration?: {
    team: ReactNode;
    comments: ReactNode;
    sso: ReactNode;
  };
  environment?: EnvironmentEditorProps;
}

export function AppShell({ title = "ApiVoy", channelLabel, children, explorer, status, connectionStatus = null, collaboration, environment }: AppShellProps) {
  const { t } = useI18n();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [collaborationTab, setCollaborationTab] = useState<CollaborationTab>("team");
  const [search, setSearch] = useState("");
  const [activeCommand, setActiveCommand] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const themeMode = useAppStore((state) => state.themeMode);
  const setThemeMode = useAppStore((state) => state.setThemeMode);
  const collapsedExplorer = useAppStore((state) => state.collapsedExplorer);
  const toggleExplorer = useAppStore((state) => state.toggleExplorer);
  const explorerOpen = !collapsedExplorer;

  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { root.dataset.theme = themeMode === "system" ? (systemDark.matches ? "dark" : "light") : themeMode; };
    apply(); systemDark.addEventListener("change", apply); return () => systemDark.removeEventListener("change", apply);
  }, [themeMode]);
  useEffect(() => {
    const closeExplorerOnMobile = () => {
      if (window.matchMedia("(max-width: 768px)").matches) useAppStore.setState({ collapsedExplorer: true });
    };
    if (useAppStore.persist.hasHydrated()) closeExplorerOnMobile();
    return useAppStore.persist.onFinishHydration(closeExplorerOnMobile);
  }, []);
  useEffect(() => {
    const openCollaboration = (event: Event) => {
      const tab = (event as CustomEvent<CollaborationTab>).detail;
      if (tab === "team" || tab === "comments" || tab === "sso") setCollaborationTab(tab);
      else setCollaborationTab("team");
      setPaletteOpen(false);
      setSettingsOpen(false);
      setCollaborationOpen(true);
    };
    const openSettingsEvent = () => {
      setPaletteOpen(false);
      setCollaborationOpen(false);
      setSettingsOpen(true);
    };
    window.addEventListener("apivoy-open-collaboration", openCollaboration);
    window.addEventListener("apivoy-open-settings", openSettingsEvent);
    return () => {
      window.removeEventListener("apivoy-open-collaboration", openCollaboration);
      window.removeEventListener("apivoy-open-settings", openSettingsEvent);
    };
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSettingsOpen(false);
        setCollaborationOpen(false);
        setPaletteOpen((value) => !value);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setPaletteOpen(false);
        setCollaborationOpen(false);
        setSettingsOpen((value) => !value);
      }
      if (event.key === "Escape") {
        if (collaborationOpen) { setCollaborationOpen(false); return; }
        if (settingsOpen) { setSettingsOpen(false); return; }
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (explorerOpen && window.matchMedia("(max-width: 768px)").matches) toggleExplorer();
      }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [collaborationOpen, explorerOpen, paletteOpen, settingsOpen, toggleExplorer]);

  const cycleTheme = () => setThemeMode(themeMode === "dark" ? "light" : themeMode === "light" ? "system" : "dark");
  const openSettings = () => { setPaletteOpen(false); setCollaborationOpen(false); setSettingsOpen(true); };
  const openCollaboration = (tab: CollaborationTab = "team") => {
    setPaletteOpen(false);
    setSettingsOpen(false);
    setCollaborationTab(tab);
    setCollaborationOpen(true);
  };

  const workbenchCommands = DEFAULT_WORKBENCH_GROUPS.flatMap((group) => group.workbenchIds.map((id) => ({ id, group: group.label, label: WORKBENCH_LABELS[id] ?? id }))).filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(search.toLowerCase()));
  const actions = [
    { id: "action-settings", label: t("settings.open"), icon: "settings" as const, run: () => openSettings() },
    ...(collaboration ? [{ id: "action-collab", label: t("collaboration.open"), icon: "users" as const, run: () => openCollaboration("team") }] : []),
    { id: "action-theme", label: t("command.theme"), icon: "sun" as const, run: () => cycleTheme() },
    { id: "action-import", label: t("command.import"), icon: "download" as const, run: () => { setPaletteOpen(false); window.dispatchEvent(new CustomEvent("apivoy-import-requests")); } },
    { id: "action-history", label: t("command.history"), icon: "activity" as const, run: () => { setPaletteOpen(false); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "http" })); queueMicrotask(() => window.dispatchEvent(new CustomEvent("apivoy-focus-history"))); } },
    { id: "action-run", label: t("command.runCollection"), icon: "send" as const, run: () => { setPaletteOpen(false); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "runner" })); } },
    { id: "action-ai", label: t("command.openAi"), icon: "bolt" as const, run: () => { setPaletteOpen(false); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "ai" })); } },
  ].filter((item) => !search.trim() || item.label.toLowerCase().includes(search.toLowerCase()));
  const commandResults = [
    ...actions.map((action) => ({ id: action.id, label: action.label, icon: action.icon, run: action.run, group: "actions" as const })),
    ...workbenchCommands.map((command) => ({ id: `workbench-${command.id}`, label: command.label, icon: "bolt" as const, run: () => window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: command.id })), group: "workbenches" as const })),
  ];
  useEffect(() => { setActiveCommand(0); }, [search, paletteOpen]);
  useDialogFocus(paletteOpen, paletteRef, () => setPaletteOpen(false), paletteInputRef);
  function runCommand(index: number) { const result = commandResults[index]; if (!result) return; result.run(); setPaletteOpen(false); }
  function onCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!commandResults.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveCommand((value) => event.key === "ArrowDown" ? (value + 1) % commandResults.length : (value - 1 + commandResults.length) % commandResults.length); }
    if (event.key === "Home") { event.preventDefault(); setActiveCommand(0); }
    if (event.key === "End") { event.preventDefault(); setActiveCommand(commandResults.length - 1); }
    if (event.key === "Enter") { event.preventDefault(); runCommand(activeCommand); }
  }

  return <FeedbackProvider><div className="apivoy-shell">
    <a className="skip-link" href="#apivoy-main">{t("shell.skip")}</a>
    <header className="app-header">
      <div className="header-leading">
        {explorer ? <button className={`ui-icon-button${explorerOpen ? " is-active" : ""}`} aria-label={t("shell.explorer.toggle")} aria-expanded={explorerOpen} aria-controls="apivoy-explorer" title={t("shell.explorer")} onClick={toggleExplorer}><Icon name="folder"/></button> : null}
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">A</span><div><strong>{title}</strong><span>{t("app.tagline")}</span></div></div>
      </div>
      <div className="header-context">
        {connectionStatus ? <span className={`connection-status tone-${connectionStatus.tone ?? "ok"}`}><span className="status-dot"/>{connectionStatus.label}</span> : null}
        <span className="channel-label" title={t("channel.current")}>{channelLabel}</span>
        {status}
      </div>
      <div className="header-actions">
        <button className="ui-icon-button" aria-label={t("command.history")} title={t("command.history")} onClick={() => window.dispatchEvent(new CustomEvent("apivoy-focus-history"))}><Icon name="activity"/></button>
        <button data-testid="command-trigger" className="command-trigger" aria-label={t("command.open")} onClick={() => setPaletteOpen(true)}><Icon name="search"/><span>{t("command.open")}</span><kbd>⌘ K</kbd></button>
        <button data-testid="theme-toggle" className="ui-icon-button" aria-label={t("command.theme")} title={`${t("settings.theme")}: ${themeMode}`} onClick={cycleTheme}><Icon name={themeMode === "light" ? "sun" : "moon"}/></button>
        {collaboration ? <button className={`ui-icon-button${collaborationOpen ? " is-active" : ""}`} aria-label={t("collaboration.open")} title={t("collaboration.open")} onClick={() => openCollaboration("team")}><Icon name="users"/></button> : null}
        <button className="ui-icon-button" aria-label={t("settings.open")} title={`${t("settings.open")} ⌘,`} onClick={openSettings}><Icon name="settings"/></button>
      </div>
    </header>
    <div className={`app-workspace ${explorerOpen ? "explorer-open" : "explorer-collapsed"}`}>
      {explorer && explorerOpen ? <button type="button" className="explorer-backdrop" aria-label={t("shell.explorer.close")} onClick={toggleExplorer} /> : null}
      {explorer ? <aside id="apivoy-explorer" className="resource-explorer" aria-label={t("shell.explorer")}>{explorer}</aside> : null}
      <main id="apivoy-main" tabIndex={-1} className="app-main">{children}</main>
    </div>
    {paletteOpen ? <div className="command-overlay" role="presentation" onMouseDown={() => setPaletteOpen(false)}><div ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-label={t("command.title")} onMouseDown={(event) => event.stopPropagation()}><div className="command-input-wrap"><Icon name="search"/><input ref={paletteInputRef} role="combobox" aria-expanded="true" aria-controls="apivoy-command-results" aria-activedescendant={commandResults[activeCommand] ? `command-${commandResults[activeCommand].id}` : undefined} autoComplete="off" value={search} onKeyDown={onCommandKeyDown} onChange={(event) => setSearch(event.target.value)} placeholder={t("command.placeholder")} aria-label={t("command.open")}/></div>
      <div id="apivoy-command-results" role="listbox" aria-label={t("command.title")}>
      {actions.length ? <><div className="command-group-label">{t("command.actions")}</div>{actions.map((action, index) => <button id={`command-${action.id}`} role="option" aria-selected={activeCommand === index} className={activeCommand === index ? "is-active" : undefined} key={action.id} type="button" onMouseEnter={() => setActiveCommand(index)} onClick={() => runCommand(index)}><span><Icon name={action.icon}/>{action.label}</span></button>)}</> : null}
      <div className="command-group-label">{t("command.workbenches")}</div>
      {workbenchCommands.map((command, index) => { const resultIndex = actions.length + index; return <button id={`command-workbench-${command.id}`} role="option" aria-selected={activeCommand === resultIndex} className={activeCommand === resultIndex ? "is-active" : undefined} key={command.id} onMouseEnter={() => setActiveCommand(resultIndex)} onClick={() => runCommand(resultIndex)}><span><Icon name="bolt"/>{command.label}</span><kbd>Enter</kbd></button>; })}
      {workbenchCommands.length === 0 && actions.length === 0 ? <div className="command-empty">{t("command.empty")}</div> : null}
    </div></div></div> : null}
    <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} channelLabel={channelLabel} environment={environment} />
    {collaboration ? <CollaborationHub open={collaborationOpen} onClose={() => setCollaborationOpen(false)} initialTab={collaborationTab} team={collaboration.team} comments={collaboration.comments} sso={collaboration.sso} /> : null}
  </div></FeedbackProvider>;
}
