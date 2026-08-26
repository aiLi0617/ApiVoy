import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  changeDefinitionFieldType,
  type DefinitionField,
} from "./InterfaceLifecycle";

const root: DefinitionField = {
  id: "root",
  name: "payload",
  type: "string",
  required: false,
  description: "",
  scope: "request.body",
};

test("selecting array automatically creates a single items field", () => {
  const arrayFields = changeDefinitionFieldType([root], root.id, "array");
  const children = arrayFields.filter((field) => field.parentId === root.id);

  assert.equal(arrayFields[0]?.type, "array");
  assert.equal(children.length, 1);
  assert.equal(children[0]?.name, "items");
  assert.equal(children[0]?.type, "string");

  const unchanged = changeDefinitionFieldType(arrayFields, root.id, "array");
  assert.equal(
    unchanged.filter((field) => field.parentId === root.id).length,
    1,
  );
});

test("switching an array to a scalar removes its items branch", () => {
  const arrayFields = changeDefinitionFieldType([root], root.id, "array");
  const scalarFields = changeDefinitionFieldType(arrayFields, root.id, "string");

  assert.deepEqual(scalarFields, [root]);
});

test("params keep array and object types without creating child fields", () => {
  const param: DefinitionField = {
    ...root,
    id: "filter",
    name: "filter",
    scope: "request.params",
  };

  const arrayFields = changeDefinitionFieldType([param], param.id, "array");
  assert.equal(arrayFields[0]?.type, "array");
  assert.equal(arrayFields.some((field) => field.parentId === param.id), false);

  const staleChild: DefinitionField = {
    ...root,
    id: "stale-child",
    parentId: param.id,
    scope: "request.params",
  };
  const objectFields = changeDefinitionFieldType(
    [...arrayFields, staleChild],
    param.id,
    "object",
  );
  assert.equal(objectFields[0]?.type, "object");
  assert.equal(objectFields.length, 1);
});
