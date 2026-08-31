import assert from "node:assert/strict";
import test from "node:test";
import { resolveDefaultSaveCollectionId } from "./HttpWorkbench";

test("prefers the system default over the active directory", () => {
  assert.equal(
    resolveDefaultSaveCollectionId([{ id: "default-collection" }, { id: "custom" }], "custom"),
    "default-collection",
  );
});

test("falls back to the system default directory", () => {
  assert.equal(
    resolveDefaultSaveCollectionId([{ id: "custom" }, { id: "default-collection" }], "missing"),
    "default-collection",
  );
});

test("uses the first root directory when no system default exists", () => {
  assert.equal(
    resolveDefaultSaveCollectionId([{ id: "child", parentId: "root" }, { id: "root" }], ""),
    "root",
  );
});
