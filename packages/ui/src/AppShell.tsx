import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icons";
import { useAppStore } from "./appStore";
import { DEFAULT_WORKBENCH_GROUPS, WORKBENCH_LABELS } from "./WorkbenchDeck";
import { useI18n } from "./i18n";
import { FeedbackProvider } from "./Feedback";
import { SettingsDialog } from "./SettingsDialog";
import { BrandMark } from "./BrandMark";
import { CollaborationHub, type CollaborationTab } from "./CollaborationHub";
import { EnvironmentEditor, type EnvironmentEditorProps } from "./EnvironmentEditor";
import { useDialogFocus } from "./useDialogFocus";
import { DEFAULT_RESPONSE_VALIDATION_SETTINGS, readResponseValidationSettings, writeResponseValidationSettings, type ProjectResponseValidationSettings } from "./responseValidationSettings";
import { RESPONSE_BODY_TYPES, createResponseComponent, readResponseComponents, writeResponseComponents, type ResponseComponent, type ResponseBodyType } from "./responseComponents";

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
  projectContext?: {
    projects: Array<{ id: string; name: string }>;
    selectedProjectId: string;
    onSelectProject: (projectId: string) => void;
  };
}

export function calculateExplorerWidth(clientX: number, explorerLeft: number, maximumWidth: number) {
  return Math.min(maximumWidth, Math.max(0, clientX - explorerLeft));
}

function EnvironmentVariablesDialog({ open, onClose, environment }: { open: boolean; onClose: () => void; environment?: EnvironmentEditorProps }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(open, dialogRef, onClose, closeRef);
  if (!open) return null;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><div ref={dialogRef} className="environment-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
    <header className="settings-dialog-header"><div><h2 id={titleId}>环境管理</h2></div><button ref={closeRef} type="button" className="ui-icon-button" aria-label="关闭环境管理" onClick={onClose}><Icon name="close"/></button></header>
    <div className="environment-dialog-body">{environment ? <EnvironmentEditor {...environment}/> : <p className="settings-hint">当前运行端未提供环境变量编辑能力。</p>}</div>
  </div></div>;
}

type ProjectSettingsCategory = "basic" | "resources" | "responses" | "validation" | "tools";

