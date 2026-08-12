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
  query?: string;
}

export function flattenWorkspaceTree({ projects, collections, requests, workspaceId, collapsedNodes, query }: FlattenWorkspaceTreeOptions): WorkspaceTreeRow[] {
  const collapsed = new Set(collapsedNodes);
  const rows: WorkspaceTreeRow[] = [];
  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? "";
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

  const requestMatches = (request: RequestRecord) => !normalizedQuery || `${request.name} ${request.target}`.toLocaleLowerCase().includes(normalizedQuery);
  function collectionMatches(collection: CollectionRecord): boolean {
    if (!normalizedQuery || collection.name.toLocaleLowerCase().includes(normalizedQuery)) return true;
    if ((requestsByCollection.get(collection.id) ?? []).some(requestMatches)) return true;
    return (childCollectionsByParent.get(collection.id) ?? []).some(collectionMatches);
  }

  function appendCollection(collection: CollectionRecord, depth: number) {
    if (!collectionMatches(collection)) return;
    rows.push({ kind: "collection", id: `collection:${collection.id}`, depth, collection });
    if (collapsed.has(`collection:${collection.id}`)) return;
    (requestsByCollection.get(collection.id) ?? []).filter(requestMatches).forEach((request) => rows.push({ kind: "request", id: `request:${request.id}`, depth: depth + 1, request }));
    (childCollectionsByParent.get(collection.id) ?? []).forEach((child) => appendCollection(child, depth + 1));
  }

  projects.filter((project) => !workspaceId || project.workspaceId === workspaceId).filter((project) => !normalizedQuery || project.name.toLocaleLowerCase().includes(normalizedQuery) || (rootCollectionsByProject.get(project.id) ?? []).some(collectionMatches)).forEach((project) => {
    rows.push({ kind: "project", id: `project:${project.id}`, depth: 0, project });
    if (collapsed.has(`project:${project.id}`)) return;
    (rootCollectionsByProject.get(project.id) ?? []).forEach((collection) => appendCollection(collection, 1));
  });
  return rows;
}
