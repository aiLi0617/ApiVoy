import assert from "node:assert/strict";
import test from "node:test";
import { mergeDesignIntoHttpDraft, type DefinitionField } from "./InterfaceLifecycle";

const baseDraft = { url: "https://api.example.com/users?existing=kept", method: "POST", headers: [["X-Existing", "kept"]] as Array<[string, string]>, body: "", timeoutMs: 30000, variables: {}, assertions: [], followRedirects: true, retryMax: 0, retryBackoffMs: 250, tlsVerify: true };
const field = (name: string, scope: DefinitionField["scope"], type = "string"): DefinitionField => ({ id: name, name, scope, type, required: false, description: "" });

test("merges design structure into HTTP debugging without replacing existing values", () => {
  const result = mergeDesignIntoHttpDraft(baseDraft, [field("page", "request.params", "integer"), field("X-Existing", "request.headers"), field("X-Tenant", "request.headers"), field("session", "request.cookies"), field("name", "request.body")]);
  assert.match(result.url, /existing=kept/);
  assert.match(result.url, /page=/);
  assert.deepEqual(result.headers.find(([name]) => name === "X-Existing"), ["X-Existing", "kept"]);
  assert.deepEqual(result.headers.find(([name]) => name === "X-Tenant"), ["X-Tenant", ""]);
  assert.match(result.headers.find(([name]) => name === "Cookie")?.[1] ?? "", /session=/);
  assert.equal(result.body, '{\n  "name": ""\n}');
});