function ResponseComponentCard({ component, index, onChange, onRemove }: { component: ResponseComponent; index: number; onChange: (next: ResponseComponent) => void; onRemove: () => void }) {
  const [schemaError, setSchemaError] = useState("");
  const bodyFieldId = useId();
  const update = (patch: Partial<ResponseComponent>) => onChange({ ...component, ...patch });
  const componentLabel = component.name.trim() || `组件 ${index + 1}`;

  return <article className="project-response-component-card">
    <header className="project-response-component-card-header">
      <span className="project-response-component-index" aria-hidden="true">{index + 1}</span>
      <label className="project-response-component-name"><span>组件名称</span><input aria-label="响应组件名称" value={component.name} placeholder="例如：成功响应" onChange={(event) => update({ name: event.target.value })}/></label>
      <button type="button" className="ui-icon-button compact project-response-component-remove" aria-label={`删除 ${componentLabel}`} title={`删除 ${componentLabel}`} onClick={onRemove}><Icon name="trash"/></button>
    </header>
    <div className="project-response-component-main">
      <label><span>状态码 <small>可选</small></span><input aria-label={`${componentLabel} 状态码`} inputMode="numeric" value={component.statusCode ?? ""} placeholder="例如 200" onChange={(event) => update({ statusCode: event.target.value })}/></label>
      <label><span>Body 类型</span><select aria-label={`${componentLabel} Body 类型`} value={component.bodyType} onChange={(event) => { const bodyType = event.target.value as ResponseBodyType; update({ bodyType, contentType: RESPONSE_BODY_TYPES.find((item) => item.id === bodyType)?.contentType ?? "" }); }}>{RESPONSE_BODY_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Content-Type <small>可编辑</small></span><input aria-label={`${componentLabel} Content-Type`} value={component.contentType} placeholder="例如 application/json" onChange={(event) => update({ contentType: event.target.value })}/></label>
    </div>
    <label className={`project-response-component-schema${schemaError ? " has-error" : ""}`} htmlFor={bodyFieldId}>
      <span>Body 字段 <small>JSON 数组，可选</small></span>
      <textarea id={bodyFieldId} aria-describedby={schemaError ? `${bodyFieldId}-error` : undefined} aria-invalid={Boolean(schemaError)} defaultValue={component.fields?.length ? JSON.stringify(component.fields, null, 2) : ""} placeholder={'[\n  { "name": "data", "type": "object" }\n]'} onChange={(event) => { event.currentTarget.setCustomValidity(""); setSchemaError(""); }} onBlur={(event) => { try { const value = event.target.value.trim() ? JSON.parse(event.target.value) as unknown : []; if (!Array.isArray(value)) throw new Error(); update({ fields: value }); setSchemaError(""); event.currentTarget.setCustomValidity(""); } catch { const message = "请输入有效的 JSON 数组"; setSchemaError(message); event.currentTarget.setCustomValidity(message); } }}/>
      {schemaError ? <small id={`${bodyFieldId}-error`} className="project-response-component-error" role="alert">{schemaError}</small> : <small className="project-response-component-hint">用于描述响应结构，并在接口设计中快速复用。</small>}
    </label>
    <footer className="project-response-component-actions">
      <label className="project-response-component-default"><input type="checkbox" checked={component.addToNewInterfaces} onChange={(event) => update({ addToNewInterfaces: event.target.checked })}/><span><strong>新增接口时默认添加</strong><small>创建接口后自动引用此响应组件</small></span></label>
    </footer>
  </article>;
}

function ProjectSettingsDialog({ open, onClose, projectId, projectName, initialCategory = "basic" }: { open: boolean; onClose: () => void; projectId?: string; projectName?: string; initialCategory?: ProjectSettingsCategory }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [validation, setValidation] = useState<ProjectResponseValidationSettings>(DEFAULT_RESPONSE_VALIDATION_SETTINGS);
  const [responseComponents, setResponseComponents] = useState<ResponseComponent[]>([]);
  const [category, setCategory] = useState<ProjectSettingsCategory>("basic");
  const [saved, setSaved] = useState(false);
  useDialogFocus(open, dialogRef, onClose, closeRef);
  useEffect(() => { if (open) { setValidation(readResponseValidationSettings(projectId)); setResponseComponents(readResponseComponents(projectId)); setCategory(initialCategory); setSaved(false); } }, [initialCategory, open, projectId]);
  if (!open) return null;
  const openProjectFeature = (eventName: string, detail?: string) => {
    onClose();
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><div ref={dialogRef} className="settings-dialog project-settings-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
    <div className="project-settings-layout">
      <aside className="project-settings-sidebar"><header><h2 id={titleId}>项目设置</h2><span><Icon name="gitBranch"/>{projectName ?? "当前项目"}</span></header><nav className="project-settings-nav" aria-label="项目设置分类"><section><h3><Icon name="settings"/>通用设置</h3><button type="button" className={category === "basic" ? "is-active" : ""} aria-current={category === "basic" ? "page" : undefined} onClick={() => setCategory("basic")}>基本设置</button></section><section><h3><Icon name="bolt"/>功能设置</h3><button type="button" className={category === "tools" ? "is-active" : ""} onClick={() => setCategory("tools")}>接口功能设置</button><button type="button" className={category === "validation" ? "is-active" : ""} aria-current={category === "validation" ? "page" : undefined} onClick={() => setCategory("validation")}>响应校验设置</button></section><section><h3><Icon name="archive"/>项目资源</h3><button type="button" className={category === "responses" ? "is-active" : ""} aria-current={category === "responses" ? "page" : undefined} onClick={() => setCategory("responses")}>响应组件</button><button type="button" className={category === "resources" ? "is-active" : ""} aria-current={category === "resources" ? "page" : undefined} onClick={() => setCategory("resources")}>环境与变量</button><button type="button" className={category === "resources" ? "is-active" : ""} onClick={() => setCategory("resources")}>项目脚本</button></section></nav></aside>
      <main className="project-settings-main">
        <button ref={closeRef} type="button" className="ui-icon-button project-settings-close" aria-label="关闭项目设置" onClick={onClose}><Icon name="close"/></button>
        {category === "basic" ? <section className="project-settings-page"><header><h3>基本设置</h3></header><h4>基本信息</h4><div className="project-basic-card"><div><strong>项目名称</strong><span>{projectName ?? "未命名项目"}</span></div><div><strong>项目 ID</strong><span>{projectId ?? "—"}</span></div><div><strong>项目语言</strong><span>简体中文</span></div></div><h4>项目操作</h4><div className="project-setting-links"><article><Icon name="archive"/><div><strong>克隆项目</strong><span>克隆项目到当前团队或其他团队。</span></div><button type="button" className="ui-button secondary">克隆项目</button></article></div></section> : null}
        {category === "resources" ? <section className="project-settings-page"><header><h3>项目资源</h3><p>管理仅作用于当前项目的环境和公共执行资源。</p></header><div className="project-setting-links"><article><Icon name="menu"/><div><strong>环境与变量</strong><span>项目请求共享的环境变量与 Secret 引用。</span></div><button type="button" className="ui-button secondary" onClick={() => openProjectFeature("apivoy-open-environment")}>管理</button></article><article><Icon name="code"/><div><strong>项目脚本</strong><span>维护可复用的前置与后置操作。</span></div><button type="button" className="ui-button secondary" onClick={() => openProjectFeature("apivoy-open-script-library")}>管理</button></article></div></section> : null}
        {category === "responses" ? <section className="project-settings-page project-response-components-page"><header><div><h3>响应组件</h3><p>集中维护可复用的状态码、内容类型与 Body 结构。</p></div><button type="button" className="ui-button primary" onClick={() => { setSaved(false); setResponseComponents((items) => [...items, createResponseComponent(items.length)]); }}><Icon name="plus"/>新建组件</button></header><div className="project-response-component-list">{responseComponents.map((component, index) => <ResponseComponentCard key={component.id} component={component} index={index} onChange={(next) => { setSaved(false); setResponseComponents((items) => items.map((item) => item.id === component.id ? next : item)); }} onRemove={() => { setSaved(false); setResponseComponents((items) => items.filter((item) => item.id !== component.id)); }}/>)}</div>{!responseComponents.length ? <div className="interface-document-empty">暂无响应组件，创建后可在接口设计中快速引用。</div> : null}</section> : null}
        {category === "validation" ? <section className="project-settings-page project-validation-page"><header><h3>响应校验设置</h3></header><h4>模块功能开关</h4><div className="project-validation-rows">{([['interfaceRun','“接口运行”和“调试用例”里的校验响应','开启后，“接口管理”模块的“运行”、“接口调试用例”界面会显示“校验响应”功能'],['singleCase','“单接口用例”里的校验响应','开启后，“单接口用例”界面会显示“校验响应”功能'],['testScenario','“测试场景”里的校验响应','开启后，“自动化测试”模块的“测试步骤”界面会显示“校验响应”功能']] as const).map(([key,label,description]) => <div className="project-setting-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><label className="http-switch"><input type="checkbox" checked={validation[key]} onChange={(event) => { setSaved(false); setValidation((current) => ({ ...current, [key]: event.target.checked, ...(key === "interfaceRun" ? { enabled: event.target.checked } : {}) })); }}/><span/></label></div>)}</div><h4>校验内容</h4><div className="project-validation-rows">{([['status','校验响应 HTTP 状态码','校验响应时，检查实际响应的状态码是否与接口文档里定义的状态码一致'],['headers','校验响应 Headers','校验响应时，检查接口设计中声明的必需响应头'],['bodyFormat','校验响应 Body 的数据格式','校验响应时，检查 JSON 等响应格式能否正确解析'],['bodySchema','校验响应 Body 的数据结构','校验响应时，检查实际响应的 Body 数据结构是否与接口文档中定义的数据结构一致']] as const).map(([key,label,description]) => <div className="project-setting-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><label className="http-switch"><input type="checkbox" checked={validation[key]} onChange={(event) => { setSaved(false); setValidation((current) => ({ ...current, [key]: event.target.checked })); }}/><span/></label></div>)}<div className={`project-setting-row project-setting-row-nested${validation.bodySchema ? "" : " is-disabled"}`}><div><strong>Object 对象允许额外字段</strong><span>当接口文档的返回响应里 Object 类型的字段未配置“额外字段”时，允许实际响应的数据有额外字段</span></div><label className="http-switch"><input type="checkbox" disabled={!validation.bodySchema} checked={validation.allowAdditionalProperties} onChange={(event) => { setSaved(false); setValidation((current) => ({ ...current, allowAdditionalProperties: event.target.checked })); }}/><span/></label></div></div></section> : null}
        {category === "tools" ? <section className="project-settings-page"><header><h3>项目工具</h3><p>进入当前项目的批量运行与模拟服务。</p></header><div className="project-setting-links"><article><Icon name="send"/><div><strong>集合运行</strong><span>批量执行当前项目中的请求集合。</span></div><button type="button" className="ui-button secondary" onClick={() => openProjectFeature("apivoy-select-workbench", "runner")}>打开</button></article><article><Icon name="archive"/><div><strong>Mock</strong><span>管理当前项目的 Mock 定义。</span></div><button type="button" className="ui-button secondary" onClick={() => openProjectFeature("apivoy-select-workbench", "mock")}>打开</button></article></div></section> : null}
      </main>
    </div>
    <footer className="settings-dialog-footer"><span className="settings-scope-note">{saved ? "项目设置已保存" : "这些设置仅作用于当前项目。"}</span><button type="button" className="ui-button secondary" onClick={onClose}>取消</button><button type="button" className="ui-button primary" disabled={!projectId} onClick={() => { if (projectId) { writeResponseValidationSettings(projectId, validation); writeResponseComponents(projectId, responseComponents); setSaved(true); } }}>保存</button></footer>
  </div></div>;
}

export function AppShell({ title = "ApiVoy", channelLabel, children, explorer, status, connectionStatus = null, collaboration, environment, projectContext }: AppShellProps) {
  const { locale, t } = useI18n();
  const applicationSettingsLabel = locale === "zh-CN" ? "软件设置" : "Application settings";
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsCategory, setProjectSettingsCategory] = useState<ProjectSettingsCategory>("basic");
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [collaborationTab, setCollaborationTab] = useState<CollaborationTab>("team");
  const [projectModule, setProjectModule] = useState<"home" | "resources" | "runner" | "mock" | "automation">(() => {
    if (typeof window === "undefined") return "home";
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const view = params.get("view");
    if (view === "resources" || view === "runner" || view === "mock" || view === "automation") return view;
    const workbench = params.get("workbench");
    if (workbench === "runner" || workbench === "mock") return workbench;
    return workbench ? "resources" : "home";
  });
  const [search, setSearch] = useState("");
  const [activeCommand, setActiveCommand] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const explorerRef = useRef<HTMLElement>(null);
  const resizingExplorerRef = useRef(false);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    if (typeof window === "undefined") return 232;
    const stored = Number(localStorage.getItem("apivoy-explorer-width"));
    return Number.isFinite(stored) ? Math.min(window.innerWidth / 2, Math.max(190, stored)) : 232;
  });
  const explorerWidthRef = useRef(explorerWidth);
  const expandedExplorerWidthRef = useRef(explorerWidth);
  const explorerDragStartWidthRef = useRef(explorerWidth);
  const themeMode = useAppStore((state) => state.themeMode);
  const setThemeMode = useAppStore((state) => state.setThemeMode);
  const collapsedExplorer = useAppStore((state) => state.collapsedExplorer);
  const toggleExplorer = useAppStore((state) => state.toggleExplorer);
  const explorerOpen = !collapsedExplorer;
  const showExplorer = explorerOpen && projectModule !== "home";
  const showProjectRail = projectModule !== "home";

  function maxExplorerWidth() {
    return Math.max(190, (workspaceRef.current?.getBoundingClientRect().width ?? 840) / 2);
  }

  function resizeExplorer(clientX: number) {
    const left = explorerRef.current?.getBoundingClientRect().left ?? workspaceRef.current?.getBoundingClientRect().left ?? 0;
    const next = calculateExplorerWidth(clientX, left, maxExplorerWidth());
    explorerWidthRef.current = next;
    setExplorerWidth(next);
  }

  function finishExplorerResize() {
    if (!resizingExplorerRef.current) return;
    resizingExplorerRef.current = false;
    if (explorerWidthRef.current <= 48) {
      const restoreWidth = explorerDragStartWidthRef.current;
      expandedExplorerWidthRef.current = restoreWidth;
      explorerWidthRef.current = restoreWidth;
      setExplorerWidth(restoreWidth);
      if (explorerOpen) toggleExplorer();
    } else {
      expandedExplorerWidthRef.current = explorerWidthRef.current;
    }
  }

  useEffect(() => { localStorage.setItem("apivoy-explorer-width", String(explorerWidth)); }, [explorerWidth]);

  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", preventBrowserContextMenu);
    return () => window.removeEventListener("contextmenu", preventBrowserContextMenu);
  }, []);
  useEffect(() => {
    const showProjectView = (view: "resources" | "runner" | "mock" | "automation") => {
      setProjectModule(view);
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      params.set("view", view);
      history.replaceState(null, "", `#${params}`);
    };
    const showHome = () => { setProjectModule("home"); const params = new URLSearchParams(window.location.hash.replace(/^#/, "")); params.delete("view"); history.replaceState(null, "", `#${params}`); };
    const showResources = () => showProjectView("resources");
    const showRequest = () => showProjectView("resources");
    const showWorkbench = (event: Event) => { const id = (event as CustomEvent<string>).detail; showProjectView(id === "runner" ? "runner" : id === "mock" ? "mock" : "resources"); };
    window.addEventListener("apivoy-project-home", showHome);
    window.addEventListener("apivoy-project-resources", showResources);
    window.addEventListener("apivoy-open-request", showRequest);
    window.addEventListener("apivoy-select-workbench", showWorkbench);
    return () => {
      window.removeEventListener("apivoy-project-home", showHome);
      window.removeEventListener("apivoy-project-resources", showResources);
      window.removeEventListener("apivoy-open-request", showRequest);
      window.removeEventListener("apivoy-select-workbench", showWorkbench);
    };
  }, []);

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
      setEnvironmentOpen(false);
      setSettingsOpen(true);
    };
    const openEnvironmentEvent = () => {
      setPaletteOpen(false);
      setSettingsOpen(false);
      setCollaborationOpen(false);
      setEnvironmentOpen(true);
    };
    const openProjectSettingsEvent = (event: Event) => {
      setPaletteOpen(false);
      setSettingsOpen(false);
      setCollaborationOpen(false);
      const requestedCategory = (event as CustomEvent<ProjectSettingsCategory>).detail;
      setProjectSettingsCategory(requestedCategory === "responses" ? "responses" : "basic");
      setProjectSettingsOpen(true);
    };
    window.addEventListener("apivoy-open-collaboration", openCollaboration);
    window.addEventListener("apivoy-open-settings", openSettingsEvent);
    window.addEventListener("apivoy-open-environment", openEnvironmentEvent);
    window.addEventListener("apivoy-open-project-settings", openProjectSettingsEvent);
    return () => {
      window.removeEventListener("apivoy-open-collaboration", openCollaboration);
      window.removeEventListener("apivoy-open-settings", openSettingsEvent);
      window.removeEventListener("apivoy-open-environment", openEnvironmentEvent);
      window.removeEventListener("apivoy-open-project-settings", openProjectSettingsEvent);
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
    { id: "action-settings", label: applicationSettingsLabel, icon: "sliders" as const, run: () => openSettings() },
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
        {projectModule === "home" ? <div className="header-home-brand" aria-label={title}><span className="brand-mark"><BrandMark /></span><strong>{title}</strong></div> : projectContext?.projects.length ? <div className="header-project-breadcrumb" aria-label="当前项目">
          <button type="button" aria-label="返回主窗口" onClick={() => window.dispatchEvent(new CustomEvent("apivoy-project-home"))}><Icon name="command"/><span>主窗口</span></button>
          <span className="header-project-separator">/</span>
          <select aria-label="切换项目" value={projectContext.selectedProjectId} onChange={(event) => projectContext.onSelectProject(event.target.value)}>
            {projectContext.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div> : null}
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
        <button className="ui-icon-button" aria-label={applicationSettingsLabel} title={`${applicationSettingsLabel} Ctrl/⌘ ,`} onClick={openSettings}><Icon name="sliders"/></button>
      </div>
    </header>
    <div ref={workspaceRef} className={`app-workspace${showProjectRail ? " has-project-rail" : ""} ${showExplorer ? "explorer-open" : "explorer-collapsed"}`} style={{ "--explorer-width": `${explorerWidth}px` } as CSSProperties}>
      {showProjectRail ? <nav className="project-module-nav" aria-label="项目功能">
        <button type="button" className={projectModule === "resources" ? "is-active" : undefined} onClick={() => { setProjectModule("resources"); window.dispatchEvent(new CustomEvent("apivoy-project-resources")); }}><Icon name="folder"/><span>资源管理</span></button>
        <button type="button" className={projectModule === "runner" ? "is-active" : undefined} onClick={() => { setProjectModule("runner"); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "runner" })); }}><Icon name="send"/><span>运行集合</span></button>
        <button type="button" className={projectModule === "mock" ? "is-active" : undefined} onClick={() => { setProjectModule("mock"); window.dispatchEvent(new CustomEvent("apivoy-select-workbench", { detail: "mock" })); }}><Icon name="archive"/><span>Mock</span></button>
        <button type="button" className={projectModule === "automation" ? "is-active" : undefined} onClick={() => { setProjectModule("automation"); const params = new URLSearchParams(window.location.hash.replace(/^#/, "")); params.set("view", "automation"); params.delete("workbench"); history.replaceState(null, "", `#${params}`); }}><Icon name="bolt"/><span>自动化</span></button>
        <button type="button" className="project-module-settings" onClick={() => { setPaletteOpen(false); setSettingsOpen(false); setProjectSettingsCategory("basic"); setProjectSettingsOpen(true); }}><Icon name="sliders"/><span>项目设置</span></button>
        <div className="project-rail-brand" aria-label={title}><span className="brand-mark"><BrandMark /></span><strong>{title}</strong></div>
      </nav> : null}
      {explorer && showExplorer ? <button type="button" className="explorer-backdrop" aria-label={t("shell.explorer.close")} onClick={toggleExplorer} /> : null}
      {explorer ? <aside ref={explorerRef} id="apivoy-explorer" className="resource-explorer" aria-label={t("shell.explorer")}>{explorer}</aside> : null}
      {explorer && showExplorer ? <div className="explorer-resize-handle" role="separator" aria-label="调整资源管理器宽度" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(maxExplorerWidth())} aria-valuenow={Math.round(explorerWidth)} tabIndex={0} onPointerDown={(event) => { if (window.matchMedia("(max-width: 768px)").matches) return; explorerDragStartWidthRef.current = explorerWidthRef.current; resizingExplorerRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (resizingExplorerRef.current) resizeExplorer(event.clientX); }} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); finishExplorerResize(); }} onPointerCancel={finishExplorerResize} onDoubleClick={() => { explorerWidthRef.current = 232; expandedExplorerWidthRef.current = 232; setExplorerWidth(232); }} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = Math.min(maxExplorerWidth(), Math.max(190, explorerWidth + (event.key === "ArrowRight" ? 10 : -10))); explorerWidthRef.current = next; expandedExplorerWidthRef.current = next; setExplorerWidth(next); }}/>: null}
      {explorer && projectModule !== "home" && !explorerOpen ? <button type="button" className="explorer-edge-toggle" aria-label={t("shell.explorer")} aria-expanded={false} aria-controls="apivoy-explorer" title={t("shell.explorer")} onClick={toggleExplorer}><Icon name="chevron"/></button> : null}
      <main id="apivoy-main" tabIndex={-1} className="app-main">{children}</main>
    </div>
    {paletteOpen ? <div className="command-overlay" role="presentation" onMouseDown={() => setPaletteOpen(false)}><div ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-label={t("command.title")} onMouseDown={(event) => event.stopPropagation()}><div className="command-input-wrap"><Icon name="search"/><input ref={paletteInputRef} role="combobox" aria-expanded="true" aria-controls="apivoy-command-results" aria-activedescendant={commandResults[activeCommand] ? `command-${commandResults[activeCommand].id}` : undefined} autoComplete="off" value={search} onKeyDown={onCommandKeyDown} onChange={(event) => setSearch(event.target.value)} placeholder={t("command.placeholder")} aria-label={t("command.open")}/></div>
      <div id="apivoy-command-results" role="listbox" aria-label={t("command.title")}>
      {actions.length ? <><div className="command-group-label">{t("command.actions")}</div>{actions.map((action, index) => <button id={`command-${action.id}`} role="option" aria-selected={activeCommand === index} className={activeCommand === index ? "is-active" : undefined} key={action.id} type="button" onMouseEnter={() => setActiveCommand(index)} onClick={() => runCommand(index)}><span><Icon name={action.icon}/>{action.label}</span></button>)}</> : null}
      <div className="command-group-label">{t("command.workbenches")}</div>
      {workbenchCommands.map((command, index) => { const resultIndex = actions.length + index; return <button id={`command-workbench-${command.id}`} role="option" aria-selected={activeCommand === resultIndex} className={activeCommand === resultIndex ? "is-active" : undefined} key={command.id} onMouseEnter={() => setActiveCommand(resultIndex)} onClick={() => runCommand(resultIndex)}><span><Icon name="bolt"/>{command.label}</span><kbd>Enter</kbd></button>; })}
      {workbenchCommands.length === 0 && actions.length === 0 ? <div className="command-empty">{t("command.empty")}</div> : null}
    </div></div></div> : null}
    <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} channelLabel={channelLabel} />
    <ProjectSettingsDialog open={projectSettingsOpen} onClose={() => setProjectSettingsOpen(false)} projectId={projectContext?.selectedProjectId} projectName={projectContext?.projects.find((project) => project.id === projectContext.selectedProjectId)?.name} initialCategory={projectSettingsCategory}/>
    <EnvironmentVariablesDialog open={environmentOpen} onClose={() => setEnvironmentOpen(false)} environment={environment}/>
    {collaboration ? <CollaborationHub open={collaborationOpen} onClose={() => setCollaborationOpen(false)} initialTab={collaborationTab} team={collaboration.team} comments={collaboration.comments} sso={collaboration.sso} /> : null}
  </div></FeedbackProvider>;
}
