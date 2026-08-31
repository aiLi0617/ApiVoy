import { IMPORT_MAX_DOCUMENTS, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_TOTAL_BYTES, importDocument, type PortableRequest } from "@apivoy/import-export";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFeedback } from "./Feedback";
import { Icon } from "./Icons";
import { readInterfaceStructureMetadata } from "./interfaceStructureV2";
import { stashCaseInterfaceStructure } from "./caseStructureBridge";
import { useAppStore } from "./appStore";

export interface WorkspaceRecord { id: string; name: string; rootPath?: string | null; archived?: boolean; updatedAt?: string }
export interface ProjectRecord { id: string; workspaceId: string; name: string }
export interface ModuleRecord { id: string; projectId: string; name: string; isDefault: boolean }
export interface CollectionRecord { id: string; projectId: string; moduleId?: string; name: string; parentId?: string | null; sortOrder: number; tags?: string[] }
export interface RequestRecord { id: string; projectId: string; collectionId: string; name: string; protocolId?: string; method?: string; target: string; envelope?: { variables?: Record<string, string>; metadata?: Record<string, unknown> } }
export interface WorkspaceTree { workspaces: WorkspaceRecord[]; projects: ProjectRecord[]; modules?: ModuleRecord[]; collections: CollectionRecord[]; requests: RequestRecord[] }

function isDebugCase(request: RequestRecord): boolean {
  return Boolean(request.envelope?.variables?.__apivoyCaseOf) && request.envelope?.metadata?.__apivoyCaseType !== "test";
}

const CREATE_PROTOCOL_GROUPS = [
  { label: "API", items: [["http", "HTTP", "globe"], ["grpc", "gRPC", "network"]] },
  { label: "实时通信", items: [["websocket", "WebSocket", "activity"], ["sse", "SSE", "activity"], ["tcp", "TCP", "network"], ["udp", "UDP", "network"]] },
  { label: "消息协议", items: [["mqtt", "MQTT", "network"], ["amqp", "AMQP", "network"], ["kafka", "Kafka", "network"]] },
  { label: "数据协议", items: [["redis", "Redis", "database"], ["sql", "SQL", "database"]] },
] as const;

