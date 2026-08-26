import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  defaultJsonTreeValue,
  parseJsonTreeSource,
  removeJsonTreeValue,
  updateJsonTreeValue,
} from "./JsonTreeEditor";

test("array type starts with one editable item", () => {
  assert.deepEqual(defaultJsonTreeValue("array"), [""]);
});

test("updates and removes deeply nested JSON values immutably", () => {
  const source = { user: { tags: ["first", "second"] } };
  const updated = updateJsonTreeValue(source, ["user", "tags", 1], "changed");
  const removed = removeJsonTreeValue(updated, ["user", "tags", 0]);

  assert.deepEqual(source, { user: { tags: ["first", "second"] } });
  assert.deepEqual(removed, { user: { tags: ["changed"] } });
});

test("reports invalid JSON without replacing the source", () => {
  assert.equal(parseJsonTreeSource('{"broken":').ok, false);
});
