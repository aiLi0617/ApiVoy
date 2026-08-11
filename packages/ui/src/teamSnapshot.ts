import type { RequestEnvelope } from "@apivoy/request-model";
import type { WorkspaceTree } from "./WorkspaceExplorer";

export interface TeamSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  tree: WorkspaceTree;
  requests: Array<{ originalId: string; projectId: string; collectionId: string; envelope: RequestEnvelope }>;
}
export interface TeamRestoreAdapter {
  getTree(): Promise<WorkspaceTree>;
  createWorkspace(name: string): Promise<WorkspaceTree["workspaces"][number]>;
  createProject(workspaceId: string, name: string): Promise<WorkspaceTree["projects"][number]>;
  createCollection(projectId: string, parentId: string | null, name: string): Promise<WorkspaceTree["collections"][number]>;
  saveEnvelope(envelope: RequestEnvelope, projectId: string, collectionId: string): Promise<void>;
}

const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|token|access.?token|refresh.?token|api.?key|client.?secret|secret)$/i;
function redact(value: unknown, key = ""): unknown {
  if (/ref$/i.test(key)) return value;
  if (sensitive.test(key)) return typeof value === "string" && value.includes("{{") ? value : "{{redacted}}";
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === "string" && sensitive.test(value[0])) return [value[0], typeof value[1] === "string" && value[1].includes("{{") ? value[1] : "{{redacted}}"];
    return value.map(item => redact(item));
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

export async function exportTeamSnapshot(tree: WorkspaceTree, loadEnvelope: (id: string) => Promise<RequestEnvelope | null>): Promise<TeamSnapshot> {
  const requests = (await Promise.all(tree.requests.map(async item => {
    const envelope = await loadEnvelope(item.id);
    return envelope ? { originalId: item.id, projectId: item.projectId, collectionId: item.collectionId, envelope: redact(envelope) as RequestEnvelope } : null;
  }))).filter((item): item is TeamSnapshot["requests"][number] => item !== null);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), tree: structuredClone(tree), requests };
}

export async function restoreTeamSnapshot(value: unknown, adapter: TeamRestoreAdapter): Promise<{ workspaces: number; projects: number; collections: number; requests: number }> {
  const snapshot = value as Partial<TeamSnapshot>;
  if (snapshot.schemaVersion !== 1 || !snapshot.tree || !Array.isArray(snapshot.requests)) throw new Error("不支持的团队快照格式");
  const current = await adapter.getTree(); const workspaceMap = new Map<string,string>(); const projectMap = new Map<string,string>(); const collectionMap = new Map<string,string>();
  for (const source of snapshot.tree.workspaces) { const target = current.workspaces.find(item => item.name === source.name) ?? await adapter.createWorkspace(source.name); workspaceMap.set(source.id,target.id); }
  for (const source of snapshot.tree.projects) { const workspaceId = workspaceMap.get(source.workspaceId); if (!workspaceId) continue; const target = current.projects.find(item => item.workspaceId === workspaceId && item.name === source.name) ?? await adapter.createProject(workspaceId,source.name); projectMap.set(source.id,target.id); }
  const pending = [...snapshot.tree.collections];
  while (pending.length) { let moved = false; for (let index=pending.length-1;index>=0;index--) { const source=pending[index]; const projectId=projectMap.get(source.projectId); const parentId=source.parentId ? collectionMap.get(source.parentId) : null; if (!projectId || (source.parentId && !parentId)) continue; const target=current.collections.find(item=>item.projectId===projectId&&(item.parentId??null)===(parentId??null)&&item.name===source.name)??await adapter.createCollection(projectId,parentId??null,source.name); collectionMap.set(source.id,target.id); pending.splice(index,1); moved=true; } if(!moved) throw new Error("团队快照包含无法解析的集合层级"); }
  let restored=0; for(const source of snapshot.requests){const projectId=projectMap.get(source.projectId),collectionId=collectionMap.get(source.collectionId);if(!projectId||!collectionId)continue;await adapter.saveEnvelope(source.envelope,projectId,collectionId);restored++;}
  return {workspaces:workspaceMap.size,projects:projectMap.size,collections:collectionMap.size,requests:restored};
}