export interface WorkspaceExplorerProps {
  tree: WorkspaceTree | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  selectedCollectionId?: string | null;
  selectedRequestId?: string | null;
  selectedProjectId?: string | null;
  onSelectCollection: (projectId: string, collectionId: string) => void;
  onOpenRequest: (id: string) => void;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (id: string, name: string) => Promise<void>;
  onArchiveWorkspace: (id: string, archived: boolean) => Promise<void>;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onTouchWorkspace: (id: string) => Promise<void>;
  onCreateProject: (workspaceId: string, name: string) => Promise<void>;
  onCreateModule?: (projectId: string, name: string) => Promise<void>;
  onRenameProject: (id: string, name: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onCreateCollection: (projectId: string, parentId: string | null, name: string, moduleId?: string) => Promise<void>;
  onRenameCollection: (collection: CollectionRecord, name: string) => Promise<void>;
  onUpdateCollectionTags: (collection: CollectionRecord, tags: string[]) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  onDeleteRequest: (id: string) => Promise<void>;
  onRenameRequest?: (request: RequestRecord, name: string) => Promise<void>;
  onDuplicateRequest?: (request: RequestRecord) => Promise<void>;
  onCopyRequestAsCurl?: (request: RequestRecord) => Promise<string>;
  onMoveCollection: (collection: CollectionRecord, projectId: string, parentId: string | null) => Promise<void>;
  onSwapCollections: (first: CollectionRecord, second: CollectionRecord) => Promise<void>;
  onMoveRequest: (id: string, projectId: string, collectionId: string) => Promise<void>;
  onImportRequests: (projectId: string, collectionId: string, requests: PortableRequest[]) => Promise<void>;
  onExportProject: (project: ProjectRecord) => Promise<PortableRequest[]>;
}

export function WorkspaceExplorer(props: WorkspaceExplorerProps) {
  const [draft, setDraft] = useState<{ kind: "project"; owner: string } | { kind: "module"; owner: string } | { kind: "collection"; owner: string; parentId: string | null; moduleId?: string } | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchTarget, setBatchTarget] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const createMenuRef = useRef<HTMLDivElement>(null);
  const createMenuButtonRef = useRef<HTMLButtonElement>(null);
  const collapsedNodes = useAppStore((state) => state.collapsedExplorerNodes);
  const toggleExplorerNode = useAppStore((state) => state.toggleExplorerNode);
  const importInput = useRef<HTMLInputElement>(null);
  const { notify, confirm, prompt } = useFeedback();
  function onTreeKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const root = event.currentTarget;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter((item) => item.offsetParent !== null);
    if (!items.length) return;
    const activeItem = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[role="treeitem"]');
    const current = Math.max(0, activeItem ? items.indexOf(activeItem) : 0);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const chevron = items[current].querySelector<HTMLButtonElement>(".tree-chevron");
      if (chevron && ((event.key === "ArrowLeft" && chevron.getAttribute("aria-expanded") === "true") || (event.key === "ArrowRight" && chevron.getAttribute("aria-expanded") === "false"))) { event.preventDefault(); chevron.click(); }
      return;
    }
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
    (items[next].querySelector<HTMLElement>(".tree-main, .tree-chevron") ?? items[next]).focus();
  }

  useEffect(() => {
    const openImport = () => importInput.current?.click();
    window.addEventListener("apivoy-import-requests", openImport);
    return () => window.removeEventListener("apivoy-import-requests", openImport);
  }, []);
  useEffect(() => {
    if (!openMenuId) return;
    const dismiss = () => { setOpenMenuId(null); setMenuPos(null); };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-tree-menu="${openMenuId}"]`)) return;
      dismiss();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [openMenuId]);
  useEffect(() => {
    if (!createMenuOpen) return;
    const close = (event: MouseEvent) => { const target = event.target as HTMLElement | null; if (!createMenuRef.current?.contains(target) && !target?.closest("[data-workspace-create-menu]")) setCreateMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setCreateMenuOpen(false); };
    const dismiss = () => setCreateMenuOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [createMenuOpen]);
  useLayoutEffect(() => {
    if (!createMenuOpen) { setCreateMenuPos(null); return; }
    const rect = createMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCreateMenuPos({ top: rect.bottom + 4, left: rect.left, width: Math.min(390, window.innerWidth - rect.left - 8) });
  }, [createMenuOpen]);
  useLayoutEffect(() => {
    if (!openMenuId) { setMenuPos(null); return; }
    const button = menuButtonRefs.current.get(openMenuId);
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 168;
    const estimatedHeight = 260;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const below = rect.bottom + 4;
    const top = below + estimatedHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : below;
    setMenuPos({ top, left });
  }, [openMenuId]);

  function openCollectionMenu(collectionId: string) {
    setOpenMenuId((current) => {
      if (current === collectionId) { setMenuPos(null); return null; }
      return collectionId;
    });
  }

  function renderCollectionMenu(collection: CollectionRecord, siblingIndex: number, siblings: CollectionRecord[]): ReactNode {
    if (openMenuId !== collection.id || !menuPos || typeof document === "undefined") return null;
    return createPortal(
      <div className="tree-more-panel" role="menu" data-tree-menu={collection.id} style={{ top: menuPos.top, left: menuPos.left }}>
        <button type="button" role="menuitem" onClick={() => { props.onSelectCollection(collection.projectId, collection.id); importInput.current?.click(); setOpenMenuId(null); }}><Icon name="download" />导入到此集合</button>
        <button type="button" role="menuitem" disabled={siblingIndex <= 0} onClick={() => { void props.onSwapCollections(collection, siblings[siblingIndex - 1]); setOpenMenuId(null); }}><Icon name="arrow-up" />上移</button>
        <button type="button" role="menuitem" disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1} onClick={() => { void props.onSwapCollections(collection, siblings[siblingIndex + 1]); setOpenMenuId(null); }}><Icon name="arrow-down" />下移</button>
        <button type="button" role="menuitem" onClick={() => { setDraft({ kind: "collection", owner: collection.projectId, parentId: collection.id }); setOpenMenuId(null); }}><Icon name="plus" />新建子集合</button>
        <button type="button" role="menuitem" onClick={async () => { setOpenMenuId(null); const value = (await prompt({ title: "重命名集合", initialValue: collection.name }))?.trim(); if (value) void props.onRenameCollection(collection, value); }}><Icon name="edit" />重命名</button>
        <button type="button" role="menuitem" onClick={async () => { setOpenMenuId(null); const value = await prompt({ title: "设置集合标签", initialValue: collection.tags?.join(", ") ?? "", placeholder: "标签以逗号分隔" }); if (value !== null) void props.onUpdateCollectionTags(collection, value.split(",").map((tag) => tag.trim()).filter(Boolean)); }}><Icon name="tag" />标签</button>
        {collection.id !== "default-collection" ? <button type="button" role="menuitem" onClick={async () => { setOpenMenuId(null); if (await confirm({ title: "删除集合", description: `删除集合“${collection.name}”及其中全部内容？`, tone: "danger", confirmLabel: "删除" })) void props.onDeleteCollection(collection.id); }}><Icon name="trash" />删除</button> : null}
      </div>,
      document.body,
    );
  }

  function renderRequestMenu(request: RequestRecord): ReactNode {
    if (openMenuId !== `request:${request.id}` || !menuPos || typeof document === "undefined") return null;
    const canCopyCurl = (request.protocolId ?? "http") === "http";
    return createPortal(
      <div className="tree-more-panel" role="menu" data-tree-menu={`request:${request.id}`} style={{ top: menuPos.top, left: menuPos.left }}>
        <button type="button" role="menuitem" disabled={!props.onRenameRequest} onClick={async () => { setOpenMenuId(null); const value = (await prompt({ title: "重命名接口", initialValue: request.name }))?.trim(); if (value) await props.onRenameRequest?.(request, value); }}><Icon name="edit" />重命名</button>
        <button type="button" role="menuitem" disabled={!props.onDuplicateRequest} onClick={async () => { setOpenMenuId(null); if (props.onDuplicateRequest) { await props.onDuplicateRequest(request); notify(`已复制接口“${request.name}”`, "success"); } }}><Icon name="copy" />复制</button>
        <button type="button" role="menuitem" disabled={!canCopyCurl || !props.onCopyRequestAsCurl} title={canCopyCurl ? undefined : "仅 HTTP 接口支持复制 cURL"} onClick={async () => { setOpenMenuId(null); const curl = await props.onCopyRequestAsCurl?.(request); if (curl) { await navigator.clipboard.writeText(curl); notify("已复制 cURL", "success"); } }}><Icon name="code" />复制 cURL</button>
        <div className="tree-more-panel-divider" role="separator" />
        <button type="button" className="is-danger" role="menuitem" onClick={async () => { setOpenMenuId(null); if (await confirm({ title: "删除接口", description: `确定删除接口“${request.name}”吗？`, tone: "danger", confirmLabel: "删除" })) await deleteRequest(request.id, request.name); }}><Icon name="trash" />删除</button>
      </div>,
      document.body,
    );
  }

  async function importFiles(files?: FileList | null) {
    if (!files?.length) return;
    const selected = [...files];
    const file = selected[0];
    const collection = tree?.collections.find((item) => item.id === props.selectedCollectionId);
    if (!collection) { notify("请先选择一个目标集合", "warning"); return; }
    try {
      if (selected.length > IMPORT_MAX_DOCUMENTS) throw new Error(`导入文档数量超过 ${IMPORT_MAX_DOCUMENTS} 个的上限`);
      const oversized = selected.find((item) => item.size > IMPORT_MAX_FILE_BYTES);
      if (oversized) throw new Error(`${oversized.name} 超过 ${IMPORT_MAX_FILE_BYTES} 字节的导入上限`);
      const totalBytes = selected.reduce((total, item) => total + item.size, 0);
      if (totalBytes > IMPORT_MAX_TOTAL_BYTES) throw new Error(`导入文档总大小超过 ${IMPORT_MAX_TOTAL_BYTES} 字节的上限`);
      const dependencyEntries = await Promise.all(selected.slice(1).map(async (dependency) => {
        const text = await dependency.text();
        return [dependency.webkitRelativePath || dependency.name, text] as const;
      }));
      const result = await importDocument(await file.text(), {
        baseUri: file.webkitRelativePath || file.name,
        documents: Object.fromEntries(dependencyEntries),
      });
      await props.onImportRequests(collection.projectId, collection.id, result.requests);
      notify(`已从 ${result.source} 导入 ${result.requests.length} 个请求${result.warnings.length ? `\\n${result.warnings.join("\\n")}` : ""}`, "success");
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "danger"); }
    if (importInput.current) importInput.current.value = "";
  }

  async function submit() {
    const value = name.trim();
    if (!draft || !value) return;
    if (draft.kind === "project") await props.onCreateProject(draft.owner, value);
    else if (draft.kind === "module") await props.onCreateModule?.(draft.owner, value);
    else await props.onCreateCollection(draft.owner, draft.parentId, value, draft.moduleId);
    setDraft(null);
    setName("");
  }

  const tree = props.tree;
  if (props.loading) return <div style={styles.empty} role="status" aria-live="polite">正在加载工作区…</div>;
  if (props.error) return <div className="workspace-load-error" role="alert"><Icon name="archive"/><strong>无法加载工作区</strong><span>{props.error}</span><div><button type="button" className="ui-button primary" onClick={props.onRetry}>重试</button><button type="button" className="ui-button secondary" onClick={() => window.dispatchEvent(new CustomEvent("apivoy-open-settings"))}>检查 Local Agent 设置</button></div></div>;
  if (!tree) return <div style={styles.empty} role="status">尚未加载工作区</div>;
  const workspace = tree.workspaces[0];
  const workspaceProjects = tree.projects.filter((project) => project.workspaceId === workspace?.id);
  const collectionCountCache = new Map<string, number>();
  function collectionRequestCount(collectionId: string, ancestors = new Set<string>()): number {
    const cached = collectionCountCache.get(collectionId);
    if (cached != null) return cached;
    if (ancestors.has(collectionId)) return 0;
    const nextAncestors = new Set(ancestors).add(collectionId);
    const direct = tree!.requests.filter((request) => request.collectionId === collectionId && !request.envelope?.variables?.__apivoyCaseOf).length;
    const descendants = tree!.collections.filter((collection) => collection.parentId === collectionId).reduce((count, child) => count + collectionRequestCount(child.id, nextAncestors), 0);
    const total = direct + descendants;
    collectionCountCache.set(collectionId, total);
    return total;
  }
  const selectedProjectIds = [...new Set(tree.requests.filter((item) => selectedIds.includes(item.id)).map((item) => item.projectId))];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedProject = tree.projects.find((project) => project.id === props.selectedProjectId) ?? workspaceProjects[0];
  const selectedProjectRequestCount = selectedProject ? tree.requests.filter((request) => request.projectId === selectedProject.id && !request.envelope?.variables?.__apivoyCaseOf).length : 0;
  const projectModules = selectedProject ? (tree.modules?.filter((module) => module.projectId === selectedProject.id) ?? [{ id: `default-module-${selectedProject.id}`, projectId: selectedProject.id, name: "默认模块", isDefault: true }]) : [];
  const collectionInModule = (collection: CollectionRecord, module: ModuleRecord) => collection.moduleId ? collection.moduleId === module.id : module.isDefault;
  function collectionPath(parentId: string | null): CollectionRecord[] {
    const path: CollectionRecord[] = [];
    const visited = new Set<string>();
    let currentId = parentId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const current = tree!.collections.find((collection) => collection.id === currentId);
      if (!current) break;
      path.unshift(current);
      currentId = current.parentId ?? null;
    }
    return path;
  }
  function collectionMatches(collection: CollectionRecord): boolean {
    if (!normalizedQuery) return true;
    if (collection.name.toLocaleLowerCase().includes(normalizedQuery)) return true;
    if (tree!.requests.some((item) => item.collectionId === collection.id && `${item.name} ${item.target}`.toLocaleLowerCase().includes(normalizedQuery))) return true;
    return tree!.collections.filter((item) => item.parentId === collection.id).some(collectionMatches);
  }
  function readDrag(event: DragEvent): { type: "request" | "collection"; id: string } | null {
    try { return JSON.parse(event.dataTransfer.getData("application/x-apivoy-item")); } catch { return null; }
  }
  function setDrag(event: DragEvent, type: "request" | "collection", id: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-apivoy-item", JSON.stringify({ type, id }));
  }
  function dropOnCollection(event: DragEvent, target: CollectionRecord) {
    event.preventDefault();
    const item = readDrag(event);
    if (!item) return;
    if (item.type === "request") void props.onMoveRequest(item.id, target.projectId, target.id);
    else {
      const source = tree!.collections.find((collection) => collection.id === item.id);
      if (source && source.id !== target.id && source.projectId === target.projectId) {
        if ((source.parentId ?? null) === (target.parentId ?? null) && (source.moduleId ?? null) === (target.moduleId ?? null)) void props.onSwapCollections(source, target);
        else void props.onMoveCollection(source, target.projectId, target.id);
      }
    }
  }
  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  async function deleteRequest(id: string, name: string, showSuccess = true): Promise<boolean> {
    try {
      await props.onDeleteRequest(id);
      setSelectedIds((current) => current.filter((item) => item !== id));
      if (showSuccess) notify(`已删除请求“${name}”`, "success");
      return true;
    } catch (error) {
      notify(`删除请求失败：${error instanceof Error ? error.message : String(error)}`, "danger");
      return false;
    }
  }
  async function batchDelete() {
    if (!selectedIds.length || !(await confirm({ title: "删除请求", description: `确定删除选中的 ${selectedIds.length} 个请求吗？`, tone: "danger", confirmLabel: "删除" }))) return;
    const targets = tree!.requests.filter((item) => selectedIds.includes(item.id));
    let deleted = 0;
    for (const request of targets) if (await deleteRequest(request.id, request.name, false)) deleted += 1;
    if (deleted) notify(`已删除 ${deleted} 个请求`, "success");
    setBatchMode(false);
  }
  async function batchMove() {
    const target = tree!.collections.find((item) => item.id === batchTarget);
    if (!target) return;
    for (const id of selectedIds) await props.onMoveRequest(id, target.projectId, target.id);
    setSelectedIds([]);
    setBatchMode(false);
  }
  function renderCollection(collection: CollectionRecord, depth = 0) {
    const collectionRequests = tree!.requests.filter((item) => item.collectionId === collection.id);
    const requests = collectionRequests.filter((item) => !item.envelope?.variables?.__apivoyCaseOf).flatMap((request) => {
      const cases = collectionRequests.filter((item) => item.envelope?.variables?.__apivoyCaseOf === request.id && isDebugCase(item));
      return collapsedNodes.includes(`request:${request.id}`) ? [request] : [request, ...cases];
    });
    const siblings = tree!.collections.filter((item) => item.projectId === collection.projectId && (item.parentId ?? null) === (collection.parentId ?? null)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const siblingIndex = siblings.findIndex((item) => item.id === collection.id);
    const children = tree!.collections.filter((item) => item.parentId === collection.id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const isCollapsed = collapsedNodes.includes(`collection:${collection.id}`);
    return <div key={collection.id} className="tree-collection-node" data-depth={depth} role="treeitem" aria-level={depth + 1} aria-setsize={siblings.length} aria-posinset={siblingIndex + 1} aria-expanded={!isCollapsed} aria-label={`集合 ${collection.name}`}>
      <div draggable onDragStart={(event) => setDrag(event, "collection", collection.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnCollection(event, collection)} className={`tree-row${props.selectedCollectionId === collection.id ? " is-active" : ""}${openMenuId === collection.id ? " is-menu-open" : ""}`} style={{...styles.collection, paddingLeft: 12 + depth * 20, ...(props.selectedCollectionId === collection.id ? styles.active : {})}}>
        <button type="button" aria-label={`${isCollapsed ? "展开" : "折叠"}集合 ${collection.name}`} aria-expanded={!isCollapsed} className={`tree-chevron${isCollapsed ? "" : " is-expanded"}`} style={styles.chevronBtn} onClick={() => toggleExplorerNode(`collection:${collection.id}`)}><Icon name="chevron" /></button>
        <button type="button" className="tree-main" style={styles.collectionMain} onClick={() => props.onSelectCollection(collection.projectId, collection.id)} title={collection.name}>
          <Icon name="folder" />
          <span className="tree-label">{collection.name}</span>
          <small className="tree-count" title={`${requests.length} 个直接请求，${collectionRequestCount(collection.id)} 个请求（含子集合）`}>{collectionRequestCount(collection.id)}</small>
        </button>
        <span className="tree-actions">
          <span className="tree-more" data-tree-menu={collection.id}>
            <button
              type="button"
              ref={(node) => { if (node) menuButtonRefs.current.set(collection.id, node); else menuButtonRefs.current.delete(collection.id); }}
              style={styles.action}
              title="更多操作"
              aria-expanded={openMenuId === collection.id}
              aria-haspopup="menu"
              onClick={(event) => { event.stopPropagation(); openCollectionMenu(collection.id); }}
            ><Icon name="menu" /></button>
            {renderCollectionMenu(collection, siblingIndex, siblings)}
          </span>
        </span>
      </div>
      {!isCollapsed && children.filter(collectionMatches).map((child) => renderCollection(child, depth + 1))}
      {!isCollapsed && !!collection.tags?.length && <div style={{ ...styles.tags, paddingLeft: 31 + depth * 20 }}>{collection.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      {!isCollapsed && requests.filter((request) => !normalizedQuery || `${request.name} ${request.target}`.toLocaleLowerCase().includes(normalizedQuery)).map((request, requestIndex, visibleRequests) => <div draggable={!batchMode} onDragStart={(event) => setDrag(event, "request", request.id)} className={`tree-row${request.envelope?.variables?.__apivoyCaseOf ? " tree-case-row" : ""}${batchMode ? " is-batch-mode" : ""}${selectedIds.includes(request.id) ? " is-selected" : ""}${props.selectedRequestId === request.id ? " is-active" : ""}${openMenuId === `request:${request.id}` ? " is-menu-open" : ""}`} role="treeitem" aria-selected={batchMode ? selectedIds.includes(request.id) : undefined} aria-level={depth + (request.envelope?.variables?.__apivoyCaseOf ? 3 : 2)} aria-setsize={visibleRequests.length} aria-posinset={requestIndex + 1} key={request.id} style={{...styles.requestRow, paddingLeft: (request.envelope?.variables?.__apivoyCaseOf ? 73 : 38) + depth * 20, ...(props.selectedRequestId === request.id && !batchMode ? styles.active : {})}}>
        {!request.envelope?.variables?.__apivoyCaseOf ? (collectionRequests.some((item) => item.envelope?.variables?.__apivoyCaseOf === request.id && isDebugCase(item)) ? <span className="tree-actions-leading"><button type="button" className={`tree-chevron tree-request-chevron${collapsedNodes.includes(`request:${request.id}`) ? "" : " is-expanded"}`} style={styles.chevronBtn} aria-label={`${collapsedNodes.includes(`request:${request.id}`) ? "展开" : "收起"}调试用例 ${request.name}`} aria-expanded={!collapsedNodes.includes(`request:${request.id}`)} onClick={() => toggleExplorerNode(`request:${request.id}`)}><Icon name="chevron"/></button></span> : <span className="tree-actions-leading tree-chevron-placeholder" aria-hidden="true"><span className="tree-chevron tree-request-chevron" style={styles.chevronBtn}><Icon name="chevron"/></span></span>) : null}
        <button type="button" className="tree-main" style={styles.request} onClick={() => { if (batchMode) { toggleSelected(request.id); return; } const parentId = request.envelope?.variables?.__apivoyCaseOf; const parentStructure = parentId ? readInterfaceStructureMetadata(collectionRequests.find((item) => item.id === parentId)?.envelope?.metadata) : null; if (parentStructure) stashCaseInterfaceStructure(request.id, parentStructure); props.onOpenRequest(request.id); }} title={batchMode ? (selectedIds.includes(request.id) ? "取消选择" : "选择此项") : request.target}>{request.envelope?.variables?.__apivoyCaseOf ? <span className="tree-case-icon" title="调试用例"><Icon name="bolt"/></span> : request.protocolId === "websocket" ? <span className="tree-protocol-icon tree-protocol-websocket" title="WebSocket"><Icon name="websocket" /></span> : <b>{request.method ?? request.protocolId?.toUpperCase() ?? "HTTP"}</b>}<span className="tree-label">{request.name}</span>{!request.envelope?.variables?.__apivoyCaseOf && collectionRequests.some((item) => item.envelope?.variables?.__apivoyCaseOf === request.id && isDebugCase(item)) ? <small className="tree-interface-case-count" title="调试用例数量">（{collectionRequests.filter((item) => item.envelope?.variables?.__apivoyCaseOf === request.id && isDebugCase(item)).length}）</small> : null}</button>
        <span className="tree-actions tree-more" data-tree-menu={`request:${request.id}`}><button type="button" ref={(node) => { const id = `request:${request.id}`; if (node) menuButtonRefs.current.set(id, node); else menuButtonRefs.current.delete(id); }} style={styles.action} title="更多操作" aria-label={`${request.name} 更多操作`} aria-expanded={openMenuId === `request:${request.id}`} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); openCollectionMenu(`request:${request.id}`); }}><Icon name="menu" /></button>{renderRequestMenu(request)}</span>
      </div>)}
    </div>;
  }
  return <section style={styles.root} role="tree" aria-label="工作区资源树" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End" tabIndex={0} onKeyDown={onTreeKeyDown}>
    <div style={styles.heading}>
      <span style={styles.headingLabel}>接口管理 <small className="workspace-resource-count" title="当前项目请求总数">{selectedProjectRequestCount}</small></span>
      <input ref={importInput} hidden multiple type="file" accept=".json,.yaml,.yml,.har,.apivoy" onChange={(event) => void importFiles(event.target.files)} />
    </div>
    <div ref={createMenuRef} className="workspace-quick-actions">
      <div className="workspace-search-row">
        <span className="workspace-search-field"><Icon name="search"/><input aria-label="搜索接口" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索接口、集合或 URL" /></span>
        <button type="button" className={`workspace-batch-trigger${batchMode ? " is-active" : ""}`} aria-pressed={batchMode} title={batchMode ? "退出多选" : "进入多选"} onClick={() => { setBatchMode((value) => !value); setSelectedIds([]); setBatchTarget(""); }}>多选</button>
        <button ref={createMenuButtonRef} className="workspace-create-trigger" type="button" aria-label="新建资源" title="新建资源" aria-haspopup="menu" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen((value) => !value)}><Icon name="plus" /></button>
      </div>
      {createMenuOpen && createMenuPos && typeof document !== "undefined" ? createPortal(<div className="workspace-protocol-menu" data-workspace-create-menu role="menu" aria-label="选择接口协议" style={{ top: createMenuPos.top, left: createMenuPos.left, width: createMenuPos.width }}>
        <div className="workspace-create-menu-title">新建</div>
        <div className="workspace-create-menu-grid">{CREATE_PROTOCOL_GROUPS.map((group) => group.items.map(([id, label, icon]) => <button key={id} type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); window.dispatchEvent(new CustomEvent("apivoy-create-workbench", { detail: id })); }}><Icon name={icon} /><span>{label === "HTTP" ? "HTTP 接口" : label}</span></button>))}</div>
        <div className="workspace-create-menu-divider"/>
        <div className="workspace-create-menu-title">项目资源</div>
        <div className="workspace-create-menu-grid">
          <button type="button" role="menuitem" disabled={!selectedProject} onClick={() => { if (selectedProject) setDraft({ kind: "module", owner: selectedProject.id }); setCreateMenuOpen(false); }}><Icon name="folder"/><span>接口目录</span></button>
          <button type="button" role="menuitem" disabled={!props.selectedCollectionId} onClick={() => { const selected = tree.collections.find((item) => item.id === props.selectedCollectionId); if (selected) setDraft({ kind: "collection", owner: selected.projectId, parentId: selected.id }); setCreateMenuOpen(false); }}><Icon name="folder"/><span>新建子集合</span></button>
          <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); window.dispatchEvent(new CustomEvent("apivoy-open-script-library")); }}><Icon name="code"/><span>脚本库</span></button>
        </div>
        <div className="workspace-create-menu-divider"/>
        <div className="workspace-create-menu-title">其他</div>
        <div className="workspace-create-menu-grid">
          <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); importInput.current?.click(); }}><Icon name="download"/><span>导入文件</span></button>
          <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); window.dispatchEvent(new CustomEvent("apivoy-open-curl-import", { detail: { projectId: selectedProject?.id, collectionId: props.selectedCollectionId ?? undefined } })); }}><Icon name="code"/><span>导入 cURL</span></button>
        </div>
      </div>, document.body) : null}
    </div>
    {batchMode && <div style={styles.batchBar}>
      <strong>{selectedIds.length} 已选</strong>
      <select aria-label="批量移动目标集合" style={styles.batchSelect} value={batchTarget} onChange={(event) => setBatchTarget(event.target.value)} disabled={!selectedIds.length || selectedProjectIds.length !== 1}><option value="">{!selectedIds.length ? "点击资源选择" : selectedProjectIds.length === 1 ? "移动到…" : "跨项目不可批量移动"}</option>{tree.collections.filter((item) => item.projectId === selectedProjectIds[0]).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button style={styles.action} disabled={!batchTarget} onClick={() => void batchMove()}>移动</button>
      <button style={styles.delete} disabled={!selectedIds.length} onClick={() => void batchDelete()}>删除</button>
      <button style={styles.action} onClick={() => { setBatchMode(false); setSelectedIds([]); setBatchTarget(""); }}>取消</button>
    </div>}
    {selectedProject ? projectModules.map((module) => { const moduleCollapsed = collapsedNodes.includes(`module:${module.id}`); return <div key={module.id} className="tree-module" role="treeitem" aria-expanded={!moduleCollapsed} aria-label={`模块 ${module.name}`}>
      <div className="tree-row tree-module-row" style={styles.moduleRow}><button type="button" className={`tree-chevron${moduleCollapsed ? "" : " is-expanded"}`} style={styles.chevronBtn} aria-label={`${moduleCollapsed ? "展开" : "折叠"}模块 ${module.name}`} onClick={() => toggleExplorerNode(`module:${module.id}`)}><Icon name="chevron"/></button><Icon name="folder"/><strong className="tree-label">{module.name}</strong>{module.isDefault ? <small style={styles.moduleBadge}>默认</small> : null}<button type="button" style={styles.action} title="在此模块中新建集合" onClick={() => setDraft({ kind: "collection", owner: module.projectId, parentId: null, moduleId: module.id })}><Icon name="plus"/></button></div>
      {!moduleCollapsed ? <div className="tree-module-content">

        {tree.collections.filter((item) => item.projectId === selectedProject.id && collectionInModule(item, module) && !item.parentId && collectionMatches(item)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((collection) => renderCollection(collection, 1))}


      </div> : null}
    </div>; }) : null}
    {draft?.kind === "module" && typeof document !== "undefined" ? createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={() => setDraft(null)}><div className="collection-create-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>新建接口目录</h2><p>请选择要创建的目录类型</p></div><button type="button" className="ui-icon-button" aria-label="关闭" onClick={() => setDraft(null)}><Icon name="close"/></button></header><div className="interface-directory-options"><button type="button" onClick={() => { setDraft({ kind: "module", owner: draft.owner }); }} className="is-selected"><Icon name="folder"/><span><strong>模块</strong><small>划分独立业务域，可包含多个目录</small></span></button><button type="button" onClick={() => setDraft({ kind: "collection", owner: draft.owner, parentId: null })}><Icon name="folder"/><span><strong>目录</strong><small>直接创建项目根目录</small></span></button></div><label><span>模块名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="例如：用户中心"/></label><footer><button type="button" className="ui-button secondary" onClick={() => setDraft(null)}>取消</button><button type="button" className="ui-button primary" disabled={!name.trim() || !props.onCreateModule} onClick={() => void submit()}>创建模块</button></footer></div></div>, document.body) : null}
    {draft?.kind === "collection" && typeof document !== "undefined" ? createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={() => setDraft(null)}><div className="collection-create-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-create-title" onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id="collection-create-title">新建集合</h2><p>{collectionPath(draft.parentId).length ? `父级：${collectionPath(draft.parentId).map((item) => item.name).join(" / ")}` : `项目根目录：${selectedProject?.name ?? "当前项目"}`}</p></div><button type="button" className="ui-icon-button" aria-label="关闭" onClick={() => setDraft(null)}><Icon name="close"/></button></header><div className="collection-create-level"><Icon name="folder"/><span>新集合将位于第 <strong>{collectionPath(draft.parentId).length + 1}</strong> 层</span></div><label><span>集合名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="请输入集合名称"/></label><footer><button type="button" className="ui-button secondary" onClick={() => { setDraft(null); setName(""); }}>取消</button><button type="button" className="ui-button primary" disabled={!name.trim()} onClick={() => void submit()}>创建集合</button></footer></div></div>, document.body) : null}
  </section>;
}

const styles: Record<string, CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: 6, minHeight: 0 },
  empty: { color: "var(--apivoy-muted)", fontSize: 12, padding: 10 },
  heading: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 10px 7px", color: "var(--apivoy-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  headingLabel: { display: "inline-flex", alignItems: "center", gap: 6 },
  headingActions: { display: "flex", alignItems: "center", gap: 4 },
  workspaceBar: { display: "flex", alignItems: "center", gap: 4, margin: "8px 7px 2px", padding: 6, border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "var(--apivoy-bg-elevated)" },
  workspaceSelect: { flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", color: "var(--apivoy-text)", fontSize: 12, fontWeight: 700 },
  search: { margin: "0 7px 7px", minWidth: 0, background: "var(--apivoy-bg-elevated)", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 7, padding: "8px 9px", fontSize: 11, outline: "none" },
  batchBar: { display: "flex", alignItems: "center", gap: 5, margin: "0 7px 7px", padding: "6px", borderRadius: 7, background: "var(--apivoy-accent-soft)", fontSize: 10 },
  batchSelect: { minWidth: 0, flex: 1, color: "var(--apivoy-text)", background: "var(--apivoy-bg-elevated)", border: "1px solid var(--apivoy-border)", borderRadius: 5, padding: 4, fontSize: 10 },
  project: { display: "flex", flexDirection: "column", gap: 2 },
  projectRow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, padding: "7px 8px", fontSize: 12 },
  projectName: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  projectActions: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0, marginLeft: "auto" },
  chevron: { color: "var(--apivoy-muted)" },
  chevronBtn: { flexShrink: 0, border: 0, background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", padding: 2, display: "inline-flex", alignItems: "center" },
  icon: { flexShrink: 0, border: 0, background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", fontSize: 16, padding: 2 },
  action: { flexShrink: 0, border: 0, background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", padding: "3px", display: "inline-flex", alignItems: "center" },
  moduleRow: { display: "flex", alignItems: "center", gap: 6, margin: "4px 6px 2px", padding: "7px 6px", borderRadius: 7, color: "var(--apivoy-text)", fontSize: 12 },
  moduleBadge: { marginLeft: "auto", color: "var(--apivoy-muted)", fontSize: 9, fontWeight: 500 },
  collection: { width: "100%", boxSizing: "border-box", display: "flex", gap: 4, alignItems: "center", background: "transparent", color: "var(--apivoy-text)", padding: "2px 5px 2px 22px", borderRadius: 7, fontSize: 12 },
  tags: { display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: 3, color: "#8da6b8", fontSize: 9 },
  collectionMain: { flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "18px minmax(0,1fr) auto", gap: 5, alignItems: "center", border: 0, background: "transparent", color: "inherit", padding: "5px 4px", textAlign: "left", cursor: "pointer", overflow: "hidden" },
  active: { background: "var(--apivoy-accent-soft)", color: "var(--apivoy-accent)" },
  requestRow: { display: "flex", alignItems: "center", gap: 4, minWidth: 0, paddingLeft: 39, borderRadius: 7 },
  request: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7, border: 0, background: "transparent", color: "inherit", padding: "7px 4px", cursor: "pointer", textAlign: "left", overflow: "hidden" },
  delete: { flexShrink: 0, opacity: .6, border: 0, background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", padding: "4px 6px", display: "inline-flex", alignItems: "center" },
  createBox: { display: "flex", gap: 5, padding: "8px" },
  input: { minWidth: 0, flex: 1, background: "var(--apivoy-bg-elevated)", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 7, padding: "7px 8px", fontSize: 12, outline: "none" },
  confirm: { border: 0, borderRadius: 7, background: "var(--apivoy-accent)", color: "#06121d", fontWeight: 700, cursor: "pointer", padding: "0 8px" },
};
