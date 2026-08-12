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
  const rootCollectionsByProject = new Map<string, CollectionRecord[]>();
  const childCollectionsByParent = new Map<string, CollectionRecord[]>();
  const requestsByCollection = new Map<string, RequestRecord[]>();
  const sortCollections = (items: CollectionRecord[]) => items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  collections.forEach((collection) => {
    const index = collection.parentId ? childCollectionsByParent : rootCollectionsByProject;
    const key = collection.parentId ?? collection.projectId;
    index.set(key, [...(index.get(key) ?? []), collection]);
  });
  rootCollectionsByProject.forEach(sortCollections);
  childCollectionsByParent.forEach(sortCollections);
  requests.forEach((request) => requestsByCollection.set(request.collectionId, [...(requestsByCollection.get(request.collectionId) ?? []), request]));

  function appendCollection(collection: CollectionRecord, depth: number) {
    rows.push({ kind: "collection", id: `collection:${collection.id}`, depth, collection });
    if (collapsed.has(`collection:${collection.id}`)) return;
    (requestsByCollection.get(collection.id) ?? []).forEach((request) => rows.push({ kind: "request", id: `request:${request.id}`, depth: depth + 1, request }));
    (childCollectionsByParent.get(collection.id) ?? []).forEach((child) => appendCollection(child, depth + 1));
  }

  projects.filter((project) => !workspaceId || project.workspaceId === workspaceId).forEach((project) => {
    rows.push({ kind: "project", id: `project:${project.id}`, depth: 0, project });
    if (collapsed.has(`project:${project.id}`)) return;
    (rootCollectionsByProject.get(project.id) ?? []).forEach((collection) => appendCollection(collection, 1));
  });
  return rows;
}
