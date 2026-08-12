import { exportApiVoyProject, importDocument, type PortableRequest } from "@apivoy/import-export";
import { useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useFeedback } from "./Feedback";
import { Icon } from "./Icons";
import { useAppStore } from "./appStore";

export interface WorkspaceRecord { id: string; name: string; rootPath?: string | null; archived?: boolean; updatedAt?: string }
export interface ProjectRecord { id: string; workspaceId: string; name: string }
export interface CollectionRecord { id: string; projectId: string; name: string; parentId?: string | null; sortOrder: number; tags?: string[] }
export interface RequestRecord { id: string; projectId: string; collectionId: string; name: string; method?: string; target: string }
export interface WorkspaceTree { workspaces: WorkspaceRecord[]; projects: ProjectRecord[]; collections: CollectionRecord[]; requests: RequestRecord[] }

export interface WorkspaceExplorerProps {
  tree: WorkspaceTree | null;
  selectedCollectionId?: string | null;
  selectedRequestId?: string | null;
  onSelectCollection: (projectId: string, collectionId: string) => void;
  onOpenRequest: (id: string) => void;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (id: string, name: string) => Promise<void>;
  onArchiveWorkspace: (id: string, archived: boolean) => Promise<void>;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onTouchWorkspace: (id: string) => Promise<void>;
  onCreateProject: (workspaceId: string, name: string) => Promise<void>;
  onRenameProject: (id: string, name: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onCreateCollection: (projectId: string, parentId: string | null, name: string) => Promise<void>;
  onRenameCollection: (collection: CollectionRecord, name: string) => Promise<void>;
  onUpdateCollectionTags: (collection: CollectionRecord, tags: string[]) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  onDeleteRequest: (id: string) => Promise<void>;
  onMoveCollection: (collection: CollectionRecord, projectId: string, parentId: string | null) => Promise<void>;
  onSwapCollections: (first: CollectionRecord, second: CollectionRecord) => Promise<void>;
  onMoveRequest: (id: string, projectId: string, collectionId: string) => Promise<void>;
  onImportRequests: (projectId: string, collectionId: string, requests: PortableRequest[]) => Promise<void>;
  onExportProject: (project: ProjectRecord) => Promise<PortableRequest[]>;
}

export function WorkspaceExplorer(props: WorkspaceExplorerProps) {
  const [draft, setDraft] = useState<{ kind: "project"; owner: string } | { kind: "collection"; owner: string; parentId: string | null } | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchTarget, setBatchTarget] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const collapsedNodes = useAppStore((state) => state.collapsedExplorerNodes);
  const toggleExplorerNode = useAppStore((state) => state.toggleExplorerNode);
  const importInput = useRef<HTMLInputElement>(null);
  const { notify, confirm, prompt } = useFeedback();

