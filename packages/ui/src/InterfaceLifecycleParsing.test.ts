import assert from "node:assert/strict";
import test from "node:test";
import { parseDefinitionFields } from "./InterfaceLifecycle";

test("restores OpenAPI parameter locations after reloading a saved design", () => {
  const source = `openapi: 3.1.2
info:
  title: Current API
  version: 1.0.0
paths:
  /current:
    get:
      parameters:
        - name: asd
          in: query
          required: false
          schema:
            type: string
      responses:
        '200':
          description: Response 200`;
  const fields = parseDefinitionFields(source, "http");
  assert.deepEqual(fields.map(({ name, scope, type, required }) => ({ name, scope, type, required })), [
    { name: "asd", scope: "request.params", type: "string", required: false },
  ]);
  assert.equal(fields.some((field) => field.name === "in"), false);
});

test("restores nested visual fields from a saved OpenAPI definition", () => {
  const visualFields = [
    { id: "name", name: "name", type: "string", required: false, description: "", scope: "request.body" },
    { id: "tags", name: "tags", type: "array", required: false, description: "", scope: "request.body" },
    { id: "items", parentId: "tags", name: "items", type: "object", required: false, description: "", scope: "request.body" },
    { id: "label", parentId: "items", name: "label", type: "string", required: true, description: "tag label", scope: "request.body" },
  ];
  const source = `openapi: 3.1.2\nx-apivoy-body-mode: json\nx-apivoy-visual-fields: ${JSON.stringify(visualFields)}\ninfo:\n  title: Current API\n  version: 1.0.0`;
  assert.deepEqual(parseDefinitionFields(source, "http"), visualFields);
});
