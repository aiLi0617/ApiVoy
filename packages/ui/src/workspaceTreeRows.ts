import type { CollectionRecord, ProjectRecord, RequestRecord } from "./WorkspaceExplorer";

export type WorkspaceTreeRow =
  | { kind: "project"; id: string; depth: 0; project: ProjectRecord }
  | { kind: "collection"; id: string; depth: number; collection: CollectionRecord }
  | { kind: "request"; id: string; depth: number; request: RequestRecord };

export interface FlattenWorkspaceTreeOptions {
  projects: readonly ProjectRecord[];
  collections: readonly CollectionRecord[];
  requests: readonly RequestRecord[];
  workspaceId?: string;
  collapsedNodes: readonly string[];
}

export function flattenWorkspaceTree({ projects, collections, requests, workspaceId, collapsedNodes }: FlattenWorkspaceTreeOptions): WorkspaceTreeRow[] {
  const collapsed = new Set(collapsedNodes);
  const rows: WorkspaceTreeRow[] = [];

  function appendCollection(collection: CollectionRecord, depth: number) {
    rows.push({ kind: "collection", id: `collection:${collection.id}`, depth, collection });
    if (collapsed.has(`collection:${collection.id}`)) return;
    requests.filter((request) => request.collectionId === collection.id).forEach((request) => rows.push({ kind: "request", id: `request:${request.id}`, depth: depth + 1, request }));
    collections.filter((item) => item.parentId === collection.id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).forEach((child) => appendCollection(child, depth + 1));
  }

  projects.filter((project) => !workspaceId || project.workspaceId === workspaceId).forEach((project) => {
    rows.push({ kind: "project", id: `project:${project.id}`, depth: 0, project });
    if (collapsed.has(`project:${project.id}`)) return;
    collections.filter((collection) => collection.projectId === project.id && !collection.parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).forEach((collection) => appendCollection(collection, 1));
  });
  return rows;
}
