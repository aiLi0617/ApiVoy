import assert from "node:assert/strict";
import test from "node:test";
import { definitionFieldsFromHttpDraft } from "./InterfaceLifecycle";

const fields = definitionFieldsFromHttpDraft({ url: "https://example.com", method: "POST", headers: [["Content-Type", "application/json"]], body: '{"users":[{"name":"Ada","roles":["admin"]}]}', timeoutMs: 30000, variables: {}, assertions: [], followRedirects: true, retryMax: 0, retryBackoffMs: 250, tlsVerify: true });

test("cURL JSON arrays become array items and nested design fields", () => {
  const byName = (name: string) => fields.filter((field) => field.name === name);
  const users = byName("users")[0];
  const userItems = byName("items").find((field) => field.parentId === users.id)!;
  const name = byName("name").find((field) => field.parentId === userItems.id)!;
  const roles = byName("roles").find((field) => field.parentId === userItems.id)!;
  const roleItems = byName("items").find((field) => field.parentId === roles.id)!;
  assert.equal(users.type, "array");
  assert.equal(userItems.type, "object");
  assert.equal(name.example, "Ada");
  assert.equal(roles.type, "array");
  assert.equal(roleItems.example, "admin");
});