  async function importFiles(files?: FileList | null) {
    if (!files?.length) return;
    const selected = [...files];
    const file = selected[0];
    const collection = tree?.collections.find((item) => item.id === props.selectedCollectionId);
    if (!collection) { notify("请先选择一个目标集合", "warning"); return; }
    try {
      const dependencyEntries = await Promise.all(selected.slice(1).map(async (dependency) => {
        const text = await dependency.text();
        return [[dependency.webkitRelativePath || dependency.name, text], [dependency.name, text]] as const;
      }));
      const result = await importDocument(await file.text(), {
        baseUri: file.webkitRelativePath || file.name,
        documents: Object.fromEntries(dependencyEntries.flat()),
      });
      await props.onImportRequests(collection.projectId, collection.id, result.requests);
      notify(`已从 ${result.source} 导入 ${result.requests.length} 个请求${result.warnings.length ? `\\n${result.warnings.join("\\n")}` : ""}`, "success");
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "danger"); }
    if (importInput.current) importInput.current.value = "";
  }

  async function exportProject(project: ProjectRecord) {
    try {
      const requests = await props.onExportProject(project);
      let content: string;
      try { content = exportApiVoyProject(project.name, requests); }
      catch (error) {
        if (!(await confirm({ title: "导出项目", description: `${error instanceof Error ? error.message : String(error)}\\n仍然继续导出吗？` }))) return;
        content = exportApiVoyProject(project.name, requests, true);
      }
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project.name.replace(/[^\w\u4e00-\u9fff-]+/g, "-")}.apivoy.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { notify(error instanceof Error ? error.message : String(error), "danger"); }
  }

  async function submit() {
    const value = name.trim();
    if (!draft || !value) return;
    if (draft.kind === "project") await props.onCreateProject(draft.owner, value);
    else await props.onCreateCollection(draft.owner, draft.parentId, value);
    setDraft(null);
    setName("");
  }

  const tree = props.tree;
  if (!tree) return <div style={styles.empty}>正在加载工作区…</div>;
  const workspace = tree.workspaces.find((item) => item.id === selectedWorkspaceId) ?? tree.workspaces[0];
  const selectedProjectIds = [...new Set(tree.requests.filter((item) => selectedIds.includes(item.id)).map((item) => item.projectId))];
  const normalizedQuery = query.trim().toLocaleLowerCase();
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
        if ((source.parentId ?? null) === (target.parentId ?? null)) void props.onSwapCollections(source, target);
        else void props.onMoveCollection(source, target.projectId, target.id);
      }
    }
  }
  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  async function batchDelete() {
    if (!selectedIds.length || !(await confirm({ title: "删除请求", description: `确定删除选中的 ${selectedIds.length} 个请求吗？`, tone: "danger", confirmLabel: "删除" }))) return;
    for (const id of selectedIds) await props.onDeleteRequest(id);
    setSelectedIds([]);
  }
  async function batchMove() {
    const target = tree!.collections.find((item) => item.id === batchTarget);
    if (!target) return;
    for (const id of selectedIds) await props.onMoveRequest(id, target.projectId, target.id);
    setSelectedIds([]);
  }
  function renderCollection(collection: CollectionRecord, depth = 0) {
    const requests = tree!.requests.filter((item) => item.collectionId === collection.id);
    const siblings = tree!.collections.filter((item) => item.projectId === collection.projectId && (item.parentId ?? null) === (collection.parentId ?? null)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const siblingIndex = siblings.findIndex((item) => item.id === collection.id);
    const children = tree!.collections.filter((item) => item.parentId === collection.id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const isCollapsed = collapsedNodes.includes(`collection:${collection.id}`);
    return <div key={collection.id} role="treeitem" aria-level={depth + 1} aria-setsize={siblings.length} aria-posinset={siblingIndex + 1} aria-expanded={!isCollapsed} aria-label={`集合 ${collection.name}`}>
      <div draggable onDragStart={(event) => setDrag(event, "collection", collection.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnCollection(event, collection)} className="tree-row" style={{...styles.collection, paddingLeft: 22 + depth * 14, ...(props.selectedCollectionId === collection.id ? styles.active : {})}}>
        <button aria-label={`${collapsedNodes.includes(`collection:${collection.id}`) ? "展开" : "折叠"}集合 ${collection.name}`} aria-expanded={!collapsedNodes.includes(`collection:${collection.id}`)} style={styles.icon} onClick={() => toggleExplorerNode(`collection:${collection.id}`)}><Icon name="chevron" /></button><button style={styles.collectionMain} onClick={() => props.onSelectCollection(collection.projectId, collection.id)}><Icon name="folder" /><span>{collection.name}</span><small>{requests.length}</small></button>
        <button disabled={siblingIndex <= 0} style={styles.action} title="上移集合" onClick={() => void props.onSwapCollections(collection, siblings[siblingIndex - 1])}><Icon name="arrow-up" /></button>
        <button disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1} style={styles.action} title="下移集合" onClick={() => void props.onSwapCollections(collection, siblings[siblingIndex + 1])}><Icon name="arrow-down" /></button>
        <button style={styles.icon} title="新建子集合" onClick={() => setDraft({ kind: "collection", owner: collection.projectId, parentId: collection.id })}><Icon name="plus" /></button>
        <button style={styles.action} title="重命名集合" onClick={async () => { const value = (await prompt({ title: "重命名集合", initialValue: collection.name }))?.trim(); if (value) void props.onRenameCollection(collection, value); }}><Icon name="edit" /></button>
        <button style={styles.action} title={collection.tags?.length ? `标签：${collection.tags.join(", ")}` : "设置标签"} onClick={async () => { const value = await prompt({ title: "设置集合标签", initialValue: collection.tags?.join(", ") ?? "", placeholder: "标签以逗号分隔" }); if (value !== null) void props.onUpdateCollectionTags(collection, value.split(",").map((tag) => tag.trim()).filter(Boolean)); }}><Icon name="tag" /></button>
        {collection.id !== "default-collection" && <button style={styles.delete} title="删除集合" onClick={async () => { if (await confirm({ title: "删除集合", description: `删除集合“${collection.name}”及其中全部内容？`, tone: "danger", confirmLabel: "删除" })) void props.onDeleteCollection(collection.id); }}><Icon name="trash" /></button>}
      </div>
      {!isCollapsed && !!collection.tags?.length && <div style={{ ...styles.tags, paddingLeft: 39 + depth * 14 }}>{collection.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      {!isCollapsed && requests.filter((request) => !normalizedQuery || `${request.name} ${request.target}`.toLocaleLowerCase().includes(normalizedQuery)).map((request) => <div draggable onDragStart={(event) => setDrag(event, "request", request.id)} className="tree-row" role="treeitem" aria-level={depth + 2} key={request.id} style={{...styles.requestRow, paddingLeft: 39 + depth * 14, ...(props.selectedRequestId === request.id ? styles.active : {})}}>
        <input type="checkbox" checked={selectedIds.includes(request.id)} onChange={() => toggleSelected(request.id)} title="批量选择" />
        <button style={styles.request} onClick={() => props.onOpenRequest(request.id)} title={request.target}><b>{request.method ?? "HTTP"}</b><span>{request.name}</span></button>
        <button style={styles.delete} title="删除请求" onClick={async () => { if (await confirm({ title: "删除请求", description: `确定删除请求“${request.name}”吗？`, tone: "danger", confirmLabel: "删除" })) void props.onDeleteRequest(request.id); }}><Icon name="trash" /></button>
      </div>)}
      {!isCollapsed && children.filter(collectionMatches).map((child) => renderCollection(child, depth + 1))}
    </div>;
  }
  return <section style={styles.root} role="tree" aria-label="工作区资源树">
    <div style={styles.workspaceBar}>
      <select aria-label="选择工作区" style={styles.workspaceSelect} value={workspace?.id ?? ""} onChange={(event) => { setSelectedWorkspaceId(event.target.value); void props.onTouchWorkspace(event.target.value); }}>
        {tree.workspaces.map((item) => <option key={item.id} value={item.id}>{item.archived ? `【已归档】${item.name}` : item.name}</option>)}
      </select>
      <button style={styles.action} title="新建工作区" onClick={async () => { const value = (await prompt({ title: "新建工作区" }))?.trim(); if (value) void props.onCreateWorkspace(value); }}><Icon name="plus" /></button>
      {workspace && <button style={styles.action} title="重命名工作区" onClick={async () => { const value = (await prompt({ title: "重命名工作区", initialValue: workspace.name }))?.trim(); if (value) void props.onRenameWorkspace(workspace.id, value); }}><Icon name="edit" /></button>}
      {workspace && workspace.id !== "default-workspace" && <button style={styles.action} title={workspace.archived ? "恢复工作区" : "归档工作区"} onClick={async () => { if (workspace.archived || await confirm({ title: "归档工作区", description: `归档工作区“${workspace.name}”？` })) void props.onArchiveWorkspace(workspace.id, !workspace.archived); }}>{workspace.archived ? "恢复" : "归档"}</button>}
      {workspace && workspace.id !== "default-workspace" && <button style={styles.delete} title="永久删除工作区" onClick={async () => { if (await confirm({ title: "永久删除工作区", description: `永久删除工作区“${workspace.name}”及其全部内容？此操作不可恢复。`, tone: "danger", confirmLabel: "永久删除" })) void props.onDeleteWorkspace(workspace.id); }}><Icon name="trash" /></button>}
    </div>
    <div style={styles.heading}>
      <span>资源管理器</span>
      <span style={styles.headingActions}><button style={styles.action} title="导入 OpenAPI JSON/YAML、Postman、HAR 或 ApiVoy 包" onClick={() => importInput.current?.click()}>导入</button>{workspace && <button style={styles.icon} title="新建项目" onClick={() => setDraft({ kind: "project", owner: workspace.id })}><Icon name="plus" /></button>}</span>
      <input ref={importInput} hidden multiple type="file" accept=".json,.yaml,.yml,.har,.apivoy" onChange={(event) => void importFiles(event.target.files)} />
    </div>
    <input aria-label="搜索资源" style={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索请求、集合或 URL" />
    {selectedIds.length > 0 && <div style={styles.batchBar}>
      <strong>{selectedIds.length} 已选</strong>
      <select aria-label="批量移动目标集合" style={styles.batchSelect} value={batchTarget} onChange={(event) => setBatchTarget(event.target.value)} disabled={selectedProjectIds.length !== 1}><option value="">{selectedProjectIds.length === 1 ? "移动到…" : "跨项目不可批量移动"}</option>{tree.collections.filter((item) => item.projectId === selectedProjectIds[0]).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button style={styles.action} disabled={!batchTarget} onClick={() => void batchMove()}>移动</button>
      <button style={styles.delete} onClick={() => void batchDelete()}>删除</button>
    </div>}
    {tree.projects.filter((project) => project.workspaceId === workspace?.id).filter((project) => !normalizedQuery || project.name.toLocaleLowerCase().includes(normalizedQuery) || tree.collections.some((item) => item.projectId === project.id && collectionMatches(item))).map((project, projectIndex, visibleProjects) => <div key={project.id} className="tree-project" style={styles.project} role="treeitem" aria-level={1} aria-setsize={visibleProjects.length} aria-posinset={projectIndex + 1} aria-label={`项目 ${project.name}`}>
      <div style={styles.projectRow} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const item = readDrag(event); if (item?.type === "collection") { const source = tree.collections.find((collection) => collection.id === item.id); if (source?.projectId === project.id) void props.onMoveCollection(source, project.id, null); } }}>
        <button aria-label={`${collapsedNodes.includes(`project:${project.id}`) ? "展开" : "折叠"}项目 ${project.name}`} aria-expanded={!collapsedNodes.includes(`project:${project.id}`)} style={styles.icon} onClick={() => toggleExplorerNode(`project:${project.id}`)}><Icon name="chevron" /></button><strong title={project.name}>{project.name}</strong>
        <button style={styles.icon} title="新建集合" onClick={() => setDraft({ kind: "collection", owner: project.id, parentId: null })}><Icon name="plus" /></button>
        <button style={styles.action} title="重命名项目" onClick={async () => { const value = (await prompt({ title: "重命名项目", initialValue: project.name }))?.trim(); if (value) void props.onRenameProject(project.id, value); }}><Icon name="edit" /></button>
        <button style={styles.action} title="导出项目包" onClick={() => void exportProject(project)}><Icon name="download" /></button>
        {project.id !== "default-project" && <button style={styles.delete} title="删除项目" onClick={async () => { if (await confirm({ title: "删除项目", description: `删除项目“${project.name}”及其中全部内容？`, tone: "danger", confirmLabel: "删除" })) void props.onDeleteProject(project.id); }}><Icon name="trash" /></button>}
      </div>
      {!collapsedNodes.includes(`project:${project.id}`) && tree.collections.filter((item) => item.projectId === project.id && !item.parentId && collectionMatches(item)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((collection) => renderCollection(collection))}
    </div>)}
    {draft && <div style={styles.createBox}>
      <input autoFocus style={styles.input} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); if (event.key === "Escape") setDraft(null); }} placeholder={draft.kind === "project" ? "项目名称" : "集合名称"} />
      <button style={styles.confirm} onClick={() => void submit()}>创建</button>
    </div>}
  </section>;
}

const styles: Record<string, CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: 6, minHeight: 0 },
  empty: { color: "var(--apivoy-muted)", fontSize: 12, padding: 10 },
  heading: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 10px 7px", color: "var(--apivoy-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  headingActions: { display: "flex", alignItems: "center", gap: 4 },
  workspaceBar: { display: "flex", alignItems: "center", gap: 4, margin: "8px 7px 2px", padding: 6, border: "1px solid var(--apivoy-border)", borderRadius: 8, background: "#0b1118" },
  workspaceSelect: { flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", color: "var(--apivoy-text)", fontSize: 12, fontWeight: 700 },
  search: { margin: "0 7px 7px", minWidth: 0, background: "#0d131b", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 7, padding: "8px 9px", fontSize: 11, outline: "none" },
  batchBar: { display: "flex", alignItems: "center", gap: 5, margin: "0 7px 7px", padding: "6px", borderRadius: 7, background: "var(--apivoy-accent-soft)", fontSize: 10 },
  batchSelect: { minWidth: 0, flex: 1, color: "var(--apivoy-text)", background: "#0d131b", border: "1px solid var(--apivoy-border)", borderRadius: 5, padding: 4, fontSize: 10 },
  project: { display: "flex", flexDirection: "column", gap: 2 },
  projectRow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, padding: "7px 8px", fontSize: 12 },
  chevron: { color: "var(--apivoy-muted)" },
  icon: { marginLeft: "auto", border: 0, background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", fontSize: 16 },
  action: { border: 0, background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", padding: "3px" },
  collection: { width: "100%", display: "flex", gap: 5, alignItems: "center", background: "transparent", color: "var(--apivoy-text)", padding: "2px 5px 2px 22px", borderRadius: 7, fontSize: 12 },
  tags: { display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: 3, color: "#8da6b8", fontSize: 9 },
  collectionMain: { flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "18px 1fr auto", gap: 5, alignItems: "center", border: 0, background: "transparent", color: "inherit", padding: "5px 4px", textAlign: "left", cursor: "pointer" },
  active: { background: "var(--apivoy-accent-soft)", color: "var(--apivoy-accent)" },
  requestRow: { display: "flex", alignItems: "center", paddingLeft: 39, borderRadius: 7 },
  request: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7, border: 0, background: "transparent", color: "inherit", padding: "7px 4px", cursor: "pointer", textAlign: "left" },
  delete: { opacity: .6, border: 0, background: "transparent", color: "var(--apivoy-muted)", cursor: "pointer", padding: "4px 8px" },
  createBox: { display: "flex", gap: 5, padding: "8px" },
  input: { minWidth: 0, flex: 1, background: "#0d131b", color: "var(--apivoy-text)", border: "1px solid var(--apivoy-border)", borderRadius: 7, padding: "7px 8px", fontSize: 12, outline: "none" },
  confirm: { border: 0, borderRadius: 7, background: "var(--apivoy-accent)", color: "#06121d", fontWeight: 700, cursor: "pointer", padding: "0 8px" },
};
