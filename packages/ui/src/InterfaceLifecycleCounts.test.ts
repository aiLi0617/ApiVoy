import assert from "node:assert/strict";
import test from "node:test";
import {
  definitionAreaCount,
  type DefinitionField,
  type ResponseDefinition,
} from "./InterfaceLifecycle";

test("counts response scenes instead of response fields in the primary tab", () => {
  const fields = [
    { id: "request", name: "id", type: "string", required: false, description: "", scope: "request.params" },
    { id: "response", name: "name", type: "string", required: false, description: "", scope: "response.body", responseId: "success" },
  ] satisfies DefinitionField[];
  const responses = [
    { id: "success", name: "成功", statusCode: "200", bodyType: "json", contentType: "application/json" },
    { id: "duplicate", name: "成功", statusCode: "200", bodyType: "json", contentType: "application/json" },
  ] satisfies ResponseDefinition[];

  assert.equal(definitionAreaCount("request", fields, responses), 1);
  assert.equal(definitionAreaCount("response", fields, responses), 2);
});
