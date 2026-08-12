import assert from "node:assert/strict";
import test from "node:test";
import { flattenWorkspaceTree } from "./workspaceTreeRows";

const projects = [{ id: "p", workspaceId: "w", name: "Project" }];
const collections = [{ id: "b", projectId: "p", name: "B", parentId: null, sortOrder: 2 }, { id: "a", projectId: "p", name: "A", parentId: null, sortOrder: 1 }, { id: "child", projectId: "p", name: "Child", parentId: "a", sortOrder: 0 }];
const requests = [{ id: "r", projectId: "p", collectionId: "a", name: "Request", target: "/" }];

test("flattens workspace rows in visible tree order", () => {
  const rows = flattenWorkspaceTree({ projects, collections, requests, workspaceId: "w", collapsedNodes: [] });
  assert.deepEqual(rows.map((row) => [row.kind, row.id, row.depth]), [["project", "project:p", 0], ["collection", "collection:a", 1], ["request", "request:r", 2], ["collection", "collection:child", 2], ["collection", "collection:b", 1]]);
});

test("omits descendants of collapsed nodes", () => {
  const rows = flattenWorkspaceTree({ projects, collections, requests, workspaceId: "w", collapsedNodes: ["collection:a"] });
  assert.deepEqual(rows.map((row) => row.id), ["project:p", "collection:a", "collection:b"]);
});


test("keeps only the project row when a project is collapsed", () => {
  const rows = flattenWorkspaceTree({ projects, collections, requests, workspaceId: "w", collapsedNodes: ["project:p"] });
  assert.deepEqual(rows.map((row) => row.id), ["project:p"]);
});


test("filters projects by workspace", () => {
  const rows = flattenWorkspaceTree({ projects: [...projects, { id: "other", workspaceId: "other", name: "Other" }], collections, requests, workspaceId: "w", collapsedNodes: [] });
  assert.equal(rows.some((row) => row.id === "project:other"), false);
});
