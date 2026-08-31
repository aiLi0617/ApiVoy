import assert from "node:assert/strict";
import test from "node:test";
import { flattenSaveCollections } from "./HttpWorkbench";

test("keeps every child directly below its own parent", () => {
  const ordered = flattenSaveCollections([
    { id: "default", parentId: null },
    { id: "other", parentId: null },
    { id: "default-child", parentId: "default" },
    { id: "other-child", parentId: "other" },
  ]);
  assert.deepEqual(ordered.map(({ collection, depth }) => [collection.id, depth]), [
    ["default", 0],
    ["default-child", 1],
    ["other", 0],
    ["other-child", 1],
  ]);
});

test("keeps orphaned and cyclic entries without recursing forever", () => {
  const ordered = flattenSaveCollections([
    { id: "orphan", parentId: "missing" },
    { id: "cycle-a", parentId: "cycle-b" },
    { id: "cycle-b", parentId: "cycle-a" },
  ]);
  assert.deepEqual(ordered.map(({ collection }) => collection.id), ["orphan", "cycle-a", "cycle-b"]);
});
